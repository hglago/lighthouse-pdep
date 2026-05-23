'use client'

import type { Financiador } from '@/types'

interface Props {
  financiadores: Financiador[]
  value: string                  // financiador_id seleccionado o ''
  onChange: (id: string) => void
  onRequestCreate?: () => void   // disparado al elegir "+ Nuevo financiador"
  disabled?: boolean
  className?: string
}

/**
 * Selector de financiador con opción de alta rápida.
 * Muestra "FIN-### — Nombre" para cada opción.
 * Solo lista activos (deleted_at IS NULL). Si codigo es null muestra "Sin código — Nombre".
 *
 * El alta rápida se delega al padre vía onRequestCreate (que abre un modal aparte).
 * El padre debe encargarse de seleccionar el nuevo financiador automáticamente
 * después de crearlo.
 */
export default function FinanciadorSelect({
  financiadores,
  value,
  onChange,
  onRequestCreate,
  disabled = false,
  className = '',
}: Props) {
  const activos = financiadores.filter(f => !f.deleted_at)

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value
    if (v === '__new__') {
      // Restablecemos el valor visual a lo previo y disparamos request al padre
      e.target.value = value
      onRequestCreate?.()
      return
    }
    onChange(v)
  }

  return (
    <select
      value={value}
      onChange={handleChange}
      disabled={disabled}
      className={`w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 disabled:opacity-50 ${className}`}
    >
      <option value="">— Seleccionar financiador —</option>
      {activos.map(f => (
        <option key={f.id} value={f.id}>
          {(f.codigo ?? 'Sin código') + ' — ' + f.nombre}
        </option>
      ))}
      {onRequestCreate && (
        <option value="__new__">+ Nuevo financiador…</option>
      )}
    </select>
  )
}
