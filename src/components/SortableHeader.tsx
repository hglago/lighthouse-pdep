'use client'

import type { SortDir } from '@/lib/useSortable'

interface Props {
  label: string
  sortKey: string
  activeKey: string | null
  dir: SortDir
  onSort: (key: string) => void
  align?: 'left' | 'right' | 'center'
  className?: string
}

// Header de tabla con sort interactivo. Cliquea para rotar asc → desc → none.
// Indicador visual: ↑ asc, ↓ desc, ↕ inactivo (gris).
export default function SortableHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = 'left',
  className = '',
}: Props) {
  const active = activeKey === sortKey
  const arrow = active && dir === 'asc' ? '↑' : active && dir === 'desc' ? '↓' : '↕'
  const arrowClass = active ? 'text-slate-700' : 'text-gray-300'
  const justify = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'

  return (
    <th className={`px-4 py-3 text-${align} text-xs font-medium uppercase tracking-wide text-gray-500 ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 ${justify} hover:text-slate-900 transition-colors cursor-pointer select-none w-full`}
        aria-label={`Ordenar por ${label}`}
      >
        <span>{label}</span>
        <span className={`text-[10px] ${arrowClass}`}>{arrow}</span>
      </button>
    </th>
  )
}
