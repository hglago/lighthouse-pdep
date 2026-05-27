'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { exportWorkbookToExcel } from '@/lib/excel'
import DataTable, { type Column } from '@/components/DataTable'
import type { InformeResumen, InformeItem } from './dypsa/actions'

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

interface Props {
  cabecera: InformeResumen
  items: InformeItem[]
}

export default function InformeDypsaCongelado({ cabecera, items }: Props) {
  const [search, setSearch] = useState('')

  const monedas = useMemo(() => Array.from(new Set(items.map(i => i.moneda))).sort(), [items])
  const totalProveedores = useMemo(() => new Set(items.map(i => i.proveedor_nombre)).size, [items])
  const totalTipos = useMemo(() => new Set(items.map(i => i.tipo_gasto_nombre)).size, [items])

  const totalesPorMoneda = useMemo(() => {
    const map = new Map<string, number>()
    for (const i of items) map.set(i.moneda, (map.get(i.moneda) ?? 0) + Number(i.monto_final_informe))
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [items])

  const porTipo = useMemo(() => {
    const map = new Map<string, { tipo: string; moneda: string; cantidad: number; total: number }>()
    for (const i of items) {
      const key = `${i.tipo_gasto_nombre}|${i.moneda}`
      const entry = map.get(key) ?? { tipo: i.tipo_gasto_nombre, moneda: i.moneda, cantidad: 0, total: 0 }
      entry.cantidad++
      entry.total += Number(i.monto_final_informe)
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
  }, [items])

  const evolucion = useMemo(() => {
    const map = new Map<string, number>()
    for (const i of items) {
      const per = i.periodo || (i.fecha_gasto ? i.fecha_gasto.slice(0, 7) : '')
      if (!per) continue
      const key = `${per}|${i.moneda}`
      map.set(key, (map.get(key) ?? 0) + Number(i.monto_final_informe))
    }
    const entries: { mes: string; moneda: string; total: number; acumulado: number }[] = []
    const acumulados = new Map<string, number>()
    const periodos = Array.from(new Set(items.map(i => i.periodo || i.fecha_gasto?.slice(0, 7) || '').filter(Boolean))).sort()
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
  }, [items, monedas])

  const periodoLabel = `${formatDate(cabecera.fecha_desde)} — ${formatDate(cabecera.fecha_hasta)}`

  // ── Export Excel ──
  function handleExportExcel() {
    const resumenRows: Record<string, unknown>[] = []
    resumenRows.push({ Sección: 'INFORME DYPSA', Detalle: cabecera.codigo })
    resumenRows.push({ Sección: 'Estado', Detalle: cabecera.estado })
    resumenRows.push({ Sección: 'Período', Detalle: periodoLabel })
    resumenRows.push({ Sección: 'Fecha de generación', Detalle: formatDateTime(cabecera.fecha_generacion) })
    resumenRows.push({})
    for (const [moneda, total] of totalesPorMoneda) {
      resumenRows.push({ Sección: `Total informado (${moneda})`, Detalle: Math.round(total) })
    }
    resumenRows.push({ Sección: 'Gastos', Detalle: items.length })
    resumenRows.push({ Sección: 'Proveedores', Detalle: totalProveedores })
    resumenRows.push({ Sección: 'Tipos de gasto', Detalle: totalTipos })
    resumenRows.push({})
    resumenRows.push({ Sección: 'POR TIPO DE GASTO' })
    resumenRows.push({ Sección: 'Tipo', Detalle: 'Moneda', Cantidad: 'Cantidad', Total: 'Total informado', '% Total': '% total', '% Acum': '% acum.' })
    for (const t of porTipo) {
      resumenRows.push({ Sección: t.tipo, Detalle: t.moneda, Cantidad: t.cantidad, Total: Math.round(t.total), '% Total': `${t.pctTotal.toFixed(1)}%`, '% Acum': `${t.pctAcum.toFixed(1)}%` })
    }
    resumenRows.push({})
    resumenRows.push({ Sección: 'EVOLUCIÓN MENSUAL' })
    for (const e of evolucion) {
      resumenRows.push({ Sección: formatPeriodo(e.mes), Detalle: e.moneda, Total: Math.round(e.total), '% Total': Math.round(e.acumulado) })
    }

    const detalleRows = items.map(i => ({
      Fecha: formatDate(i.fecha_gasto),
      Período: formatPeriodo(i.periodo || ''),
      'Proveedor / Concepto': i.proveedor_nombre,
      Tipo: i.tipo_gasto_nombre,
      Descripción: i.descripcion,
      Moneda: i.moneda,
      'Importe informado': Math.round(Number(i.monto_final_informe)),
      Comprobante: i.tiene_comprobante ? 'Sí' : 'No',
    }))

    exportWorkbookToExcel([
      { name: 'Resumen', rows: resumenRows },
      { name: 'Detalle', rows: detalleRows },
    ], `${cabecera.codigo}.xlsx`)
  }

  // ── Export PDF ──
  async function handleExportPdf() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const margin = 14
    let y = 15

    doc.setFontSize(18)
    doc.setTextColor(30, 41, 59)
    doc.text('Informe Dypsa', margin, y)
    doc.setFontSize(9)
    doc.setTextColor(120)
    doc.text(`N° informe: ${cabecera.codigo}`, pageWidth - margin, y, { align: 'right' })
    y += 7

    doc.setFontSize(10)
    doc.setTextColor(100)
    doc.text('Informe ejecutivo de gastos pagados para socio', margin, y)
    y += 7

    doc.setDrawColor(200)
    doc.setLineWidth(0.3)
    doc.line(margin, y, pageWidth - margin, y)
    y += 5

    doc.setFontSize(9)
    doc.setTextColor(80)
    doc.text(`Período: ${periodoLabel}`, margin, y)
    doc.text(`Generado: ${formatDateTime(cabecera.fecha_generacion)}`, pageWidth - margin, y, { align: 'right' })
    y += 5
    doc.text(`Estado: ${cabecera.estado}`, margin, y)
    y += 8

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
    doc.text(`Gastos: ${items.length}   ·   Proveedores: ${totalProveedores}   ·   Tipos de gasto: ${totalTipos}`, margin, y)
    y += 8

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

    if (y > 140) { doc.addPage(); y = 15 }
    doc.setTextColor(30, 41, 59)
    doc.setFontSize(12)
    doc.text(`Detalle de gastos incluidos (${items.length})`, margin, y)
    y += 2
    autoTable(doc, {
      startY: y,
      head: [['Fecha', 'Período', 'Proveedor / Concepto', 'Tipo', 'Descripción', 'Moneda', 'Importe informado', 'Comp.']],
      body: items.map(i => [
        formatDate(i.fecha_gasto),
        formatPeriodo(i.periodo || ''),
        i.proveedor_nombre,
        i.tipo_gasto_nombre,
        (i.descripcion || '').length > 50 ? (i.descripcion || '').slice(0, 47) + '...' : (i.descripcion || ''),
        i.moneda,
        formatMoney(Number(i.monto_final_informe), i.moneda),
        i.tiene_comprobante ? 'Sí' : 'No',
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 41, 59] },
      columnStyles: { 6: { halign: 'right' } },
      margin: { left: margin, right: margin },
    })

    const totalPages = doc.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p)
      doc.setFontSize(7)
      doc.setTextColor(150)
      doc.text(`${cabecera.codigo} — Página ${p} de ${totalPages}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 8, { align: 'center' })
    }

    doc.save(`${cabecera.codigo}.pdf`)
  }

  // ── DataTable columns ──
  const columns: Column<InformeItem>[] = useMemo(() => [
    { key: 'fecha_gasto', label: 'Fecha', accessor: r => r.fecha_gasto, type: 'date' as const, render: r => <span className="whitespace-nowrap">{formatDate(r.fecha_gasto)}</span> },
    { key: 'periodo', label: 'Período', accessor: r => r.periodo ?? '', type: 'text' as const, render: r => <span className="whitespace-nowrap font-mono text-xs text-gray-500">{formatPeriodo(r.periodo || '')}</span> },
    { key: 'proveedor_nombre', label: 'Proveedor / Concepto', accessor: r => r.proveedor_nombre, type: 'text' as const, render: r => <span className="font-medium text-gray-900 max-w-xs truncate block">{r.proveedor_nombre}</span> },
    { key: 'tipo_gasto_nombre', label: 'Tipo', accessor: r => r.tipo_gasto_nombre, type: 'enum' as const, enumOptions: Array.from(new Set(items.map(i => i.tipo_gasto_nombre))).sort().map(t => ({ value: t })) },
    { key: 'descripcion', label: 'Descripción', accessor: r => r.descripcion ?? '', type: 'text' as const, className: 'hidden lg:table-cell', render: r => <span className="text-gray-500 max-w-xs truncate block">{r.descripcion}</span> },
    { key: 'moneda', label: 'Moneda', accessor: r => r.moneda, type: 'enum' as const, enumOptions: monedas.map(m => ({ value: m })) },
    { key: 'monto_final_informe', label: 'Importe informado', accessor: r => Number(r.monto_final_informe), type: 'number' as const, align: 'right' as const, render: r => <span className="tabular-nums font-medium text-gray-900 whitespace-nowrap">{formatMoney(Number(r.monto_final_informe), r.moneda)}</span> },
    { key: 'comprobante', label: 'Comp.', accessor: r => r.tiene_comprobante ? 1 : 0, type: 'enum' as const, align: 'center' as const, enumOptions: [{ value: '1', label: 'Sí' }, { value: '0', label: 'No' }], render: r => r.tiene_comprobante ? <span className="inline-block rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">S</span> : <span className="text-xs text-gray-300">&mdash;</span> },
  ], [items, monedas])

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/reportes/dypsa" className="text-xs text-slate-500 hover:text-slate-700 transition-colors">&larr; Informe Dypsa</Link>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">
            {cabecera.codigo}
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Informe emitido · {periodoLabel} · {formatDateTime(cabecera.fecha_generacion)}
          </p>
          <span className="mt-1 inline-block rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">{cabecera.estado}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleExportExcel}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Exportar Excel
          </button>
          <button type="button" onClick={handleExportPdf}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Exportar PDF
          </button>
        </div>
      </div>

      {/* ── KPI cards ── */}
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
          <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">{items.length}</p>
          <p className="mt-2 text-xs text-gray-400">snapshot congelado</p>
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

      {/* ── Detalle (DataTable) ── */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Detalle de gastos incluidos</h2>
            <p className="text-xs text-gray-400">{items.length} registro{items.length !== 1 ? 's' : ''} (snapshot congelado)</p>
          </div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar en detalle..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 sm:max-w-xs"
          />
        </div>
        <DataTable
          rows={items}
          columns={columns}
          getRowId={r => r.id}
          searchTerm={search}
          searchKeys={['proveedor_nombre', 'tipo_gasto_nombre', 'descripcion', 'moneda', 'periodo']}
          initialSort={{ key: 'fecha_gasto', dir: 'desc' }}
          emptyMessage="No hay items que coincidan con la búsqueda."
        />
      </div>
    </div>
  )
}
