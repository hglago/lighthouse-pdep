'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertRole } from '@/lib/auth/guards'
import type { UserRole } from '@/types'

// Fase 2C.2d (2026-05-25): proveedores = maestro operativo.
// USER puede crear proveedores (carga desde su gasto), no editar ni eliminar.
// Eliminar = admin/supervisor (+ contador legacy).
const ROLES_PROVEEDORES_CREAR: UserRole[] = [
  'admin', 'supervisor', 'operador', 'user',
  'contador', // legacy
]
const ROLES_PROVEEDORES_EDITAR: UserRole[] = [
  'admin', 'supervisor', 'operador',
  'contador', // legacy
]
const ROLES_PROVEEDORES_ELIMINAR: UserRole[] = [
  'admin', 'supervisor',
  'contador', // legacy
]

export type ProveedorPayload = {
  nombre: string
  cuit: string | null
  email: string | null
  telefono: string | null
  direccion: string | null
  observaciones: string | null
  tiene_uplift: boolean
  porcentaje_uplift: number
  // P1: servicios por hora. Default false / 0 cuando no aplica.
  permite_horas_servicio: boolean
  valor_hora: number
  nombre_informe: string | null
}

// Normaliza ambos bloques opcionales del proveedor:
// - Uplift: si no tiene, fuerza porcentaje=0. Si tiene, no permite negativos.
// - Horas de servicio: si no permite, fuerza valor_hora=0. Si permite, no permite negativos.
// D22: el uplift es informativo y no afecta importes operativos.
function normalizeProveedor(data: ProveedorPayload): ProveedorPayload {
  const tieneUplift = data.tiene_uplift === true
  let pct = Number(data.porcentaje_uplift)
  if (!Number.isFinite(pct) || pct < 0) pct = 0

  const permiteHoras = data.permite_horas_servicio === true
  let valor = Number(data.valor_hora)
  if (!Number.isFinite(valor) || valor < 0) valor = 0

  return {
    ...data,
    tiene_uplift: tieneUplift,
    porcentaje_uplift: tieneUplift ? pct : 0,
    permite_horas_servicio: permiteHoras,
    valor_hora: permiteHoras ? valor : 0,
  }
}

// Detecta error de Postgres por columna inexistente (42703) que afecta a las
// columnas opcionales agregadas por migraciones recientes (uplift + P1 horas).
function isOptionalColumnMissingError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === '42703') return true
  const msg = (err.message ?? '').toLowerCase()
  return (
    msg.includes('tiene_uplift') ||
    msg.includes('porcentaje_uplift') ||
    msg.includes('permite_horas_servicio') ||
    msg.includes('valor_hora') ||
    msg.includes('nombre_informe')
  )
}

// Quita las columnas opcionales del payload para el retry cuando la DB no las tiene.
function stripCamposOpcionales<T extends {
  tiene_uplift?: boolean
  porcentaje_uplift?: number
  permite_horas_servicio?: boolean
  valor_hora?: number
  nombre_informe?: string | null
}>(p: T): Omit<T, 'tiene_uplift' | 'porcentaje_uplift' | 'permite_horas_servicio' | 'valor_hora' | 'nombre_informe'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tiene_uplift, porcentaje_uplift, permite_horas_servicio, valor_hora, nombre_informe, ...rest } = p
  return rest
}

export type ProveedorActionResult = { ok: true } | { ok: false; error: string }

export async function createProveedor(data: ProveedorPayload): Promise<ProveedorActionResult> {
  try {
    // Fase 2C.2d: maestro operativo. USER puede crear.
    const guard = await assertRole(ROLES_PROVEEDORES_CREAR)
    if (!guard.ok) return guard

    const supabase = createClient()
    const authResult = await supabase.auth.getUser()
    const user = authResult.data?.user
    if (!user) return { ok: false, error: 'No autenticado' }

    const fullPayload = { ...normalizeProveedor(data), created_by: user.id }

    const { error } = await supabase.from('proveedores').insert(fullPayload)
    if (!error) {
      revalidatePath('/proveedores')
      return { ok: true }
    }

    // Retry sin columnas opcionales (uplift + servicios por hora) si la DB no las tiene
    if (isOptionalColumnMissingError(error)) {
      console.warn('[createProveedor] columnas opcionales no disponibles, reintentando sin ellas')
      const retry = await supabase.from('proveedores').insert(stripCamposOpcionales(fullPayload))
      if (retry.error) return { ok: false, error: retry.error.message }
      revalidatePath('/proveedores')
      return { ok: true }
    }

    return { ok: false, error: error.message }
  } catch (err) {
    console.error('[createProveedor] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

export async function updateProveedor(id: string, data: ProveedorPayload): Promise<ProveedorActionResult> {
  try {
    // Fase 2C.2d: editar maestro. USER excluido.
    const guard = await assertRole(ROLES_PROVEEDORES_EDITAR)
    if (!guard.ok) return guard

    const supabase = createClient()
    const fullPayload = normalizeProveedor(data)

    const { error } = await supabase
      .from('proveedores')
      .update(fullPayload)
      .eq('id', id)
      .is('deleted_at', null)
    if (!error) {
      revalidatePath('/proveedores')
      return { ok: true }
    }

    if (isOptionalColumnMissingError(error)) {
      console.warn('[updateProveedor] columnas opcionales no disponibles, reintentando sin ellas')
      const retry = await supabase
        .from('proveedores')
        .update(stripCamposOpcionales(fullPayload))
        .eq('id', id)
        .is('deleted_at', null)
      if (retry.error) return { ok: false, error: retry.error.message }
      revalidatePath('/proveedores')
      return { ok: true }
    }

    return { ok: false, error: error.message }
  } catch (err) {
    console.error('[updateProveedor] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

// Crear proveedor desde el modal de gastos. Devuelve id + nombre del nuevo
// proveedor para que el caller lo seleccione automáticamente sin tocar el form.
export type ProveedorQuickResult =
  | { ok: true; id: string; nombre: string }
  | { ok: false; error: string }

export async function createProveedorQuick(data: {
  nombre: string
  cuit: string | null
  email: string | null
  telefono: string | null
  observaciones: string | null
}): Promise<ProveedorQuickResult> {
  try {
    // Fase 2C.2d: reemplaza check inline `admin/contador` por assertRole
    // unificado. USER puede crear proveedores desde el modal de gasto.
    const guard = await assertRole(ROLES_PROVEEDORES_CREAR)
    if (!guard.ok) return guard

    const supabase = createClient()
    const auth = await supabase.auth.getUser()
    if (!auth.data?.user) return { ok: false, error: 'No autenticado' }

    const nombre = data.nombre.trim()
    if (!nombre) return { ok: false, error: 'El nombre es requerido.' }
    const cuit = data.cuit?.trim() || null

    // Pre-check de duplicados (nombre case-insensitive o CUIT exacto)
    const { data: candidatos, error: searchErr } = await supabase
      .from('proveedores')
      .select('id, nombre, cuit')
      .is('deleted_at', null)
    if (searchErr) return { ok: false, error: searchErr.message }

    const nombreNorm = nombre.toLowerCase()
    const dup = (candidatos ?? []).find(p =>
      p.nombre.trim().toLowerCase() === nombreNorm
      || (cuit && p.cuit && p.cuit === cuit)
    )
    if (dup) {
      const motivo = (cuit && dup.cuit === cuit) ? 'CUIT' : 'nombre'
      return { ok: false, error: `Ya existe un proveedor con ese ${motivo}: "${dup.nombre}".` }
    }

    const { data: inserted, error } = await supabase
      .from('proveedores')
      .insert({
        nombre,
        cuit,
        email: data.email?.trim() || null,
        telefono: data.telefono?.trim() || null,
        direccion: null,
        observaciones: data.observaciones?.trim() || null,
        created_by: auth.data.user.id,
      })
      .select('id, nombre')
      .single()

    if (error) {
      console.error('[createProveedorQuick] insert error:', { code: error.code, message: error.message })
      if (error.code === '23505') {
        return { ok: false, error: 'Ya existe un proveedor con ese nombre o CUIT.' }
      }
      return { ok: false, error: error.message }
    }
    if (!inserted) return { ok: false, error: 'No se pudo crear el proveedor.' }

    revalidatePath('/proveedores')
    revalidatePath('/gastos')
    return { ok: true, id: inserted.id, nombre: inserted.nombre }
  } catch (err) {
    console.error('[createProveedorQuick] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

// Cuenta gastos activos y pagos asociados a un proveedor. Solo lectura.
// Se usa antes del confirm de "Dar de baja" para informar al usuario que la
// historia queda intacta. NO modifica nada.
export type ProveedorDepsResult =
  | { ok: true; gastos: number; pagos: number }
  | { ok: false; error: string }

export async function getProveedorDependencies(id: string): Promise<ProveedorDepsResult> {
  try {
    const supabase = createClient()
    const [g, p] = await Promise.all([
      supabase
        .from('gastos')
        .select('id', { count: 'exact', head: true })
        .eq('proveedor_id', id)
        .is('deleted_at', null),
      supabase
        .from('pagos')
        .select('id', { count: 'exact', head: true })
        .eq('proveedor_id', id),
    ])
    if (g.error) return { ok: false, error: g.error.message }
    if (p.error) return { ok: false, error: p.error.message }
    return { ok: true, gastos: g.count ?? 0, pagos: p.count ?? 0 }
  } catch (err) {
    console.error('[getProveedorDependencies] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

// Soft delete vía RPC SECURITY DEFINER. La policy directa UPDATE sobre la tabla
// queda intacta; este camino es el operativo. La función SQL (public.soft_delete_proveedor)
// valida auth.uid() y corre con los privilegios del owner, evitando interferencias
// de policies/triggers que hayan generado falsos rechazos en el path directo.
//
// NOTA DE NEGOCIO: esto es BAJA LÓGICA, no eliminación física. Gastos, pagos y
// movimientos asociados quedan intactos para preservar trazabilidad histórica.
export async function deleteProveedor(id: string): Promise<ProveedorActionResult> {
  try {
    // Fase 2C.2d: destructiva (baja lógica). admin/supervisor (+ contador legacy).
    const guard = await assertRole(ROLES_PROVEEDORES_ELIMINAR)
    if (!guard.ok) return guard

    const supabase = createClient()
    const { error } = await supabase.rpc('soft_delete_proveedor', { proveedor_id: id })
    if (error) {
      console.error('[deleteProveedor] RPC error:', { code: error.code, message: error.message })
      return { ok: false, error: error.message }
    }
    revalidatePath('/proveedores')
    return { ok: true }
  } catch (err) {
    console.error('[deleteProveedor] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}
