'use client'

import { useMemo, useState, useCallback } from 'react'

export type SortDir = 'asc' | 'desc' | null

// Devuelve un comparable estable a partir del valor. null/undefined van al final.
function comparable(v: unknown): { type: 'null' } | { type: 'num'; n: number } | { type: 'str'; s: string } {
  if (v === null || v === undefined || v === '') return { type: 'null' }
  if (typeof v === 'number' && !isNaN(v)) return { type: 'num', n: v }
  if (typeof v === 'string') {
    const s = v.trim()
    // Detección de fecha ISO YYYY-MM-DD o ISO completo
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const t = Date.parse(s)
      if (!isNaN(t)) return { type: 'num', n: t }
    }
    return { type: 'str', s: s.toLocaleLowerCase('es') }
  }
  if (typeof v === 'boolean') return { type: 'num', n: v ? 1 : 0 }
  return { type: 'str', s: String(v).toLocaleLowerCase('es') }
}

function compareValues(a: unknown, b: unknown): number {
  const ca = comparable(a)
  const cb = comparable(b)
  // null/undefined siempre al final, sin importar la dirección
  if (ca.type === 'null' && cb.type === 'null') return 0
  if (ca.type === 'null') return 1
  if (cb.type === 'null') return -1
  if (ca.type === 'num' && cb.type === 'num') return ca.n - cb.n
  if (ca.type === 'str' && cb.type === 'str') return ca.s.localeCompare(cb.s, 'es')
  // mixto: tratar numérico como menor
  if (ca.type === 'num') return -1
  return 1
}

// Hook para tablas: rota asc → desc → none por click en la misma columna.
// Cambiar de columna inicia en asc.
export function useSortable<T>(
  rows: T[],
  accessors: Record<string, (row: T) => unknown>,
  initial?: { key: string; dir: Exclude<SortDir, null> }
) {
  const [key, setKey] = useState<string | null>(initial?.key ?? null)
  const [dir, setDir] = useState<SortDir>(initial?.dir ?? null)

  const onSort = useCallback((nextKey: string) => {
    if (key !== nextKey) {
      setKey(nextKey)
      setDir('asc')
      return
    }
    if (dir === 'asc') setDir('desc')
    else if (dir === 'desc') { setKey(null); setDir(null) }
    else setDir('asc')
  }, [key, dir])

  const sorted = useMemo(() => {
    if (!key || !dir) return rows
    const accessor = accessors[key]
    if (!accessor) return rows
    const copy = rows.slice()
    copy.sort((a, b) => {
      const cmp = compareValues(accessor(a), accessor(b))
      return dir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [rows, key, dir, accessors])

  return { sorted, sortKey: key, sortDir: dir, onSort }
}

// Icono de orden para encabezados clickeables.
export function sortIndicator(active: boolean, dir: SortDir): string {
  if (!active || !dir) return '↕'
  return dir === 'asc' ? '↑' : '↓'
}
