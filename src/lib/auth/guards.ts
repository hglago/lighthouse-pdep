// src/lib/auth/guards.ts
// Fase 2C.1 (2026-05-25) — helpers de autorización server-side.
//
// Uso típico en server actions:
//   const a = await assertRole(['admin', 'supervisor'])
//   if (!a.ok) return a   // {ok:false; error} compatible con ActionResult
//
// Sin tocar SQL / RPC / RLS. Solo SELECT de profiles para resolver role.
// Mensajes de error normalizados para no filtrar info de cuentas.

import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/types'

export type CurrentProfile = {
  id: string
  email: string
  role: UserRole
  activo: boolean
}

export type AssertRoleResult =
  | { ok: true; profile: CurrentProfile }
  | { ok: false; error: string }

// Devuelve el profile activo del usuario autenticado, o null en cualquier
// caso adverso (sin sesión, profile inexistente, profile inactivo).
// Útil para flujos donde no queremos diferenciar las causas.
export async function getCurrentProfile(): Promise<CurrentProfile | null> {
  const supabase = createClient()

  const auth = await supabase.auth.getUser()
  if (!auth.data?.user) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, role, activo')
    .eq('id', auth.data.user.id)
    .single()

  if (error || !data) return null
  if (!data.activo) return null

  return {
    id: data.id,
    email: data.email,
    role: data.role as UserRole,
    activo: data.activo,
  }
}

// Verifica que el usuario actual esté autenticado, tenga profile activo,
// y que su role esté en la lista de roles permitidos.
// Devuelve un ActionResult compatible (ok/error string).
//
// Convención: incluir 'admin' en TODAS las listas allowed para garantizar
// que admin@lighthouse.com nunca pierda acceso a una action.
export async function assertRole(allowed: UserRole[]): Promise<AssertRoleResult> {
  const supabase = createClient()

  const auth = await supabase.auth.getUser()
  if (!auth.data?.user) {
    return { ok: false, error: 'No autenticado' }
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, role, activo')
    .eq('id', auth.data.user.id)
    .single()

  if (error || !data || !data.activo) {
    return { ok: false, error: 'Usuario inactivo o sin perfil' }
  }

  const profile: CurrentProfile = {
    id: data.id,
    email: data.email,
    role: data.role as UserRole,
    activo: data.activo,
  }

  if (!allowed.includes(profile.role)) {
    return { ok: false, error: 'Sin permiso para esta acción' }
  }

  return { ok: true, profile }
}
