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

export async function createProveedor(data: ProveedorPayload) {
  const supabase = createClient()
  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) throw new Error('No autenticado')

  const { error } = await supabase.from('proveedores').insert({
    ...normalizeUplift(data),
    created_by: user.id,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/proveedores')
}

export async function updateProveedor(id: string, data: ProveedorPayload) {
  const supabase = createClient()
  const { error } = await supabase
    .from('proveedores')
    .update(normalizeUplift(data))
    .eq('id', id)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)
  revalidatePath('/proveedores')
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

export async function deleteProveedor(id: string) {
  const supabase = createClient()
  const { error } = await supabase
    .from('proveedores')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)
  revalidatePath('/proveedores')
}
