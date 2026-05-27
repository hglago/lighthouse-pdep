import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/types'

const ROLES_REPORTES: UserRole[] = ['admin', 'supervisor', 'socio']

export default async function ReportesPage() {
  const supabase = createClient()

  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = (profile?.role as UserRole) ?? 'visualizador'
  if (!ROLES_REPORTES.includes(role)) redirect('/gastos')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Reportes</h1>
        <p className="mt-1 text-sm text-gray-500">
          Informes ejecutivos y auditoría de gastos del proyecto.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Link href="/reportes/dypsa" className="block rounded-lg border border-gray-200 bg-white p-6 hover:border-slate-300 hover:shadow-sm transition-all">
          <h2 className="text-lg font-medium text-gray-900">Informe Dypsa</h2>
          <p className="mt-2 text-sm text-gray-500">
            Informe ejecutivo de gastos pagados para socio.
          </p>
          <span className="mt-4 inline-block rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
            Ver informe
          </span>
        </Link>

        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-medium text-gray-900">Cancelación de gastos</h2>
          <p className="mt-2 text-sm text-gray-500">
            Auditoría de pagos, órdenes de pago y comprobantes asociados.
          </p>
          <span className="mt-4 inline-block rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
            Próximamente
          </span>
        </div>
      </div>
    </div>
  )
}
