import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FondosClient, { type AporteFondoRow } from './FondosClient'
import type { Fondo, UserRole } from '@/types'
import { createFondo, updateFondo, deleteFondo, registrarAporte } from './actions'

export default async function FondosPage() {
  const supabase = createClient()

  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) redirect('/login')

  const [profileResult, fondosResult, aportesResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single(),
    supabase
      .from('fondos')
      .select('id, nombre, descripcion, monto_inicial, saldo_actual, moneda, estado, responsable_id, created_by, created_at, updated_at, deleted_at')
      .is('deleted_at', null)
      .order('nombre'),
    supabase
      .from('aportes_fondo')
      .select('id, fondo_id, movimiento_id, fecha_aporte, monto, moneda, tipo_aporte, aportante, concepto, comprobante_url, observaciones, created_by, created_at, updated_at, deleted_at, fondos(nombre)')
      .is('deleted_at', null)
      .order('fecha_aporte', { ascending: false }),
  ])

  const role: UserRole = (profileResult.data?.role as UserRole) ?? 'visualizador'
  const fondos: Fondo[] = (fondosResult.data ?? []) as Fondo[]
  const aportes = (aportesResult.data ?? []) as unknown as AporteFondoRow[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Fondos</h1>
        <p className="mt-1 text-sm text-gray-500">
          Administración de fondos y registro de aportes.
        </p>
      </div>

      <FondosClient
        fondos={fondos}
        aportes={aportes}
        role={role}
        onCreateFondo={createFondo}
        onUpdateFondo={updateFondo}
        onDeleteFondo={deleteFondo}
        onRegistrarAporte={registrarAporte}
      />
    </div>
  )
}
