import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DashboardShell from '@/components/layout/DashboardShell'
import type { SessionUser } from '@/types'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()

  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, activo')
    .eq('id', user.id)
    .single()

  // Sin profile (auth.user huérfano) o profile inactivo → expulsar vía route handler.
  // signOut() en Server Components NO limpia cookies del browser (read-only context),
  // por eso delegamos a /auth/signout que SÍ puede clearear cookies y cierra sesión limpia.
  if (!profile || profile.activo === false) {
    redirect('/auth/signout')
  }

  const sessionUser: SessionUser = {
    id: user.id,
    email: profile?.email ?? user.email ?? '',
    full_name: profile?.full_name ?? null,
    role: profile?.role ?? 'visualizador',
  }

  return <DashboardShell user={sessionUser}>{children}</DashboardShell>
}
