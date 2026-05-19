import { createBrowserClient } from '@supabase/ssr'

// Usar solo en Client Components. Requiere NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      'Supabase no está configurado. Copiá .env.local.example a .env.local y completá los valores.'
    )
  }

  return createBrowserClient(url, key)
}
