import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import GastosClient, { type GastoRow } from './GastosClient'
import type { Fondo, Proveedor, UserRole } from '@/types'
import { createGasto, updateGasto, deleteGasto, cambiarEstadoGasto } from './actions'

export default async function GastosPage() {
  const supabase = createClient()

  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) redirect('/login')

  const [profileResult, gastosResult, fondosResult, proveedoresResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single(),
    supabase
      .from('gastos')
      .select('id, fondo_id, proveedor_id, descripcion, monto, moneda, estado, fecha_gasto, notas, tiene_anticipo, monto_anticipo, porcentaje_anticipo, fecha_prevista_pago_anticipo, fecha_comprometida_pago_saldo, condiciones_pago_notas, fecha_vencimiento, prioridad_pago, created_by, created_at, fondos(nombre, moneda), proveedores(nombre)')
      .is('deleted_at', null)
      .order('fecha_gasto', { ascending: false }),
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
      .order('nombre', { ascending: true }),
  ])

  const role: UserRole = (profileResult.data?.role as UserRole) ?? 'visualizador'
  const gastos: GastoRow[] = (gastosResult.data ?? []) as unknown as GastoRow[]
  const fondos = (fondosResult.data ?? []) as Pick<Fondo, 'id' | 'nombre' | 'moneda'>[]
  const proveedores = (proveedoresResult.data ?? []) as Pick<Proveedor, 'id' | 'nombre'>[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Gastos</h1>
        <p className="mt-1 text-sm text-gray-500">
          Registro y control de gastos por fondo.
        </p>
      </div>

      <GastosClient
          gastos={gastos}
          fondos={fondos}
          proveedores={proveedores}
          role={role}
          onCreateGasto={createGasto}
          onUpdateGasto={updateGasto}
          onDeleteGasto={deleteGasto}
          onCambiarEstado={cambiarEstadoGasto}
        />
    </div>
  )
}
