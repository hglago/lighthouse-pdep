'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { aplicarUplift } from '@/lib/uplift'
import { exportWorkbookToExcel } from '@/lib/excel'
import DataTable, { type Column } from '@/components/DataTable'
import type { InformeResumen, GenerarResult } from './dypsa/actions'

export interface DypsaGastoRow {
  id: string
  fecha_gasto: string
  periodo: string
  proveedor: string
  tipo_gasto: string
  descripcion: string
  moneda: string
  monto: number
  porcentaje_uplift_snapshot: number
  tiene_comprobante: boolean
}

function formatMoney(amount: number, moneda: string): string {
  const abs = Math.round(Math.abs(amount))
  const formatted = abs.toLocaleString('es-AR')
  if (moneda === 'USD') return `USD ${formatted}`
  if (moneda === 'EUR') return `EUR ${formatted}`
  return `$${formatted}`
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function formatDateTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.toLocaleDateString('es-AR')} ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
}

function formatPeriodo(p: string): string {
  if (!p || p.length < 7) return p
  const [y, m] = p.split('-')
  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  return `${meses[parseInt(m, 10) - 1]} ${y}`
}

function importeInformado(row: DypsaGastoRow): number {
  return aplicarUplift(row.monto, {
    tiene_uplift: row.porcentaje_uplift_snapshot > 0,
    porcentaje_uplift: row.porcentaje_uplift_snapshot,
  })
}

function filenameDates(desde: string, hasta: string): string {
  const d = desde || 'inicio'
  const h = hasta || 'hoy'
  return `Informe_Dypsa_${d}_a_${h}`
}

// ── Export helpers ──

function buildResumenRows(
  filtered: DypsaGastoRow[],
  porTipo: Array<{ tipo: string; moneda: string; cantidad: number; total: number; pctTotal: number; pctAcum: number }>,
  evolucion: Array<{ mes: string; moneda: string; total: number; acumulado: number }>,
  totalesPorMoneda: Array<[string, number]>,
  fechaDesde: string,
  fechaHasta: string,
  totalProveedores: number,
  totalTipos: number,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  rows.push({ Sección: 'INFORME DYPSA' })
  rows.push({ Sección: 'Período', Detalle: `${fechaDesde || '(inicio)'} a ${fechaHasta || '(hoy)'}` })
  rows.push({ Sección: 'Fecha de generación', Detalle: new Date().toLocaleDateString('es-AR') })
  rows.push({})

  rows.push({ Sección: 'RESUMEN EJECUTIVO' })
  for (const [moneda, total] of totalesPorMoneda) {
    rows.push({ Sección: `Total informado (${moneda})`, Detalle: Math.round(total) })
  }
  rows.push({ Sección: 'Gastos', Detalle: filtered.length })
  rows.push({ Sección: 'Proveedores', Detalle: totalProveedores })
  rows.push({ Sección: 'Tipos de gasto', Detalle: totalTipos })
  rows.push({})

  rows.push({ Sección: 'POR TIPO DE GASTO' })
  rows.push({ Sección: 'Tipo', Detalle: 'Moneda', Cantidad: 'Cantidad', Total: 'Total informado', '% Total': '% total', '% Acum': '% acum.' })
  for (const t of porTipo) {
    rows.push({ Sección: t.tipo, Detalle: t.moneda, Cantidad: t.cantidad, Total: Math.round(t.total), '% Total': `${t.pctTotal.toFixed(1)}%`, '% Acum': `${t.pctAcum.toFixed(1)}%` })
  }
  rows.push({})

  rows.push({ Sección: 'EVOLUCIÓN MENSUAL' })
  rows.push({ Sección: 'Mes', Detalle: 'Moneda', Total: 'Mensual', '% Total': 'Acumulado' })
  for (const e of evolucion) {
    rows.push({ Sección: formatPeriodo(e.mes), Detalle: e.moneda, Total: Math.round(e.total), '% Total': Math.round(e.acumulado) })
  }

  return rows
}

function buildDetalleRows(filtered: DypsaGastoRow[]): Record<string, unknown>[] {
  return filtered.map(r => ({
    Fecha: formatDate(r.fecha_gasto),
    Período: formatPeriodo(r.periodo),
    'Proveedor / Concepto': r.proveedor,
    Tipo: r.tipo_gasto,
    Descripción: r.descripcion,
    Moneda: r.moneda,
    'Importe informado': Math.round(importeInformado(r)),
    Comprobante: r.tiene_comprobante ? 'Sí' : 'No',
  }))
}

async function exportPdf(
  filtered: DypsaGastoRow[],
  porTipo: Array<{ tipo: string; moneda: string; cantidad: number; total: number; pctTotal: number; pctAcum: number }>,
  evolucion: Array<{ mes: string; moneda: string; total: number; acumulado: number }>,
  totalesPorMoneda: Array<[string, number]>,
  fechaDesde: string,
  fechaHasta: string,
  totalProveedores: number,
  totalTipos: number,
) {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 14
  const now = new Date()
  const fechaHora = `${now.toLocaleDateString('es-AR')} ${now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
  let y = 15

  // ── Encabezado formal ──
  doc.setFontSize(18)
  doc.setTextColor(30, 41, 59)
  doc.text('Informe Dypsa', margin, y)

  doc.setFontSize(9)
  doc.setTextColor(120)
  doc.text('N° informe: Vista previa', pageWidth - margin, y, { align: 'right' })
  y += 7

  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text('Informe ejecutivo de gastos pagados para socio', margin, y)
  y += 7

  // Línea separadora
  doc.setDrawColor(200)
  doc.setLineWidth(0.3)
  doc.line(margin, y, pageWidth - margin, y)
  y += 5

  // Metadatos en dos columnas
  doc.setFontSize(9)
  doc.setTextColor(80)
  doc.text(`Período: ${fechaDesde ? formatDate(fechaDesde) : '(inicio)'} a ${fechaHasta ? formatDate(fechaHasta) : '(hoy)'}`, margin, y)
  doc.text(`Generado: ${fechaHora}`, pageWidth - margin, y, { align: 'right' })
  y += 8

  // ── Resumen ejecutivo ──
  doc.setTextColor(30, 41, 59)
  doc.setFontSize(12)
  doc.text('Resumen ejecutivo', margin, y)
  y += 6
  doc.setFontSize(10)
  doc.setTextColor(0)
  for (const [moneda, total] of totalesPorMoneda) {
    doc.text(`Total informado (${moneda}): ${formatMoney(total, moneda)}`, margin, y)
    y += 5
  }
  doc.setTextColor(80)
  doc.text(`Gastos: ${filtered.length}   ·   Proveedores: ${totalProveedores}   ·   Tipos de gasto: ${totalTipos}`, margin, y)
  y += 8

  // ── Por tipo de gasto ──
  doc.setTextColor(30, 41, 59)
  doc.setFontSize(12)
  doc.text('Por tipo de gasto', margin, y)
  y += 2
  autoTable(doc, {
    startY: y,
    head: [['Tipo', 'Moneda', 'Cant.', 'Total informado', '% total', '% acum.']],
    body: porTipo.map(t => [t.tipo, t.moneda, t.cantidad, formatMoney(t.total, t.moneda), `${t.pctTotal.toFixed(1)}%`, `${t.pctAcum.toFixed(1)}%`]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59] },
    margin: { left: margin, right: margin },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

  // ── Evolución mensual ──
  if (y > 170) { doc.addPage(); y = 15 }
  doc.setTextColor(30, 41, 59)
  doc.setFontSize(12)
  doc.text('Evolución mensual', margin, y)
  y += 2
  autoTable(doc, {
    startY: y,
    head: [['Mes', 'Moneda', 'Mensual', 'Acumulado']],
    body: evolucion.map(e => [formatPeriodo(e.mes), e.moneda, formatMoney(e.total, e.moneda), formatMoney(e.acumulado, e.moneda)]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59] },
    margin: { left: margin, right: margin },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

  // ── Detalle ──
  if (y > 140) { doc.addPage(); y = 15 }
  doc.setTextColor(30, 41, 59)
  doc.setFontSize(12)
  doc.text(`Detalle de gastos incluidos (${filtered.length})`, margin, y)
  y += 2
  autoTable(doc, {
    startY: y,
    head: [['Fecha', 'Período', 'Proveedor / Concepto', 'Tipo', 'Descripción', 'Moneda', 'Importe informado', 'Comp.']],
    body: filtered.map(r => [
      formatDate(r.fecha_gasto),
      formatPeriodo(r.periodo),
      r.proveedor,
      r.tipo_gasto,
      r.descripcion.length > 50 ? r.descripcion.slice(0, 47) + '...' : r.descripcion,
      r.moneda,
      formatMoney(importeInformado(r), r.moneda),
      r.tiene_comprobante ? 'Sí' : 'No',
    ]),
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [30, 41, 59] },
    columnStyles: { 6: { halign: 'right' } },
    margin: { left: margin, right: margin },
  })

  // Footer en cada página
  const totalPages = (doc as unknown as { getNumberOfPages: () => number }).getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(150)
    doc.text(`Informe Dypsa — Página ${i} de ${totalPages}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 8, { align: 'center' })
  }

  const fname = filenameDates(fechaDesde, fechaHasta)
  doc.save(`${fname}.pdf`)
}

// ── Component ──

interface Props {
  rows: DypsaGastoRow[]
  informes?: InformeResumen[]
  generarAction?: (fechaDesde: string, fechaHasta: string) => Promise<GenerarResult>
}

export default function InformeDypsaClient({ rows, informes = [], generarAction }: Props) {
  const today = new Date().toISOString().slice(0, 10)

  const [draftDesde, setDraftDesde] = useState('')
  const [draftHasta, setDraftHasta] = useState(today)
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState(today)
  const [detalleSearch, setDetalleSearch] = useState('')
  const [generarMsg, setGenerarMsg] = useState('')
  const [generarError, setGenerarError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleBuscar() {
    setFechaDesde(draftDesde)
    setFechaHasta(draftHasta)
  }

  function handleLimpiar() {
    setDraftDesde('')
    setDraftHasta(today)
    setFechaDesde('')
    setFechaHasta(today)
  }

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (fechaDesde && r.fecha_gasto < fechaDesde) return false
      if (fechaHasta && r.fecha_gasto > fechaHasta) return false
      return true
    })
  }, [rows, fechaDesde, fechaHasta])

  const monedas = useMemo(() => Array.from(new Set(filtered.map(r => r.moneda))).sort(), [filtered])
  const totalProveedores = useMemo(() => new Set(filtered.map(r => r.proveedor)).size, [filtered])
  const totalTipos = useMemo(() => new Set(filtered.map(r => r.tipo_gasto)).size, [filtered])

  const totalesPorMoneda = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of filtered) map.set(r.moneda, (map.get(r.moneda) ?? 0) + importeInformado(r))
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  const porTipo = useMemo(() => {
    const map = new Map<string, { tipo: string; moneda: string; cantidad: number; total: number }>()
    for (const r of filtered) {
      const key = `${r.tipo_gasto}|${r.moneda}`
      const entry = map.get(key) ?? { tipo: r.tipo_gasto, moneda: r.moneda, cantidad: 0, total: 0 }
      entry.cantidad++
      entry.total += importeInformado(r)
      map.set(key, entry)
    }
    const raw = Array.from(map.values())
    const totalPorMoneda = new Map<string, number>()
    for (const e of raw) totalPorMoneda.set(e.moneda, (totalPorMoneda.get(e.moneda) ?? 0) + e.total)
    const sorted = raw.sort((a, b) => a.moneda.localeCompare(b.moneda) || b.total - a.total)
    const acumPorMoneda = new Map<string, number>()
    return sorted.map(e => {
      const grandTotal = totalPorMoneda.get(e.moneda) || 1
      const pctTotal = (e.total / grandTotal) * 100
      const prevAcum = acumPorMoneda.get(e.moneda) ?? 0
      const pctAcum = prevAcum + pctTotal
      acumPorMoneda.set(e.moneda, pctAcum)
      return { ...e, pctTotal, pctAcum }
    })
  }, [filtered])

  const evolucion = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of filtered) {
      const key = `${r.periodo}|${r.moneda}`
      map.set(key, (map.get(key) ?? 0) + importeInformado(r))
    }
    const entries: { mes: string; moneda: string; total: number; acumulado: number }[] = []
    const acumulados = new Map<string, number>()
    const periodos = Array.from(new Set(filtered.map(r => r.periodo))).sort()
    for (const periodo of periodos) {
      for (const moneda of monedas) {
        const key = `${periodo}|${moneda}`
        const total = map.get(key)
        if (total === undefined) continue
        const prevAcum = acumulados.get(moneda) ?? 0
        const acumulado = prevAcum + total
        acumulados.set(moneda, acumulado)
        entries.push({ mes: periodo, moneda, total, acumulado })
      }
    }
    return entries
  }, [filtered, monedas])

  const periodoLabel = fechaDesde && fechaHasta
    ? `${formatDate(fechaDesde)} — ${formatDate(fechaHasta)}`
    : fechaDesde
      ? `Desde ${formatDate(fechaDesde)}`
      : fechaHasta
        ? `Hasta ${formatDate(fechaHasta)}`
        : 'Todo el período'

  const hayFiltrosActivos = fechaDesde !== '' || fechaHasta !== today

  function handleExportExcel() {
    const resumenRows = buildResumenRows(filtered, porTipo, evolucion, totalesPorMoneda, fechaDesde, fechaHasta, totalProveedores, totalTipos)
    const detalleRows = buildDetalleRows(filtered)
    const fname = filenameDates(fechaDesde, fechaHasta)
    exportWorkbookToExcel([
      { name: 'Resumen', rows: resumenRows },
      { name: 'Detalle', rows: detalleRows },
    ], `${fname}.xlsx`)
  }

  function handleExportPdf() {
    exportPdf(filtered, porTipo, evolucion, totalesPorMoneda, fechaDesde, fechaHasta, totalProveedores, totalTipos)
  }

  const detalleColumns: Column<DypsaGastoRow>[] = useMemo(() => [
    {
      key: 'fecha_gasto',
      label: 'Fecha',
      accessor: r => r.fecha_gasto,
      type: 'date' as const,
      render: r => <span className="whitespace-nowrap">{formatDate(r.fecha_gasto)}</span>,
    },
    {
      key: 'periodo',
      label: 'Período',
      accessor: r => r.periodo,
      type: 'text' as const,
      render: r => <span className="whitespace-nowrap font-mono text-xs text-gray-500">{formatPeriodo(r.periodo)}</span>,
      enumOptions: Array.from(new Set(filtered.map(r => r.periodo))).filter(Boolean).sort().map(p => ({ value: p, label: formatPeriodo(p) })),
    },
    {
      key: 'proveedor',
      label: 'Proveedor / Concepto',
      accessor: r => r.proveedor,
      type: 'text' as const,
      render: r => <span className="font-medium text-gray-900 max-w-xs truncate block">{r.proveedor}</span>,
    },
    {
      key: 'tipo_gasto',
      label: 'Tipo',
      accessor: r => r.tipo_gasto,
      type: 'enum' as const,
      enumOptions: Array.from(new Set(filtered.map(r => r.tipo_gasto))).sort().map(t => ({ value: t })),
    },
    {
      key: 'descripcion',
      label: 'Descripción',
      accessor: r => r.descripcion,
      type: 'text' as const,
      className: 'hidden lg:table-cell',
      render: r => <span className="text-gray-500 max-w-xs truncate block">{r.descripcion}</span>,
    },
    {
      key: 'moneda',
      label: 'Moneda',
      accessor: r => r.moneda,
      type: 'enum' as const,
      enumOptions: monedas.map(m => ({ value: m })),
    },
    {
      key: 'importe',
      label: 'Importe informado',
      accessor: r => importeInformado(r),
      type: 'number' as const,
      align: 'right' as const,
      render: r => <span className="tabular-nums font-medium text-gray-900 whitespace-nowrap">{formatMoney(importeInformado(r), r.moneda)}</span>,
    },
    {
      key: 'comprobante',
      label: 'Comp.',
      accessor: r => r.tiene_comprobante ? 1 : 0,
      type: 'enum' as const,
      align: 'center' as const,
      enumOptions: [{ value: '1', label: 'Sí' }, { value: '0', label: 'No' }],
      render: r => r.tiene_comprobante
        ? <span className="inline-block rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">S</span>
        : <span className="text-xs text-gray-300">&mdash;</span>,
    },
  ], [filtered, monedas])

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/reportes" className="text-xs text-slate-500 hover:text-slate-700 transition-colors">&larr; Reportes</Link>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">Informe Dypsa</h1>
          <p className="mt-0.5 text-sm text-gray-500">Informe ejecutivo de gastos pagados para socio.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {filtered.length > 0 && (
            <>
              <button type="button" onClick={handleExportExcel}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Exportar Excel
              </button>
              <button type="button" onClick={handleExportPdf}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Exportar PDF
              </button>
            </>
          )}
          {generarAction && (
            <button type="button" disabled={isPending || !fechaDesde || !fechaHasta}
              onClick={() => {
                setGenerarMsg('')
                setGenerarError('')
                startTransition(async () => {
                  const result = await generarAction(fechaDesde, fechaHasta)
                  if (result.ok) {
                    setGenerarMsg(`Informe ${result.codigo} generado correctamente.`)
                  } else {
                    setGenerarError(result.error)
                  }
                })
              }}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={!fechaDesde || !fechaHasta ? 'Seleccioná fecha desde y hasta, y presioná Buscar' : 'Generar informe numerado con snapshot'}>
              {isPending ? 'Generando...' : 'Generar informe'}
            </button>
          )}
        </div>
      </div>

      {/* ── Filtros ── */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Fecha desde</label>
          <input type="date" value={draftDesde} onChange={e => setDraftDesde(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Fecha hasta</label>
          <input type="date" value={draftHasta} onChange={e => setDraftHasta(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20" />
        </div>
        <button type="button" onClick={handleBuscar}
          className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors">
          Buscar
        </button>
        {hayFiltrosActivos && (
          <button type="button" onClick={handleLimpiar}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors">
            Limpiar filtros
          </button>
        )}
      </div>

      {/* ── Feedback generar ── */}
      {generarMsg && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{generarMsg}</div>
      )}
      {generarError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{generarError}</div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
          <p className="text-sm text-gray-500">No hay gastos pagados en el período seleccionado.</p>
        </div>
      ) : (
        <>
          {/* ── Dashboard KPI cards ── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-5 sm:col-span-2 lg:col-span-1">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Total informado</p>
              <div className="mt-2 space-y-1">
                {totalesPorMoneda.map(([moneda, total]) => (
                  <p key={moneda} className="text-xl font-bold tabular-nums text-gray-900">{formatMoney(total, moneda)}</p>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-400">{periodoLabel}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Gastos</p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">{filtered.length}</p>
              <p className="mt-2 text-xs text-gray-400">con pago confirmado</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Proveedores</p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">{totalProveedores}</p>
              <p className="mt-2 text-xs text-gray-400">conceptos distintos</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Tipos de gasto</p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">{totalTipos}</p>
              <p className="mt-2 text-xs text-gray-400">clasificaciones</p>
            </div>
          </div>

          {/* ── Resúmenes lado a lado ── */}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-100 px-5 py-3">
                <h2 className="text-sm font-semibold text-gray-900">Por tipo de gasto</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                      <th className="px-5 py-2">Tipo</th>
                      <th className="px-5 py-2 text-right">Cant.</th>
                      <th className="px-5 py-2 text-right">Total informado</th>
                      <th className="px-5 py-2 text-right">% total</th>
                      <th className="px-5 py-2 text-right">% acum.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {porTipo.map((t, i) => (
                      <tr key={i}>
                        <td className="px-5 py-2 text-gray-900">{t.tipo}</td>
                        <td className="px-5 py-2 text-right tabular-nums text-gray-500">{t.cantidad}</td>
                        <td className="px-5 py-2 text-right tabular-nums font-medium text-gray-900 whitespace-nowrap">{formatMoney(t.total, t.moneda)}</td>
                        <td className="px-5 py-2 text-right tabular-nums text-gray-500">{t.pctTotal.toFixed(1)}%</td>
                        <td className="px-5 py-2 text-right tabular-nums text-gray-500">{t.pctAcum.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-100 px-5 py-3">
                <h2 className="text-sm font-semibold text-gray-900">Evolución mensual</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                      <th className="px-5 py-2">Mes</th>
                      <th className="px-5 py-2 text-right">Mensual</th>
                      <th className="px-5 py-2 text-right">Acumulado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {evolucion.map((e, i) => (
                      <tr key={i}>
                        <td className="px-5 py-2 text-gray-900 whitespace-nowrap">
                          {formatPeriodo(e.mes)}
                          {monedas.length > 1 && <span className="ml-1.5 text-xs text-gray-400">{e.moneda}</span>}
                        </td>
                        <td className="px-5 py-2 text-right tabular-nums text-gray-600 whitespace-nowrap">{formatMoney(e.total, e.moneda)}</td>
                        <td className="px-5 py-2 text-right tabular-nums font-medium text-gray-900 whitespace-nowrap">{formatMoney(e.acumulado, e.moneda)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── Detalle de gastos incluidos (DataTable) ── */}
          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Detalle de gastos incluidos</h2>
                <p className="text-xs text-gray-400">{filtered.length} registro{filtered.length !== 1 ? 's' : ''}</p>
              </div>
              <input
                type="text"
                value={detalleSearch}
                onChange={e => setDetalleSearch(e.target.value)}
                placeholder="Buscar en detalle..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 sm:max-w-xs"
              />
            </div>
            <DataTable
              rows={filtered}
              columns={detalleColumns}
              getRowId={r => r.id}
              searchTerm={detalleSearch}
              searchKeys={['proveedor', 'tipo_gasto', 'descripcion', 'moneda', 'periodo']}
              initialSort={{ key: 'fecha_gasto', dir: 'desc' }}
              emptyMessage="No hay gastos que coincidan con la búsqueda."
            />
          </div>
        </>
      )}
      {/* ── Informes emitidos ── */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Informes emitidos</h2>
        </div>
        {informes.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">No hay informes emitidos todavía.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                  <th className="px-5 py-2">Código</th>
                  <th className="px-5 py-2">Período</th>
                  <th className="px-5 py-2">Generado</th>
                  <th className="px-5 py-2 text-right">Total</th>
                  <th className="px-5 py-2 text-right">Items</th>
                  <th className="px-5 py-2">Estado</th>
                  <th className="px-5 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {informes.map(inf => (
                  <tr key={inf.id} className="hover:bg-gray-50/50">
                    <td className="px-5 py-2 font-mono text-sm font-medium text-gray-900">{inf.codigo}</td>
                    <td className="px-5 py-2 text-gray-600 whitespace-nowrap">{formatDate(inf.fecha_desde)} — {formatDate(inf.fecha_hasta)}</td>
                    <td className="px-5 py-2 text-gray-500 whitespace-nowrap">{formatDateTime(inf.fecha_generacion)}</td>
                    <td className="px-5 py-2 text-right tabular-nums font-medium text-gray-900 whitespace-nowrap">{formatMoney(Number(inf.total_informado), inf.moneda)}</td>
                    <td className="px-5 py-2 text-right tabular-nums text-gray-600">{inf.cantidad_items}</td>
                    <td className="px-5 py-2">
                      <span className="inline-block rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">{inf.estado}</span>
                    </td>
                    <td className="px-5 py-2">
                      <Link href={`/reportes/dypsa/${inf.id}`}
                        className="rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors">
                        Ver informe
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
