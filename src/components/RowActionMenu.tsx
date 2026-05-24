'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type RowActionItem = {
  label: string
  onClick: () => void
  disabled?: boolean
  // primary  = verde (acción principal afirmativa, ej. Aprobar)
  // danger   = rojo (acción destructiva, ej. Eliminar, Cancelar)
  // default  = slate (resto)
  variant?: 'default' | 'primary' | 'danger'
}

interface Props {
  items: RowActionItem[]
  /** Si items está vacío, el botón aparece deshabilitado con este tooltip. */
  emptyTooltip?: string
  buttonLabel?: string
}

// Dropdown de acciones por fila. Se renderiza en un Portal con position:fixed
// para escapar al overflow del DataTable (overflow-x-auto fuerza overflow-y a
// auto por el quirk de CSS, lo que clipearía el menú dentro de la celda).
export default function RowActionMenu({ items, emptyTooltip, buttonLabel = 'Acción' }: Props) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (btnRef.current?.contains(e.target as Node)) return
      // Si el click cae dentro del menú, dejar que el handler del item cierre.
      const target = e.target as HTMLElement
      if (target?.closest?.('[data-rowaction-menu]')) return
      setOpen(false)
    }
    function onScroll() { setOpen(false) }
    function onResize() { setOpen(false) }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const noItems = items.length === 0

  function toggle() {
    if (noItems) return
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setCoords({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    setOpen(o => !o)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        disabled={noItems}
        title={noItems ? emptyTooltip : undefined}
        className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
          noItems
            ? 'cursor-not-allowed text-gray-300'
            : 'text-slate-700 hover:bg-slate-100'
        }`}
      >
        {buttonLabel}
        <span className="text-[10px]">{open ? '▴' : '▾'}</span>
      </button>
      {open && coords && typeof window !== 'undefined' && createPortal(
        <div
          data-rowaction-menu
          className="fixed z-[60] min-w-[160px] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          style={{ top: coords.top, right: coords.right }}
        >
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setOpen(false)
                it.onClick()
              }}
              disabled={it.disabled}
              className={`block w-full px-3 py-1.5 text-left text-xs font-medium transition-colors disabled:opacity-50 ${
                it.variant === 'primary' ? 'text-emerald-700 hover:bg-emerald-50' :
                it.variant === 'danger'  ? 'text-red-600 hover:bg-red-50' :
                                            'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
