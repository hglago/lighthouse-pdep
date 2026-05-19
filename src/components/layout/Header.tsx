'use client'

import { IconMenu, IconLogout } from '@/components/ui/icons'

interface HeaderProps {
  onMenuClick: () => void
}

export default function Header({ onMenuClick }: HeaderProps) {
  function handleLogout() {
    // Elimina la cookie de sesión mock y redirige al login
    document.cookie = 'mock-session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/'
    window.location.href = '/login'
  }

  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 lg:px-6">
      <button
        onClick={onMenuClick}
        className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 lg:hidden"
        aria-label="Abrir menú"
      >
        <IconMenu />
      </button>

      <div className="flex items-center gap-3 ml-auto">
        <span className="hidden text-sm text-gray-500 sm:block">
          admin@lighthouse.com
        </span>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        >
          <IconLogout className="w-4 h-4" />
          <span className="hidden sm:inline">Salir</span>
        </button>
      </div>
    </header>
  )
}
