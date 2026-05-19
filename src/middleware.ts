import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Rutas que requieren autenticación
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/fondos',
  '/gastos',
  '/pagos',
  '/anticipos',
  '/proveedores',
  '/honorarios',
  '/rendiciones',
]

// TODO: Reemplazar la verificación mock con Supabase Auth en la siguiente etapa
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isAuthenticated = request.cookies.get('mock-session')?.value === 'true'

  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  const isLoginPage = pathname === '/login'

  if (!isAuthenticated && isProtected) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (isAuthenticated && isLoginPage) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
