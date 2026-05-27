'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  IconDashboard,
  IconFondos,
  IconGastos,
  IconPagos,
  IconProveedores,
  IconReportes,
  IconClose,
} from '@/components/ui/icons'
import { ROLE_LABELS } from '@/types'
import type { SessionUser, UserRole } from '@/types'
import { APP_VERSION } from '@/lib/version'

interface SidebarProps {
  open: boolean
  onClose: () => void
  user: SessionUser
}

function IconUsers() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

type NavItem = { label: string; href: string; Icon: React.ComponentType; allowedRoles: UserRole[] }

const ROLES_OPERATIVOS: UserRole[] = ['admin', 'supervisor', 'operador', 'user', 'contador', 'revisor', 'visualizador']

const navigation: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', Icon: IconDashboard, allowedRoles: ['admin'] },
  { label: 'Fondos', href: '/fondos', Icon: IconFondos, allowedRoles: ROLES_OPERATIVOS },
  { label: 'Gastos', href: '/gastos', Icon: IconGastos, allowedRoles: ROLES_OPERATIVOS },
  { label: 'Pagos', href: '/pagos', Icon: IconPagos, allowedRoles: ROLES_OPERATIVOS },
  { label: 'Proveedores', href: '/proveedores', Icon: IconProveedores, allowedRoles: ROLES_OPERATIVOS },
  { label: 'Reportes', href: '/reportes', Icon: IconReportes, allowedRoles: ['admin', 'supervisor', 'socio'] },
  { label: 'Usuarios', href: '/usuarios', Icon: IconUsers, allowedRoles: ['admin'] },
]

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return parts[0].slice(0, 2).toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}

export default function Sidebar({ open, onClose, user }: SidebarProps) {
  const pathname = usePathname()
  const initials = getInitials(user.full_name, user.email)
  const displayName = user.full_name ?? user.email

  return (
    <>
      {/* Overlay mobile */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-slate-900',
          'transition-transform duration-200 ease-in-out',
          'lg:relative lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b border-slate-800 px-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-white p-1.5">
              <img src="/brand/lighthouse-logo-horizontal.png" alt="Lighthouse School" className="h-7 w-auto" />
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">Gestión de Fondos</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:text-white lg:hidden"
            aria-label="Cerrar menú"
          >
            <IconClose />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {navigation
              .filter(item => item.allowedRoles.includes(user.role as UserRole))
              .map(({ label, href, Icon }) => {
              const isActive = pathname === href || pathname.startsWith(href + '/')
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onClose}
                    className={[
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-white/10 text-white'
                        : 'text-slate-400 hover:bg-white/5 hover:text-white',
                    ].join(' ')}
                  >
                    <Icon />
                    {label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* User section */}
        <div className="border-t border-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-700">
              <span className="text-xs font-medium text-slate-300">{initials}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{displayName}</p>
              <p className="truncate text-xs text-slate-400">{ROLE_LABELS[user.role] ?? user.role}</p>
            </div>
          </div>
        </div>

        {/* Versión */}
        <div className="border-t border-slate-800 px-4 py-2.5">
          <p className="truncate text-[10px] font-mono tabular-nums text-slate-500">
            {APP_VERSION.tag} · {APP_VERSION.commit}
          </p>
          <p className="truncate text-[10px] font-mono tabular-nums text-slate-600">
            {APP_VERSION.env} · {new Date(APP_VERSION.buildTime).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </aside>
    </>
  )
}
