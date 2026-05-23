'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { FondoEstado, TipoAporte } from '@/types'

function cleanDbError(msg: string): string {
  return msg.replace(/^ERROR:\s*/i, '').replace(/\s*CONTEXT:[\s\S]*$/i, '').trim()
}

export async function createFondo(data: {
  nombre: string
  moneda: string
  monto_inicial: number
  descripcion: string | null
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')

  const payload = {
    nombre: data.nombre,
    moneda: data.moneda,
    monto_inicial: data.monto_inicial,
    descripcion: data.descripcion,
    created_by: user.id,
  }

  // ─── Diagnóstico RLS (logs temporales) ─────────────────────────────────────
  console.log("AUTH USER:", user)
  console.log("USER ID:", user?.id)
  console.log("PAYLOAD FONDO:", payload)
  console.log("CREATED_BY:", payload.created_by)

  // Confirma rol según sesión actual (la misma que evaluará la policy)
  const roleResult = await supabase.rpc('get_my_role')
  console.log("GET_MY_ROLE result:", roleResult.data, "error:", roleResult.error?.message)

  // Verifica que la sesión del SQL ve al usuario: si SELECT sobre profiles
  // devuelve la fila propia, auth.uid() está seteado en la sesión SQL.
  const profileCheck = await supabase
    .from('profiles')
    .select('id, role, email')
    .eq('id', user.id)
    .maybeSingle()
  console.log("PROFILE SELF-CHECK:", profileCheck.data, "error:", profileCheck.error?.message)

  // INSERT con .select() para obtener data si pasa, y detalle si rebota
  const { data: inserted, error } = await supabase
    .from('fondos')
    .insert(payload)
    .select()

  console.log("INSERT DATA:", inserted)
  console.log("INSERT ERROR:", error ? { code: error.code, message: error.message, details: error.details, hint: error.hint } : null)

  if (error) throw new Error(cleanDbError(error.message))
  revalidatePath('/fondos')
}

export async function updateFondo(
  id: string,
  data: { nombre: string; descripcion: string | null; estado: FondoEstado }
) {
  const supabase = createClient()
  const { error } = await supabase
    .from('fondos')
    .update({ nombre: data.nombre, descripcion: data.descripcion, estado: data.estado })
    .eq('id', id)
    .is('deleted_at', null)
  if (error) throw new Error(cleanDbError(error.message))
  revalidatePath('/fondos')
}

export type FondoActionResult = { ok: true } | { ok: false; error: string }

// Conteos + saldo del fondo, antes de mostrar el confirm de baja.
// Read-only.
export type FondoDepsResult =
  | {
      ok: true
      nombre: string
      moneda: string
      saldo_actual: number
      gastos: number
      pagos: number
      aportes: number
      movimientos: number
    }
  | { ok: false; error: string }

export async function getFondoDependencies(id: string): Promise<FondoDepsResult> {
  try {
    const supabase = createClient()

    const [fondoRes, gastos, pagos, aportes, movimientos] = await Promise.all([
      supabase
        .from('fondos')
        .select('nombre, moneda, saldo_actual')
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('gastos')
        .select('id', { count: 'exact', head: true })
        .eq('fondo_id', id),
      supabase
        .from('pagos')
        .select('id', { count: 'exact', head: true })
        .eq('fondo_id', id),
      supabase
        .from('aportes_fondo')
        .select('id', { count: 'exact', head: true })
        .eq('fondo_id', id),
      supabase
        .from('movimientos_fondo')
        .select('id', { count: 'exact', head: true })
        .eq('fondo_id', id),
    ])

    if (fondoRes.error) return { ok: false, error: fondoRes.error.message }
    if (!fondoRes.data) return { ok: false, error: 'Fondo no encontrado' }

    return {
      ok: true,
      nombre: fondoRes.data.nombre,
      moneda: fondoRes.data.moneda,
      saldo_actual: Number(fondoRes.data.saldo_actual),
      gastos: gastos.count ?? 0,
      pagos: pagos.count ?? 0,
      aportes: aportes.count ?? 0,
      movimientos: movimientos.count ?? 0,
    }
  } catch (err) {
    console.error('[getFondoDependencies] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

// Soft delete vía RPC SECURITY DEFINER. La función SQL public.soft_delete_fondo
// valida auth.uid() y saldo_actual = 0 antes del UPDATE. Si saldo != 0, RAISE
// EXCEPTION con mensaje legible; lo capturamos como ActionResult.
//
// BAJA LÓGICA: no borra movimientos, gastos, pagos ni aportes. El fondo
// solo deja de estar disponible para nuevas operaciones.
export async function deleteFondo(id: string, motivo?: string | null): Promise<FondoActionResult> {
  try {
    const supabase = createClient()
    const { error } = await supabase.rpc('soft_delete_fondo', {
      fondo_id: id,
      motivo: motivo ?? null,
    })
    if (error) {
      console.error('[deleteFondo] RPC error:', { code: error.code, message: error.message })
      return { ok: false, error: cleanDbError(error.message) }
    }
    revalidatePath('/fondos')
    return { ok: true }
  } catch (err) {
    console.error('[deleteFondo] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

export type AportePayload = {
  fondo_id: string
  fecha_aporte: string
  monto: number
  tipo_aporte: TipoAporte
  aportante: string | null
  concepto: string
  comprobante_url: string | null
  observaciones: string | null
}

export async function registrarAporte(data: AportePayload) {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_registrar_aporte', {
    p_fondo_id:        data.fondo_id,
    p_fecha_aporte:    data.fecha_aporte,
    p_monto:           data.monto,
    p_tipo_aporte:     data.tipo_aporte,
    p_aportante:       data.aportante,
    p_concepto:        data.concepto,
    p_comprobante_url: data.comprobante_url,
    p_observaciones:   data.observaciones,
  })
  if (error) throw new Error(cleanDbError(error.message))
  revalidatePath('/fondos')
}

// ─── Etapa 2B: crear socio ───────────────────────────────────────────────────

export type SocioPayload = {
  nombre:        string
  cuit:          string | null
  email:         string | null
  telefono:      string | null
  observaciones: string | null
}

export type SocioActionResult =
  | { ok: true; id: string; codigo: string | null; nombre: string }
  | { ok: false; error: string }

export async function crearSocio(data: SocioPayload): Promise<SocioActionResult> {
  try {
    const supabase = createClient()
    const auth = await supabase.auth.getUser()
    if (!auth.data?.user) return { ok: false, error: 'No autenticado' }

    const nombre = data.nombre.trim()
    if (!nombre) return { ok: false, error: 'El nombre es requerido.' }

    const payload = {
      nombre,
      cuit:          data.cuit?.trim() || null,
      email:         data.email?.trim() || null,
      telefono:      data.telefono?.trim() || null,
      observaciones: data.observaciones?.trim() || null,
      created_by:    auth.data.user.id,
    }

    const { data: inserted, error } = await supabase
      .from('socios')
      .insert(payload)
      .select('id, codigo, nombre')
      .single()

    if (error) {
      console.error('[crearSocio] insert error:', { code: error.code, message: error.message })
      return { ok: false, error: cleanDbError(error.message) }
    }
    if (!inserted) return { ok: false, error: 'No se pudo crear el socio.' }

    revalidatePath('/fondos')
    return { ok: true, id: inserted.id, codigo: inserted.codigo, nombre: inserted.nombre }
  } catch (err) {
    console.error('[crearSocio] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

// ─── Etapa 2B: crear financiador ─────────────────────────────────────────────

export type FinanciadorPayload = SocioPayload

export type FinanciadorActionResult =
  | { ok: true; id: string; codigo: string | null; nombre: string }
  | { ok: false; error: string }

export async function crearFinanciador(data: FinanciadorPayload): Promise<FinanciadorActionResult> {
  try {
    const supabase = createClient()
    const auth = await supabase.auth.getUser()
    if (!auth.data?.user) return { ok: false, error: 'No autenticado' }

    const nombre = data.nombre.trim()
    if (!nombre) return { ok: false, error: 'El nombre es requerido.' }

    const payload = {
      nombre,
      cuit:          data.cuit?.trim() || null,
      email:         data.email?.trim() || null,
      telefono:      data.telefono?.trim() || null,
      observaciones: data.observaciones?.trim() || null,
      created_by:    auth.data.user.id,
    }

    const { data: inserted, error } = await supabase
      .from('financiadores')
      .insert(payload)
      .select('id, codigo, nombre')
      .single()

    if (error) {
      console.error('[crearFinanciador] insert error:', { code: error.code, message: error.message })
      return { ok: false, error: cleanDbError(error.message) }
    }
    if (!inserted) return { ok: false, error: 'No se pudo crear el financiador.' }

    revalidatePath('/fondos')
    return { ok: true, id: inserted.id, codigo: inserted.codigo, nombre: inserted.nombre }
  } catch (err) {
    console.error('[crearFinanciador] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

// ─── Etapa 2C: registrar aporte de socio (transaccional vía RPC SECURITY DEFINER)

export type AporteSocioPayload = {
  fecha:           string                                                  // ISO date YYYY-MM-DD
  socio_id:        string
  importe:         number
  moneda:          string
  destino_aporte:  'risa' | 'cancelacion_financiacion'
  financiador_id:  string | null                                           // requerido si destino = 'cancelacion_financiacion'
  observaciones:   string | null
}

export type AporteSocioActionResult =
  | { ok: true; aporte_id: string; aporte_codigo: string | null }
  | { ok: false; error: string }

export async function registrarAporteSocio(data: AporteSocioPayload): Promise<AporteSocioActionResult> {
  try {
    if (!Number.isFinite(data.importe) || data.importe <= 0) {
      return { ok: false, error: 'El importe debe ser mayor a 0.' }
    }
    if (data.destino_aporte === 'cancelacion_financiacion' && !data.financiador_id) {
      return { ok: false, error: 'El financiador es obligatorio cuando el destino es cancelar financiación.' }
    }

    const supabase = createClient()
    const { data: result, error } = await supabase.rpc('registrar_aporte_socio', {
      p_fecha:          data.fecha,
      p_socio_id:       data.socio_id,
      p_importe:        data.importe,
      p_moneda:         data.moneda,
      p_destino_aporte: data.destino_aporte,
      p_financiador_id: data.financiador_id,
      p_observaciones:  data.observaciones,
    })
    if (error) {
      console.error('[registrarAporteSocio] RPC error:', { code: error.code, message: error.message })
      return { ok: false, error: cleanDbError(error.message) }
    }

    const aporte_id = result as string

    // Opción B: SELECT post-RPC para devolver el codigo APO-### al cliente
    const { data: aporte, error: selErr } = await supabase
      .from('aportes_fondo')
      .select('codigo')
      .eq('id', aporte_id)
      .maybeSingle()
    if (selErr) {
      console.warn('[registrarAporteSocio] no se pudo leer codigo del aporte:', selErr.message)
    }

    revalidatePath('/fondos')
    return { ok: true, aporte_id, aporte_codigo: aporte?.codigo ?? null }
  } catch (err) {
    console.error('[registrarAporteSocio] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}
