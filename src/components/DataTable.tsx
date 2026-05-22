'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSortable } from '@/lib/useSortable'
import SortableHeader from './SortableHeader'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ColumnType = 'text' | 'number' | 'date' | 'enum'
export type Align = 'left' | 'right' | 'center'

export interface Column<T> {
  key: string
  label: string
  accessor: (row: T) => unknown
  render?: (row: T) => ReactNode
  type?: ColumnType
  sortable?: boolean
  filterable?: boolean
  align?: Align
  className?: string
  /** Para type='enum'. Si se omite, los valores se infieren de los datos visibles. */
  enumOptions?: Array<{ value: string; label?: string }>
}

interface Props<T> {
  rows: T[]
  columns: Column<T>[]
  getRowId: (row: T) => string
  selectable?: boolean
  rowActions?: (row: T) => ReactNode
  bulkActions?: (selectedIds: Set<string>, clear: () => void) => ReactNode
  /** Búsqueda general controlada por el módulo. Se aplica como contains case-insensitive
   *  contra accessor(row) de las columnas listadas en searchKeys. */
  searchTerm?: string
  searchKeys?: string[]
  emptyMessage?: string
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  /** Callback con las filas visibles tras filtros+orden. Útil para Exportar Excel
   *  desde el módulo respetando lo mostrado. */
  onVisibleRowsChange?: (rows: T[]) => void
  className?: string
}

// ─── Filter state ────────────────────────────────────────────────────────────

type FilterValue =
  | { type: 'contains'; value: string }
  | { type: 'range'; min: string; max: string }
  | { type: 'enum'; values: Set<string> }
  | null

type FilterMap = Record<string, FilterValue>

function isFilterActive(f: FilterValue): boolean {
  if (!f) return false
  if (f.type === 'contains') return f.value.trim() !== ''
  if (f.type === 'range') return f.min.trim() !== '' || f.max.trim() !== ''
  if (f.type === 'enum') return f.values.size > 0
  return false
}

function matchesFilter(value: unknown, f: FilterValue, type: ColumnType): boolean {
  if (!f) return true
  if (f.type === 'contains') {
    const needle = f.value.trim().toLocaleLowerCase('es')
    if (!needle) return true
    const haystack = String(value ?? '').toLocaleLowerCase('es')
    return haystack.includes(needle)
  }
  if (f.type === 'range') {
    if (type === 'number') {
      const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''))
      if (isNaN(n)) return false
      if (f.min.trim() !== '') {
        const min = parseFloat(f.min)
        if (!isNaN(min) && n < min) return false
      }
      if (f.max.trim() !== '') {
        const max = parseFloat(f.max)
        if (!isNaN(max) && n > max) return false
      }
      return true
    }
    if (type === 'date') {
      const s = String(value ?? '')
      if (!s) return false
      if (f.min.trim() !== '' && s < f.min) return false
      if (f.max.trim() !== '' && s > f.max) return false
      return true
    }
    return true
  }
  if (f.type === 'enum') {
    return f.values.has(String(value ?? ''))
  }
  return true
}

// ─── DataTable ───────────────────────────────────────────────────────────────

export default function DataTable<T>({
  rows,
  columns,
  getRowId,
  selectable = false,
  rowActions,
  bulkActions,
  searchTerm = '',
  searchKeys,
  emptyMessage = 'Sin resultados.',
  initialSort,
  onVisibleRowsChange,
  className = '',
}: Props<T>) {
  // ── Search + per-column filters ────────────────────────────────────────────
  const [filters, setFilters] = useState<FilterMap>({})
  const activeFilterKeys = Object.keys(filters).filter(k => isFilterActive(filters[k]))

  // Aplica search general primero
  const searched = useMemo(() => {
    const q = searchTerm.trim().toLocaleLowerCase('es')
    if (!q) return rows
    const keys = searchKeys && searchKeys.length > 0
      ? columns.filter(c => searchKeys.includes(c.key))
      : columns.filter(c => (c.type ?? 'text') === 'text')
    return rows.filter(row =>
      keys.some(c => String(c.accessor(row) ?? '').toLocaleLowerCase('es').includes(q))
    )
  }, [rows, columns, searchTerm, searchKeys])

  // Luego filtros por columna
  const filtered = useMemo(() => {
    if (activeFilterKeys.length === 0) return searched
    const colByKey: Record<string, Column<T>> = {}
    for (const c of columns) colByKey[c.key] = c
    return searched.filter(row =>
      activeFilterKeys.every(k => {
        const c = colByKey[k]
        if (!c) return true
        return matchesFilter(c.accessor(row), filters[k], c.type ?? 'text')
      })
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, filters, columns])

  // Luego orden
  const sortAccessors = useMemo(() => {
    const acc: Record<string, (row: T) => unknown> = {}
    for (const c of columns) if (c.sortable !== false) acc[c.key] = c.accessor
    return acc
  }, [columns])
  const { sorted, sortKey, sortDir, onSort } = useSortable(filtered, sortAccessors, initialSort)

  // Notifica filas visibles al exterior (para Excel/export)
  useEffect(() => {
    onVisibleRowsChange?.(sorted)
  }, [sorted, onVisibleRowsChange])

  // ── Selección ──────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const selectedVisibleCount = sorted.reduce((n, row) => n + (selectedIds.has(getRowId(row)) ? 1 : 0), 0)
  const allVisibleSelected = sorted.length > 0 && selectedVisibleCount === sorted.length
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected

  function toggleRow(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAllVisible() {
    if (allVisibleSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(sorted.map(getRowId)))
  }
  function clearSelection() {
    setSelectedIds(new Set())
  }

  // ── Helpers de filtro ──────────────────────────────────────────────────────
  function setFilter(key: string, value: FilterValue) {
    setFilters(prev => ({ ...prev, [key]: value }))
  }
  function clearAllFilters() {
    setFilters({})
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const colSpan = columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)

  return (
    <div className={`space-y-3 ${className}`}>
      {bulkActions && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <span className="text-sm font-medium text-emerald-900">
            {selectedIds.size} seleccionado{selectedIds.size !== 1 ? 's' : ''}
          </span>
          <span className="text-emerald-300">·</span>
          {bulkActions(selectedIds, clearSelection)}
          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto rounded-md px-2 py-1.5 text-xs text-emerald-700 hover:bg-emerald-100 transition-colors"
          >
            Limpiar selección
          </button>
        </div>
      )}

      {activeFilterKeys.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <span className="font-medium">
            {activeFilterKeys.length} filtro{activeFilterKeys.length !== 1 ? 's' : ''} activo{activeFilterKeys.length !== 1 ? 's' : ''}
          </span>
          <button
            type="button"
            onClick={clearAllFilters}
            className="rounded px-2 py-0.5 text-xs underline hover:no-underline"
          >
            Limpiar todos los filtros
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {selectable && (
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      ref={el => { if (el) el.indeterminate = someVisibleSelected }}
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      disabled={sorted.length === 0}
                      className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500 disabled:opacity-40"
                      aria-label="Seleccionar todos los visibles"
                    />
                  </th>
                )}
                {columns.map(c => (
                  <ColumnHeader
                    key={c.key}
                    column={c}
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={onSort}
                    filter={filters[c.key] ?? null}
                    onFilterChange={(v) => setFilter(c.key, v)}
                    rows={searched}
                  />
                ))}
                {rowActions && (
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">
                    Acciones
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-gray-400">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                sorted.map(row => {
                  const id = getRowId(row)
                  const isSel = selectedIds.has(id)
                  return (
                    <tr key={id} className={`transition-colors ${isSel ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}>
                      {selectable && (
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggleRow(id)}
                            className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
                            aria-label={`Seleccionar fila`}
                          />
                        </td>
                      )}
                      {columns.map(c => {
                        const align = c.align ?? 'left'
                        const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
                        return (
                          <td key={c.key} className={`px-4 py-3 text-sm text-gray-700 ${alignClass} ${c.className ?? ''}`}>
                            {c.render ? c.render(row) : formatCell(c.accessor(row), c.type)}
                          </td>
                        )
                      })}
                      {rowActions && (
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">{rowActions(row)}</div>
                        </td>
                      )}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function formatCell(value: unknown, type?: ColumnType): ReactNode {
  if (value === null || value === undefined) return <span className="text-gray-300">—</span>
  if (type === 'number' && typeof value === 'number') {
    return <span className="tabular-nums">{value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
  }
  return String(value)
}

// ─── ColumnHeader (con popover de filtro) ────────────────────────────────────

interface ColumnHeaderProps<T> {
  column: Column<T>
  activeKey: string | null
  dir: 'asc' | 'desc' | null
  onSort: (key: string) => void
  filter: FilterValue
  onFilterChange: (v: FilterValue) => void
  rows: T[]
}

function ColumnHeader<T>({ column, activeKey, dir, onSort, filter, onFilterChange, rows }: ColumnHeaderProps<T>) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const filterable = column.filterable !== false
  const sortable = column.sortable !== false
  const isFiltered = isFilterActive(filter)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // Solo header sin sort/filter
  if (!sortable && !filterable) {
    const align = column.align ?? 'left'
    return (
      <th className={`px-4 py-3 text-${align} text-xs font-medium uppercase tracking-wide text-gray-500 ${column.className ?? ''}`}>
        {column.label}
      </th>
    )
  }

  // Solo sortable, sin filter
  if (sortable && !filterable) {
    return (
      <SortableHeader
        label={column.label}
        sortKey={column.key}
        activeKey={activeKey}
        dir={dir}
        onSort={onSort}
        align={column.align ?? 'left'}
        className={column.className ?? ''}
      />
    )
  }

  // Filterable: combinamos botón sort + ícono filter
  const align = column.align ?? 'left'
  const justify = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'
  const arrow = sortable && activeKey === column.key && dir === 'asc' ? '↑'
              : sortable && activeKey === column.key && dir === 'desc' ? '↓'
              : sortable ? '↕' : ''
  const arrowClass = sortable && activeKey === column.key ? 'text-slate-700' : 'text-gray-300'

  return (
    <th className={`px-4 py-3 text-${align} text-xs font-medium uppercase tracking-wide text-gray-500 ${column.className ?? ''}`}>
      <div ref={wrapperRef} className="relative inline-flex w-full">
        <div className={`inline-flex items-center gap-1 ${justify} w-full`}>
          {sortable ? (
            <button
              type="button"
              onClick={() => onSort(column.key)}
              className="inline-flex items-center gap-1 hover:text-slate-900 transition-colors cursor-pointer select-none"
            >
              <span>{column.label}</span>
              <span className={`text-[10px] ${arrowClass}`}>{arrow}</span>
            </button>
          ) : (
            <span>{column.label}</span>
          )}
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-label={`Filtrar ${column.label}`}
            className={`ml-1 inline-flex h-4 w-4 items-center justify-center rounded text-[10px] transition-colors ${
              isFiltered ? 'bg-slate-900 text-white' : 'text-gray-300 hover:text-slate-700 hover:bg-slate-100'
            }`}
            title="Filtrar"
          >
            ⚲
          </button>
        </div>
        {open && (
          <FilterPopover
            column={column}
            filter={filter}
            rows={rows}
            onChange={onFilterChange}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    </th>
  )
}

// ─── FilterPopover ───────────────────────────────────────────────────────────

interface PopProps<T> {
  column: Column<T>
  filter: FilterValue
  rows: T[]
  onChange: (v: FilterValue) => void
  onClose: () => void
}

function FilterPopover<T>({ column, filter, rows, onChange, onClose }: PopProps<T>) {
  const type = column.type ?? 'text'

  // Estado local del popover según tipo
  const [contains, setContains] = useState(filter?.type === 'contains' ? filter.value : '')
  const [min, setMin] = useState(filter?.type === 'range' ? filter.min : '')
  const [max, setMax] = useState(filter?.type === 'range' ? filter.max : '')
  const [enumVals, setEnumVals] = useState<Set<string>>(filter?.type === 'enum' ? new Set(filter.values) : new Set())

  // Opciones de enum: provistas o inferidas
  const enumOptions = useMemo<Array<{ value: string; label?: string }>>(() => {
    if (column.enumOptions) return column.enumOptions
    if (type !== 'enum') return []
    const uniq = new Set<string>()
    for (const r of rows) uniq.add(String(column.accessor(r) ?? ''))
    return Array.from(uniq).sort().map(v => ({ value: v }))
  }, [column, rows, type])

  function apply() {
    if (type === 'text') {
      onChange(contains.trim() === '' ? null : { type: 'contains', value: contains })
    } else if (type === 'number' || type === 'date') {
      if (min.trim() === '' && max.trim() === '') onChange(null)
      else onChange({ type: 'range', min, max })
    } else if (type === 'enum') {
      onChange(enumVals.size === 0 ? null : { type: 'enum', values: enumVals })
    }
    onClose()
  }

  function clear() {
    onChange(null)
    setContains(''); setMin(''); setMax(''); setEnumVals(new Set())
    onClose()
  }

  return (
    <div className="absolute top-full left-0 z-30 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
        Filtrar {column.label}
      </div>

      {type === 'text' && (
        <input
          type="text"
          autoFocus
          value={contains}
          onChange={e => setContains(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') apply() }}
          placeholder="Contiene…"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500/30"
        />
      )}

      {type === 'number' && (
        <div className="flex gap-2">
          <input
            type="number"
            value={min}
            onChange={e => setMin(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') apply() }}
            placeholder="Mínimo"
            className="w-1/2 rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500/30"
          />
          <input
            type="number"
            value={max}
            onChange={e => setMax(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') apply() }}
            placeholder="Máximo"
            className="w-1/2 rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500/30"
          />
        </div>
      )}

      {type === 'date' && (
        <div className="flex flex-col gap-2">
          <label className="text-[10px] uppercase tracking-wide text-gray-400">Desde</label>
          <input
            type="date"
            value={min}
            onChange={e => setMin(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') apply() }}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500/30"
          />
          <label className="text-[10px] uppercase tracking-wide text-gray-400">Hasta</label>
          <input
            type="date"
            value={max}
            onChange={e => setMax(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') apply() }}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500/30"
          />
        </div>
      )}

      {type === 'enum' && (
        <div className="max-h-48 overflow-y-auto space-y-1">
          {enumOptions.length === 0 && <p className="text-xs text-gray-400">Sin valores.</p>}
          {enumOptions.map(opt => (
            <label key={opt.value} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50">
              <input
                type="checkbox"
                checked={enumVals.has(opt.value)}
                onChange={() => {
                  setEnumVals(prev => {
                    const next = new Set(prev)
                    if (next.has(opt.value)) next.delete(opt.value); else next.add(opt.value)
                    return next
                  })
                }}
                className="h-3.5 w-3.5 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
              />
              <span>{opt.label ?? (opt.value || '(vacío)')}</span>
            </label>
          ))}
        </div>
      )}

      <div className="mt-3 flex justify-between gap-2">
        <button
          type="button"
          onClick={clear}
          className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 transition-colors"
        >
          Limpiar
        </button>
        <button
          type="button"
          onClick={apply}
          className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 transition-colors"
        >
          Aplicar
        </button>
      </div>
    </div>
  )
}
