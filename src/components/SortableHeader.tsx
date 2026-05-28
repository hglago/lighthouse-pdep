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
  const justify = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'

  return (
    <th className={`px-4 py-3 text-${align} text-xs font-semibold uppercase tracking-wide text-slate-600 ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1.5 ${justify} hover:text-[#0C1F6E] transition-colors cursor-pointer select-none w-full`}
        aria-label={`Ordenar por ${label}`}
      >
        <span>{label}</span>
        <SortIcon active={active} dir={dir} />
      </button>
    </th>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  const color = active ? 'text-[#079783]' : 'text-slate-400'
  if (active && dir === 'asc') {
    return (
      <svg className={`h-3.5 w-3.5 ${color}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M10 5a1 1 0 01.78.375l4 5A1 1 0 0114 12H6a1 1 0 01-.78-1.625l4-5A1 1 0 0110 5z" clipRule="evenodd" />
      </svg>
    )
  }
  if (active && dir === 'desc') {
    return (
      <svg className={`h-3.5 w-3.5 ${color}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M10 15a1 1 0 01-.78-.375l-4-5A1 1 0 016 8h8a1 1 0 01.78 1.625l-4 5A1 1 0 0110 15z" clipRule="evenodd" />
      </svg>
    )
  }
  return (
    <svg className={`h-3.5 w-3.5 ${color}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 3a.75.75 0 01.53.22l3 3a.75.75 0 11-1.06 1.06L10 4.81 7.53 7.28A.75.75 0 116.47 6.22l3-3A.75.75 0 0110 3zM6.47 12.72a.75.75 0 011.06 0L10 15.19l2.47-2.47a.75.75 0 111.06 1.06l-3 3a.75.75 0 01-1.06 0l-3-3a.75.75 0 010-1.06z" />
    </svg>
  )
}
