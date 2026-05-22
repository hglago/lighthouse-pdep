import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ProveedoresClient from './ProveedoresClient'
import type { Proveedor, UserRole } from '@/types'

export default async function ProveedoresPage() {
  const supabase = createClient()

  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) redirect('/login')

  // Query base con columnas que siempre existen (mismo patrón que el selector de
  // Gastos, que ya sabemos que funciona).
  const [profileResult, proveedoresResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single(),
    supabase
      .from('proveedores')
      .select('id, nombre, cuit, email, telefono, direccion, observaciones, activo, created_by, created_at, updated_at, deleted_at')
      .is('deleted_at', null)
      .order('nombre', { ascending: true }),
  ])

  // Intentamos enriquecer con columnas uplift en una query separada. Si las
  // columnas todavía no existen en DB (ALTER pendiente), simplemente ignoramos
  // y hidratamos defaults — el listado funciona igual.
  const upliftMap = new Map<string, { tiene_uplift: boolean; porcentaje_uplift: number }>()
  if (proveedoresResult.data && proveedoresResult.data.length > 0) {
    const upliftResult = await supabase
      .from('proveedores')
      .select('id, tiene_uplift, porcentaje_uplift')
      .is('deleted_at', null)
    if (upliftResult.error) {
      console.warn('[proveedores] columnas uplift no disponibles:', upliftResult.error.message)
    } else if (upliftResult.data) {
      for (const u of upliftResult.data as Array<{ id: string; tiene_uplift: boolean | null; porcentaje_uplift: number | null }>) {
        upliftMap.set(u.id, {
          tiene_uplift: u.tiene_uplift === true,
          porcentaje_uplift: Number(u.porcentaje_uplift) || 0,
        })
      }
    }
  }

  const role: UserRole = (profileResult.data?.role as UserRole) ?? 'visualizador'
  const proveedores: Proveedor[] = (proveedoresResult.data ?? []).map(p => {
    const up = upliftMap.get(p.id)
    return {
      ...p,
      tiene_uplift: up?.tiene_uplift ?? false,
      porcentaje_uplift: up?.porcentaje_uplift ?? 0,
    } as Proveedor
  })

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
