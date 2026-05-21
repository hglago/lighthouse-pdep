import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Route Handler: aquí supabase.auth.signOut() SÍ puede limpiar cookies
// (a diferencia de Server Components donde las cookies son read-only).
// Usado por (dashboard)/layout.tsx cuando detecta un auth.user sin profile
// para cerrar la sesión limpiamente y evitar loops middleware ↔ layout.
export async function GET(request: NextRequest) {
  const supabase = createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/login', request.url))
}
