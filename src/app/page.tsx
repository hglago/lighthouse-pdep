import { redirect } from 'next/navigation'

type Props = {
  searchParams: { error?: string; error_code?: string; error_description?: string }
}

export default function Home({ searchParams }: Props) {
  // Si Supabase redirigió acá con un error de OAuth (Site URL fallback),
  // logueamos y mandamos al login con mensaje genérico.
  if (searchParams.error || searchParams.error_code) {
    console.error('[home] oauth error in URL:', searchParams)
    redirect('/login?error=auth_failed')
  }
  redirect('/dashboard')
}
