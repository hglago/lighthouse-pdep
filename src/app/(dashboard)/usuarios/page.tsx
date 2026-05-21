import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import UsuariosClient, { type UsuarioRow, type GoogleAllowedRow } from './UsuariosClient'
import {
  crearUsuario, updateUsuario, toggleUsuarioActivo, resetPasswordUsuario,
  crearGoogleAllowed, updateGoogleAllowed, toggleGoogleAllowedActivo, deleteGoogleAllowed,
} from './actions'

export default async function UsuariosPage() {
  const supabase = createClient()

  const auth = await supabase.auth.getUser()
  if (!auth.data?.user) redirect('/login')

  const { data: caller } = await supabase
    .from('profiles')
    .select('role, activo')
    .eq('id', auth.data.user.id)
    .single()
  if (!caller || caller.role !== 'admin') redirect('/dashboard')

  const [usuariosResult, fondosResult, googleResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, email, usuario_login, full_name, role, activo, puede_exportar, puede_aprobar_gastos, puede_confirmar_pagos, fondo_default_id, notas_admin, created_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('fondos')
      .select('id, nombre, moneda')
      .is('deleted_at', null)
      .order('nombre'),
    supabase
      .from('google_allowed_users')
      .select('id, email, activo, role, usuario_login, full_name, notas_admin, created_at, created_by')
      .order('created_at', { ascending: false }),
  ])

  const usuarios = (usuariosResult.data ?? []) as UsuarioRow[]
  const fondos = (fondosResult.data ?? []) as { id: string; nombre: string; moneda: string }[]
  const googleAllowed = (googleResult.data ?? []) as GoogleAllowedRow[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Usuarios</h1>
        <p className="mt-1 text-sm text-gray-500">Administración de roles, atributos y acceso.</p>
      </div>

      <UsuariosClient
        usuarios={usuarios}
        fondos={fondos}
        googleAllowed={googleAllowed}
        currentUserId={auth.data.user.id}
        onCrear={crearUsuario}
        onUpdate={updateUsuario}
        onToggleActivo={toggleUsuarioActivo}
        onResetPassword={resetPasswordUsuario}
        onCrearGoogle={crearGoogleAllowed}
        onUpdateGoogle={updateGoogleAllowed}
        onToggleGoogle={toggleGoogleAllowedActivo}
        onDeleteGoogle={deleteGoogleAllowed}
      />
    </div>
  )
}
