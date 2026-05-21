import { createClient } from '@supabase/supabase-js'

// Usar SOLO en server actions de admin. Bypassa RLS — nunca exponer en cliente.
// Requiere SUPABASE_SERVICE_ROLE_KEY (sin prefijo NEXT_PUBLIC_) en .env.local.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL no configurada.')
  }
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY no configurada en .env.local — requerida para invitar usuarios.')
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
