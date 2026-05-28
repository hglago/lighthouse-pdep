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
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ring-1 transition-colors ${
          noItems
            ? 'cursor-not-allowed text-gray-300 ring-slate-200'
            : 'text-[#079783] ring-[#079783]/30 hover:bg-[#079783]/10 hover:ring-[#079783]/50'
        }`}
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
          <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
        </svg>
        <span>{buttonLabel}</span>
        <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
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
