import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { ObligacionPendiente } from '@/types'

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: currency === 'USD' ? 'USD' : currency === 'EUR' ? 'EUR' : 'ARS',
    minimumFractionDigits: 2,
  }).format(amount)
}

const PRIORIDAD_LABELS: Record<number, string> = { 1: 'Crítica', 2: 'Alta', 3: 'Normal', 4: 'Baja' }
const PRIORIDAD_COLORS: Record<number, string> = {
  1: 'text-red-600 font-semibold',
  2: 'text-amber-600 font-medium',
  3: 'text-gray-500',
  4: 'text-gray-400',
}

type FondoRow = { id: string; nombre: string; moneda: string; saldo_actual: number }
type GastoEnvRow = {
  id: string; fecha_gasto: string; descripcion: string; monto: number; moneda: string
  proveedores: { nombre: string } | null
}
type PagoBorradorRow = {
  id: string; nro_pago: string; concepto: string; monto: number; moneda: string
  fondos: { nombre: string } | null
}
type PagoPagadoRow = { monto: number; moneda: string; fecha_pago: string }
type AporteRow = { aportante: string | null; moneda: string; monto: number; fecha_aporte: string; fondo_id: string }
type AporteGroup = { aportante: string; moneda: string; total: number; cantidad: number; ultimo: string }

export default async function DashboardPage() {
  const supabase = createClient()
  const auth = await supabase.auth.getUser()
  if (!auth.data?.user) redirect('/login')

  // Fase 2C.3 (2026-05-25): dashboard restringido a admin. Otros roles
  // (incluidos legacy contador/revisor/visualizador y nuevos supervisor/
  // operador/user) son redirigidos a /gastos. Patrón page-guard
  // consistente con /usuarios/page.tsx.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', auth.data.user.id)
    .single()
  if (!profile || profile.role !== 'admin') redirect('/gastos')

  const today = new Date()
  const isoToday = today.toISOString().slice(0, 10)
  const isoIn7 = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10)
  const isoMonthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)

  const [fondosResult, oblisResult, gastosEnvResult, pagosBorradorResult, pagosPagadosResult, aportesResult] = await Promise.all([
    supabase.from('fondos')
      .select('id, nombre, moneda, saldo_actual')
      .eq('estado', 'activo')
      .is('deleted_at', null)
      .order('nombre'),

    supabase.from('v_obligaciones_pendientes')
      .select('obligacion_id, tipo_obligacion, concepto, monto_pendiente, moneda, fecha_vencimiento, prioridad_pago, fondo_nombre, proveedor_nombre')
      .not('fecha_vencimiento', 'is', null)
      .order('fecha_vencimiento', { ascending: true }),

    supabase.from('gastos')
      .select('id, fecha_gasto, descripcion, monto, moneda, proveedores(nombre)', { count: 'exact' })
      .eq('estado', 'enviado')
      .is('deleted_at', null)
      .order('fecha_gasto', { ascending: false })
      .limit(15),

    supabase.from('pagos')
      .select('id, nro_pago, concepto, monto, moneda, fondos(nombre)', { count: 'exact' })
      .eq('estado', 'borrador')
      .order('created_at', { ascending: false })
      .limit(15),

    supabase.from('pagos')
      .select('monto, moneda, fecha_pago')
      .eq('estado', 'pagado'),

    supabase.from('aportes_fondo')
      .select('aportante, moneda, monto, fecha_aporte, fondo_id')
      .is('deleted_at', null),
  ])

  const fondos = (fondosResult.data ?? []) as FondoRow[]
  const obligaciones = (oblisResult.data ?? []) as ObligacionPendiente[]
  const gastosEnv = (gastosEnvResult.data ?? []) as unknown as GastoEnvRow[]
  const gastosEnvTotal = gastosEnvResult.count ?? gastosEnv.length
  const pagosBorrador = (pagosBorradorResult.data ?? []) as unknown as PagoBorradorRow[]
  const pagosBorradorTotal = pagosBorradorResult.count ?? pagosBorrador.length
  const pagosPagados = (pagosPagadosResult.data ?? []) as PagoPagadoRow[]
  const aportes = (aportesResult.data ?? []) as AporteRow[]

  const saldoARS = fondos.filter(f => f.moneda === 'ARS').reduce((s, f) => s + Number(f.saldo_actual), 0)
  const saldoUSD = fondos.filter(f => f.moneda === 'USD').reduce((s, f) => s + Number(f.saldo_actual), 0)
  const fondosActivos = fondos.length

  const oblisVencidas = obligaciones.filter(o => o.fecha_vencimiento && o.fecha_vencimiento < isoToday).length
  const oblisProx7 = obligaciones.filter(o =>
    o.fecha_vencimiento && o.fecha_vencimiento >= isoToday && o.fecha_vencimiento <= isoIn7
  ).length
  const oblisTabla = obligaciones.slice(0, 12)

  // Pagado: total histórico + mes actual, separado por moneda (nunca mezclar)
  const totalPagadoARS = pagosPagados.filter(p => p.moneda === 'ARS').reduce((s, p) => s + Number(p.monto), 0)
  const totalPagadoUSD = pagosPagados.filter(p => p.moneda === 'USD').reduce((s, p) => s + Number(p.monto), 0)
  const pagadoMesARS = pagosPagados.filter(p => p.moneda === 'ARS' && p.fecha_pago >= isoMonthStart).reduce((s, p) => s + Number(p.monto), 0)
  const pagadoMesUSD = pagosPagados.filter(p => p.moneda === 'USD' && p.fecha_pago >= isoMonthStart).reduce((s, p) => s + Number(p.monto), 0)

  // Aportes: GROUP BY aportante + moneda (nunca mezclar). NULL/vacío → "Sin identificar"
  const aportesMap = new Map<string, AporteGroup>()
  // Aportes acumulados por fondo_id (para % saldo/aportes — un fondo tiene una sola moneda)
  const aportadoPorFondo = new Map<string, number>()
  for (const a of aportes) {
    const aportante = a.aportante?.trim() || 'Sin identificar'
    const key = `${aportante}|${a.moneda}`
    const ex = aportesMap.get(key)
    if (ex) {
      ex.total += Number(a.monto)
      ex.cantidad += 1
      if (a.fecha_aporte > ex.ultimo) ex.ultimo = a.fecha_aporte
    } else {
      aportesMap.set(key, { aportante, moneda: a.moneda, total: Number(a.monto), cantidad: 1, ultimo: a.fecha_aporte })
    }
    aportadoPorFondo.set(a.fondo_id, (aportadoPorFondo.get(a.fondo_id) ?? 0) + Number(a.monto))
  }
  const aportesAgrupados = Array.from(aportesMap.values()).sort((a, b) => b.total - a.total)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Vista operativa.</p>
      </div>

      {/* ─── KPIs ──────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Kpi label="Saldo total ARS" value={formatMoney(saldoARS, 'ARS')} />
        <Kpi label="Saldo total USD" value={formatMoney(saldoUSD, 'USD')} />
        <Kpi label="Fondos activos" value={String(fondosActivos)} />
        <Kpi label="Obligaciones vencidas" value={String(oblisVencidas)} tone={oblisVencidas > 0 ? 'red' : undefined} />
        <Kpi label="Próximos 7 días" value={String(oblisProx7)} tone={oblisProx7 > 0 ? 'amber' : undefined} />
        <Kpi label="Gastos esperando aprobación" value={String(gastosEnvTotal)} />
        <Kpi label="Pagos en borrador" value={String(pagosBorradorTotal)} />
        <Kpi label="Total pagado ARS" value={formatMoney(totalPagadoARS, 'ARS')} />
        <Kpi label="Total pagado USD" value={formatMoney(totalPagadoUSD, 'USD')} />
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Pagado mes actual</p>
          <p className="mt-1 text-base font-semibold text-gray-900">{formatMoney(pagadoMesARS, 'ARS')}</p>
          <p className="text-sm text-gray-500">{formatMoney(pagadoMesUSD, 'USD')}</p>
        </div>
      </div>

      {/* ─── Fondos ────────────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900">Fondos</h2>
        <Card empty={fondos.length === 0 ? 'Sin fondos activos.' : false}>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <Th>Fondo</Th>
                <Th align="center">Moneda</Th>
                <Th align="right">Saldo actual</Th>
                <Th align="center">% sobre aportes</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {fondos.map(f => (
                <tr key={f.id}>
                  <Td className="text-gray-900 font-medium">{f.nombre}</Td>
                  <Td align="center" className="text-gray-500">{f.moneda}</Td>
                  <Td align="right" className="font-semibold text-gray-900 whitespace-nowrap">{formatMoney(Number(f.saldo_actual), f.moneda)}</Td>
                  <Td align="center">
                    <PorcentajeBadge saldo={Number(f.saldo_actual)} totalAportado={aportadoPorFondo.get(f.id) ?? 0} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      {/* ─── Obligaciones próximas ────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900">Obligaciones próximas</h2>
        <Card empty={oblisTabla.length === 0 ? 'No hay obligaciones con vencimiento.' : false}>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <Th>Fecha</Th>
                <Th>Concepto</Th>
                <Th className="hidden md:table-cell">Proveedor</Th>
                <Th align="right">Monto</Th>
                <Th align="center" className="hidden sm:table-cell">Prioridad</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {oblisTabla.map(o => {
                const vencida = o.fecha_vencimiento && o.fecha_vencimiento < isoToday
                return (
                  <tr key={o.obligacion_id}>
                    <Td className={`whitespace-nowrap ${vencida ? 'text-red-600 font-medium' : 'text-gray-600'}`}>{o.fecha_vencimiento ?? '—'}</Td>
                    <Td className="text-gray-900 max-w-xs truncate">{o.concepto}</Td>
                    <Td className="hidden md:table-cell text-gray-600">{o.proveedor_nombre ?? '—'}</Td>
                    <Td align="right" className="font-medium text-gray-900 whitespace-nowrap">{formatMoney(Number(o.monto_pendiente), o.moneda)}</Td>
                    <Td align="center" className={`hidden sm:table-cell ${PRIORIDAD_COLORS[o.prioridad_pago] ?? 'text-gray-500'}`}>{PRIORIDAD_LABELS[o.prioridad_pago] ?? o.prioridad_pago}</Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      </section>

      {/* ─── Pagos en borrador ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900">Pagos en borrador</h2>
        <Card empty={pagosBorrador.length === 0 ? 'Sin pagos en borrador.' : false}>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <Th>Nro</Th>
                <Th>Concepto</Th>
                <Th className="hidden sm:table-cell">Fondo</Th>
                <Th align="right">Monto</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pagosBorrador.map(p => (
                <tr key={p.id}>
                  <Td className="text-gray-400 font-mono text-xs whitespace-nowrap">{p.nro_pago}</Td>
                  <Td className="text-gray-900 max-w-xs truncate">{p.concepto}</Td>
                  <Td className="hidden sm:table-cell text-gray-600">{p.fondos?.nombre ?? '—'}</Td>
                  <Td align="right" className="font-medium text-gray-900 whitespace-nowrap">{formatMoney(Number(p.monto), p.moneda)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      {/* ─── Gastos esperando aprobación ──────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900">Gastos esperando aprobación</h2>
        <Card empty={gastosEnv.length === 0 ? 'Sin gastos esperando aprobación.' : false}>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <Th>Fecha</Th>
                <Th className="hidden md:table-cell">Proveedor</Th>
                <Th>Concepto</Th>
                <Th align="right">Monto</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {gastosEnv.map(g => (
                <tr key={g.id}>
                  <Td className="text-gray-600 whitespace-nowrap">{g.fecha_gasto}</Td>
                  <Td className="hidden md:table-cell text-gray-600">{g.proveedores?.nombre ?? '—'}</Td>
                  <Td className="text-gray-900 max-w-xs truncate">{g.descripcion}</Td>
                  <Td align="right" className="font-medium text-gray-900 whitespace-nowrap">{formatMoney(Number(g.monto), g.moneda)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      {/* ─── Aportes por aportante ────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900">Aportes por aportante</h2>
        <Card empty={aportesAgrupados.length === 0 ? 'Sin aportes registrados.' : false}>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <Th>Aportante</Th>
                <Th align="center">Moneda</Th>
                <Th align="right">Total aportado</Th>
                <Th align="center" className="hidden sm:table-cell">Aportes</Th>
                <Th align="right" className="hidden md:table-cell">Último aporte</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {aportesAgrupados.map(a => (
                <tr key={`${a.aportante}|${a.moneda}`}>
                  <Td className="text-gray-900 font-medium">
                    {a.aportante === 'Sin identificar'
                      ? <span className="italic text-gray-400">Sin identificar</span>
                      : a.aportante}
                  </Td>
                  <Td align="center" className="text-gray-500">{a.moneda}</Td>
                  <Td align="right" className="font-semibold text-gray-900 whitespace-nowrap">{formatMoney(a.total, a.moneda)}</Td>
                  <Td align="center" className="hidden sm:table-cell text-gray-600 tabular-nums">{a.cantidad}</Td>
                  <Td align="right" className="hidden md:table-cell text-gray-500 whitespace-nowrap">{a.ultimo}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'red' | 'amber' }) {
  const toneClass = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-gray-900'
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  )
}

function Card({ children, empty }: { children: React.ReactNode; empty: false | string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      {empty ? (
        <div className="p-8 text-center text-sm text-gray-400">{empty}</div>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </div>
  )
}

function Th({ children, align, className }: { children: React.ReactNode; align?: 'left' | 'right' | 'center'; className?: string }) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  return <th className={`px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500 ${alignClass} ${className ?? ''}`}>{children}</th>
}

function Td({ children, align, className }: { children: React.ReactNode; align?: 'left' | 'right' | 'center'; className?: string }) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  return <td className={`px-4 py-2.5 text-sm ${alignClass} ${className ?? ''}`}>{children}</td>
}

function PorcentajeBadge({ saldo, totalAportado }: { saldo: number; totalAportado: number }) {
  if (totalAportado <= 0) {
    return <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500">Sin aportes</span>
  }
  const pct = (saldo / totalAportado) * 100
  const cls = pct <= 40
    ? 'bg-red-100 text-red-700'
    : pct <= 85
    ? 'bg-amber-100 text-amber-700'
    : 'bg-green-100 text-green-700'
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{pct.toFixed(1)}%</span>
}
