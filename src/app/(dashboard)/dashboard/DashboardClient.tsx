'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'

// ── Types ──

type DetailRow = Record<string, string | number>

export type DashboardData = {
  periodo: { desde: string; hasta: string; preset: string }
  kpis: {
    totalAportado: Array<{ moneda: string; total: number }>
    cantidadAportes: number
    totalPagado: Array<{ moneda: string; total: number }>
    gastosPendientes: Array<{ moneda: string; total: number; cantidad: number }>
    necesidadSemanal: Array<{ moneda: string; total: number; cantidad: number }>
    posicionGlobal: Array<{ moneda: string; mp: number; mt: number; pg: number }>
    saldoMP: Array<{ moneda: string; total: number }>
    saldoTerceros: Array<{ moneda: string; nombre: string; saldo: number }>
    upliftInformado: { total: number; gastos: number; proveedores: number }
    upliftPorProveedor: Array<{ proveedor: string; cantidad: number; totalBase: number; totalInformado: number; totalUplift: number; pctTotal: number; pctAcum: number }>
    upliftDetalle: Array<{
      informeCodigo: string; fechaInforme: string; descripcion: string; proveedor: string
      tipoGasto: string; montoBase: number; pctUplift: number; montoUplift: number
      montoInformado: number; moneda: string
    }>
  }
  detalle: {
    aportes: Array<{ codigo: string; aportante: string; fecha: string; moneda: string; monto: number }>
    pagos: Array<{ fecha: string; concepto: string; proveedor: string; moneda: string; monto: number }>
    pendientes: Array<{ concepto: string; proveedor: string; fecha: string; moneda: string; monto: number; prioridad: number }>
    necesidad: Array<{ descripcion: string; proveedor: string; fechaPrevista: string; moneda: string; monto: number }>
    fondos: Array<{ nombre: string; moneda: string; saldo: number }>
    terceros: Array<{ nombre: string; moneda: string; deuda: number; cancelado: number; saldo: number }>
  }
  secciones: {
    aportesPorAportante: Array<{ aportante: string; moneda: string; cantidad: number; total: number }>
    gastosPorTipo: Array<{ tipo: string; moneda: string; cantidad: number; total: number; pctTotal: number; pctAcum: number }>
    gastosPorProveedor: Array<{ proveedor: string; moneda: string; cantidad: number; total: number; pctTotal: number; pctAcum: number }>
    gastosPorEstado: Array<{ estado: string; moneda: string; cantidad: number; total: number }>
  }
}

// ── Palette & helpers ──

const C = { teal: '#079783', green: '#67B855', blueDeep: '#0C1F6E', blueMid: '#525EA6', violet: '#7C2D88', amber: '#D56E39', red: '#C32421' }

function tone(v: number): string { return v < 0 ? 'text-[#C32421]' : v === 0 ? 'text-slate-600' : 'text-gray-900' }
function fmt(n: number, m: string): string { const a = Math.round(Math.abs(n)).toLocaleString('es-AR'); const s = n < 0 ? '-' : ''; return m === 'USD' ? `${s}USD ${a}` : m === 'EUR' ? `${s}EUR ${a}` : `${s}$${a}` }
function fmtD(iso: string): string { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}` }
function pct(v: number, t: number): string { return t > 0 ? `${((v / t) * 100).toFixed(1)}%` : '—' }

const PL: Record<string, string> = { week: 'Semana', month: 'Mes', all: 'Todo', custom: 'Custom' }
const PL_LONG: Record<string, string> = { week: 'Semana actual', month: 'Mes actual', all: 'Todo el proyecto', custom: 'Personalizado' }
const TOP_N = 8
const PRIO: Record<number, string> = { 1: 'Crítica', 2: 'Alta', 3: 'Normal', 4: 'Baja' }

// ── Eye icon ──

function EyeBtn({ onClick, preview }: { onClick: () => void; preview?: string[] }) {
  return (
    <div className="group relative inline-flex">
      <button type="button" onClick={onClick} title="Ver detalle" aria-label="Ver detalle"
        className="inline-flex items-center justify-center rounded-full p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors min-w-[28px] min-h-[28px]">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
      {preview && preview.length > 0 && (
        <div className="pointer-events-none absolute right-full top-1/2 z-30 mr-2 -translate-y-1/2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg opacity-0 transition-opacity group-hover:opacity-100 hidden sm:block w-max max-w-[240px]">
          {preview.map((line, i) => (
            <p key={i} className={`whitespace-nowrap text-xs ${i === 0 ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>{line}</p>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Modal ──

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const handleKey = useCallback((e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }, [onClose])
  useEffect(() => { if (open) { document.addEventListener('keydown', handleKey); return () => document.removeEventListener('keydown', handleKey) } }, [open, handleKey])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh] sm:pt-[15vh] overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h3 className="text-sm font-bold text-gray-900 sm:text-base">{title}</h3>
          <button onClick={onClose} className="rounded-full p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100">&times;</button>
        </div>
        <div className="overflow-y-auto overflow-x-auto p-4 sm:p-5">{children}</div>
      </div>
    </div>
  )
}

function ModalTable({ cols, rows, rightFrom = 3 }: { cols: string[]; rows: Array<Array<string | React.ReactNode>>; rightFrom?: number }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b">
        {cols.map((h, i) => <th key={i} className={`px-3 py-2 text-xs font-semibold uppercase text-gray-500 ${i >= rightFrom ? 'text-right' : 'text-left'}`}>{h}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-gray-50">
        {rows.map((r, i) => <tr key={i} className="hover:bg-gray-50/50">{r.map((c, j) => <td key={j} className={`px-3 py-2 ${j >= rightFrom ? 'text-right tabular-nums' : ''}`}>{c}</td>)}</tr>)}
      </tbody>
    </table>
  )
}

// ── Component ──

interface Props { data: DashboardData }

export default function DashboardClient({ data }: Props) {
  const router = useRouter()
  const { periodo: per, kpis, secciones: sec, detalle: det } = data
  const [modal, setModal] = useState<string | null>(null)
  const [showDates, setShowDates] = useState(per.preset === 'custom')

  const pendN = kpis.gastosPendientes.reduce((s, g) => s + g.cantidad, 0)
  const needN = kpis.necesidadSemanal.reduce((s, n) => s + n.cantidad, 0)
  // Total de financiación pendiente por moneda (fila "Total" de la card).
  const totalTerceros = Array.from(
    kpis.saldoTerceros.reduce((m, t) => m.set(t.moneda, (m.get(t.moneda) ?? 0) + t.saldo), new Map<string, number>())
  )
  const totalAportMon = new Map(kpis.totalAportado.map(a => [a.moneda, a.total]))
  const perLabel = per.preset === 'custom' ? `${fmtD(per.desde)} — ${fmtD(per.hasta)}` : PL_LONG[per.preset] ?? per.preset
  const topTipo = sec.gastosPorTipo.slice(0, TOP_N)
  const topProv = sec.gastosPorProveedor.slice(0, TOP_N)
  // Detalle de aportes agrupado por socio (modal). Mantiene el orden
  // fecha desc dentro de cada grupo; grupos ordenados alfabéticamente.
  const aportesPorSocio = Array.from(
    det.aportes.reduce((m, a) => {
      const k = a.aportante || '—'
      if (!m.has(k)) m.set(k, [] as typeof det.aportes)
      m.get(k)!.push(a)
      return m
    }, new Map<string, typeof det.aportes>())
  ).sort((x, y) => x[0].localeCompare(y[0], 'es'))

  return (
    <div className="relative mx-auto max-w-[1440px] space-y-4 px-2 py-2 sm:space-y-5 sm:px-3">
      {/* Watermark */}
      <div className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center overflow-hidden" aria-hidden="true">
        <img src="/brand/lighthouse-logo-horizontal.png" alt="" className="w-[500px] max-w-[60vw] select-none opacity-[0.03]" />
      </div>

      {/* Header */}
      <div className="relative overflow-hidden rounded-xl px-4 py-4 sm:rounded-2xl sm:px-6 sm:py-5" style={{ background: `linear-gradient(135deg, ${C.teal}14, ${C.green}0C, ${C.blueDeep}08)` }}>
        <img src="/brand/lighthouse-logo-horizontal.png" alt="" className="pointer-events-none absolute right-3 top-1/2 h-10 -translate-y-1/2 select-none opacity-[0.06] sm:h-14 sm:right-4" aria-hidden="true" />
        <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight sm:text-xl" style={{ color: C.blueDeep }}>Dashboard</h1>
            <p className="text-[11px] text-gray-500 sm:text-xs">Vista operativa del proyecto</p>
          </div>
          <span className="self-start rounded-full px-3 py-1 text-[11px] font-semibold text-white shadow-sm sm:self-auto sm:text-xs" style={{ backgroundColor: C.teal }}>{perLabel}</span>
        </div>
      </div>

      {/* Filtros */}
      <div className="relative z-10 rounded-xl border border-gray-100 bg-white/90 p-3 shadow-sm backdrop-blur-sm sm:px-4 sm:py-2.5">
        <div className="flex flex-wrap gap-2">
          {(['week', 'month', 'all'] as const).map(p => (
            <button key={p} onClick={() => router.push(`/dashboard?preset=${p}`)}
              className={`min-h-[36px] rounded-full px-4 py-1.5 text-xs font-semibold transition-all sm:min-h-0 sm:py-1 ${per.preset === p ? 'text-white shadow' : 'text-gray-600 hover:bg-gray-100'}`}
              style={per.preset === p ? { backgroundColor: C.teal } : undefined}>
              <span className="sm:hidden">{PL[p]}</span><span className="hidden sm:inline">{PL_LONG[p]}</span>
            </button>
          ))}
          <button onClick={() => setShowDates(!showDates)}
            className={`min-h-[36px] rounded-full px-4 py-1.5 text-xs font-semibold transition-all sm:min-h-0 sm:py-1 ${per.preset === 'custom' ? 'text-white shadow' : 'text-gray-600 hover:bg-gray-100'}`}
            style={per.preset === 'custom' ? { backgroundColor: C.teal } : undefined}>Fechas</button>
        </div>
        {showDates && (
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1"><label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">Desde</label><input type="date" id="dd" defaultValue={per.preset === 'custom' ? per.desde : ''} className="w-full min-h-[40px] rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400 sm:min-h-0 sm:py-1 sm:text-xs" /></div>
            <div className="flex-1"><label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">Hasta</label><input type="date" id="dh" defaultValue={per.preset === 'custom' ? per.hasta : ''} className="w-full min-h-[40px] rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400 sm:min-h-0 sm:py-1 sm:text-xs" /></div>
            <button onClick={() => { const d = (document.getElementById('dd') as HTMLInputElement)?.value; const h = (document.getElementById('dh') as HTMLInputElement)?.value; if (d && h) router.push(`/dashboard?fechaDesde=${d}&fechaHasta=${h}`) }}
              className="min-h-[40px] rounded-lg px-5 py-2 text-sm font-semibold text-white sm:min-h-0 sm:px-4 sm:py-1 sm:text-xs" style={{ backgroundColor: C.teal }}>Aplicar</button>
          </div>
        )}
      </div>

      {/* KPIs principales */}
      <div className="relative z-10 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <Kpi c={C.teal} label="Total aportado" sub={`${kpis.cantidadAportes} aporte${kpis.cantidadAportes !== 1 ? 's' : ''}`}>
          {kpis.totalAportado.map(a => <Money key={a.moneda} v={a.total} m={a.moneda} />)}
          {kpis.totalAportado.length === 0 && <Nil />}
        </Kpi>
        <Kpi c={C.blueDeep} label="Total pagado" sub="en período">
          {kpis.totalPagado.map(p => <Money key={p.moneda} v={p.total} m={p.moneda} />)}
          {kpis.totalPagado.length === 0 && <Nil />}
        </Kpi>
        <Kpi c={pendN > 0 ? C.amber : C.green} label="Pendientes" sub={`${pendN} obligación${pendN !== 1 ? 'es' : ''}`}>
          {pendN > 0 ? kpis.gastosPendientes.map(g => <Money key={g.moneda} v={g.total} m={g.moneda} />) : <Ok>Al día</Ok>}
        </Kpi>
        <Kpi c={needN > 0 ? C.red : C.green} label="Necesidad semana" sub={`${needN} con pago previsto`}>
          {needN > 0 ? kpis.necesidadSemanal.map(n => <Money key={n.moneda} v={n.total} m={n.moneda} />) : <Ok>Sin necesidad</Ok>}
        </Kpi>
      </div>

      {/* Financieros */}
      <div className="relative z-10 grid gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
        <Fin c={C.teal} label="Posición global RISA">
          {kpis.posicionGlobal.length > 0 ? kpis.posicionGlobal.map(pg => (
            <div key={pg.moneda}>
              <p className={`text-base font-bold tabular-nums sm:text-xl ${tone(pg.pg)}`}>{fmt(pg.pg, pg.moneda)}</p>
              <p className="text-[10px] text-gray-500 sm:text-xs">MP <span className={tone(pg.mp)}>{fmt(pg.mp, pg.moneda)}</span> · MT <span className={tone(pg.mt)}>{fmt(pg.mt, pg.moneda)}</span></p>
            </div>
          )) : <Nil />}
        </Fin>
        <Fin c={C.blueDeep} label="Saldo medios propios">
          {kpis.saldoMP.map(s => <p key={s.moneda} className={`text-base font-bold tabular-nums sm:text-xl ${tone(s.total)}`}>{fmt(s.total, s.moneda)}</p>)}
          {kpis.saldoMP.length === 0 && <Nil />}
        </Fin>
        <Fin c={C.violet} label="Financiación pendiente">
          {kpis.saldoTerceros.length > 0 ? (
            <div className="space-y-1.5">
              {kpis.saldoTerceros.map((t, i) => (
                <div key={i} className="flex justify-between items-baseline gap-2">
                  <span className="text-[10px] text-gray-500 truncate sm:text-xs">{t.nombre}</span>
                  <span className={`text-xs tabular-nums whitespace-nowrap sm:text-sm ${t.saldo > 0 ? 'text-[#C32421]' : tone(t.saldo)}`}>{fmt(t.saldo, t.moneda)}</span>
                </div>
              ))}
              {totalTerceros.map(([m, total]) => (
                <div key={m} className="flex justify-between items-baseline gap-2 border-t border-gray-100 pt-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-gray-600 sm:text-xs">Total</span>
                  <span className={`text-sm font-bold tabular-nums whitespace-nowrap sm:text-base ${total > 0 ? 'text-[#C32421]' : tone(total)}`}>{fmt(total, m)}</span>
                </div>
              ))}
            </div>
          ) : <Ok>Sin deuda</Ok>}
        </Fin>
        <div className="relative rounded-xl bg-white/95 p-4 shadow-sm backdrop-blur-sm sm:p-5" style={{ borderTop: `3px solid ${C.amber}` }}>
          {kpis.upliftInformado.total > 0 && <div className="absolute right-2 top-2"><EyeBtn onClick={() => setModal('upliftProv')} preview={[fmt(kpis.upliftInformado.total, 'ARS'), `${kpis.upliftInformado.proveedores} proveedores · ${kpis.upliftInformado.gastos} gastos`, ...(kpis.upliftPorProveedor[0] ? [`1° ${kpis.upliftPorProveedor[0].proveedor}`] : []), 'Click para ver detalle']} /></div>}
          <p className="text-[10px] font-bold uppercase tracking-wide sm:text-xs" style={{ color: C.amber }}>Uplift informado</p>
          <div className="mt-3 space-y-2">
            {kpis.upliftInformado.total > 0 ? (
              <>
                <p className={`text-base font-bold tabular-nums sm:text-xl ${tone(kpis.upliftInformado.total)}`}>{fmt(kpis.upliftInformado.total, 'ARS')}</p>
                <p className="text-[10px] text-gray-500 sm:text-xs">{kpis.upliftInformado.gastos} gasto{kpis.upliftInformado.gastos !== 1 ? 's' : ''} · {kpis.upliftInformado.proveedores} proveedor{kpis.upliftInformado.proveedores !== 1 ? 'es' : ''}</p>
              </>
            ) : <p className="text-sm text-gray-400 sm:text-base">Sin uplift informado</p>}
          </div>
        </div>
      </div>

      {/* Secciones resumen (cards con ojo → modal) — 4 por fila en desktop */}
      <div className="relative z-10 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <SummaryCard c={C.blueDeep} label="Ranking por tipo de gasto"
          totals={sec.gastosPorTipo} sub={`${sec.gastosPorTipo.length} tipo${sec.gastosPorTipo.length !== 1 ? 's' : ''}`}
          onDetail={() => setModal('tipo')}
          preview={[`${sec.gastosPorTipo.length} tipos`, ...(topTipo[0] ? [`1° ${topTipo[0].tipo}: ${fmt(topTipo[0].total, topTipo[0].moneda)}`] : []), 'Click para ver detalle']} />
        <SummaryCard c={C.teal} label="Ranking por proveedor"
          totals={sec.gastosPorProveedor} sub={`${sec.gastosPorProveedor.length} proveedor${sec.gastosPorProveedor.length !== 1 ? 'es' : ''}`}
          onDetail={() => setModal('proveedor')}
          preview={[`${sec.gastosPorProveedor.length} proveedores`, ...(topProv[0] ? [`1° ${topProv[0].proveedor}: ${fmt(topProv[0].total, topProv[0].moneda)}`] : []), 'Click para ver detalle']} />
        <SummaryCard c={C.teal} label="Aportes por socio"
          totals={sec.aportesPorAportante} sub={`${sec.aportesPorAportante.length} socio${sec.aportesPorAportante.length !== 1 ? 's' : ''}`}
          onDetail={() => setModal('aportes')}
          preview={[`${sec.aportesPorAportante.length} socios`, ...(sec.aportesPorAportante[0] ? [`1° ${sec.aportesPorAportante[0].aportante}: ${fmt(sec.aportesPorAportante[0].total, sec.aportesPorAportante[0].moneda)}`] : []), 'Click para ver detalle']} />
        <SummaryCard c={C.blueMid} label="Gastos por estado"
          totals={sec.gastosPorEstado} sub={`${sec.gastosPorEstado.length} estado${sec.gastosPorEstado.length !== 1 ? 's' : ''}`}
          onDetail={() => setModal('estado')}
          preview={[`${sec.gastosPorEstado.length} estados`, ...(sec.gastosPorEstado[0] ? [`Mayor: ${sec.gastosPorEstado[0].estado} (${fmt(sec.gastosPorEstado[0].total, sec.gastosPorEstado[0].moneda)})`] : []), 'Click para ver detalle']} />
      </div>

      {/* ── Modales ── */}
      <Modal open={modal === 'tipo'} onClose={() => setModal(null)} title="Ranking por tipo de gasto">
        {sec.gastosPorTipo.length === 0 ? <Empty /> : (
          <ModalTable cols={['Tipo', 'Moneda', 'Cant.', 'Total', '%', '% acum.']} rightFrom={2}
            rows={sec.gastosPorTipo.map(t => [t.tipo, t.moneda, String(t.cantidad), fmt(t.total, t.moneda), <Chip key="p">{t.pctTotal.toFixed(1)}%</Chip>, <Chip key="a">{t.pctAcum.toFixed(1)}%</Chip>])} />
        )}
      </Modal>

      <Modal open={modal === 'proveedor'} onClose={() => setModal(null)} title="Ranking por proveedor">
        {sec.gastosPorProveedor.length === 0 ? <Empty /> : (
          <ModalTable cols={['Proveedor', 'Moneda', 'Cant.', 'Total', '%', '% acum.']} rightFrom={2}
            rows={sec.gastosPorProveedor.map(p => [p.proveedor, p.moneda, String(p.cantidad), fmt(p.total, p.moneda), <Chip key="p">{p.pctTotal.toFixed(1)}%</Chip>, <Chip key="a">{p.pctAcum.toFixed(1)}%</Chip>])} />
        )}
      </Modal>

      <Modal open={modal === 'aportes'} onClose={() => setModal(null)} title="Detalle de aportes">
        {det.aportes.length === 0 ? <Empty /> : (
          <div className="space-y-5">
            {aportesPorSocio.map(([socio, aportes]) => {
              const sub = new Map<string, number>()
              for (const a of aportes) sub.set(a.moneda, (sub.get(a.moneda) ?? 0) + a.monto)
              return (
                <div key={socio}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 border-b border-gray-200 pb-1">
                    <h4 className="text-xs font-bold uppercase tracking-wide" style={{ color: C.teal }}>{socio}</h4>
                    <span className="text-sm font-bold tabular-nums whitespace-nowrap text-gray-900">
                      {Array.from(sub.entries()).map(([m, t]) => fmt(t, m)).join(' · ')}
                    </span>
                  </div>
                  <ModalTable cols={['Fecha', 'Código', 'Moneda', 'Monto']} rightFrom={3}
                    rows={aportes.map(a => [
                      fmtD(a.fecha),
                      // Deep-link al detalle del aporte en /fondos.
                      a.codigo
                        ? <Link key="c" href={`/fondos?aporte=${encodeURIComponent(a.codigo)}`} className="font-mono text-xs text-[#079783] underline decoration-dotted underline-offset-2 hover:decoration-solid" title="Ver detalle del aporte">{a.codigo}</Link>
                        : '—',
                      a.moneda,
                      fmt(a.monto, a.moneda),
                    ])} />
                </div>
              )
            })}
          </div>
        )}
      </Modal>

      <Modal open={modal === 'estado'} onClose={() => setModal(null)} title="Gastos por estado">
        {sec.gastosPorEstado.length === 0 ? <Empty /> : (
          <ModalTable cols={['Estado', 'Moneda', 'Cant.', 'Total']} rightFrom={2}
            rows={sec.gastosPorEstado.map(e => [e.estado, e.moneda, String(e.cantidad), fmt(e.total, e.moneda)])} />
        )}
      </Modal>

      <Modal open={modal === 'upliftProv'} onClose={() => setModal(null)} title="Uplift informado por proveedor">
        {kpis.upliftPorProveedor.length === 0 ? <Empty /> : (
          <ModalTable cols={['Proveedor', 'Gastos', 'Total base', 'Total informado', '$ uplift', '% uplift', '% s/total', '% acum.']} rightFrom={1}
            rows={kpis.upliftPorProveedor.map(p => [
              p.proveedor,
              String(p.cantidad),
              fmt(p.totalBase, 'ARS'),
              fmt(p.totalInformado, 'ARS'),
              <span key="u" className="font-bold" style={{ color: C.amber }}>{fmt(p.totalUplift, 'ARS')}</span>,
              <Chip key="pu">{p.totalBase > 0 ? `${(p.totalUplift / p.totalBase * 100).toFixed(1)}%` : '—'}</Chip>,
              <Chip key="p">{p.pctTotal.toFixed(1)}%</Chip>,
              <Chip key="a">{p.pctAcum.toFixed(1)}%</Chip>,
            ])} />
        )}
      </Modal>
    </div>
  )
}

// ── Sub-components ──

// TIPO-20 (2026-06-05): tipografía del dashboard reducida ~20% (un escalón
// de Tailwind) para un look más profesional y minimalista.
function Money({ v, m }: { v: number; m: string }) { return <p className={`text-xl font-bold tabular-nums sm:text-2xl ${tone(v)}`}>{fmt(v, m)}</p> }
function Nil() { return <p className="text-xl font-bold text-gray-300 sm:text-2xl">—</p> }
function Ok({ children }: { children: string }) { return <p className="text-base font-bold sm:text-xl" style={{ color: C.green }}>{children}</p> }

function Kpi({ c, label, sub, children }: { c: string; label: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-white/95 p-4 shadow-sm backdrop-blur-sm sm:p-5">
      <div className="absolute left-0 top-0 h-full w-1.5 rounded-l-xl" style={{ backgroundColor: c }} />
      <p className="pl-3 text-[10px] font-bold uppercase tracking-wide sm:text-xs" style={{ color: c }}>{label}</p>
      <div className="mt-2 pl-3 space-y-0.5 sm:mt-3">{children}</div>
      <p className="mt-2 pl-3 text-[10px] text-gray-500 sm:mt-3 sm:text-xs">{sub}</p>
    </div>
  )
}

function Fin({ c, label, children }: { c: string; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/95 p-4 shadow-sm backdrop-blur-sm sm:p-5" style={{ borderTop: `3px solid ${c}` }}>
      <p className="text-[10px] font-bold uppercase tracking-wide sm:text-xs" style={{ color: c }}>{label}</p>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  )
}

function SummaryCard({ c, label, totals, sub, onDetail, preview }: {
  c: string; label: string; totals: Array<{ moneda: string; total: number }>; sub: string; onDetail: () => void; preview?: string[]
}) {
  const grandTotal = new Map<string, number>()
  for (const t of totals) grandTotal.set(t.moneda, (grandTotal.get(t.moneda) ?? 0) + t.total)
  return (
    <div className="relative overflow-hidden rounded-xl bg-white/95 p-4 shadow-sm backdrop-blur-sm sm:p-5">
      <div className="absolute left-0 top-0 h-full w-1.5 rounded-l-xl" style={{ backgroundColor: c }} />
      <div className="flex items-start justify-between pl-3">
        <p className="text-[10px] font-bold uppercase tracking-wide sm:text-xs" style={{ color: c }}>{label}</p>
        <EyeBtn onClick={onDetail} preview={preview} />
      </div>
      <div className="mt-2 pl-3 space-y-0.5 sm:mt-3">
        {Array.from(grandTotal.entries()).map(([m, t]) => <p key={m} className={`text-base font-bold tabular-nums sm:text-xl ${tone(t)}`}>{fmt(t, m)}</p>)}
        {grandTotal.size === 0 && <p className="text-base font-bold text-gray-300">—</p>}
      </div>
      <p className="mt-2 pl-3 text-[10px] text-gray-500 sm:mt-3 sm:text-xs">{sub}</p>
    </div>
  )
}

function Empty() { return <p className="text-sm text-gray-400 text-center py-4">Sin datos en el período.</p> }
function Chip({ children }: { children: React.ReactNode }) { return <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-gray-500">{children}</span> }
