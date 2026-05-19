import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ProveedoresClient from './ProveedoresClient'
import type { Proveedor, UserRole } from '@/types'

export default async function ProveedoresPage() {
  const supabase = createClient()

  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) redirect('/login')

  const [profileResult, proveedoresResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single(),
    supabase
      .from('proveedores')
      .select('id, nombre, cuit, email, telefono, direccion, activo, created_by, created_at, updated_at, deleted_at')
      .is('deleted_at', null)
      .order('nombre', { ascending: true }),
  ])

  const role: UserRole = (profileResult.data?.role as UserRole) ?? 'visualizador'
  const proveedores: Proveedor[] = (proveedoresResult.data ?? []) as Proveedor[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Proveedores</h1>
        <p className="mt-1 text-sm text-gray-500">
          Alta y gestión de proveedores.
        </p>
      </div>

      <ProveedoresClient proveedores={proveedores} role={role} />
    </div>
  )
}
