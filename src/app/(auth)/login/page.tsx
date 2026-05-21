'use client'

import { useState, useEffect, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// OAuth Google pausado temporalmente hasta estabilización.
// Flipear a true reactiva el botón "Continuar con Google" sin tocar el callback ni la whitelist.
const OAUTH_GOOGLE_ENABLED = false

export default function LoginPage() {
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [urlError, setUrlError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const err = params.get('error')
    if (err === 'not_authorized') setUrlError('Usuario no autorizado.')
    else if (err === 'auth_failed') setUrlError('Error de autenticación. Intentá de nuevo.')
  }, [])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setUrlError('')
    setLoading(true)

    const supabase = createClient()
    const loginNormalizado = usuario.toLowerCase().trim()

    const { data: email, error: rpcError } = await supabase.rpc(
      'fn_email_by_usuario_login',
      { p_login: loginNormalizado }
    )
    if (rpcError || !email) {
      setError('Usuario o contraseña incorrectos.')
      setLoading(false)
      return
    }

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) {
      setError('Usuario o contraseña incorrectos.')
      setLoading(false)
      return
    }

    router.refresh()
    router.push('/dashboard')
  }

  async function handleGoogleLogin() {
    setError('')
    setUrlError('')
    setGoogleLoading(true)
    const supabase = createClient()
    const { error: oauthErr } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (oauthErr) {
      setError('No se pudo iniciar sesión con Google.')
      setGoogleLoading(false)
    }
    // Si no hay error, el browser ya está navegando a Google. No reseteo loading.
  }

  const mensaje = urlError || error

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">

          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900">
              <span className="text-sm font-bold text-white">PD</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">PDEP</h1>
            <p className="mt-1 text-sm text-gray-500">Gestión de Fondos</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="usuario" className="mb-1 block text-sm font-medium text-gray-700">
                Usuario
              </label>
              <input
                id="usuario"
                type="text"
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                placeholder="usuario"
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            {mensaje && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {mensaje}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>

          {/* OAuth Google pausado temporalmente hasta estabilización.
              Separador + botón solo se renderizan cuando OAUTH_GOOGLE_ENABLED=true.
              El callback /auth/callback, la whitelist google_allowed_users y la sección
              "Usuarios Google autorizados" en /usuarios siguen disponibles para el día
              que se reactive. */}
          {OAUTH_GOOGLE_ENABLED && (
            <>
              <div className="my-5 flex items-center gap-3 text-xs text-gray-400">
                <div className="h-px flex-1 bg-gray-200" />
                <span>o</span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>

              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={loading || googleLoading}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC04" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                {googleLoading ? 'Conectando...' : 'Continuar con Google'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
