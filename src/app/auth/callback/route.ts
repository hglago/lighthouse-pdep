import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const oauthError = searchParams.get('error')
  const oauthErrorCode = searchParams.get('error_code')
  const oauthErrorDescription = searchParams.get('error_description')

  console.error('[oauth callback] hit:', {
    url: request.url,
    hasCode: !!code,
    oauthError,
    oauthErrorCode,
    oauthErrorDescription,
  })

  // Si Supabase/Google enviaron error explícito, lo logueamos y redirigimos genérico
  if (oauthError) {
    console.error('[oauth callback] provider error:', { oauthError, oauthErrorCode, oauthErrorDescription })
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  if (!code) {
    console.error('[oauth callback] no code in URL')
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  const supabase = createClient()

  const { data: exData, error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code)
  if (exchangeErr) {
    console.error('[oauth callback] exchangeCodeForSession failed:', {
      message: exchangeErr.message,
      status: exchangeErr.status,
      name: exchangeErr.name,
    })
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  console.error('[oauth callback] exchange OK. user email:', exData?.user?.email)

  const { data, error: rpcErr } = await supabase.rpc('fn_apply_google_whitelist_self')
  if (rpcErr) {
    console.error('[oauth callback] rpc error:', rpcErr.message)
    await supabase.auth.signOut()
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row?.allowed) {
    console.error('[oauth callback] not allowed. reason:', row?.reason ?? 'unknown')
    await supabase.auth.signOut()
    return NextResponse.redirect(`${origin}/login?error=not_authorized`)
  }

  console.error('[oauth callback] allowed. reason:', row.reason)
  return NextResponse.redirect(`${origin}/dashboard`)
}
