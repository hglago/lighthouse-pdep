import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/types'
import { obtenerInformeDypsa } from '../actions'
import InformeDypsaCongelado from '../../InformeDypsaCongelado'

const ROLES_REPORTES: UserRole[] = ['admin', 'supervisor', 'socio']

export default async function InformeDypsaDetallePage({ params }: { params: { id: string } }) {
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

  const informe = await obtenerInformeDypsa(params.id)
  if (!informe) notFound()

  return <InformeDypsaCongelado cabecera={informe.cabecera} items={informe.items} />
}
