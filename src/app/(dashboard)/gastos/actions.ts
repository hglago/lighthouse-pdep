'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type GastoPayload = {
  fondo_id: string
  proveedor_id: string
  descripcion: string
  monto: number
  moneda: string
  fecha_gasto: string
  notas: string | null
  tiene_anticipo: boolean
  monto_anticipo: number | null
  porcentaje_anticipo: number | null
  fecha_prevista_pago_anticipo: string | null
  fecha_comprometida_pago_saldo: string | null
  condiciones_pago_notas: string | null
  fecha_vencimiento: string | null
  prioridad_pago: number
}

export async function createGasto(
  data: GastoPayload,
  options?: { id?: string; comprobante?: { path: string; mime: string; nombre: string; size: number } }
) {
  const supabase = createClient()
  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) throw new Error('No autenticado')

  const insert: Record<string, unknown> = {
    ...data,
    proveedor_id: data.proveedor_id || null,
    estado: 'enviado',  // alta directa a pendiente de aprobación (sin paso por borrador)
    created_by: user.id,
  }
  if (options?.id) {
    insert.id = options.id
  }
  if (options?.comprobante) {
    insert.comprobante_path = options.comprobante.path
    insert.comprobante_nombre = options.comprobante.nombre
    insert.comprobante_mime = options.comprobante.mime
    insert.comprobante_size_bytes = options.comprobante.size
    insert.comprobante_uploaded_by = user.id
    insert.comprobante_subido_en = new Date().toISOString()
  }

  const { error } = await supabase.from('gastos').insert(insert)
  if (error) throw new Error(error.message)
  revalidatePath('/gastos')
}

export async function updateGasto(id: string, data: GastoPayload) {
  const supabase = createClient()
  const result = await supabase
    .from('gastos')
    .update({ ...data, proveedor_id: data.proveedor_id || null })
    .eq('id', id)
    .in('estado', ['borrador', 'enviado'])  // editable mientras no esté aprobado/pagado
    .is('deleted_at', null)
    .select('id')
  if (result.error) throw new Error(result.error.message)
  if (!result.data || result.data.length === 0)
    throw new Error('Sin permiso para editar este gasto o ya fue aprobado/pagado.')
  revalidatePath('/gastos')
}

export async function deleteGasto(id: string) {
  const supabase = createClient()

  // 1. rol del usuario según get_my_role()
  const roleResult = await supabase.rpc('get_my_role')
  console.error('[deleteGasto] get_my_role:', roleResult.data, '| rpcError:', roleResult.error?.message)

  // 2. id del usuario autenticado
  const authResult = await supabase.auth.getUser()
  console.error('[deleteGasto] auth.uid:', authResult.data.user?.id)

  // 3. estado actual del gasto antes del update
  const gastoActual = await supabase
    .from('gastos')
    .select('id, created_by, estado, deleted_at')
    .eq('id', id)
    .maybeSingle()
  console.error('[deleteGasto] gasto actual:', JSON.stringify(gastoActual.data), '| selectError:', gastoActual.error?.message)

  // 4. payload exacto
  const payload = { deleted_at: new Date().toISOString() }
  console.error('[deleteGasto] payload:', JSON.stringify(payload))

  // 5. resultado del update
  const result = await supabase
    .from('gastos')
    .update(payload)
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
  console.error('[deleteGasto] result data:', JSON.stringify(result.data), '| error:', result.error?.message, '| code:', result.error?.code, '| status:', result.status)

  if (result.error) throw new Error(result.error.message)
  if (!result.data || result.data.length === 0)
    throw new Error('Sin permiso para eliminar este gasto.')
  revalidatePath('/gastos')
}

// ─── Gastos recurrentes ───────────────────────────────────────────────────────

export type GastoRecurrentePayload = {
  fondo_id: string
  proveedor_id: string | null
  concepto: string
  categoria: string | null
  monto: number
  moneda: string
  dia_vencimiento: number
  fecha_inicio: string
  fecha_fin: string | null
  activo: boolean
  prioridad_pago: number
  observaciones: string | null
}

export type RecurrenteActionResult = { ok: true } | { ok: false; error: string }

export async function createGastoRecurrente(data: GastoRecurrentePayload): Promise<RecurrenteActionResult> {
  try {
    const supabase = createClient()
    const authResult = await supabase.auth.getUser()
    const user = authResult.data?.user
    if (!user) return { ok: false, error: 'No autenticado' }

    const insertPayload = {
      ...data,
      proveedor_id: data.proveedor_id || null,
      created_by: user.id,
    }
    console.error('[createGastoRecurrente] payload:', JSON.stringify(insertPayload))

    const { error } = await supabase.from('gastos_recurrentes').insert(insertPayload)
    if (error) {
      console.error('[createGastoRecurrente] supabase error:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      })
      return { ok: false, error: `${error.message}${error.details ? ' — ' + error.details : ''}${error.hint ? ' (' + error.hint + ')' : ''}` }
    }

    revalidatePath('/gastos')
    return { ok: true }
  } catch (err) {
    console.error('[createGastoRecurrente] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

export async function updateGastoRecurrente(id: string, data: GastoRecurrentePayload): Promise<RecurrenteActionResult> {
  try {
    const supabase = createClient()
    const updatePayload = { ...data, proveedor_id: data.proveedor_id || null }
    console.error('[updateGastoRecurrente] id:', id, 'payload:', JSON.stringify(updatePayload))

    const { data: rows, error } = await supabase
      .from('gastos_recurrentes')
      .update(updatePayload)
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
    if (error) {
      console.error('[updateGastoRecurrente] supabase error:', {
        code: error.code, message: error.message, details: error.details, hint: error.hint,
      })
      return { ok: false, error: `${error.message}${error.details ? ' — ' + error.details : ''}${error.hint ? ' (' + error.hint + ')' : ''}` }
    }
    if (!rows || rows.length === 0) {
      return { ok: false, error: 'Sin permiso para editar este gasto recurrente.' }
    }

    revalidatePath('/gastos')
    return { ok: true }
  } catch (err) {
    console.error('[updateGastoRecurrente] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

export async function deleteGastoRecurrente(id: string): Promise<RecurrenteActionResult> {
  try {
    const supabase = createClient()
    const { data: rows, error } = await supabase
      .from('gastos_recurrentes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
    if (error) {
      console.error('[deleteGastoRecurrente] supabase error:', {
        code: error.code, message: error.message, details: error.details, hint: error.hint,
      })
      return { ok: false, error: error.message }
    }
    if (!rows || rows.length === 0) {
      return { ok: false, error: 'Sin permiso para eliminar este gasto recurrente.' }
    }
    revalidatePath('/gastos')
    return { ok: true }
  } catch (err) {
    console.error('[deleteGastoRecurrente] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

// Genera gastos pendientes desde recurrentes activos hasta el mes actual.
// Idempotente vía UNIQUE INDEX (recurrente_id, periodo).
// Se invoca desde /gastos page.tsx al cargar el módulo (dev).
// En producción se puede mover a pg_cron diario sin cambios.
export async function generarGastosRecurrentes(): Promise<{ created: number; error: string | null }> {
  try {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('fn_generar_gastos_recurrentes')
    if (error) {
      console.error('[generarGastosRecurrentes] rpc error:', error.message)
      return { created: 0, error: error.message }
    }
    return { created: (data as number) ?? 0, error: null }
  } catch (err) {
    console.error('[generarGastosRecurrentes] unhandled:', err)
    return { created: 0, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

export async function cambiarEstadoGasto(
  id: string,
  nuevoEstado: 'enviado' | 'aprobado' | 'rechazado'
) {
  const supabase = createClient()
  const result = await supabase
    .from('gastos')
    .update({ estado: nuevoEstado })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
  if (result.error) throw new Error(result.error.message)
  if (!result.data || result.data.length === 0)
    throw new Error('Sin permiso para cambiar el estado de este gasto.')
  revalidatePath('/gastos')
}

// ─── Bulk actions sobre gastos seleccionados ─────────────────────────────────

export type BulkGastoResult = {
  procesados: string[]
  errores: { id: string; descripcion?: string; error: string }[]
}

// Cambia estado a 'aprobado' solo para gastos en 'borrador'/'enviado'.
// Los que ya están aprobados/pagados/rechazados se omiten con error explicativo.
export async function bulkAprobarGastos(ids: string[]): Promise<BulkGastoResult> {
  const supabase = createClient()
  const procesados: string[] = []
  const errores: BulkGastoResult['errores'] = []

  for (const id of ids) {
    const { data: rows, error } = await supabase
      .from('gastos')
      .update({ estado: 'aprobado' })
      .eq('id', id)
      .in('estado', ['borrador', 'enviado'])
      .is('deleted_at', null)
      .select('id, descripcion')
    if (error) {
      errores.push({ id, error: error.message })
    } else if (!rows || rows.length === 0) {
      // Buscar la descripción para el mensaje
      const { data: g } = await supabase
        .from('gastos').select('descripcion, estado').eq('id', id).maybeSingle()
      errores.push({
        id,
        descripcion: g?.descripcion,
        error: g ? `Estado actual "${g.estado}" no permite aprobar.` : 'No encontrado.',
      })
    } else {
      procesados.push(id)
    }
  }
  if (procesados.length > 0) {
    revalidatePath('/gastos')
    revalidatePath('/pagos')
  }
  return { procesados, errores }
}

// Cancela (= rechaza) gastos. Solo permite si no están ya pagados/parciales.
export async function bulkRechazarGastos(ids: string[]): Promise<BulkGastoResult> {
  const supabase = createClient()
  const procesados: string[] = []
  const errores: BulkGastoResult['errores'] = []

  for (const id of ids) {
    const { data: rows, error } = await supabase
      .from('gastos')
      .update({ estado: 'rechazado' })
      .eq('id', id)
      .in('estado', ['borrador', 'enviado', 'aprobado'])
      .is('deleted_at', null)
      .select('id')
    if (error) {
      errores.push({ id, error: error.message })
    } else if (!rows || rows.length === 0) {
      const { data: g } = await supabase
        .from('gastos').select('descripcion, estado').eq('id', id).maybeSingle()
      errores.push({
        id,
        descripcion: g?.descripcion,
        error: g
          ? `No se puede cancelar un gasto en estado "${g.estado}".`
          : 'No encontrado.',
      })
    } else {
      procesados.push(id)
    }
  }
  if (procesados.length > 0) {
    revalidatePath('/gastos')
    revalidatePath('/pagos')
  }
  return { procesados, errores }
}

// Soft-delete. Bloquea si el gasto tiene CUALQUIER pago asociado (cualquier estado),
// para evitar dejar pagos huérfanos apuntando a un gasto borrado.
export async function bulkDeleteGastos(ids: string[]): Promise<BulkGastoResult> {
  const supabase = createClient()
  const procesados: string[] = []
  const errores: BulkGastoResult['errores'] = []

  for (const id of ids) {
    const { count, error: countErr } = await supabase
      .from('pagos')
      .select('id', { count: 'exact', head: true })
      .eq('gasto_id', id)
    if (countErr) {
      errores.push({ id, error: countErr.message })
      continue
    }
    if ((count ?? 0) > 0) {
      const { data: g } = await supabase
        .from('gastos').select('descripcion').eq('id', id).maybeSingle()
      errores.push({
        id,
        descripcion: g?.descripcion,
        error: `Tiene ${count} pago${count !== 1 ? 's' : ''} asociado${count !== 1 ? 's' : ''}. Anulalos primero.`,
      })
      continue
    }

    const { data: rows, error } = await supabase
      .from('gastos')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
    if (error) {
      errores.push({ id, error: error.message })
    } else if (!rows || rows.length === 0) {
      errores.push({ id, error: 'Sin permiso o gasto no encontrado.' })
    } else {
      procesados.push(id)
    }
  }
  if (procesados.length > 0) revalidatePath('/gastos')
  return { procesados, errores }
}

// ─── Comprobantes ─────────────────────────────────────────────────────────────

export type ComprobantePayload = {
  path: string
  mime: string
  nombre: string
  size: number
}

export async function setComprobanteGasto(id: string, data: ComprobantePayload) {
  const supabase = createClient()
  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) throw new Error('No autenticado')

  const { data: rows, error } = await supabase
    .from('gastos')
    .update({
      comprobante_path: data.path,
      comprobante_nombre: data.nombre,
      comprobante_mime: data.mime,
      comprobante_size_bytes: data.size,
      comprobante_uploaded_by: user.id,
      comprobante_subido_en: new Date().toISOString(),
    })
    .eq('id', id)
    .in('estado', ['borrador', 'enviado', 'aprobado', 'pagado_parcial'])
    .is('deleted_at', null)
    .select('id')
  if (error) throw new Error(error.message)
  if (!rows || rows.length === 0)
    throw new Error('Sin permiso o el gasto ya está cerrado (pagado/rechazado).')
  revalidatePath('/gastos')
}

export async function removeComprobanteGasto(id: string) {
  const supabase = createClient()

  const { data: gasto, error: fetchErr } = await supabase
    .from('gastos')
    .select('comprobante_path')
    .eq('id', id)
    .in('estado', ['borrador', 'enviado', 'aprobado', 'pagado_parcial'])
    .is('deleted_at', null)
    .maybeSingle()
  if (fetchErr) throw new Error(fetchErr.message)
  if (!gasto) throw new Error('Gasto ya cerrado (pagado/rechazado) o no existe.')
  if (!gasto.comprobante_path) throw new Error('Este gasto no tiene comprobante.')

  const { error: rmErr } = await supabase.storage
    .from('comprobantes')
    .remove([gasto.comprobante_path])
  if (rmErr) console.error('[removeComprobanteGasto] storage warning:', rmErr.message)

  const { data: rows, error: updErr } = await supabase
    .from('gastos')
    .update({
      comprobante_path: null,
      comprobante_nombre: null,
      comprobante_mime: null,
      comprobante_size_bytes: null,
      comprobante_uploaded_by: null,
      comprobante_subido_en: null,
    })
    .eq('id', id)
    .in('estado', ['borrador', 'enviado', 'aprobado', 'pagado_parcial'])
    .is('deleted_at', null)
    .select('id')
  if (updErr) throw new Error(updErr.message)
  if (!rows || rows.length === 0)
    throw new Error('Sin permiso para limpiar comprobante.')
  revalidatePath('/gastos')
}
