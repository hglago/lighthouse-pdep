import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { UserRole, GastoEstado } from '@/types'
import PrintButton from './PrintButton'

/**
 * Orden de Gasto (2026-07-06): vista imprimible de un gasto individual.
 *
 * Server component. Lee el gasto por `id` con sus joins (fondo, proveedor,
 * financiador, tipo de gasto). Render con detalle completo — incluidas las
 * observaciones (`notas`) y condiciones de pago — para todos los estados.
 * Print-friendly vía `.print-document` (ver globals.css): al imprimir se
 * oculta el chrome del dashboard y queda solo la hoja.
 *
 * A diferencia de la Orden de Pago, la Orden de Gasto NO es un snapshot:
 * refleja el gasto en vivo al momento de abrir.
 */

const ROLES_OPERATIVOS: UserRole[] = ['admin', 'supervisor', 'operador', 'user', 'contador', 'revisor', 'visualizador']

function fmtMonto(m: number | null | undefined, moneda: string): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: moneda === 'USD' ? 'USD' : 'ARS',
    minimumFractionDigits: 2,
  }).format(Number(m) || 0)
}

function fmtFecha(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

const ESTADO_LABELS: Record<GastoEstado, string> = {
  borrador: 'Borrador',
  enviado: 'Pendiente',
  aprobado: 'Aprobado',
  pagado_parcial: 'Pagado parcial',
  pagado: 'Pagado',
  rechazado: 'Rechazado',
}

const ESTADO_STYLES: Record<GastoEstado, string> = {
  borrador: 'bg-gray-50 text-gray-600 ring-1 ring-gray-200',
  enviado: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  aprobado: 'bg-green-50 text-green-700 ring-1 ring-green-200',
  pagado_parcial: 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200',
  pagado: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  rechazado: 'bg-red-50 text-red-700 ring-1 ring-red-200',
}

const PRIORIDAD_LABELS: Record<number, string> = {
  1: 'Crítica',
  2: 'Alta',
  3: 'Normal',
  4: 'Baja',
}

// Forma cruda del gasto con joins PostgREST.
type GastoOrden = {
  id: string
  codigo: string | null
  descripcion: string
  monto: number
  moneda: string
  estado: GastoEstado
  fecha_gasto: string
  notas: string | null
  forma_cancelacion: 'risa' | 'financiador' | null
  tiene_anticipo: boolean | null
  monto_anticipo: number | null
  porcentaje_anticipo: number | null
  fecha_prevista_pago_anticipo: string | null
  fecha_comprometida_pago_saldo: string | null
  condiciones_pago_notas: string | null
  fecha_vencimiento: string | null
  fecha_pago_prevista: string | null
  prioridad_pago: number | null
  es_servicio_horas: boolean | null
  descripcion_servicio: string | null
  periodo_servicio_desde: string | null
  periodo_servicio_hasta: string | null
  horas_servicio: number | null
  valor_hora_aplicado: number | null
  porcentaje_uplift_snapshot: number | null
  importe_base_servicio: number | null
  periodo_analitico: string | null
  comprobante_nombre: string | null
  created_by: string
  created_at: string
  fondos: { nombre: string; moneda: string } | null
  proveedores: { nombre: string } | null
  financiadores: { codigo: string | null; nombre: string } | null
  tipos_gasto: { codigo: string | null; nombre: string } | null
}

const SELECT_FULL =
  'id, codigo, descripcion, monto, moneda, estado, fecha_gasto, notas, forma_cancelacion, tiene_anticipo, monto_anticipo, porcentaje_anticipo, fecha_prevista_pago_anticipo, fecha_comprometida_pago_saldo, condiciones_pago_notas, fecha_vencimiento, fecha_pago_prevista, prioridad_pago, es_servicio_horas, descripcion_servicio, periodo_servicio_desde, periodo_servicio_hasta, horas_servicio, valor_hora_aplicado, porcentaje_uplift_snapshot, importe_base_servicio, periodo_analitico, comprobante_nombre, created_by, created_at, fondos(nombre, moneda), proveedores(nombre), financiadores:financiador_id(codigo, nombre), tipos_gasto:tipo_gasto_id(codigo, nombre)'

const SELECT_BASE =
  'id, descripcion, monto, moneda, estado, fecha_gasto, notas, tiene_anticipo, monto_anticipo, porcentaje_anticipo, fecha_prevista_pago_anticipo, fecha_comprometida_pago_saldo, condiciones_pago_notas, fecha_vencimiento, prioridad_pago, comprobante_nombre, created_by, created_at, fondos(nombre, moneda), proveedores(nombre)'

export default async function OrdenGastoPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createClient()

  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const role = (profile?.role as UserRole) ?? 'visualizador'
  if (role === 'socio') redirect('/reportes')
  if (!ROLES_OPERATIVOS.includes(role)) redirect('/gastos')

  // SELECT tolerante: si alguna columna nueva no está aplicada (42703),
  // retry con el subconjunto base e hidratación de defaults.
  let g: GastoOrden | null = null
  const full = await supabase
    .from('gastos')
    .select(SELECT_FULL)
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle()

  if (full.error?.code === '42703') {
    const base = await supabase
      .from('gastos')
      .select(SELECT_BASE)
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle()
    if (base.error) {
      console.error('[orden-gasto] error:', base.error.code, base.error.message)
      throw new Error(base.error.message)
    }
    if (base.data) {
      g = {
        ...(base.data as Record<string, unknown>),
        codigo: null,
        forma_cancelacion: 'risa',
        fecha_pago_prevista: (base.data as { fecha_vencimiento?: string | null }).fecha_vencimiento ?? null,
        es_servicio_horas: false,
        descripcion_servicio: null,
        periodo_servicio_desde: null,
        periodo_servicio_hasta: null,
        horas_servicio: null,
        valor_hora_aplicado: null,
        porcentaje_uplift_snapshot: 0,
        importe_base_servicio: null,
        periodo_analitico: ((base.data as { fecha_gasto?: string }).fecha_gasto ?? '').slice(0, 7) || null,
        financiadores: null,
        tipos_gasto: null,
      } as unknown as GastoOrden
    }
  } else if (full.error) {
    console.error('[orden-gasto] error:', full.error.code, full.error.message)
    throw new Error(full.error.message)
  } else {
    g = (full.data as unknown as GastoOrden) ?? null
  }

  if (!g) notFound()

  // Ownership: el rol `user` solo puede ver sus propios gastos (igual que el listado).
  if (role === 'user' && g.created_by !== user.id) notFound()

  const moneda = g.moneda || g.fondos?.moneda || 'ARS'
  const canal = g.forma_cancelacion === 'financiador' ? 'Tercero de la red' : 'Medios propios RISA'
  const prioridad = g.prioridad_pago != null ? (PRIORIDAD_LABELS[g.prioridad_pago] ?? `Prioridad ${g.prioridad_pago}`) : '—'

  const labelCls = 'text-xs uppercase tracking-wide text-slate-500'
  const valueCls = 'mt-1 text-sm font-medium text-slate-900'

  return (
    <div className="mx-auto max-w-3xl p-6 print:p-0 print:max-w-none">
      {/* Toolbar — se oculta al imprimir */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Orden de Gasto</h1>
          <p className="mt-1 text-sm text-gray-500">Vista lista para imprimir o guardar como PDF.</p>
        </div>
        <PrintButton />
      </div>

      {/* Hoja imprimible */}
      <article className="print-document rounded-xl border border-slate-200 bg-white p-8 shadow-sm print:rounded-none print:border-0 print:shadow-none print:p-0">
        {/* Encabezado */}
        <header className="mb-6 flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Orden de Gasto</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-slate-900">{g.codigo ?? '—'}</p>
            <p className="mt-1 text-xs text-slate-500">Fecha del gasto: {fmtFecha(g.fecha_gasto)}</p>
          </div>
          <div className="text-right">
            <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${ESTADO_STYLES[g.estado]}`}>
              {ESTADO_LABELS[g.estado] ?? g.estado}
            </span>
            {g.periodo_analitico && (
              <p className="mt-1 font-mono text-xs text-slate-500">Período {g.periodo_analitico}</p>
            )}
          </div>
        </header>

        {/* Beneficiario + tipo */}
        <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className={labelCls}>Proveedor</p>
            <p className={valueCls}>{g.proveedores?.nombre ?? <span className="text-slate-400">—</span>}</p>
          </div>
          <div>
            <p className={labelCls}>Tipo de gasto</p>
            <p className={valueCls}>
              {g.tipos_gasto?.nombre
                ? <span>{g.tipos_gasto.codigo && <span className="font-mono">{g.tipos_gasto.codigo} </span>}{g.tipos_gasto.nombre}</span>
                : <span className="text-slate-400">—</span>}
            </p>
          </div>
          <div>
            <p className={labelCls}>Fondo</p>
            <p className={valueCls}>{g.fondos?.nombre ?? <span className="text-slate-400">—</span>}</p>
          </div>
          <div>
            <p className={labelCls}>Canal de cancelación</p>
            <p className={valueCls}>{canal}</p>
            {g.forma_cancelacion === 'financiador' && g.financiadores && (
              <p className="mt-0.5 text-xs text-slate-600">
                {g.financiadores.codigo && <span className="font-mono">{g.financiadores.codigo} </span>}
                {g.financiadores.nombre}
              </p>
            )}
          </div>
        </section>

        {/* Importe */}
        <section className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-5 print:bg-white">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <p className={labelCls}>Importe</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">{fmtMonto(g.monto, moneda)}</p>
            </div>
            <div className="text-right">
              <p className={labelCls}>Prioridad de pago</p>
              <p className={valueCls}>{prioridad}</p>
            </div>
          </div>
        </section>

        {/* Concepto + fechas */}
        <section className="mb-6 space-y-3">
          <div>
            <p className={labelCls}>Concepto</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">
              {g.descripcion || <span className="text-slate-400">—</span>}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className={labelCls}>Fecha del gasto</p>
              <p className="mt-0.5 text-sm text-slate-900">{fmtFecha(g.fecha_gasto)}</p>
            </div>
            <div>
              <p className={labelCls}>Vencimiento</p>
              <p className="mt-0.5 text-sm text-slate-900">{fmtFecha(g.fecha_vencimiento)}</p>
            </div>
            <div>
              <p className={labelCls}>Pago previsto</p>
              <p className="mt-0.5 text-sm text-slate-900">{fmtFecha(g.fecha_pago_prevista)}</p>
            </div>
          </div>
        </section>

        {/* Anticipo (si corresponde) */}
        {g.tiene_anticipo && (
          <section className="mb-6 rounded-lg border border-slate-200 p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-600">Condiciones de pago — anticipo</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className={labelCls}>Monto anticipo</p>
                <p className="mt-0.5 text-sm tabular-nums text-slate-900">{fmtMonto(g.monto_anticipo, moneda)}</p>
              </div>
              <div>
                <p className={labelCls}>% anticipo</p>
                <p className="mt-0.5 text-sm tabular-nums text-slate-900">{g.porcentaje_anticipo != null ? `${g.porcentaje_anticipo}%` : '—'}</p>
              </div>
              <div>
                <p className={labelCls}>Pago anticipo</p>
                <p className="mt-0.5 text-sm text-slate-900">{fmtFecha(g.fecha_prevista_pago_anticipo)}</p>
              </div>
              <div>
                <p className={labelCls}>Pago saldo</p>
                <p className="mt-0.5 text-sm text-slate-900">{fmtFecha(g.fecha_comprometida_pago_saldo)}</p>
              </div>
            </div>
            {g.condiciones_pago_notas && (
              <div className="mt-3">
                <p className={labelCls}>Condiciones acordadas</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{g.condiciones_pago_notas}</p>
              </div>
            )}
          </section>
        )}

        {/* Servicio por horas (si corresponde) */}
        {g.es_servicio_horas && (
          <section className="mb-6 rounded-lg border border-slate-200 p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-600">Servicio por horas</p>
            {g.descripcion_servicio && (
              <div className="mb-3">
                <p className={labelCls}>Descripción del servicio</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-900">{g.descripcion_servicio}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <p className={labelCls}>Período</p>
                <p className="mt-0.5 text-sm text-slate-900">{fmtFecha(g.periodo_servicio_desde)} — {fmtFecha(g.periodo_servicio_hasta)}</p>
              </div>
              <div>
                <p className={labelCls}>Horas</p>
                <p className="mt-0.5 text-sm tabular-nums text-slate-900">{g.horas_servicio ?? '—'}</p>
              </div>
              <div>
                <p className={labelCls}>Valor hora</p>
                <p className="mt-0.5 text-sm tabular-nums text-slate-900">{g.valor_hora_aplicado != null ? fmtMonto(g.valor_hora_aplicado, moneda) : '—'}</p>
              </div>
              <div>
                <p className={labelCls}>Importe base</p>
                <p className="mt-0.5 text-sm tabular-nums text-slate-900">{g.importe_base_servicio != null ? fmtMonto(g.importe_base_servicio, moneda) : '—'}</p>
              </div>
              <div>
                <p className={labelCls}>Uplift (snapshot)</p>
                <p className="mt-0.5 text-sm tabular-nums text-slate-900">{g.porcentaje_uplift_snapshot ? `${g.porcentaje_uplift_snapshot}%` : '—'}</p>
              </div>
            </div>
          </section>
        )}

        {/* Observaciones */}
        <section className="mb-6">
          <p className={labelCls}>Observaciones</p>
          <p className="mt-1 min-h-[1.5rem] whitespace-pre-wrap rounded-lg border border-slate-100 bg-slate-50/50 p-3 text-sm text-slate-700 print:border-slate-200 print:bg-white">
            {g.notas || <span className="text-slate-400">Sin observaciones.</span>}
          </p>
        </section>

        {/* Comprobante */}
        <section className="mb-6">
          <p className={labelCls}>Comprobante</p>
          <p className="mt-1 text-sm text-slate-900">
            {g.comprobante_nombre ?? <span className="text-slate-400">Sin comprobante adjunto.</span>}
          </p>
        </section>

        {/* Firma */}
        <section className="mt-12 grid grid-cols-2 gap-12 print:mt-16">
          <div className="border-t border-slate-300 pt-2 text-center">
            <p className="text-xs text-slate-500">Solicita / Rinde</p>
          </div>
          <div className="border-t border-slate-300 pt-2 text-center">
            <p className="text-xs text-slate-500">Autoriza</p>
          </div>
        </section>
      </article>
    </div>
  )
}
