'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  IconDashboard,
  IconFondos,
  IconGastos,
  IconPagos,
  IconProveedores,
  IconHonorarios,
  IconRendiciones,
  IconClose,
} from '@/components/ui/icons'
import { ROLE_LABELS } from '@/types'
import type { SessionUser } from '@/types'

interface SidebarProps {
  open: boolean
  onClose: () => void
  user: SessionUser
}

const navigation = [
  { label: 'Dashboard', href: '/dashboard', Icon: IconDashboard },
  { label: 'Fondos', href: '/fondos', Icon: IconFondos },
  { label: 'Gastos', href: '/gastos', Icon: IconGastos },
  { label: 'Pagos', href: '/pagos', Icon: IconPagos },
  { label: 'Proveedores', href: '/proveedores', Icon: IconProveedores },
  { label: 'Honorarios', href: '/honorarios', Icon: IconHonorarios },
  { label: 'Rendiciones', href: '/rendiciones', Icon: IconRendiciones },
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
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white">
              <span className="text-xs font-bold text-slate-900">PD</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">PDEP</p>
              <p className="text-xs text-slate-400">Gestión de Fondos</p>
            </div>
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
            {navigation.map(({ label, href, Icon }) => {
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
      </aside>
    </>
  )
}
