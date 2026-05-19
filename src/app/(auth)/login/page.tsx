'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

// Credenciales mock — se reemplazarán con Supabase Auth en la siguiente etapa
const MOCK_EMAIL = 'admin@lighthouse.com'
const MOCK_PASSWORD = 'admin123'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (email === MOCK_EMAIL && password === MOCK_PASSWORD) {
      document.cookie = 'mock-session=true; path=/; SameSite=Strict'
      router.push('/dashboard')
    } else {
      setError('Credenciales incorrectas. Verificá el email y la contraseña.')
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">

          {/* Brand */}
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900">
              <span className="text-sm font-bold text-white">PD</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">PDEP</h1>
            <p className="mt-1 text-sm text-gray-500">Gestión de Fondos</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                placeholder="tu@email.com"
                required
                autoComplete="email"
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

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>

          {/* Mock credentials notice — remover al integrar auth real */}
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="mb-1 text-xs font-semibold text-amber-800">Credenciales de prueba</p>
            <p className="text-xs text-amber-700">Email: {MOCK_EMAIL}</p>
            <p className="text-xs text-amber-700">Contraseña: {MOCK_PASSWORD}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
