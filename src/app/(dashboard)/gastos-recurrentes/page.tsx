import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import GastosRecurrentesClient, { type GastoRecurrenteRow } from './GastosRecurrentesClient'
import type { Fondo, Proveedor, UserRole } from '@/types'
import { createGastoRecurrente, updateGastoRecurrente, deleteGastoRecurrente } from './actions'

export default async function GastosRecurrentesPage() {
  const supabase = createClient()

  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) redirect('/login')

  const [profileResult, recurrentesResult, fondosResult, proveedoresResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single(),
    supabase
      .from('gastos_recurrentes')
      .select('id, fondo_id, proveedor_id, concepto, categoria, monto, moneda, dia_vencimiento, fecha_inicio, fecha_fin, activo, prioridad_pago, observaciones, created_by, created_at, fondos(nombre, moneda), proveedores(nombre)')
      .is('deleted_at', null)
      .order('concepto', { ascending: true }),
    supabase
      .from('fondos')
      .select('id, nombre, moneda')
      .is('deleted_at', null)
      .eq('estado', 'activo')
      .order('nombre'),
    supabase
      .from('proveedores')
      .select('id, nombre')
      .is('deleted_at', null)
      .eq('activo', true)
      .order('nombre'),
  ])

  const role: UserRole = (profileResult.data?.role as UserRole) ?? 'visualizador'
  const recurrentes = (recurrentesResult.data ?? []) as unknown as GastoRecurrenteRow[]
  const fondos = (fondosResult.data ?? []) as Pick<Fondo, 'id' | 'nombre' | 'moneda'>[]
  const proveedores = (proveedoresResult.data ?? []) as Pick<Proveedor, 'id' | 'nombre'>[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Gastos recurrentes</h1>
        <p className="mt-1 text-sm text-gray-500">
          Obligaciones de pago periódicas con día de vencimiento mensual.
        </p>
      </div>

      <GastosRecurrentesClient
        recurrentes={recurrentes}
        fondos={fondos}
        proveedores={proveedores}
        role={role}
        onCreateRecurrente={createGastoRecurrente}
        onUpdateRecurrente={updateGastoRecurrente}
        onDeleteRecurrente={deleteGastoRecurrente}
      />
    </div>
  )
}
