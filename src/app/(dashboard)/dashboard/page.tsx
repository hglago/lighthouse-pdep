import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DashboardClient, { type DashboardData } from './DashboardClient'

const ESTADO_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  enviado: 'Pendiente aprobación',
  aprobado: 'Aprobado',
  pagado_parcial: 'Pagado parcial',
  pagado: 'Pagado',
  rechazado: 'Rechazado',
}

function getWeekRange(): { desde: string; hasta: string } {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { desde: monday.toISOString().slice(0, 10), hasta: sunday.toISOString().slice(0, 10) }
}

function getMonthRange(): { desde: string; hasta: string } {
  const now = new Date()
  const desde = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const hasta = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
  return { desde, hasta }
}

export default async function DashboardPage({ searchParams }: { searchParams: { preset?: string; fechaDesde?: string; fechaHasta?: string } }) {
  const supabase = createClient()
  const auth = await supabase.auth.getUser()
  if (!auth.data?.user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', auth.data.user.id)
    .single()
  if (!profile) redirect('/gastos')
  if (profile.role === 'socio') redirect('/reportes')
  if (profile.role !== 'admin') redirect('/gastos')

  // Determinar rango
  let preset = searchParams.preset ?? 'month'
  let desde: string
  let hasta: string

  if (searchParams.fechaDesde && searchParams.fechaHasta) {
    preset = 'custom'
    desde = searchParams.fechaDesde
    hasta = searchParams.fechaHasta
  } else if (preset === 'week') {
    const r = getWeekRange()
    desde = r.desde
    hasta = r.hasta
  } else if (preset === 'all') {
    desde = '2000-01-01'
    hasta = '2099-12-31'
  } else {
    preset = 'month'
    const r = getMonthRange()
    desde = r.desde
    hasta = r.hasta
  }

  // Semana actual para necesidad semanal (siempre la semana en curso, independiente del filtro)
  const weekRange = getWeekRange()

  // ── Queries filtradas ──
  const [
    aportesResult,
    pagosPagadosResult,
    obligacionesResult,
    necesidadSemanalResult,
    pgResult,
    fondosResult,
    saldosTercerosResult,
    gastosEnPeriodoResult,
    upliftItemsResult,
    financiadoresResult,
  ] = await Promise.all([
    // 1. Aportes en período (con detalle para modal)
    supabase
      .from('aportes_fondo')
      .select('codigo, aportante, moneda, monto, fecha_aporte, socio_id, socios:socio_id(nombre)')
      .is('deleted_at', null)
      .gte('fecha_aporte', desde)
      .lte('fecha_aporte', hasta)
      .order('fecha_aporte', { ascending: false }),

    // 2. Pagos pagados en período (con detalle para modal)
    supabase
      .from('pagos')
      .select('monto, moneda, fecha_pago, concepto, proveedores:proveedor_id(nombre)')
      .eq('estado', 'pagado')
      .gte('fecha_pago', desde)
      .lte('fecha_pago', hasta)
      .order('fecha_pago', { ascending: false }),

    // 3. Obligaciones pendientes (con detalle para modal)
    supabase
      .from('v_obligaciones_pendientes')
      .select('obligacion_id, concepto, monto_pendiente, moneda, fecha_vencimiento, proveedor_nombre, prioridad_pago'),

    // 4. Necesidad semanal con detalle para modal
    supabase
      .from('gastos')
      .select('id, monto, moneda, descripcion, fecha_pago_prevista, proveedores:proveedor_id(nombre)')
      .is('deleted_at', null)
      .in('estado', ['enviado', 'aprobado'])
      .gte('fecha_pago_prevista', weekRange.desde)
      .lte('fecha_pago_prevista', weekRange.hasta),

    // 5. Posición global RISA (estado actual)
    supabase.from('v_posicion_global_risa').select('moneda, mp_total, mt_total, pg_total'),

    // 6. Saldo MP (fondos activos, estado actual, con nombre para detalle)
    supabase
      .from('fondos')
      .select('nombre, moneda, saldo_actual')
      .eq('estado', 'activo')
      .is('deleted_at', null),

    // 7. Saldo terceros (estado actual, con detalle para modal)
    supabase
      .from('v_saldos_financiadores')
      .select('financiador_nombre, moneda, saldo_pendiente, total_deuda_generada, total_cancelado'),

    // 8. Gastos en período (para secciones tipo/proveedor/estado)
    supabase
      .from('gastos')
      .select('monto, moneda, estado, proveedores:proveedor_id(nombre), tipos_gasto:tipo_gasto_id(nombre)')
      .is('deleted_at', null)
      .gte('fecha_gasto', desde)
      .lte('fecha_gasto', hasta),

    // 9a. Informes Dypsa emitidos en período (cabeceras).
    // Requiere RLS SELECT en reportes_dypsa — si no hay policy, devuelve vacío.
    supabase
      .from('reportes_dypsa')
      .select('id, estado, fecha_generacion'),

    // 10. Terceros activos (para mostrarlos en la card de financiación
    // aunque tengan saldo $0 — la view solo trae los que tienen movimientos).
    supabase
      .from('financiadores')
      .select('nombre')
      .is('deleted_at', null),
  ])

  // ── Agregar datos ──

  // KPI: Aportes
  const aportesData = aportesResult.data ?? []
  const aportesAgg = new Map<string, number>()
  const aportesAportanteAgg = new Map<string, { aportante: string; moneda: string; cantidad: number; total: number }>()
  for (const a of aportesData) {
    const moneda = a.moneda as string
    const monto = Number(a.monto) || 0
    aportesAgg.set(moneda, (aportesAgg.get(moneda) ?? 0) + monto)

    const socioNombre = (a.socios as { nombre?: string } | null)?.nombre
    const aportante = socioNombre || (a.aportante as string)?.trim() || 'Sin identificar'
    const key = `${aportante}|${moneda}`
    const ex = aportesAportanteAgg.get(key)
    if (ex) { ex.cantidad++; ex.total += monto }
    else aportesAportanteAgg.set(key, { aportante, moneda, cantidad: 1, total: monto })
  }

  // KPI: Pagos pagados
  const pagosAgg = new Map<string, number>()
  for (const p of pagosPagadosResult.data ?? []) {
    const moneda = p.moneda as string
    pagosAgg.set(moneda, (pagosAgg.get(moneda) ?? 0) + (Number(p.monto) || 0))
  }

  // KPI: Pendientes de pago (v_obligaciones_pendientes — descuenta pagos confirmados)
  const obligaciones = (obligacionesResult.data ?? []) as Array<{
    obligacion_id: string; monto_pendiente: number; moneda: string; fecha_vencimiento: string | null
  }>
  const pendientesAgg = new Map<string, { total: number; cantidad: number }>()
  for (const o of obligaciones) {
    const moneda = o.moneda
    const ex = pendientesAgg.get(moneda) ?? { total: 0, cantidad: 0 }
    ex.total += Number(o.monto_pendiente) || 0
    ex.cantidad++
    pendientesAgg.set(moneda, ex)
  }

  // KPI: Necesidad semanal — gastos con fecha_pago_prevista en semana actual.
  // Cruzar con obligaciones para incluir solo gastos realmente pendientes de pago.
  const obligacionIds = new Set(obligaciones.map(o => o.obligacion_id))
  let necesidadSemanalData = necesidadSemanalResult.data
  if (necesidadSemanalResult.error?.code === '42703') {
    necesidadSemanalData = []
  }
  const necesidadAgg = new Map<string, { total: number; cantidad: number }>()
  for (const g of necesidadSemanalData ?? []) {
    const gastoId = g.id as string
    if (!obligacionIds.has(gastoId)) continue
    const moneda = g.moneda as string
    const ex = necesidadAgg.get(moneda) ?? { total: 0, cantidad: 0 }
    ex.total += Number(g.monto) || 0
    ex.cantidad++
    necesidadAgg.set(moneda, ex)
  }

  // KPI: Posición global
  const pgData = pgResult.data ?? []
  const posicionGlobal = pgData.map(r => ({
    moneda: r.moneda as string,
    mp: Number(r.mp_total) || 0,
    mt: Number(r.mt_total) || 0,
    pg: Number(r.pg_total) || 0,
  }))

  // KPI: Saldo MP
  const saldoMPAgg = new Map<string, number>()
  for (const f of fondosResult.data ?? []) {
    const moneda = f.moneda as string
    saldoMPAgg.set(moneda, (saldoMPAgg.get(moneda) ?? 0) + (Number(f.saldo_actual) || 0))
  }

  // KPI: Saldo terceros — incluye TODOS los terceros activos, también los de
  // saldo $0 (pedido 2026-06-05). La view solo trae terceros con movimientos,
  // así que los que no figuran en ella se agregan con saldo 0 en ARS.
  const saldosView = (saldosTercerosResult.data ?? []).map(t => ({
    nombre: t.financiador_nombre as string,
    moneda: t.moneda as string,
    saldo: Number(t.saldo_pendiente) || 0,
  }))
  const tercerosConMovimientos = new Set(saldosView.map(t => t.nombre))
  const saldoTerceros = [
    ...saldosView,
    ...(financiadoresResult.data ?? [])
      .filter(f => !tercerosConMovimientos.has(f.nombre as string))
      .map(f => ({ nombre: f.nombre as string, moneda: 'ARS', saldo: 0 })),
  ].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

  // Secciones: gastos en período
  const gastosData = gastosEnPeriodoResult.data ?? []

  const tipoAgg = new Map<string, { tipo: string; moneda: string; cantidad: number; total: number }>()
  const provAgg = new Map<string, { proveedor: string; moneda: string; cantidad: number; total: number }>()
  const estadoAgg = new Map<string, { estado: string; moneda: string; cantidad: number; total: number }>()

  for (const g of gastosData) {
    const moneda = g.moneda as string
    const monto = Number(g.monto) || 0
    const tipo = (g.tipos_gasto as { nombre?: string } | null)?.nombre ?? 'Sin clasificar'
    const prov = (g.proveedores as { nombre?: string } | null)?.nombre ?? 'Sin proveedor'
    const estado = ESTADO_LABELS[g.estado as string] ?? (g.estado as string)

    const tk = `${tipo}|${moneda}`
    const te = tipoAgg.get(tk) ?? { tipo, moneda, cantidad: 0, total: 0 }
    te.cantidad++; te.total += monto; tipoAgg.set(tk, te)

    const pk = `${prov}|${moneda}`
    const pe = provAgg.get(pk) ?? { proveedor: prov, moneda, cantidad: 0, total: 0 }
    pe.cantidad++; pe.total += monto; provAgg.set(pk, pe)

    const ek = `${estado}|${moneda}`
    const ee = estadoAgg.get(ek) ?? { estado, moneda, cantidad: 0, total: 0 }
    ee.cantidad++; ee.total += monto; estadoAgg.set(ek, ee)
  }

  // KPI: Uplift informado — informes emitidos en período, items + gastos
  const upliftAgg = { total: 0, gastos: 0, proveedores: new Set<string>() }
  // Filtrar en JS: estado='emitido' y fecha_generacion en rango
  const reportesEnPeriodo = (upliftItemsResult.data ?? []).filter(r => {
    if ((r as { estado?: string }).estado !== 'emitido') return false
    const fg = ((r as { fecha_generacion?: string }).fecha_generacion ?? '').slice(0, 10)
    return fg >= desde && fg <= hasta
  })
  const reporteIds = reportesEnPeriodo.map(r => r.id as string)

  // Map de código+fecha por reporte_id
  const reporteInfoMap = new Map<string, { codigo: string; fecha: string }>()
  for (const r of reportesEnPeriodo) {
    const rr = r as { id: string; estado: string; fecha_generacion: string }
    reporteInfoMap.set(rr.id, { codigo: rr.id, fecha: rr.fecha_generacion })
  }

  type UpliftDetailRow = {
    informeCodigo: string; fechaInforme: string; descripcion: string; proveedor: string
    tipoGasto: string; montoBase: number; pctUplift: number; montoUplift: number
    montoInformado: number; moneda: string
  }
  const upliftDetalle: UpliftDetailRow[] = []

  if (reporteIds.length > 0) {
    const itemsResult = await supabase
      .from('reportes_dypsa_items')
      .select('monto_final_informe, gasto_id, reporte_id, proveedor_nombre, tipo_gasto_nombre, descripcion, moneda')
      .in('reporte_id', reporteIds)

    if (!itemsResult.error && itemsResult.data) {
      const gastoIds = Array.from(new Set(itemsResult.data.map(i => i.gasto_id as string)))

      const gastosRefResult = await supabase
        .from('gastos')
        .select('id, monto, proveedor_id, porcentaje_uplift_snapshot')
        .in('id', gastoIds)

      const gastoMap = new Map<string, { monto: number; proveedor_id: string | null; pctSnapshot: number }>()
      for (const g of gastosRefResult.data ?? []) {
        gastoMap.set(g.id as string, {
          monto: Number(g.monto) || 0,
          proveedor_id: g.proveedor_id as string | null,
          pctSnapshot: Number((g as { porcentaje_uplift_snapshot?: number }).porcentaje_uplift_snapshot) || 0,
        })
      }

      // Traer código de informe
      const cabResult = await supabase
        .from('reportes_dypsa')
        .select('id, codigo, fecha_generacion')
        .in('id', reporteIds)
      for (const c of cabResult.data ?? []) {
        reporteInfoMap.set(c.id as string, { codigo: c.codigo as string, fecha: c.fecha_generacion as string })
      }

      for (const item of itemsResult.data) {
        const montoInforme = Number(item.monto_final_informe) || 0
        const gRef = gastoMap.get(item.gasto_id as string)
        const montoOriginal = gRef?.monto ?? 0
        const diff = montoInforme - montoOriginal

        if (diff > 0.01) {
          upliftAgg.total += diff
          upliftAgg.gastos++
          if (gRef?.proveedor_id) upliftAgg.proveedores.add(gRef.proveedor_id)

          const pctUplift = gRef?.pctSnapshot && gRef.pctSnapshot > 0
            ? gRef.pctSnapshot
            : montoOriginal > 0 ? (diff / montoOriginal) * 100 : 0

          const repInfo = reporteInfoMap.get(item.reporte_id as string)
          upliftDetalle.push({
            informeCodigo: repInfo?.codigo ?? '',
            fechaInforme: repInfo?.fecha ?? '',
            descripcion: (item.descripcion as string) ?? '',
            proveedor: (item.proveedor_nombre as string) ?? 'Sin proveedor',
            tipoGasto: (item.tipo_gasto_nombre as string) ?? 'Sin clasificar',
            montoBase: montoOriginal,
            pctUplift,
            montoUplift: diff,
            montoInformado: montoInforme,
            moneda: (item.moneda as string) ?? 'ARS',
          })
        }
      }
    }
  }

  upliftDetalle.sort((a, b) => b.fechaInforme.localeCompare(a.fechaInforme) || b.montoUplift - a.montoUplift)

  // Uplift por proveedor (agrupado desde upliftDetalle)
  const upliftProvMap = new Map<string, { proveedor: string; cantidad: number; totalBase: number; totalInformado: number; totalUplift: number }>()
  for (const u of upliftDetalle) {
    const ex = upliftProvMap.get(u.proveedor)
    if (ex) { ex.cantidad++; ex.totalBase += u.montoBase; ex.totalInformado += u.montoInformado; ex.totalUplift += u.montoUplift }
    else upliftProvMap.set(u.proveedor, { proveedor: u.proveedor, cantidad: 1, totalBase: u.montoBase, totalInformado: u.montoInformado, totalUplift: u.montoUplift })
  }
  const upliftPorProveedorRaw = Array.from(upliftProvMap.values()).sort((a, b) => b.totalUplift - a.totalUplift)
  const upliftProvGrandTotal = upliftPorProveedorRaw.reduce((s, p) => s + p.totalUplift, 0) || 1
  let upliftProvAcum = 0
  const upliftPorProveedor = upliftPorProveedorRaw.map(p => {
    const pctTotal = (p.totalUplift / upliftProvGrandTotal) * 100
    upliftProvAcum += pctTotal
    return { ...p, pctTotal, pctAcum: upliftProvAcum }
  })

  function addPctAcum<T extends { moneda: string; total: number }>(rows: T[]): Array<T & { pctTotal: number; pctAcum: number }> {
    const totalByMon = new Map<string, number>()
    for (const r of rows) totalByMon.set(r.moneda, (totalByMon.get(r.moneda) ?? 0) + r.total)
    const acumByMon = new Map<string, number>()
    return rows.map(r => {
      const gt = totalByMon.get(r.moneda) || 1
      const p = (r.total / gt) * 100
      const prev = acumByMon.get(r.moneda) ?? 0
      const ac = prev + p
      acumByMon.set(r.moneda, ac)
      return { ...r, pctTotal: p, pctAcum: ac }
    })
  }

  // Detalle rows para modales
  const aportesDetalle = aportesData.map(a => ({
    codigo: (a.codigo as string) ?? '',
    aportante: (a.socios as { nombre?: string } | null)?.nombre || (a.aportante as string)?.trim() || 'Sin identificar',
    fecha: (a.fecha_aporte as string) ?? '',
    moneda: a.moneda as string,
    monto: Number(a.monto) || 0,
  }))

  const pagosDetalle = (pagosPagadosResult.data ?? []).map(p => ({
    fecha: (p.fecha_pago as string) ?? '',
    concepto: (p.concepto as string) ?? '',
    proveedor: (p.proveedores as { nombre?: string } | null)?.nombre ?? '—',
    moneda: p.moneda as string,
    monto: Number(p.monto) || 0,
  }))

  const pendientesDetalle = obligaciones.map(o => ({
    concepto: (o as { concepto?: string }).concepto ?? '',
    proveedor: (o as { proveedor_nombre?: string }).proveedor_nombre ?? '—',
    fecha: o.fecha_vencimiento ?? '',
    moneda: o.moneda,
    monto: Number(o.monto_pendiente) || 0,
    prioridad: Number((o as { prioridad_pago?: number }).prioridad_pago) || 3,
  }))

  let necesidadDetalle = (necesidadSemanalData ?? [])
    .filter(g => obligacionIds.has(g.id as string))
    .map(g => ({
      descripcion: (g.descripcion as string) ?? '',
      proveedor: (g.proveedores as { nombre?: string } | null)?.nombre ?? '—',
      fechaPrevista: (g.fecha_pago_prevista as string) ?? '',
      moneda: g.moneda as string,
      monto: Number(g.monto) || 0,
    }))
  if (necesidadSemanalResult.error?.code === '42703') necesidadDetalle = []

  const fondosDetalle = (fondosResult.data ?? []).map(f => ({
    nombre: f.nombre as string,
    moneda: f.moneda as string,
    saldo: Number(f.saldo_actual) || 0,
  }))

  const tercerosDetalle = (saldosTercerosResult.data ?? []).map(t => ({
    nombre: t.financiador_nombre as string,
    moneda: t.moneda as string,
    deuda: Number(t.total_deuda_generada) || 0,
    cancelado: Number(t.total_cancelado) || 0,
    saldo: Number(t.saldo_pendiente) || 0,
  }))

  const dashData: DashboardData = {
    periodo: { desde, hasta, preset },
    kpis: {
      totalAportado: Array.from(aportesAgg.entries()).map(([moneda, total]) => ({ moneda, total })).sort((a, b) => a.moneda.localeCompare(b.moneda)),
      cantidadAportes: aportesData.length,
      totalPagado: Array.from(pagosAgg.entries()).map(([moneda, total]) => ({ moneda, total })).sort((a, b) => a.moneda.localeCompare(b.moneda)),
      gastosPendientes: Array.from(pendientesAgg.entries()).map(([moneda, v]) => ({ moneda, ...v })).sort((a, b) => a.moneda.localeCompare(b.moneda)),
      necesidadSemanal: Array.from(necesidadAgg.entries()).map(([moneda, v]) => ({ moneda, ...v })).sort((a, b) => a.moneda.localeCompare(b.moneda)),
      posicionGlobal,
      saldoMP: Array.from(saldoMPAgg.entries()).map(([moneda, total]) => ({ moneda, total })).sort((a, b) => a.moneda.localeCompare(b.moneda)),
      saldoTerceros,
      upliftInformado: { total: upliftAgg.total, gastos: upliftAgg.gastos, proveedores: upliftAgg.proveedores.size },
      upliftDetalle: upliftDetalle.slice(0, 15),
      upliftPorProveedor,
    },
    detalle: {
      aportes: aportesDetalle,
      pagos: pagosDetalle,
      pendientes: pendientesDetalle,
      necesidad: necesidadDetalle,
      fondos: fondosDetalle,
      terceros: tercerosDetalle,
    },
    secciones: {
      aportesPorAportante: Array.from(aportesAportanteAgg.values()).sort((a, b) => b.total - a.total),
      gastosPorTipo: addPctAcum(Array.from(tipoAgg.values()).sort((a, b) => a.moneda.localeCompare(b.moneda) || b.total - a.total)),
      gastosPorProveedor: addPctAcum(Array.from(provAgg.values()).sort((a, b) => a.moneda.localeCompare(b.moneda) || b.total - a.total)),
      gastosPorEstado: Array.from(estadoAgg.values()).sort((a, b) => b.total - a.total),
    },
  }

  return <DashboardClient data={dashData} />
}
