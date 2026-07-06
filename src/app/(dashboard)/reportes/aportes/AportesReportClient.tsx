'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { exportWorkbookToExcel } from '@/lib/excel'

// Fila del informe: un aporte activo con su socio y destino ya derivado.
export interface AporteReportRow {
  id: string
  codigo: string | null          // APO-###
  fecha_aporte: string
  socio_id: string | null
  socio_codigo: string | null    // SOC-###
  socio_nombre: string | null    // nombre del socio (si tiene socio_id)
  aportante: string | null       // texto libre (aportes legacy sin socio_id)
  monto: number
  moneda: string
  destino: string                // 'RISA' | 'Tercero…' | 'Mixto' | 'Tercero de la red'
  concepto: string
  observaciones: string | null
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatMoney(amount: number, moneda: string): string {
  const formatted = amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (moneda === 'USD') return `USD ${formatted}`
  if (moneda === 'EUR') return `EUR ${formatted}`
  return `$ ${formatted}`
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

// Clave y etiqueta de agrupamiento por socio. Los aportes sin socio_id se
// agrupan por su texto libre "aportante"; si tampoco lo tienen, "Sin socio".
function grupoKey(r: AporteReportRow): string {
  if (r.socio_id) return `socio:${r.socio_id}`
  if (r.aportante && r.aportante.trim()) return `libre:${r.aportante.trim().toLowerCase()}`
  return 'sin-socio'
}
function grupoLabel(r: AporteReportRow): string {
  return r.socio_nombre ?? (r.aportante?.trim() || 'Sin socio asignado')
}

interface SocioGrupo {
  key: string
  codigo: string | null
  nombre: string
  aportes: AporteReportRow[]
  totalesPorMoneda: Map<string, number>
  cantidad: number
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  rows: AporteReportRow[]
}

export default function AportesReportClient({ rows }: Props) {
  const today = new Date().toISOString().slice(0, 10)

  const [draftDesde, setDraftDesde] = useState('')
  const [draftHasta, setDraftHasta] = useState(today)
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState(today)
  const [socioFiltro, setSocioFiltro] = useState('')
  const [monedaFiltro, setMonedaFiltro] = useState('')

  function handleBuscar() {
    setFechaDesde(draftDesde)
    setFechaHasta(draftHasta)
  }
  function handleLimpiar() {
    setDraftDesde('')
    setDraftHasta(today)
    setFechaDesde('')
    setFechaHasta(today)
    setSocioFiltro('')
    setMonedaFiltro('')
  }

  const monedas = useMemo(
    () => Array.from(new Set(rows.map(r => r.moneda))).sort(),
    [rows],
  )

  // Opciones de socio para el filtro (por etiqueta visible, ordenadas).
  const sociosOpciones = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows) m.set(grupoKey(r), grupoLabel(r))
    return Array.from(m.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'))
  }, [rows])

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (fechaDesde && r.fecha_aporte < fechaDesde) return false
      if (fechaHasta && r.fecha_aporte > fechaHasta) return false
      if (socioFiltro && grupoKey(r) !== socioFiltro) return false
      if (monedaFiltro && r.moneda !== monedaFiltro) return false
      return true
    })
  }, [rows, fechaDesde, fechaHasta, socioFiltro, monedaFiltro])

  // Agrupamiento por socio, con subtotales por moneda y aportes ordenados por fecha.
  const grupos = useMemo<SocioGrupo[]>(() => {
    const map = new Map<string, SocioGrupo>()
    for (const r of filtered) {
      const key = grupoKey(r)
      let g = map.get(key)
      if (!g) {
        g = { key, codigo: r.socio_codigo, nombre: grupoLabel(r), aportes: [], totalesPorMoneda: new Map(), cantidad: 0 }
        map.set(key, g)
      }
      g.aportes.push(r)
      g.cantidad++
      g.totalesPorMoneda.set(r.moneda, (g.totalesPorMoneda.get(r.moneda) ?? 0) + r.monto)
    }
    const arr = Array.from(map.values())
    for (const g of arr) {
      g.aportes.sort((a, b) => b.fecha_aporte.localeCompare(a.fecha_aporte))
    }
    return arr.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [filtered])

  // Totales generales por moneda (todos los socios).
  const totalesGenerales = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of filtered) m.set(r.moneda, (m.get(r.moneda) ?? 0) + r.monto)
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  const cantSocios = grupos.length
  const cantAportes = filtered.length

  const periodoLabel = fechaDesde && fechaHasta
    ? `${formatDate(fechaDesde)} — ${formatDate(fechaHasta)}`
    : fechaDesde
      ? `Desde ${formatDate(fechaDesde)}`
      : fechaHasta
        ? `Hasta ${formatDate(fechaHasta)}`
        : 'Todo el período'

  const hayFiltrosActivos = fechaDesde !== '' || fechaHasta !== today || socioFiltro !== '' || monedaFiltro !== ''

  function filename(ext: string): string {
    const d = fechaDesde || 'inicio'
    const h = fechaHasta || 'hoy'
    return `Informe_Aportes_${d}_a_${h}.${ext}`
  }

  // ── Export Excel: hoja Resumen (subtotales por socio) + hoja Detalle. ──
  function handleExportExcel() {
    const resumen: Record<string, unknown>[] = []
    resumen.push({ Sección: 'INFORME DE APORTES POR SOCIO' })
    resumen.push({ Sección: 'Período', Detalle: periodoLabel })
    resumen.push({ Sección: 'Generado', Detalle: new Date().toLocaleDateString('es-AR') })
    resumen.push({})
    for (const [moneda, total] of totalesGenerales) {
      resumen.push({ Sección: `Total aportado (${moneda})`, Detalle: total })
    }
    resumen.push({ Sección: 'Socios', Detalle: cantSocios })
    resumen.push({ Sección: 'Aportes', Detalle: cantAportes })
    resumen.push({})
    resumen.push({ Sección: 'SUBTOTAL POR SOCIO', Detalle: 'Código', Moneda: 'Moneda', Total: 'Total', Cantidad: 'Aportes' })
    for (const g of grupos) {
      for (const [moneda, total] of Array.from(g.totalesPorMoneda.entries()).sort(([a], [b]) => a.localeCompare(b))) {
        resumen.push({ Sección: g.nombre, Detalle: g.codigo ?? '', Moneda: moneda, Total: total, Cantidad: g.cantidad })
      }
    }

    const detalle: Record<string, unknown>[] = []
    for (const g of grupos) {
      for (const a of g.aportes) {
        detalle.push({
          Socio: g.nombre,
          'Código socio': g.codigo ?? '',
          Fecha: formatDate(a.fecha_aporte),
          'N° aporte': a.codigo ?? '',
          Destino: a.destino,
          Concepto: a.concepto,
          Observaciones: a.observaciones ?? '',
          Moneda: a.moneda,
          Monto: a.monto,
        })
      }
    }

    exportWorkbookToExcel(
      [
        { name: 'Resumen', rows: resumen },
        { name: 'Detalle', rows: detalle },
      ],
      filename('xlsx'),
    )
  }

  // ── Export PDF: encabezado + total general + una sección por socio. ──
  async function handleExportPdf() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const margin = 14
    const now = new Date()
    const fechaHora = `${now.toLocaleDateString('es-AR')} ${now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
    let y = 15

    doc.setFontSize(18)
    doc.setTextColor(30, 41, 59)
    doc.text('Informe de Aportes por socio', margin, y)
    y += 7

    doc.setFontSize(10)
    doc.setTextColor(100)
    doc.text('Detalle de aportes realizados por cada socio', margin, y)
    y += 7

    doc.setDrawColor(200)
    doc.setLineWidth(0.3)
    doc.line(margin, y, pageWidth - margin, y)
    y += 5

    doc.setFontSize(9)
    doc.setTextColor(80)
    doc.text(`Período: ${periodoLabel}`, margin, y)
    doc.text(`Generado: ${fechaHora}`, pageWidth - margin, y, { align: 'right' })
    y += 8

    doc.setTextColor(30, 41, 59)
    doc.setFontSize(12)
    doc.text('Resumen', margin, y)
    y += 6
    doc.setFontSize(10)
    doc.setTextColor(0)
    for (const [moneda, total] of totalesGenerales) {
      doc.text(`Total aportado (${moneda}): ${formatMoney(total, moneda)}`, margin, y)
      y += 5
    }
    doc.setTextColor(80)
    doc.text(`Socios: ${cantSocios}   ·   Aportes: ${cantAportes}`, margin, y)
    y += 8

    for (const g of grupos) {
      if (y > 250) { doc.addPage(); y = 15 }
      doc.setTextColor(30, 41, 59)
      doc.setFontSize(11)
      const titulo = g.codigo ? `${g.codigo} — ${g.nombre}` : g.nombre
      doc.text(titulo, margin, y)
      y += 2
      autoTable(doc, {
        startY: y,
        head: [['Fecha', 'N° aporte', 'Destino', 'Concepto', 'Moneda', 'Monto']],
        body: g.aportes.map(a => [
          formatDate(a.fecha_aporte),
          a.codigo ?? '',
          a.destino,
          a.concepto.length > 40 ? a.concepto.slice(0, 37) + '...' : a.concepto,
          a.moneda,
          formatMoney(a.monto, a.moneda),
        ]),
        foot: Array.from(g.totalesPorMoneda.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([moneda, total]) => ['', '', '', 'Subtotal', moneda, formatMoney(total, moneda)]),
        styles: { fontSize: 8, cellPadding: 1.5 },
        headStyles: { fillColor: [30, 41, 59] },
        footStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontStyle: 'bold' },
        columnStyles: { 5: { halign: 'right' } },
        margin: { left: margin, right: margin },
      })
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
    }

    const totalPages = (doc as unknown as { getNumberOfPages: () => number }).getNumberOfPages()
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i)
      doc.setFontSize(7)
      doc.setTextColor(150)
      doc.text(`Informe de Aportes — Página ${i} de ${totalPages}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 8, { align: 'center' })
    }

    doc.save(filename('pdf'))
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/reportes" className="text-xs text-slate-500 hover:text-slate-700 transition-colors">&larr; Reportes</Link>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">Informe de Aportes por socio</h1>
          <p className="mt-0.5 text-sm text-gray-500">Detalle completo de los aportes realizados por cada socio.</p>
        </div>
        {cantAportes > 0 && (
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
        )}
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
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Socio</label>
          <select value={socioFiltro} onChange={e => setSocioFiltro(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20">
            <option value="">Todos</option>
            {sociosOpciones.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        {monedas.length > 1 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Moneda</label>
            <select value={monedaFiltro} onChange={e => setMonedaFiltro(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20">
              <option value="">Todas</option>
              {monedas.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        )}
        {hayFiltrosActivos && (
          <button type="button" onClick={handleLimpiar}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors">
            Limpiar filtros
          </button>
        )}
      </div>

      {cantAportes === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
          <p className="text-sm text-gray-500">No hay aportes en el período seleccionado.</p>
        </div>
      ) : (
        <>
          {/* ── KPIs ── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Total aportado</p>
              <div className="mt-2 space-y-1">
                {totalesGenerales.map(([moneda, total]) => (
                  <p key={moneda} className="text-xl font-bold tabular-nums text-gray-900">{formatMoney(total, moneda)}</p>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-400">{periodoLabel}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Socios</p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">{cantSocios}</p>
              <p className="mt-2 text-xs text-gray-400">con aportes registrados</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Aportes</p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">{cantAportes}</p>
              <p className="mt-2 text-xs text-gray-400">transacciones activas</p>
            </div>
          </div>

          {/* ── Detalle por socio ── */}
          <div className="space-y-6">
            {grupos.map(g => (
              <div key={g.key} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                <div className="flex flex-col gap-1 border-b border-gray-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-baseline gap-2">
                    {g.codigo && <span className="font-mono text-xs text-slate-500">{g.codigo}</span>}
                    <h2 className="text-sm font-semibold text-gray-900">{g.nombre}</h2>
                    <span className="text-xs text-gray-400">{g.cantidad} aporte{g.cantidad !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                    {Array.from(g.totalesPorMoneda.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([moneda, total]) => (
                      <span key={moneda} className="text-sm font-semibold tabular-nums text-gray-900">{formatMoney(total, moneda)}</span>
                    ))}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                        <th className="px-5 py-2">Fecha</th>
                        <th className="px-5 py-2">N° aporte</th>
                        <th className="px-5 py-2">Destino</th>
                        <th className="px-5 py-2">Concepto</th>
                        <th className="hidden px-5 py-2 lg:table-cell">Observaciones</th>
                        <th className="px-5 py-2">Moneda</th>
                        <th className="px-5 py-2 text-right">Monto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {g.aportes.map(a => (
                        <tr key={a.id} className="hover:bg-gray-50/50">
                          <td className="px-5 py-2 whitespace-nowrap text-gray-600">{formatDate(a.fecha_aporte)}</td>
                          <td className="px-5 py-2 whitespace-nowrap font-mono text-xs text-slate-600">{a.codigo ?? '—'}</td>
                          <td className="px-5 py-2 text-gray-600">{a.destino}</td>
                          <td className="max-w-xs truncate px-5 py-2 text-gray-900" title={a.concepto}>{a.concepto || <span className="text-gray-300">—</span>}</td>
                          <td className="hidden max-w-xs truncate px-5 py-2 text-gray-500 lg:table-cell" title={a.observaciones ?? ''}>{a.observaciones || <span className="text-gray-300">—</span>}</td>
                          <td className="px-5 py-2 text-gray-500">{a.moneda}</td>
                          <td className="px-5 py-2 text-right tabular-nums font-medium text-gray-900 whitespace-nowrap">{formatMoney(a.monto, a.moneda)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      {Array.from(g.totalesPorMoneda.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([moneda, total]) => (
                        <tr key={moneda} className="border-t border-gray-100 bg-gray-50/50">
                          <td className="px-5 py-2 text-xs font-medium uppercase tracking-wider text-gray-400" colSpan={5}>Subtotal {g.nombre}</td>
                          <td className="px-5 py-2 text-gray-500">{moneda}</td>
                          <td className="px-5 py-2 text-right tabular-nums font-bold text-gray-900 whitespace-nowrap">{formatMoney(total, moneda)}</td>
                        </tr>
                      ))}
                    </tfoot>
                  </table>
                </div>
              </div>
            ))}
          </div>

          {/* ── Total general ── */}
          <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Total general de aportes</h2>
              <div className="flex flex-wrap gap-x-6 gap-y-0.5">
                {totalesGenerales.map(([moneda, total]) => (
                  <span key={moneda} className="text-lg font-bold tabular-nums text-gray-900">{formatMoney(total, moneda)}</span>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
