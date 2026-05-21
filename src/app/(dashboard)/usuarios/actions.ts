'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { UserRole } from '@/types'

const EMAIL_DOMAIN = 'pdep.local'
const USUARIO_LOGIN_REGEX = /^[a-z0-9._-]+$/
const PASSWORD_MIN_LENGTH = 4

export type ActionResult = { ok: true } | { ok: false; error: string }

export type CrearUsuarioPayload = {
  usuario_login: string
  password: string
  full_name: string | null
  role: UserRole
  puede_exportar: boolean
  puede_aprobar_gastos: boolean
  puede_confirmar_pagos: boolean
  fondo_default_id: string | null
}

export type UpdateUsuarioPayload = {
  role: UserRole
  activo: boolean
  puede_exportar: boolean
  puede_aprobar_gastos: boolean
  puede_confirmar_pagos: boolean
  fondo_default_id: string | null
  notas_admin: string | null
}

async function assertAdmin(): Promise<{ ok: true; supabase: ReturnType<typeof createClient>; callerId: string } | { ok: false; error: string }> {
  const supabase = createClient()
  const auth = await supabase.auth.getUser()
  if (!auth.data?.user) return { ok: false, error: 'No autenticado' }
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', auth.data.user.id)
    .single()
  if (error) return { ok: false, error: error.message }
  if (profile?.role !== 'admin') return { ok: false, error: 'Solo administradores' }
  return { ok: true, supabase, callerId: auth.data.user.id }
}

async function countOtherActiveAdmins(
  supabase: ReturnType<typeof createClient>,
  excludeId: string
): Promise<number> {
  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('activo', true)
    .neq('id', excludeId)
  return count ?? 0
}

export async function crearUsuario(payload: CrearUsuarioPayload): Promise<ActionResult> {
  try {
    const a = await assertAdmin()
    if (!a.ok) return a

    const usuario = payload.usuario_login.trim().toLowerCase()
    if (!USUARIO_LOGIN_REGEX.test(usuario)) {
      return { ok: false, error: 'Usuario inválido: solo minúsculas, números, . _ -' }
    }
    if (payload.password.length < PASSWORD_MIN_LENGTH) {
      return { ok: false, error: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.` }
    }

    let admin
    try {
      admin = createAdminClient()
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Error de configuración admin' }
    }

    const { count, error: countErr } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_login', usuario)
    if (countErr) return { ok: false, error: `Error al verificar unicidad: ${countErr.message}` }
    if ((count ?? 0) > 0) return { ok: false, error: 'Ese usuario ya existe.' }

    const email = `${usuario}@${EMAIL_DOMAIN}`

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: payload.password,
      email_confirm: true,
    })
    if (error) {
      console.error('[crearUsuario] createUser:', error.message)
      return { ok: false, error: `No se pudo crear: ${error.message}` }
    }
    if (!data?.user) return { ok: false, error: 'No se pudo crear el usuario (sin data).' }

    const { error: updErr } = await admin
      .from('profiles')
      .update({
        usuario_login: usuario,
        full_name: payload.full_name,
        role: payload.role,
        puede_exportar: payload.puede_exportar,
        puede_aprobar_gastos: payload.puede_aprobar_gastos,
        puede_confirmar_pagos: payload.puede_confirmar_pagos,
        fondo_default_id: payload.fondo_default_id,
      })
      .eq('id', data.user.id)
    if (updErr) {
      console.error('[crearUsuario] update profile:', updErr.message)
      await admin.auth.admin.deleteUser(data.user.id).catch(() => {})
      return { ok: false, error: `Usuario creado pero falló asignar atributos: ${updErr.message}` }
    }

    revalidatePath('/usuarios')
    return { ok: true }
  } catch (err) {
    console.error('[crearUsuario] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

export async function updateUsuario(id: string, payload: UpdateUsuarioPayload): Promise<ActionResult> {
  try {
    const a = await assertAdmin()
    if (!a.ok) return a
    const { supabase, callerId } = a

    if (id === callerId && !payload.activo) return { ok: false, error: 'No podés desactivarte a vos mismo.' }
    if (id === callerId && payload.role !== 'admin') return { ok: false, error: 'No podés degradarte a vos mismo.' }

    const { data: target, error: fetchErr } = await supabase
      .from('profiles')
      .select('role, activo')
      .eq('id', id)
      .single()
    if (fetchErr) return { ok: false, error: fetchErr.message }
    if (!target) return { ok: false, error: 'Usuario no encontrado' }

    const seraQueDeja = target.role === 'admin' && target.activo
      && (payload.role !== 'admin' || !payload.activo)
    if (seraQueDeja) {
      const others = await countOtherActiveAdmins(supabase, id)
      if (others === 0) return { ok: false, error: 'Es el único administrador activo. No puede degradarse ni desactivarse.' }
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        role: payload.role,
        activo: payload.activo,
        puede_exportar: payload.puede_exportar,
        puede_aprobar_gastos: payload.puede_aprobar_gastos,
        puede_confirmar_pagos: payload.puede_confirmar_pagos,
        fondo_default_id: payload.fondo_default_id,
        notas_admin: payload.notas_admin,
      })
      .eq('id', id)
    if (error) return { ok: false, error: error.message }

    revalidatePath('/usuarios')
    return { ok: true }
  } catch (err) {
    console.error('[updateUsuario] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

export async function toggleUsuarioActivo(id: string): Promise<ActionResult> {
  try {
    const a = await assertAdmin()
    if (!a.ok) return a
    const { supabase, callerId } = a

    if (id === callerId) return { ok: false, error: 'No podés desactivarte a vos mismo.' }

    const { data: target, error: fetchErr } = await supabase
      .from('profiles')
      .select('role, activo')
      .eq('id', id)
      .single()
    if (fetchErr) return { ok: false, error: fetchErr.message }
    if (!target) return { ok: false, error: 'Usuario no encontrado' }

    if (target.activo && target.role === 'admin') {
      const others = await countOtherActiveAdmins(supabase, id)
      if (others === 0) return { ok: false, error: 'Es el único administrador activo. No puede desactivarse.' }
    }

    const { error } = await supabase
      .from('profiles')
      .update({ activo: !target.activo })
      .eq('id', id)
    if (error) return { ok: false, error: error.message }

    revalidatePath('/usuarios')
    return { ok: true }
  } catch (err) {
    console.error('[toggleUsuarioActivo] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

// ─── Whitelist Google ─────────────────────────────────────────────────────────

export type GoogleAllowedPayload = {
  email: string
  role: UserRole
  usuario_login: string | null
  full_name: string | null
  activo: boolean
  notas_admin: string | null
}

function validateEmail(email: string): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: 'Email inválido' }
  }
  return { ok: true, value: trimmed }
}

function validateUsuarioLogin(login: string | null): { ok: true; value: string | null } | { ok: false; error: string } {
  if (!login || !login.trim()) return { ok: true, value: null }
  const v = login.trim().toLowerCase()
  if (!USUARIO_LOGIN_REGEX.test(v)) {
    return { ok: false, error: 'Usuario interno inválido: solo minúsculas, números, . _ -' }
  }
  return { ok: true, value: v }
}

export async function crearGoogleAllowed(payload: GoogleAllowedPayload): Promise<ActionResult> {
  try {
    const a = await assertAdmin()
    if (!a.ok) return a

    const em = validateEmail(payload.email)
    if (!em.ok) return em
    const ul = validateUsuarioLogin(payload.usuario_login)
    if (!ul.ok) return ul

    const { error } = await a.supabase.from('google_allowed_users').insert({
      email: em.value,
      role: payload.role,
      usuario_login: ul.value,
      full_name: payload.full_name?.trim() || null,
      activo: payload.activo,
      notas_admin: payload.notas_admin?.trim() || null,
      created_by: a.callerId,
    })
    if (error) {
      if (error.code === '23505') return { ok: false, error: 'Ese email ya está autorizado.' }
      return { ok: false, error: error.message }
    }

    revalidatePath('/usuarios')
    return { ok: true }
  } catch (err) {
    console.error('[crearGoogleAllowed] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

export async function updateGoogleAllowed(id: string, payload: GoogleAllowedPayload): Promise<ActionResult> {
  try {
    const a = await assertAdmin()
    if (!a.ok) return a

    const em = validateEmail(payload.email)
    if (!em.ok) return em
    const ul = validateUsuarioLogin(payload.usuario_login)
    if (!ul.ok) return ul

    const { error } = await a.supabase.from('google_allowed_users').update({
      email: em.value,
      role: payload.role,
      usuario_login: ul.value,
      full_name: payload.full_name?.trim() || null,
      activo: payload.activo,
      notas_admin: payload.notas_admin?.trim() || null,
    }).eq('id', id)
    if (error) {
      if (error.code === '23505') return { ok: false, error: 'Ese email ya está autorizado en otra fila.' }
      return { ok: false, error: error.message }
    }

    revalidatePath('/usuarios')
    return { ok: true }
  } catch (err) {
    console.error('[updateGoogleAllowed] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

export async function toggleGoogleAllowedActivo(id: string): Promise<ActionResult> {
  try {
    const a = await assertAdmin()
    if (!a.ok) return a

    const { data: target, error: fetchErr } = await a.supabase
      .from('google_allowed_users')
      .select('activo')
      .eq('id', id)
      .single()
    if (fetchErr) return { ok: false, error: fetchErr.message }
    if (!target) return { ok: false, error: 'Autorización no encontrada' }

    const { error } = await a.supabase
      .from('google_allowed_users')
      .update({ activo: !target.activo })
      .eq('id', id)
    if (error) return { ok: false, error: error.message }

    revalidatePath('/usuarios')
    return { ok: true }
  } catch (err) {
    console.error('[toggleGoogleAllowedActivo] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

export async function deleteGoogleAllowed(id: string): Promise<ActionResult> {
  try {
    const a = await assertAdmin()
    if (!a.ok) return a

    const { error } = await a.supabase.from('google_allowed_users').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }

    revalidatePath('/usuarios')
    return { ok: true }
  } catch (err) {
    console.error('[deleteGoogleAllowed] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

export async function resetPasswordUsuario(id: string, newPassword: string): Promise<ActionResult> {
  try {
    const a = await assertAdmin()
    if (!a.ok) return a

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      return { ok: false, error: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.` }
    }

    let admin
    try {
      admin = createAdminClient()
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Error de configuración admin' }
    }

    const { error } = await admin.auth.admin.updateUserById(id, { password: newPassword })
    if (error) {
      console.error('[resetPasswordUsuario] updateUserById:', error.message)
      return { ok: false, error: error.message }
    }

    return { ok: true }
  } catch (err) {
    console.error('[resetPasswordUsuario] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}
