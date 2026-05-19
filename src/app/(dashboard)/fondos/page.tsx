import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FondosClient from './FondosClient'
import type { Fondo, UserRole } from '@/types'

export default async function FondosPage() {
  const supabase = createClient()

  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) redirect('/login')

  const [profileResult, fondosResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single(),
    supabase
      .from('fondos')
      .select('id, nombre, descripcion, monto_inicial, saldo_actual, moneda, estado, responsable_id, created_by, created_at, updated_at, deleted_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
  ])

  const role: UserRole = (profileResult.data?.role as UserRole) ?? 'visualizador'
  const fondos: Fondo[] = (fondosResult.data ?? []) as Fondo[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Fondos</h1>
        <p className="mt-1 text-sm text-gray-500">
          Administración de fondos y cuentas.
        </p>
      </div>

      <FondosClient fondos={fondos} role={role} />
    </div>
  )
}
