'use client'

import { useRouter } from 'next/navigation'
import { IconMenu, IconLogout } from '@/components/ui/icons'
import { createClient } from '@/lib/supabase/client'
import type { SessionUser } from '@/types'

interface HeaderProps {
  onMenuClick: () => void
  user: SessionUser
}

export default function Header({ onMenuClick, user }: HeaderProps) {
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.refresh()
    router.push('/login')
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
          {user.email}
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
