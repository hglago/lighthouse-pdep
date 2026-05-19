import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AnticiposClient, { type AnticipoRow } from './AnticiposClient'
import type { Fondo, Proveedor, UserRole } from '@/types'
import { createAnticipo, updateAnticipo, cambiarEstadoAnticipo } from './actions'

export default async function AnticiposPage() {
  const supabase = createClient()

  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) redirect('/login')

  const [profileResult, anticiposResult, fondosResult, proveedoresResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single(),
    supabase
      .from('anticipos')
      .select('id, proveedor_id, fondo_id, concepto, monto_total, porcentaje_anticipo, monto_anticipo, monto_saldo, moneda, fecha_acuerdo, fecha_vencimiento_saldo, estado, observaciones, created_by, created_at, proveedores(nombre), fondos(nombre, moneda)')
      .is('deleted_at', null)
      .order('fecha_acuerdo', { ascending: false }),
    supabase
      .from('fondos')
      .select('id, nombre, moneda')
      .is('deleted_at', null)
      .eq('estado', 'activo')
      .order('nombre', { ascending: true }),
    supabase
      .from('proveedores')
      .select('id, nombre')
      .is('deleted_at', null)
      .eq('activo', true)
      .order('nombre', { ascending: true }),
  ])

  const role: UserRole = (profileResult.data?.role as UserRole) ?? 'visualizador'
  const anticipos: AnticipoRow[] = (anticiposResult.data ?? []) as unknown as AnticipoRow[]
  const fondos = (fondosResult.data ?? []) as Pick<Fondo, 'id' | 'nombre' | 'moneda'>[]
  const proveedores = (proveedoresResult.data ?? []) as Pick<Proveedor, 'id' | 'nombre'>[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Anticipos</h1>
        <p className="mt-1 text-sm text-gray-500">
          Anticipos comerciales a proveedores.
        </p>
      </div>

      <AnticiposClient
        anticipos={anticipos}
        fondos={fondos}
        proveedores={proveedores}
        role={role}
        onCreateAnticipo={createAnticipo}
        onUpdateAnticipo={updateAnticipo}
        onCambiarEstado={cambiarEstadoAnticipo}
      />
    </div>
  )
}
