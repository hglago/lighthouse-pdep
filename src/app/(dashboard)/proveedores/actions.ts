'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type ProveedorPayload = {
  nombre: string
  cuit: string | null
  email: string | null
  telefono: string | null
  direccion: string | null
  observaciones: string | null
  tiene_uplift: boolean
  porcentaje_uplift: number
}

// Si no tiene uplift, forzamos porcentaje a 0 para evitar inconsistencia.
// Si tiene uplift, no permitimos negativos (mismo check que la DB).
function normalizeUplift(data: ProveedorPayload): ProveedorPayload {
  const tiene = data.tiene_uplift === true
  let pct = Number(data.porcentaje_uplift)
  if (!Number.isFinite(pct) || pct < 0) pct = 0
  return { ...data, tiene_uplift: tiene, porcentaje_uplift: tiene ? pct : 0 }
}

// Detecta error de Postgres por columna inexistente (42703) que afecta
// específicamente a las columnas de uplift. Esto pasa si el ALTER no se aplicó.
function isUpliftColumnMissingError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === '42703') return true
  const msg = (err.message ?? '').toLowerCase()
  return msg.includes('tiene_uplift') || msg.includes('porcentaje_uplift')
}

// Quita las columnas de uplift del payload — para el retry cuando la DB no las tiene.
function stripUplift<T extends { tiene_uplift?: boolean; porcentaje_uplift?: number }>(p: T): Omit<T, 'tiene_uplift' | 'porcentaje_uplift'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tiene_uplift, porcentaje_uplift, ...rest } = p
  return rest
}

export type ProveedorActionResult = { ok: true } | { ok: false; error: string }

export async function createProveedor(data: ProveedorPayload): Promise<ProveedorActionResult> {
  try {
    const supabase = createClient()
    const authResult = await supabase.auth.getUser()
    const user = authResult.data?.user
    if (!user) return { ok: false, error: 'No autenticado' }

    const fullPayload = { ...normalizeUplift(data), created_by: user.id }

    const { error } = await supabase.from('proveedores').insert(fullPayload)
    if (!error) {
      revalidatePath('/proveedores')
      return { ok: true }
    }

    // Retry sin columnas de uplift si la DB todavía no las tiene
    if (isUpliftColumnMissingError(error)) {
      console.warn('[createProveedor] columnas uplift no disponibles, reintentando sin ellas')
      const retry = await supabase.from('proveedores').insert(stripUplift(fullPayload))
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
    const supabase = createClient()
    const fullPayload = normalizeUplift(data)

    const { error } = await supabase
      .from('proveedores')
      .update(fullPayload)
      .eq('id', id)
      .is('deleted_at', null)
    if (!error) {
      revalidatePath('/proveedores')
      return { ok: true }
    }

    if (isUpliftColumnMissingError(error)) {
      console.warn('[updateProveedor] columnas uplift no disponibles, reintentando sin ellas')
      const retry = await supabase
        .from('proveedores')
        .update(stripUplift(fullPayload))
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
    const supabase = createClient()
    const auth = await supabase.auth.getUser()
    if (!auth.data?.user) return { ok: false, error: 'No autenticado' }

    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', auth.data.user.id)
      .single()
    if (profileErr) return { ok: false, error: profileErr.message }
    if (profile?.role !== 'admin' && profile?.role !== 'contador') {
      return { ok: false, error: 'Solo administradores o contadores pueden crear proveedores.' }
    }

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

export async function deleteProveedor(id: string): Promise<ProveedorActionResult> {
  try {
    const supabase = createClient()
    const auth = await supabase.auth.getUser()
    if (!auth.data?.user) return { ok: false, error: 'No autenticado' }

    // Logs temporales de diagnóstico RLS
    console.log("ELIMINAR PROVEEDOR ID:", id)
    console.log("AUTH UID:", auth.data.user.id)

    // Estado actual del proveedor antes del soft-delete
    const { data: target } = await supabase
      .from('proveedores')
      .select('id, nombre, created_by, deleted_at')
      .eq('id', id)
      .maybeSingle()
    console.log("PROVEEDOR ACTUAL:", target)

    // Rol del usuario actual (la policy UPDATE puede chequearlo)
    const roleResult = await supabase.rpc('get_my_role')
    console.log("GET_MY_ROLE result:", roleResult.data, "error:", roleResult.error?.message)

    const { data: rows, error } = await supabase
      .from('proveedores')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')

    console.log("UPDATE RESULT rows:", rows, "error:", error ? {
      code: error.code, message: error.message, details: error.details, hint: error.hint
    } : null)

    if (error) return { ok: false, error: error.message }
    if (!rows || rows.length === 0) {
      return { ok: false, error: 'Sin permiso para eliminar este proveedor o ya estaba eliminado.' }
    }

    revalidatePath('/proveedores')
    return { ok: true }
  } catch (err) {
    console.error('[deleteProveedor] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}
