'use client'

import { useState, useTransition, useMemo } from 'react'
import type { Fondo, Proveedor, Financiador, UserRole, GastoEstado, PagoEstado, PagoTipo, TipoGasto } from '@/types'
import type { GastoPayload, GastoRecurrentePayload, ComprobantePayload, RecurrenteActionResult, BulkGastoResult, TipoGastoQuickPayload, TipoGastoQuickResult } from './actions'
import type { ProveedorQuickResult } from '../proveedores/actions'
import type { FinanciadorPayload, FinanciadorActionResult } from '../fondos/actions'
import { exportToExcel, todayForFile } from '@/lib/excel'
import { createClient as createSupabaseBrowser } from '@/lib/supabase/client'
import DataTable, { type Column } from '@/components/DataTable'
import RowActionMenu, { type RowActionItem } from '@/components/RowActionMenu'
import DetalleServicioBlock from '@/components/DetalleServicioBlock'
import FinanciadorSelect from '@/components/FinanciadorSelect'
import FinanciadorQuickCreateModal from '@/components/FinanciadorQuickCreateModal'
import TipoGastoQuickCreateModal from '@/components/TipoGastoQuickCreateModal'

// Subconjunto del proveedor que necesita el modal: nombre + campos snapshot.
type ProveedorParaGasto = Pick<Proveedor, 'id' | 'nombre' | 'permite_horas_servicio' | 'valor_hora' | 'tiene_uplift' | 'porcentaje_uplift'>

// ─── Row types ───────────────────────────────────────────────────────────────

export interface GastoRow {
  id: string
  codigo: string | null  // G000001... generado por trigger DB; null si la migración no se aplicó
  fondo_id: string
  proveedor_id: string | null
  // P3a-fc: forma de cancelación + financiador (FK opcional). Tolerante a migración no aplicada.
  forma_cancelacion: 'risa' | 'financiador'
  financiador_id: string | null
  descripcion: string
  monto: number
  moneda: string
  estado: GastoEstado
  fecha_gasto: string
  notas: string | null
  tiene_anticipo: boolean
  monto_anticipo: number | null
  porcentaje_anticipo: number | null
  fecha_prevista_pago_anticipo: string | null
  fecha_comprometida_pago_saldo: string | null
  condiciones_pago_notas: string | null
  fecha_vencimiento: string | null
  prioridad_pago: number
  // P3a: snapshot de servicio por hora. NULL/0 cuando es_servicio_horas=false.
  es_servicio_horas: boolean
  descripcion_servicio: string | null
  periodo_servicio_desde: string | null
  periodo_servicio_hasta: string | null
  horas_servicio: number | null
  valor_hora_aplicado: number | null
  porcentaje_uplift_snapshot: number
  importe_base_servicio: number | null
  comprobante_path: string | null
  comprobante_nombre: string | null
  comprobante_mime: string | null
  comprobante_size_bytes: number | null
  comprobante_uploaded_by: string | null
  comprobante_subido_en: string | null
  recurrente_id: string | null
  periodo: string | null
  created_by: string
  created_at: string
  // TIPOS-GASTO: clasificación analítica. Trigger DB asigna OTRO si NULL.
  tipo_gasto_id: string | null
  fondos: { nombre: string; moneda: string } | null
  proveedores: { nombre: string } | null
  // P3a-fc: financiador joined (cuando forma_cancelacion='financiador').
  financiadores: { id: string; codigo: string | null; nombre: string } | null
  // TIPOS-GASTO: joined del tipo (codigo + nombre para columna/export).
  tipos_gasto: { id: string; codigo: string; nombre: string } | null
}

export interface PagoDeGasto {
  id: string
  gasto_id: string
  nro_pago: string
  tipo: PagoTipo
  estado: PagoEstado
  monto: number
  moneda: string
  fecha_pago: string
}

export interface GastoRecurrenteRow {
  id: string
  fondo_id: string
  proveedor_id: string | null
  concepto: string
  // categoria (legacy): DEPRECADA en UI desde TIPOS-GASTO. Columna sigue en DB.
  categoria: string | null
  // TIPOS-GASTO
  tipo_gasto_id: string | null
  monto: number
  moneda: string
  dia_vencimiento: number
  fecha_inicio: string
  fecha_fin: string | null
  activo: boolean
  prioridad_pago: number
  observaciones: string | null
  created_by: string
  created_at: string
  fondos: { nombre: string; moneda: string } | null
  proveedores: { nombre: string } | null
  tipos_gasto: { id: string; codigo: string; nombre: string } | null
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ESTADO_LABELS: Record<GastoEstado, string> = {
  borrador: 'Borrador',
  enviado: 'Pendiente',
  aprobado: 'Aprobado',
  pagado_parcial: 'Pagado parcial',
  pagado: 'Pagado',
  rechazado: 'Rechazado',
}

const ESTADO_COLORS: Record<GastoEstado, string> = {
  borrador: 'bg-gray-100 text-gray-600',
  enviado: 'bg-blue-100 text-blue-700',
  aprobado: 'bg-green-100 text-green-700',
  pagado_parcial: 'bg-cyan-100 text-cyan-700',
  pagado: 'bg-emerald-100 text-emerald-700',
  rechazado: 'bg-red-100 text-red-700',
}

const PRIORIDAD_LABELS: Record<number, string> = {
  1: 'Crítica',
  2: 'Alta',
  3: 'Normal',
  4: 'Baja',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMonto(monto: number, moneda: string) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: moneda === 'USD' ? 'USD' : 'ARS',
    minimumFractionDigits: 2,
  }).format(monto)
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

// ─── Form + state types ───────────────────────────────────────────────────────

type ActiveTab = 'gastos' | 'recurrentes'

type EditingState =
  | { tipo: 'gasto'; row: GastoRow }
  | { tipo: 'recurrente'; row: GastoRecurrenteRow }
  | null

interface FormState {
  es_recurrente: boolean
  // common
  fondo_id: string
  proveedor_id: string
  // TIPOS-GASTO: ID del tipo. '' inicial; openModal lo setea a OTRO si hay tipos.
  tipo_gasto_id: string
  descripcion: string
  monto: string
  moneda: string
  prioridad_pago: string
  // gasto-only
  fecha_gasto: string
  notas: string
  tiene_anticipo: boolean
  monto_anticipo: string
  fecha_prevista_pago_anticipo: string
  fecha_comprometida_pago_saldo: string
  condiciones_pago_notas: string
  fecha_vencimiento: string
  // P3a: bloque "Detalle del servicio" — opt-in por gasto.
  // El proveedor puede permitir horas, pero el usuario decide gasto por gasto
  // si lo carga como servicio por hora o como gasto común.
  usar_servicio_horas: boolean
  descripcion_servicio: string
  periodo_servicio_desde: string
  periodo_servicio_hasta: string
  horas_servicio: string
  // P3a-fc: forma de cancelación opt-in. Si false, va a RISA.
  es_financiado: boolean
  financiador_id: string
  // recurrente-only
  categoria: string
  dia_vencimiento: string
  fecha_inicio: string
  fecha_fin: string
  activo: boolean
  observaciones: string
}

const EMPTY_FORM: FormState = {
  es_recurrente: false,
  fondo_id: '',
  proveedor_id: '',
  tipo_gasto_id: '',
  descripcion: '',
  monto: '',
  moneda: '',
  prioridad_pago: '3',
  fecha_gasto: '',
  notas: '',
  tiene_anticipo: false,
  monto_anticipo: '',
  fecha_prevista_pago_anticipo: '',
  fecha_comprometida_pago_saldo: '',
  condiciones_pago_notas: '',
  fecha_vencimiento: '',
  usar_servicio_horas: false,
  descripcion_servicio: '',
  periodo_servicio_desde: '',
  periodo_servicio_hasta: '',
  horas_servicio: '',
  es_financiado: false,
  financiador_id: '',
  categoria: '',
  dia_vencimiento: '1',
  fecha_inicio: '',
  fecha_fin: '',
  activo: true,
  observaciones: '',
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  gastos: GastoRow[]
  recurrentes: GastoRecurrenteRow[]
  fondos: Pick<Fondo, 'id' | 'codigo' | 'nombre' | 'moneda'>[]
  proveedores: ProveedorParaGasto[]
  financiadores: Financiador[]
  // TIPOS-GASTO: tipos activos para el select del modal. Empty array si la
  // migración aún no se aplicó (page.tsx tolera 42P01 con []).
  tiposGasto: TipoGasto[]
  pagosDeGastos: PagoDeGasto[]
  role: UserRole
  onCreateGasto: (
    data: GastoPayload,
    options?: { id?: string; comprobante?: ComprobantePayload }
  ) => Promise<void>
  onUpdateGasto: (id: string, data: GastoPayload) => Promise<void>
  onDeleteGasto: (id: string) => Promise<void>
  onCambiarEstado: (id: string, nuevoEstado: 'enviado' | 'aprobado' | 'rechazado') => Promise<void>
  onCreateRecurrente: (data: GastoRecurrentePayload) => Promise<RecurrenteActionResult>
  onUpdateRecurrente: (id: string, data: GastoRecurrentePayload) => Promise<RecurrenteActionResult>
  onDeleteRecurrente: (id: string) => Promise<RecurrenteActionResult>
  onSetComprobante: (id: string, data: ComprobantePayload) => Promise<void>
  onRemoveComprobante: (id: string) => Promise<void>
  onCreateProveedorQuick: (data: {
    nombre: string
    cuit: string | null
    email: string | null
    telefono: string | null
    observaciones: string | null
  }) => Promise<ProveedorQuickResult>
  onBulkAprobar: (ids: string[]) => Promise<BulkGastoResult>
  onBulkRechazar: (ids: string[]) => Promise<BulkGastoResult>
  onBulkDelete: (ids: string[]) => Promise<BulkGastoResult>
  onCrearFinanciador: (data: FinanciadorPayload) => Promise<FinanciadorActionResult>
  // TIPOS-GASTO: alta inline desde el modal de gasto.
  onCrearTipoGasto: (data: TipoGastoQuickPayload) => Promise<TipoGastoQuickResult>
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function GastosClient({
  gastos,
  recurrentes,
  fondos,
  proveedores,
  financiadores,
  tiposGasto,
  pagosDeGastos,
  role,
  onCreateGasto,
  onUpdateGasto,
  onDeleteGasto,
  onCambiarEstado,
  onCreateRecurrente,
  onUpdateRecurrente,
  onDeleteRecurrente,
  onSetComprobante,
  onRemoveComprobante,
  onCreateProveedorQuick,
  onBulkAprobar,
  onBulkRechazar,
  onBulkDelete,
  onCrearFinanciador,
  onCrearTipoGasto,
}: Props) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('gastos')
  const [searchGastos, setSearchGastos] = useState('')
  const [searchRecurrentes, setSearchRecurrentes] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<EditingState>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [actionError, setActionError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [comprobanteError, setComprobanteError] = useState('')
  const [comprobanteUploading, setComprobanteUploading] = useState(false)
  const [pendingComprobante, setPendingComprobante] = useState<File | null>(null)

  // ── Quick crear proveedor (desde modal de gasto) ───────────────────────────
  const [localExtraProveedores, setLocalExtraProveedores] = useState<ProveedorParaGasto[]>([])
  const [quickProvOpen, setQuickProvOpen] = useState(false)
  const [qpNombre, setQpNombre] = useState('')
  const [qpCuit, setQpCuit] = useState('')
  const [qpEmail, setQpEmail] = useState('')
  const [qpTelefono, setQpTelefono] = useState('')
  const [qpObs, setQpObs] = useState('')
  const [qpError, setQpError] = useState('')
  const [qpSubmitting, setQpSubmitting] = useState(false)

  function openQuickProv() {
    setQpNombre(''); setQpCuit(''); setQpEmail(''); setQpTelefono(''); setQpObs('')
    setQpError('')
    setQuickProvOpen(true)
  }

  async function handleQuickProvSubmit(e: React.FormEvent) {
    e.preventDefault()
    setQpError('')
    if (!qpNombre.trim()) { setQpError('El nombre es requerido.'); return }
    setQpSubmitting(true)
    const result = await onCreateProveedorQuick({
      nombre: qpNombre,
      cuit: qpCuit.trim() || null,
      email: qpEmail.trim() || null,
      telefono: qpTelefono.trim() || null,
      observaciones: qpObs.trim() || null,
    })
    setQpSubmitting(false)
    if (!result.ok) { setQpError(result.error); return }
    // Append a la lista local + autoseleccionar en el form de gasto.
    // Los proveedores creados desde quick-create son comunes (sin horas, sin uplift).
    // Si se necesita servicio por hora, se edita el proveedor desde /proveedores.
    setLocalExtraProveedores(prev =>
      prev.some(p => p.id === result.id) ? prev : [...prev, {
        id: result.id,
        nombre: result.nombre,
        permite_horas_servicio: false,
        valor_hora: 0,
        tiene_uplift: false,
        porcentaje_uplift: 0,
      }]
    )
    setForm(prev => ({ ...prev, proveedor_id: result.id }))
    setQuickProvOpen(false)
  }

  // Lista efectiva de proveedores: props + locales (deduplicado por id), ordenado
  const effectiveProveedores = (() => {
    const map = new Map<string, ProveedorParaGasto>()
    proveedores.forEach(p => map.set(p.id, p))
    localExtraProveedores.forEach(p => { if (!map.has(p.id)) map.set(p.id, p) })
    return Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre))
  })()

  // ── Quick crear financiador (desde modal de gasto financiado) ──────────────
  const [localExtraFinanciadores, setLocalExtraFinanciadores] = useState<Financiador[]>([])
  const [quickFinanOpen, setQuickFinanOpen] = useState(false)

  const effectiveFinanciadores = useMemo(() => {
    const map = new Map<string, Financiador>()
    financiadores.forEach(f => map.set(f.id, f))
    localExtraFinanciadores.forEach(f => { if (!map.has(f.id)) map.set(f.id, f) })
    return Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [financiadores, localExtraFinanciadores])

  function handleFinanciadorCreated(result: { id: string; codigo: string | null; nombre: string }) {
    const stub: Financiador = {
      id: result.id,
      codigo: result.codigo,
      nombre: result.nombre,
      cuit: null,
      email: null,
      telefono: null,
      observaciones: null,
      deleted_at: null,
      created_by: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setLocalExtraFinanciadores(prev =>
      prev.some(f => f.id === stub.id) ? prev : [...prev, stub]
    )
    setForm(prev => ({ ...prev, financiador_id: result.id }))
    setQuickFinanOpen(false)
  }

  const canWrite = role === 'admin' || role === 'contador'
  const canDelete = role === 'admin'
  const canApprove = role === 'admin' || role === 'revisor'

  const qg = searchGastos.trim().toLowerCase()
  // Memoizar el filtro: si no se memoiza, la identidad cambia en cada render y
  // el useEffect interno del DataTable (onVisibleRowsChange) entra en loop.
  const filteredGastosBase = useMemo(() => {
    if (!qg) return gastos
    return gastos.filter(
      (g) =>
        (g.codigo ?? '').toLowerCase().includes(qg) ||
        g.descripcion.toLowerCase().includes(qg) ||
        (g.fondos?.nombre ?? '').toLowerCase().includes(qg) ||
        (g.proveedores?.nombre ?? '').toLowerCase().includes(qg) ||
        (g.financiadores?.nombre ?? '').toLowerCase().includes(qg) ||
        (g.financiadores?.codigo ?? '').toLowerCase().includes(qg) ||
        (g.notas ?? '').toLowerCase().includes(qg) ||
        (g.descripcion_servicio ?? '').toLowerCase().includes(qg)
    )
  }, [gastos, qg])

  // F2.1: tabla de gastos migrada a DataTable. La búsqueda libre (input arriba)
  // pre-filtra a `filteredGastosBase` ANTES de pasarlas al DataTable, para
  // conservar match contra columnas no expuestas (notas, descripcion_servicio,
  // financiador.codigo). El sort + selección + filtros por columna los maneja
  // el DataTable internamente.
  const [visibleGastos, setVisibleGastos] = useState<GastoRow[]>(filteredGastosBase)

  const gastosColumns = useMemo<Column<GastoRow>[]>(() => [
    {
      key: 'codigo',
      label: 'Código',
      accessor: g => g.codigo ?? '',
      render: g => g.codigo
        ? <span className="text-xs font-mono tabular-nums text-slate-600 whitespace-nowrap">{g.codigo}</span>
        : <span className="text-gray-300">—</span>,
      type: 'text',
    },
    {
      key: 'fecha',
      label: 'Fecha',
      accessor: g => g.fecha_gasto,
      render: g => <span className="text-sm text-gray-500 whitespace-nowrap">{g.fecha_gasto}</span>,
      type: 'date',
    },
    {
      key: 'descripcion',
      label: 'Concepto',
      accessor: g => g.descripcion,
      render: g => (
        <div>
          <div className="flex items-center gap-1.5 max-w-xs">
            <span className="text-sm font-medium text-gray-900 truncate min-w-0">{g.descripcion}</span>
            {g.comprobante_path && (
              <button
                type="button"
                title="Ver comprobante"
                aria-label="Ver comprobante"
                onClick={() => handleViewComprobante(g.comprobante_path!)}
                className="flex-shrink-0 text-slate-400 hover:text-slate-700 transition-colors"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </button>
            )}
          </div>
          <div className="flex gap-1 mt-0.5 items-center flex-wrap">
            {g.es_servicio_horas && (
              <span
                title={
                  g.horas_servicio != null && g.valor_hora_aplicado != null
                    ? `Servicio por hora — ${g.horas_servicio}h × ${formatMonto(g.valor_hora_aplicado, g.moneda)}`
                    : 'Servicio por hora'
                }
                className="inline-flex rounded px-1.5 py-0 text-xs font-medium bg-amber-100 text-amber-800"
              >
                Servicio por hora
              </span>
            )}
            {g.forma_cancelacion === 'financiador' ? (
              <span
                title="Gasto afrontado por un tercero de la red"
                className="inline-flex rounded px-1.5 py-0 text-xs font-medium bg-orange-100 text-orange-800"
              >
                {g.financiadores
                  ? `Tercero: ${g.financiadores.codigo ?? 'Sin código'} ${g.financiadores.nombre}`
                  : 'Tercero'}
              </span>
            ) : (
              <span
                title="Gasto afrontado con medios propios RISA"
                className="inline-flex rounded px-1.5 py-0 text-xs font-medium bg-slate-100 text-slate-700"
              >
                Medios propios RISA
              </span>
            )}
            {g.recurrente_id && (
              <span
                title={`Generado automáticamente desde recurrente${g.periodo ? ` — período ${g.periodo}` : ''}`}
                className="inline-flex rounded px-1.5 py-0 text-xs font-medium bg-indigo-100 text-indigo-700"
              >
                Recurrente{g.periodo ? ` ${g.periodo}` : ''}
              </span>
            )}
            {g.tiene_anticipo && (
              <span className="inline-flex rounded px-1.5 py-0 text-xs font-medium bg-purple-100 text-purple-700">Anticipo</span>
            )}
            {g.prioridad_pago <= 2 && (
              <span className="inline-flex rounded px-1.5 py-0 text-xs font-medium bg-amber-100 text-amber-700">{PRIORIDAD_LABELS[g.prioridad_pago]}</span>
            )}
            {g.fecha_vencimiento && (
              <span className="text-xs text-gray-400">vence {g.fecha_vencimiento}</span>
            )}
          </div>
        </div>
      ),
      type: 'text',
    },
    {
      key: 'proveedor',
      label: 'Proveedor',
      accessor: g => g.proveedores?.nombre ?? '',
      render: g => g.proveedores?.nombre ?? <span className="text-gray-300">—</span>,
      type: 'text',
      className: 'hidden md:table-cell',
    },
    {
      // TIPOS-GASTO: columna analítica con filtro enum por codigo.
      key: 'tipo_gasto',
      label: 'Tipo',
      accessor: g => g.tipos_gasto?.codigo ?? '',
      render: g => g.tipos_gasto
        ? <span className="inline-flex rounded px-1.5 py-0.5 text-xs font-medium bg-slate-100 text-slate-700" title={g.tipos_gasto.nombre}>{g.tipos_gasto.codigo}</span>
        : <span className="text-gray-300">—</span>,
      type: 'enum',
      enumOptions: effectiveTipos.map(t => ({ value: t.codigo, label: `${t.codigo} — ${t.nombre}` })),
      className: 'hidden sm:table-cell',
    },
    {
      key: 'monto',
      label: 'Monto',
      accessor: g => g.monto,
      render: g => <span className="whitespace-nowrap font-medium text-gray-900">{formatMonto(g.monto, g.moneda)}</span>,
      type: 'number',
      align: 'right',
    },
    {
      key: 'estado',
      label: 'Estado',
      accessor: g => g.estado,
      render: g => {
        const ui = estadoUI(g)
        return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ui.cls}`}>{ui.label}</span>
      },
      type: 'enum',
      enumOptions: [
        { value: 'borrador', label: ESTADO_LABELS.borrador },
        { value: 'enviado', label: ESTADO_LABELS.enviado },
        { value: 'aprobado', label: ESTADO_LABELS.aprobado },
        { value: 'pagado_parcial', label: ESTADO_LABELS.pagado_parcial },
        { value: 'pagado', label: ESTADO_LABELS.pagado },
        { value: 'rechazado', label: ESTADO_LABELS.rechazado },
      ],
      className: 'hidden lg:table-cell',
    },
  // estadoUI/handleViewComprobante usan estado y handlers que dependen del
  // ciclo de vida — no agregamos deps para evitar re-crear columns en cada
  // render (los closures siempre apuntan al estado actual).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  // ─── Bulk actions: feedback + handler genérico ─────────────────────────────
  const [bulkMessage, setBulkMessage] = useState<{ text: string; isError: boolean } | null>(null)

  function describirResultado(r: BulkGastoResult, accion: string): { text: string; isError: boolean } {
    const okN = r.procesados.length
    const errN = r.errores.length
    const partes: string[] = []
    if (okN > 0) partes.push(`${okN} gasto${okN !== 1 ? 's' : ''} ${accion}`)
    if (errN > 0) {
      const detalles = r.errores.slice(0, 2).map(e => (e.descripcion ? `"${e.descripcion}": ` : '') + e.error).join('; ')
      const masN = r.errores.length - 2
      partes.push(`${errN} omitido${errN !== 1 ? 's' : ''}: ${detalles}${masN > 0 ? ` (+${masN} más)` : ''}`)
    }
    return { text: partes.join(' · ') || 'Sin cambios.', isError: errN > 0 }
  }

  function runBulk(
    ids: string[],
    actionFn: (ids: string[]) => Promise<BulkGastoResult>,
    accionDescriptiva: string,
    clearSelection: () => void,
  ) {
    if (ids.length === 0) return
    setBulkMessage(null)
    startTransition(async () => {
      try {
        const result = await actionFn(ids)
        setBulkMessage(describirResultado(result, accionDescriptiva))
        clearSelection()
      } catch (err) {
        setBulkMessage({ text: err instanceof Error ? err.message : 'Error inesperado.', isError: true })
      }
    })
  }

  const qr = searchRecurrentes.trim().toLowerCase()
  // F2.2: memoizar para evitar loop con onVisibleRowsChange del DataTable.
  const filteredRecurrentesBase = useMemo(() => {
    if (!qr) return recurrentes
    return recurrentes.filter(
      (r) =>
        r.concepto.toLowerCase().includes(qr) ||
        (r.fondos?.nombre ?? '').toLowerCase().includes(qr) ||
        (r.proveedores?.nombre ?? '').toLowerCase().includes(qr) ||
        (r.categoria ?? '').toLowerCase().includes(qr)
    )
  }, [recurrentes, qr])
  const [visibleRecurrentes, setVisibleRecurrentes] = useState<GastoRecurrenteRow[]>(filteredRecurrentesBase)

  // ─── Helpers ────────────────────────────────────────────────────────────────

  // G1 (2026-05-24): todos los gastos operan sobre el fondo RISA (FON-001).
  // No hay selector visible en el modal — el fondo se asigna automáticamente
  // tanto en alta como en edición (la edición lo conserva en el server).
  // Si RISA no aparece en la lista de fondos activos, mostramos error y
  // bloqueamos el guardar.
  const fondoRisa = useMemo(() => {
    return fondos.find(f => f.codigo === 'FON-001') ?? fondos[0] ?? null
  }, [fondos])
  const risaIdInicial = fondoRisa?.id ?? ''
  const risaMonedaInicial = fondoRisa?.moneda ?? 'ARS'

  // TIPOS-GASTO: lista de tipos visible al usuario + alta inline. La prop
  // `tiposGasto` puede crecer en runtime cuando el user crea uno nuevo.
  const [localExtraTipos, setLocalExtraTipos] = useState<TipoGasto[]>([])
  const [quickTipoOpen, setQuickTipoOpen] = useState(false)
  const effectiveTipos = useMemo<TipoGasto[]>(
    () => [...tiposGasto, ...localExtraTipos],
    [tiposGasto, localExtraTipos]
  )
  const otroTipoId = useMemo(
    () => effectiveTipos.find(t => t.codigo === 'OTRO')?.id ?? '',
    [effectiveTipos]
  )

  function handleTipoGastoCreated(result: { id: string; codigo: string; nombre: string }) {
    // Append a lista local + autoseleccionar en el form.
    setLocalExtraTipos(prev =>
      prev.some(t => t.id === result.id) ? prev : [...prev, {
        id: result.id,
        codigo: result.codigo,
        nombre: result.nombre,
        descripcion: null,
        activo: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: null,
      }]
    )
    setForm(prev => ({ ...prev, tipo_gasto_id: result.id }))
    setQuickTipoOpen(false)
  }

  function handleTipoGastoSelectChange(value: string) {
    if (value === '__NEW__') {
      setQuickTipoOpen(true)
      return
    }
    setForm(prev => ({ ...prev, tipo_gasto_id: value }))
  }

  function handleEsRecurrenteToggle(checked: boolean) {
    setForm((prev) => ({
      ...prev,
      es_recurrente: checked,
      ...(checked
        ? {
            fecha_gasto: todayIso(),
            notas: '',
            tiene_anticipo: false,
            monto_anticipo: '',
            fecha_prevista_pago_anticipo: '',
            fecha_comprometida_pago_saldo: '',
            condiciones_pago_notas: '',
            fecha_vencimiento: '',
          }
        : {
            categoria: '',
            dia_vencimiento: '1',
            fecha_inicio: todayIso(),
            fecha_fin: '',
            activo: true,
            observaciones: '',
          }),
    }))
  }

  // ─── Modal openers ──────────────────────────────────────────────────────────

  function openNew(tipo: 'gasto' | 'recurrente') {
    setEditing(null)
    setForm({
      ...EMPTY_FORM,
      // G1: fondo siempre RISA, sin selector visible.
      fondo_id: risaIdInicial,
      moneda: risaMonedaInicial,
      es_recurrente: tipo === 'recurrente',
      fecha_gasto: todayIso(),
      fecha_inicio: todayIso(),
      // TIPOS-GASTO: pre-selección de OTRO si hay tipos cargados.
      tipo_gasto_id: otroTipoId,
    })
    setFormError('')
    setModalOpen(true)
  }

  function openEditGasto(g: GastoRow) {
    setEditing({ tipo: 'gasto', row: g })
    setForm({
      es_recurrente: false,
      fondo_id: g.fondo_id,
      proveedor_id: g.proveedor_id ?? '',
      tipo_gasto_id: g.tipo_gasto_id ?? otroTipoId,
      descripcion: g.descripcion,
      monto: String(g.monto),
      moneda: g.moneda,
      prioridad_pago: String(g.prioridad_pago),
      fecha_gasto: g.fecha_gasto,
      notas: g.notas ?? '',
      tiene_anticipo: g.tiene_anticipo,
      monto_anticipo: g.monto_anticipo != null ? String(g.monto_anticipo) : '',
      fecha_prevista_pago_anticipo: g.fecha_prevista_pago_anticipo ?? '',
      fecha_comprometida_pago_saldo: g.fecha_comprometida_pago_saldo ?? '',
      condiciones_pago_notas: g.condiciones_pago_notas ?? '',
      fecha_vencimiento: g.fecha_vencimiento ?? '',
      // P3a: si el gasto era de servicio, hidratar el toggle + snapshot.
      usar_servicio_horas: g.es_servicio_horas === true,
      descripcion_servicio: g.descripcion_servicio ?? '',
      periodo_servicio_desde: g.periodo_servicio_desde ?? '',
      periodo_servicio_hasta: g.periodo_servicio_hasta ?? '',
      horas_servicio: g.horas_servicio != null ? String(g.horas_servicio) : '',
      // P3a-fc: si el gasto era financiado, hidratar checkbox + selector.
      es_financiado: g.forma_cancelacion === 'financiador',
      financiador_id: g.financiador_id ?? '',
      categoria: '',
      dia_vencimiento: '1',
      fecha_inicio: todayIso(),
      fecha_fin: '',
      activo: true,
      observaciones: '',
    })
    setFormError('')
    setModalOpen(true)
  }

  function openEditRecurrente(r: GastoRecurrenteRow) {
    setEditing({ tipo: 'recurrente', row: r })
    setForm({
      es_recurrente: true,
      fondo_id: r.fondo_id,
      proveedor_id: r.proveedor_id ?? '',
      tipo_gasto_id: r.tipo_gasto_id ?? otroTipoId,
      descripcion: r.concepto,
      monto: String(r.monto),
      moneda: r.moneda,
      prioridad_pago: String(r.prioridad_pago),
      fecha_gasto: todayIso(),
      notas: '',
      tiene_anticipo: false,
      monto_anticipo: '',
      fecha_prevista_pago_anticipo: '',
      fecha_comprometida_pago_saldo: '',
      condiciones_pago_notas: '',
      fecha_vencimiento: '',
      // P3a: campos servicio quedan vacíos para recurrentes (P3b los implementa).
      usar_servicio_horas: false,
      descripcion_servicio: '',
      periodo_servicio_desde: '',
      periodo_servicio_hasta: '',
      horas_servicio: '',
      // P3a-fc: forma_cancelacion no aplica a recurrentes en P3a (queda RISA por default).
      es_financiado: false,
      financiador_id: '',
      categoria: r.categoria ?? '',
      dia_vencimiento: String(r.dia_vencimiento),
      fecha_inicio: r.fecha_inicio,
      fecha_fin: r.fecha_fin ?? '',
      activo: r.activo,
      observaciones: r.observaciones ?? '',
    })
    setFormError('')
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError('')
    setComprobanteError('')
    setPendingComprobante(null)
  }

  // ─── Submit ─────────────────────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')

    const isRecurrente = editing ? editing.tipo === 'recurrente' : form.es_recurrente

    if (isRecurrente) {
      if (!form.fondo_id) { setFormError('No se encontró el fondo operativo RISA. No se puede guardar.'); return }
      if (!form.descripcion.trim()) { setFormError('El concepto es requerido.'); return }
      const monto = parseFloat(form.monto)
      if (!form.monto || isNaN(monto) || monto <= 0) { setFormError('El monto debe ser mayor a 0.'); return }
      const dia = parseInt(form.dia_vencimiento)
      if (!form.dia_vencimiento || isNaN(dia) || dia < 1 || dia > 28) {
        setFormError('El día de vencimiento debe estar entre 1 y 28.')
        return
      }
      if (!form.fecha_inicio) { setFormError('La fecha de inicio es requerida.'); return }

      const payload: GastoRecurrentePayload = {
        fondo_id: form.fondo_id,
        proveedor_id: form.proveedor_id || null,
        concepto: form.descripcion.trim(),
        // TIPOS-GASTO: categoria queda en null desde la UI (DEPRECADO).
        // tipo_gasto_id la reemplaza. Si en edit el recurrente venía con
        // categoria viva, se preserva en DB (no la pisamos a null).
        categoria: editing && editing.tipo === 'recurrente' ? editing.row.categoria : null,
        tipo_gasto_id: form.tipo_gasto_id || null,
        monto,
        moneda: form.moneda,
        dia_vencimiento: dia,
        fecha_inicio: form.fecha_inicio,
        fecha_fin: form.fecha_fin || null,
        activo: form.activo,
        prioridad_pago: parseInt(form.prioridad_pago) || 3,
        observaciones: form.observaciones.trim() || null,
      }

      startTransition(async () => {
        const result = editing && editing.tipo === 'recurrente'
          ? await onUpdateRecurrente(editing.row.id, payload)
          : await onCreateRecurrente(payload)
        if (!result.ok) { setFormError(result.error); return }
        closeModal()
      })
    } else {
      if (!form.fondo_id) { setFormError('No se encontró el fondo operativo RISA. No se puede guardar.'); return }
      if (!form.descripcion.trim()) { setFormError('El concepto es requerido.'); return }
      if (!form.fecha_gasto) { setFormError('La fecha es requerida.'); return }

      // P3a-fc: forma de cancelación. Si está marcado financiado, exige financiador_id.
      if (form.es_financiado && !form.financiador_id) {
        setFormError('Cuando el gasto se afronta con un tercero de la red, seleccioná el tercero.')
        return
      }

      // P3a: el gasto es de servicio por hora SOLO si:
      //   (a) el proveedor permite horas, Y
      //   (b) el usuario activó el checkbox opt-in en este gasto.
      // El monto se calcula como horas × valor_hora_aplicado (snapshot del proveedor).
      const provSel = form.proveedor_id ? effectiveProveedores.find(p => p.id === form.proveedor_id) : null
      const esServicioHoras = !!provSel?.permite_horas_servicio && form.usar_servicio_horas === true

      let monto: number
      let snapshotServicio: {
        descripcion_servicio: string
        periodo_servicio_desde: string
        periodo_servicio_hasta: string
        horas_servicio: number
        valor_hora_aplicado: number
        porcentaje_uplift_snapshot: number
        importe_base_servicio: number
      } | null = null

      if (esServicioHoras) {
        if (!form.descripcion_servicio.trim()) {
          setFormError('La descripción del servicio es requerida.')
          return
        }
        if (!form.periodo_servicio_desde) {
          setFormError('Indicá el período desde del servicio.')
          return
        }
        if (!form.periodo_servicio_hasta) {
          setFormError('Indicá el período hasta del servicio.')
          return
        }
        if (form.periodo_servicio_desde > form.periodo_servicio_hasta) {
          setFormError('"Período desde" debe ser anterior o igual a "Período hasta".')
          return
        }
        const horas = parseFloat(form.horas_servicio.replace(',', '.'))
        if (!form.horas_servicio || isNaN(horas) || horas <= 0) {
          setFormError('Las horas deben ser mayor a 0.')
          return
        }
        const valorHora = Number(provSel!.valor_hora) || 0
        if (valorHora < 0) {
          setFormError('El valor hora del proveedor no puede ser negativo.')
          return
        }
        const importeBase = Math.round(horas * valorHora * 100) / 100
        const upliftSnap = provSel!.tiene_uplift ? (Number(provSel!.porcentaje_uplift) || 0) : 0

        monto = importeBase
        snapshotServicio = {
          descripcion_servicio: form.descripcion_servicio.trim(),
          periodo_servicio_desde: form.periodo_servicio_desde,
          periodo_servicio_hasta: form.periodo_servicio_hasta,
          horas_servicio: horas,
          valor_hora_aplicado: valorHora,
          porcentaje_uplift_snapshot: upliftSnap,
          importe_base_servicio: importeBase,
        }
      } else {
        monto = parseFloat(form.monto)
        if (!form.monto || isNaN(monto) || monto <= 0) {
          setFormError('El monto debe ser mayor a 0.')
          return
        }
      }

      let monto_anticipo: number | null = null
      let porcentaje_anticipo: number | null = null
      if (form.tiene_anticipo) {
        monto_anticipo = parseFloat(form.monto_anticipo)
        if (!form.monto_anticipo || isNaN(monto_anticipo) || monto_anticipo <= 0) {
          setFormError('El monto de anticipo debe ser mayor a 0.')
          return
        }
        if (monto_anticipo > monto) {
          setFormError('El monto de anticipo no puede superar el monto total.')
          return
        }
        porcentaje_anticipo = Math.round((monto_anticipo / monto) * 10000) / 100
      }

      const payload: GastoPayload = {
        fondo_id: form.fondo_id,
        proveedor_id: form.proveedor_id || '',
        tipo_gasto_id: form.tipo_gasto_id || null,
        descripcion: form.descripcion.trim(),
        monto,
        moneda: form.moneda,
        fecha_gasto: form.fecha_gasto,
        notas: form.notas.trim() || null,
        tiene_anticipo: form.tiene_anticipo,
        monto_anticipo,
        porcentaje_anticipo,
        fecha_prevista_pago_anticipo: form.fecha_prevista_pago_anticipo || null,
        fecha_comprometida_pago_saldo: form.fecha_comprometida_pago_saldo || null,
        condiciones_pago_notas: form.condiciones_pago_notas.trim() || null,
        fecha_vencimiento: form.fecha_vencimiento || null,
        prioridad_pago: parseInt(form.prioridad_pago) || 3,
        es_servicio_horas: esServicioHoras,
        descripcion_servicio: snapshotServicio?.descripcion_servicio ?? null,
        periodo_servicio_desde: snapshotServicio?.periodo_servicio_desde ?? null,
        periodo_servicio_hasta: snapshotServicio?.periodo_servicio_hasta ?? null,
        horas_servicio: snapshotServicio?.horas_servicio ?? null,
        valor_hora_aplicado: snapshotServicio?.valor_hora_aplicado ?? null,
        porcentaje_uplift_snapshot: snapshotServicio?.porcentaje_uplift_snapshot ?? 0,
        importe_base_servicio: snapshotServicio?.importe_base_servicio ?? null,
        // P3a-fc: forma de cancelación
        forma_cancelacion: form.es_financiado ? 'financiador' : 'risa',
        financiador_id: form.es_financiado ? form.financiador_id : null,
      }

      startTransition(async () => {
        try {
          if (editing && editing.tipo === 'gasto') {
            await onUpdateGasto(editing.row.id, payload)
          } else if (pendingComprobante) {
            const newId = crypto.randomUUID()
            const path = `gastos/${newId}`
            const supabase = createSupabaseBrowser()
            const { error: upErr } = await supabase.storage
              .from('comprobantes')
              .upload(path, pendingComprobante, {
                upsert: true,
                contentType: pendingComprobante.type,
              })
            if (upErr) throw new Error(`Error al subir comprobante: ${upErr.message}`)
            try {
              await onCreateGasto(payload, {
                id: newId,
                comprobante: {
                  path,
                  mime: pendingComprobante.type,
                  nombre: pendingComprobante.name,
                  size: pendingComprobante.size,
                },
              })
            } catch (err) {
              // Cleanup best-effort si el INSERT falla tras subir
              try { await supabase.storage.from('comprobantes').remove([path]) } catch {}
              throw err
            }
          } else {
            await onCreateGasto(payload)
          }
          closeModal()
        } catch (err: unknown) {
          setFormError(err instanceof Error ? err.message : 'Error al guardar.')
        }
      })
    }
  }

  // ─── Table actions ───────────────────────────────────────────────────────────

  function handleDeleteGasto(id: string, descripcion: string) {
    if (!confirm(`¿Eliminar el gasto "${descripcion}"?`)) return
    setActionError('')
    startTransition(async () => {
      try {
        await onDeleteGasto(id)
      } catch (err: unknown) {
        setActionError(err instanceof Error ? err.message : 'Error al eliminar.')
      }
    })
  }

  function handleCambiarEstado(id: string, nuevoEstado: 'enviado' | 'aprobado' | 'rechazado') {
    setActionError('')
    startTransition(async () => {
      try {
        await onCambiarEstado(id, nuevoEstado)
      } catch (err: unknown) {
        setActionError(err instanceof Error ? err.message : 'Error al cambiar estado.')
      }
    })
  }

  function handleDeleteRecurrente(id: string, concepto: string) {
    if (!confirm(`¿Eliminar el gasto recurrente "${concepto}"?`)) return
    setActionError('')
    startTransition(async () => {
      const result = await onDeleteRecurrente(id)
      if (!result.ok) setActionError(result.error)
    })
  }

  function handleToggleActivo(r: GastoRecurrenteRow) {
    setActionError('')
    startTransition(async () => {
      const result = await onUpdateRecurrente(r.id, {
        fondo_id: r.fondo_id,
        proveedor_id: r.proveedor_id,
        concepto: r.concepto,
        categoria: r.categoria,
        tipo_gasto_id: r.tipo_gasto_id,
        monto: r.monto,
        moneda: r.moneda,
        dia_vencimiento: r.dia_vencimiento,
        fecha_inicio: r.fecha_inicio,
        fecha_fin: r.fecha_fin,
        activo: !r.activo,
        prioridad_pago: r.prioridad_pago,
        observaciones: r.observaciones,
      })
      if (!result.ok) setActionError(result.error)
    })
  }

  // ─── Comprobantes ────────────────────────────────────────────────────────────

  async function handleUploadComprobante(file: File) {
    if (!editing || editing.tipo !== 'gasto') return
    const id = editing.row.id

    if (!/\.(pdf|jpe?g|png|webp)$/i.test(file.name)) {
      setComprobanteError('Extensión no permitida. Aceptados: PDF, JPG, JPEG, PNG, WEBP.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setComprobanteError('Archivo supera 10 MB.')
      return
    }

    setComprobanteError('')
    setComprobanteUploading(true)
    try {
      const supabase = createSupabaseBrowser()
      const path = `gastos/${id}`
      const { error: upErr } = await supabase.storage
        .from('comprobantes')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) throw new Error(upErr.message)
      await onSetComprobante(id, { path, mime: file.type, nombre: file.name, size: file.size })
    } catch (err) {
      setComprobanteError(err instanceof Error ? err.message : 'Error al subir.')
    } finally {
      setComprobanteUploading(false)
    }
  }

  async function handleViewComprobante(path: string) {
    setComprobanteError('')
    try {
      const supabase = createSupabaseBrowser()
      const { data, error } = await supabase.storage
        .from('comprobantes')
        .createSignedUrl(path, 3600)
      if (error) throw new Error(error.message)
      if (!data?.signedUrl) throw new Error('No se pudo generar el link.')
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setComprobanteError(err instanceof Error ? err.message : 'Error al abrir.')
    }
  }

  function handleRemoveComprobante() {
    if (!editing || editing.tipo !== 'gasto') return
    if (!confirm('¿Quitar el comprobante de este gasto?')) return
    setComprobanteError('')
    startTransition(async () => {
      try {
        await onRemoveComprobante(editing.row.id)
      } catch (err) {
        setComprobanteError(err instanceof Error ? err.message : 'Error al quitar.')
      }
    })
  }

  function formatBytes(b: number): string {
    return b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`
  }

  // ─── Export ──────────────────────────────────────────────────────────────────

  function handleExportGastos() {
    // visibleGastos refleja lo que muestra el DataTable tras búsqueda + filtros
    // por columna + sort. Fallback a filteredGastosBase por si aún no se hidrató.
    const source = visibleGastos.length > 0 ? visibleGastos : filteredGastosBase
    const rows = source.map(g => ({
      fecha: g.fecha_gasto,
      proveedor: g.proveedores?.nombre ?? '',
      concepto: g.descripcion,
      // TIPOS-GASTO: clasificación analítica.
      tipo_gasto_codigo: g.tipos_gasto?.codigo ?? '',
      tipo_gasto_nombre: g.tipos_gasto?.nombre ?? '',
      fondo: g.fondos?.nombre ?? '',
      monto: g.monto,
      moneda: g.moneda,
      estado: ESTADO_LABELS[g.estado] ?? g.estado,
      fecha_vencimiento: g.fecha_vencimiento ?? '',
      prioridad_pago: g.prioridad_pago,
      tiene_anticipo: g.tiene_anticipo ? 'sí' : 'no',
      monto_anticipo: g.monto_anticipo ?? '',
      recurrente: 'no',
    }))
    exportToExcel(rows, `gastos_${todayForFile()}.xlsx`, 'Gastos')
  }

  function handleExportRecurrentes() {
    const source = visibleRecurrentes.length > 0 ? visibleRecurrentes : filteredRecurrentesBase
    const rows = source.map(r => ({
      fecha: r.fecha_inicio,
      proveedor: r.proveedores?.nombre ?? '',
      concepto: r.concepto,
      // TIPOS-GASTO: clasificación analítica. La columna legacy "categoria"
      // queda fuera del export (DEPRECADA).
      tipo_gasto_codigo: r.tipos_gasto?.codigo ?? '',
      tipo_gasto_nombre: r.tipos_gasto?.nombre ?? '',
      fondo: r.fondos?.nombre ?? '',
      monto: r.monto,
      moneda: r.moneda,
      estado: r.activo ? 'Activo' : 'Inactivo',
      fecha_vencimiento: '',
      prioridad_pago: r.prioridad_pago,
      tiene_anticipo: 'no',
      monto_anticipo: '',
      recurrente: 'sí',
    }))
    exportToExcel(rows, `gastos_recurrentes_${todayForFile()}.xlsx`, 'Recurrentes')
  }

  // ─── Derived ─────────────────────────────────────────────────────────────────

  const isRecurrenteMode = editing ? editing.tipo === 'recurrente' : form.es_recurrente
  const isEditing = editing !== null
  const editingGastoLatest = editing?.tipo === 'gasto'
    ? (gastos.find(g => g.id === editing.row.id) ?? editing.row)
    : null

  // Set de recurrente_id que YA tienen gasto generado para el período actual (YYYY-MM)
  const periodoActual = new Date().toISOString().slice(0, 7)
  const recurrentesGeneradosEsteMes = useMemo(() => new Set(
    gastos
      .filter(g => g.recurrente_id && g.periodo === periodoActual)
      .map(g => g.recurrente_id as string)
  ), [gastos, periodoActual])

  const recurrentesColumns = useMemo<Column<GastoRecurrenteRow>[]>(() => [
    {
      key: 'concepto',
      label: 'Concepto',
      accessor: r => r.concepto,
      render: r => (
        <div>
          <div className="text-sm font-medium text-gray-900 max-w-xs truncate">{r.concepto}</div>
          <div className="flex gap-1 mt-0.5 items-center">
            {/* TIPOS-GASTO: categoria legacy ya no se muestra (DEPRECADO).
                El Tipo va en su propia columna. */}
            {r.prioridad_pago <= 2 && (
              <span className="inline-flex rounded px-1.5 py-0 text-xs font-medium bg-amber-100 text-amber-700">{PRIORIDAD_LABELS[r.prioridad_pago]}</span>
            )}
            {recurrentesGeneradosEsteMes.has(r.id) && (
              <span
                title={`Ya generó gasto para el período ${periodoActual}`}
                className="inline-flex rounded px-1.5 py-0 text-xs font-medium bg-emerald-100 text-emerald-700"
              >
                Generado {periodoActual}
              </span>
            )}
          </div>
        </div>
      ),
      type: 'text',
    },
    {
      key: 'proveedor',
      label: 'Proveedor',
      accessor: r => r.proveedores?.nombre ?? '',
      render: r => r.proveedores?.nombre ?? <span className="text-gray-300">—</span>,
      type: 'text',
      className: 'hidden md:table-cell',
    },
    {
      // TIPOS-GASTO: columna analítica en recurrentes.
      key: 'tipo_gasto',
      label: 'Tipo',
      accessor: r => r.tipos_gasto?.codigo ?? '',
      render: r => r.tipos_gasto
        ? <span className="inline-flex rounded px-1.5 py-0.5 text-xs font-medium bg-slate-100 text-slate-700" title={r.tipos_gasto.nombre}>{r.tipos_gasto.codigo}</span>
        : <span className="text-gray-300">—</span>,
      type: 'enum',
      enumOptions: effectiveTipos.map(t => ({ value: t.codigo, label: `${t.codigo} — ${t.nombre}` })),
      className: 'hidden sm:table-cell',
    },
    {
      key: 'dia',
      label: 'Día',
      accessor: r => r.dia_vencimiento,
      type: 'number',
      align: 'center',
    },
    {
      key: 'monto',
      label: 'Monto',
      accessor: r => r.monto,
      render: r => <span className="whitespace-nowrap font-medium text-gray-900">{formatMonto(r.monto, r.moneda)}</span>,
      type: 'number',
      align: 'right',
    },
    {
      key: 'estado',
      label: 'Estado',
      accessor: r => (r.activo ? 'activo' : 'inactivo'),
      render: r => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${r.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {r.activo ? 'Activo' : 'Inactivo'}
        </span>
      ),
      type: 'enum',
      enumOptions: [
        { value: 'activo', label: 'Activo' },
        { value: 'inactivo', label: 'Inactivo' },
      ],
      className: 'hidden lg:table-cell',
    },
  ], [recurrentesGeneradosEsteMes, periodoActual])

  // Pagos por gasto_id (incluye todos los estados; el caller decide filtrar)
  const pagosPorGastoId = new Map<string, PagoDeGasto[]>()
  for (const p of pagosDeGastos) {
    if (!p.gasto_id) continue
    const arr = pagosPorGastoId.get(p.gasto_id)
    if (arr) arr.push(p)
    else pagosPorGastoId.set(p.gasto_id, [p])
  }

  // Suma de pagos CONFIRMADOS por gasto. Usado para badge "Pagado parcial".
  function totalPagadoDeGasto(gastoId: string): number {
    const pgs = pagosPorGastoId.get(gastoId) ?? []
    return pgs.filter(p => p.estado === 'pagado').reduce((s, p) => s + Number(p.monto), 0)
  }

  // Estado visual del gasto: usa el real de DB salvo que detectemos pago parcial computado.
  function estadoUI(g: GastoRow): { label: string; cls: string } {
    if (g.estado === 'aprobado') {
      const pagado = totalPagadoDeGasto(g.id)
      const total = Number(g.monto)
      if (pagado > 0 && pagado < total - 0.01) {
        return { label: 'Pagado parcial', cls: 'bg-cyan-100 text-cyan-700' }
      }
    }
    return { label: ESTADO_LABELS[g.estado], cls: ESTADO_COLORS[g.estado] }
  }

  const inputCls =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20'

  // Proveedor actualmente seleccionado en el form (memoizado para evitar re-cómputo).
  // Necesario para decidir si el modal muestra el checkbox "Cargar como servicio
  // por hora" y para snapshotear valor_hora/uplift al guardar.
  const proveedorEnForm: ProveedorParaGasto | null = useMemo(() => {
    if (!form.proveedor_id) return null
    return effectiveProveedores.find(p => p.id === form.proveedor_id) ?? null
  }, [form.proveedor_id, effectiveProveedores])

  // El proveedor permite horas: condición para mostrar el checkbox opt-in.
  const proveedorPermiteHoras = !!proveedorEnForm?.permite_horas_servicio

  // Checkbox visible solo en modo Gasto y cuando el proveedor permite horas.
  // El usuario decide por cada gasto si lo carga como servicio o como gasto común.
  const mostrarCheckboxServicio = !isRecurrenteMode && proveedorPermiteHoras

  // Bloque "Detalle del servicio" visible solo si el checkbox está activo.
  const mostrarBloqueServicio = mostrarCheckboxServicio && form.usar_servicio_horas

  // Cambio de proveedor: si el nuevo no permite horas, limpiar el toggle y los
  // campos snapshot (evita inconsistencias al guardar). Si permite horas pero
  // antes había marcado el toggle con otro proveedor, conservamos el toggle.
  function handleProveedorChange(nuevoId: string) {
    const nuevo = nuevoId ? effectiveProveedores.find(p => p.id === nuevoId) : null
    const nuevoPermiteHoras = !!nuevo?.permite_horas_servicio
    setForm(prev => ({
      ...prev,
      proveedor_id: nuevoId,
      ...(nuevoPermiteHoras
        ? {}
        : {
            usar_servicio_horas: false,
            descripcion_servicio: '',
            periodo_servicio_desde: '',
            periodo_servicio_hasta: '',
            horas_servicio: '',
          }),
    }))
  }

  // Monto calculado en vivo cuando es servicio por hora.
  const montoCalculadoServicio: number = useMemo(() => {
    if (!mostrarBloqueServicio || !proveedorEnForm) return 0
    const horas = parseFloat(form.horas_servicio.replace(',', '.'))
    if (!Number.isFinite(horas) || horas <= 0) return 0
    const valor = Number(proveedorEnForm.valor_hora) || 0
    return Math.round(horas * valor * 100) / 100
  }, [mostrarBloqueServicio, proveedorEnForm, form.horas_servicio])

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ─── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('gastos')}
          className={[
            'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
            activeTab === 'gastos'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-gray-500 hover:text-gray-700',
          ].join(' ')}
        >
          Gastos
          <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-xs tabular-nums text-gray-600">
            {gastos.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('recurrentes')}
          className={[
            'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
            activeTab === 'recurrentes'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-gray-500 hover:text-gray-700',
          ].join(' ')}
        >
          Recurrentes
          <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-xs tabular-nums text-gray-600">
            {recurrentes.length}
          </span>
        </button>
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {/* ─── Tab: Gastos ─────────────────────────────────────────────────────── */}
      {activeTab === 'gastos' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <input
              type="text"
              value={searchGastos}
              onChange={(e) => setSearchGastos(e.target.value)}
              placeholder="Buscar por código, concepto, fondo o proveedor..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 sm:max-w-sm"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportGastos}
                disabled={filteredGastosBase.length === 0}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                Exportar Excel
              </button>
              {canWrite && (
                <button
                  onClick={() => openNew('gasto')}
                  disabled={isPending}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  + Nuevo gasto
                </button>
              )}
            </div>
          </div>

          {/* Feedback de última acción masiva — externo al DataTable */}
          {bulkMessage && (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                bulkMessage.isError
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-800'
              }`}
            >
              {bulkMessage.text}
              <button
                type="button"
                onClick={() => setBulkMessage(null)}
                className="ml-2 text-xs underline hover:no-underline"
              >
                Cerrar
              </button>
            </div>
          )}

          <DataTable<GastoRow>
            rows={filteredGastosBase}
            getRowId={g => g.id}
            selectable={canWrite}
            initialSort={{ key: 'fecha', dir: 'desc' }}
            emptyMessage={searchGastos ? 'Sin resultados para esa búsqueda.' : 'No hay gastos registrados.'}
            onVisibleRowsChange={setVisibleGastos}
            columns={gastosColumns}
            rowActions={(canWrite || canApprove) ? (g) => {
              // GASTOS-UX-2: dropdown único con acciones aplicables según
              // estado, rol y pagos asociados. Reglas server-side intactas.
              const pagosDelGasto = pagosPorGastoId.get(g.id) ?? []
              const pagosActivos = pagosDelGasto.filter(p => p.estado !== 'anulado').length
              const pagosTotal   = pagosDelGasto.length
              const sinPagosActivos = pagosActivos === 0
              const sinPagosAlguna  = pagosTotal === 0
              const items: RowActionItem[] = []
              let tooltipBloqueo: string | undefined

              if (g.estado === 'borrador' || g.estado === 'enviado') {
                if (canApprove && g.estado === 'enviado') {
                  items.push({ label: 'Aprobar', variant: 'primary', onClick: () => handleCambiarEstado(g.id, 'aprobado') })
                }
                if (canWrite) items.push({ label: 'Editar', onClick: () => openEditGasto(g) })
                if (canWrite && g.estado === 'borrador') {
                  items.push({ label: 'Enviar', variant: 'primary', onClick: () => handleCambiarEstado(g.id, 'enviado') })
                }
                if (canApprove) items.push({ label: 'Cancelar', variant: 'danger', onClick: () => handleCambiarEstado(g.id, 'rechazado') })
                if (canDelete && sinPagosAlguna) {
                  items.push({ label: 'Eliminar', variant: 'danger', onClick: () => handleDeleteGasto(g.id, g.descripcion) })
                }
              } else if (g.estado === 'aprobado') {
                if (sinPagosActivos) {
                  if (canWrite) items.push({ label: 'Editar', onClick: () => openEditGasto(g) })
                  if (canApprove) items.push({ label: 'Cancelar', variant: 'danger', onClick: () => handleCambiarEstado(g.id, 'rechazado') })
                  // "Volver a pendiente" requiere la migración SQL
                  // 20260524000001 (fn_gastos_validar_estado extendido para
                  // permitir aprobado→enviado). Hasta aplicarla, el click
                  // mostrará el error del trigger.
                  if (canApprove) items.push({ label: 'Volver a pendiente', onClick: () => handleCambiarEstado(g.id, 'enviado') })
                  if (canDelete && sinPagosAlguna) {
                    items.push({ label: 'Eliminar', variant: 'danger', onClick: () => handleDeleteGasto(g.id, g.descripcion) })
                  }
                } else {
                  tooltipBloqueo = 'Tiene pagos asociados. Anulá los pagos primero.'
                }
              } else if (g.estado === 'pagado_parcial' || g.estado === 'pagado') {
                tooltipBloqueo = 'Anulá el pago desde /pagos.'
              }
              // rechazado: sin items ni tooltip
              return <RowActionMenu items={items} emptyTooltip={tooltipBloqueo} />
            } : undefined}
            bulkActions={canWrite ? (selectedIds, clear) => {
              const ids = Array.from(selectedIds)
              return (
                <>
                  <button
                    type="button"
                    onClick={() => runBulk(ids, onBulkAprobar, 'autorizado(s)', clear)}
                    disabled={isPending}
                    className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 transition-colors disabled:opacity-50"
                  >
                    Autorizar seleccionados
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm(`¿Cancelar ${ids.length} gasto(s)? Quedarán en estado "rechazado".`)) return
                      runBulk(ids, onBulkRechazar, 'cancelado(s)', clear)
                    }}
                    disabled={isPending}
                    className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-50"
                  >
                    Cancelar seleccionados
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!confirm(`¿Eliminar ${ids.length} gasto(s)? Solo se eliminarán los que no tengan pagos asociados.`)) return
                        runBulk(ids, onBulkDelete, 'eliminado(s)', clear)
                      }}
                      disabled={isPending}
                      className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      Eliminar seleccionados
                    </button>
                  )}
                </>
              )
            } : undefined}
          />
        </div>
      )}

      {/* ─── Tab: Recurrentes ────────────────────────────────────────────────── */}
      {activeTab === 'recurrentes' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <input
              type="text"
              value={searchRecurrentes}
              onChange={(e) => setSearchRecurrentes(e.target.value)}
              placeholder="Buscar por concepto, fondo, proveedor o categoría..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 sm:max-w-sm"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportRecurrentes}
                disabled={filteredRecurrentesBase.length === 0}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                Exportar Excel
              </button>
              {canWrite && (
                <button
                  onClick={() => openNew('recurrente')}
                  disabled={isPending}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  + Nuevo recurrente
                </button>
              )}
            </div>
          </div>

          <DataTable<GastoRecurrenteRow>
            rows={filteredRecurrentesBase}
            getRowId={r => r.id}
            initialSort={{ key: 'concepto', dir: 'asc' }}
            emptyMessage={searchRecurrentes ? 'Sin resultados para esa búsqueda.' : 'No hay gastos recurrentes configurados.'}
            onVisibleRowsChange={setVisibleRecurrentes}
            columns={recurrentesColumns}
            rowActions={(canWrite || canDelete) ? (r) => (
              <>
                {canWrite && (
                  <button onClick={() => openEditRecurrente(r)} disabled={isPending} className="rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50">
                    Editar
                  </button>
                )}
                {canWrite && (
                  <button
                    onClick={() => handleToggleActivo(r)}
                    disabled={isPending}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${r.activo ? 'text-amber-700 hover:bg-amber-50' : 'text-green-700 hover:bg-green-50'}`}
                  >
                    {r.activo ? 'Desactivar' : 'Activar'}
                  </button>
                )}
                {canDelete && (
                  <button onClick={() => handleDeleteRecurrente(r.id, r.concepto)} disabled={isPending} className="rounded px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
                    Eliminar
                  </button>
                )}
              </>
            ) : undefined}
          />
        </div>
      )}

      {/* ─── Modal ───────────────────────────────────────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              {isEditing
                ? editing?.tipo === 'recurrente' ? 'Editar gasto recurrente' : 'Editar gasto'
                : isRecurrenteMode ? 'Nuevo gasto recurrente' : 'Nuevo gasto'}
            </h2>

            {/* Checkbox "Es recurrente" — solo en modo creación */}
            {!isEditing && (
              <div className="mb-5 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.es_recurrente}
                    onChange={(e) => handleEsRecurrenteToggle(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
                  />
                  <span className="text-sm font-medium text-gray-700">Es gasto recurrente</span>
                  <span className="text-xs text-gray-400">(plantilla mensual, no genera gasto inmediato)</span>
                </label>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">

              {/* G1: fondo siempre RISA — sin selector. Display informativo. */}
              {fondoRisa ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Fondo operativo: <span className="font-medium text-slate-800">{fondoRisa.codigo ?? 'FON-001'} — {fondoRisa.nombre}</span>
                </div>
              ) : (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  No se encontró el fondo operativo RISA. No se puede crear ni editar gastos hasta que esté disponible.
                </div>
              )}

              {/* Campos comunes */}
              <div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Proveedor</label>
                  <div className="flex gap-2">
                    <select
                      value={form.proveedor_id}
                      onChange={(e) => handleProveedorChange(e.target.value)}
                      className={`${inputCls} flex-1`}
                    >
                      <option value="">Sin proveedor</option>
                      {effectiveProveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                    {canWrite && (
                      <button
                        type="button"
                        onClick={openQuickProv}
                        title="Crear proveedor nuevo sin salir del formulario"
                        className="flex-shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                      >
                        + Crear
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* TIPOS-GASTO: select Tipo de gasto + alta inline (solo modal gasto). */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Tipo de gasto <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.tipo_gasto_id}
                  onChange={(e) => handleTipoGastoSelectChange(e.target.value)}
                  className={inputCls}
                >
                  {effectiveTipos.length === 0 && <option value="">— sin tipos cargados —</option>}
                  {effectiveTipos.map(t => (
                    <option key={t.id} value={t.id}>{t.codigo} — {t.nombre}</option>
                  ))}
                  {canWrite && (
                    <option value="__NEW__">+ Nuevo tipo de gasto…</option>
                  )}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Concepto <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.descripcion}
                  onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className={inputCls}
                  placeholder={isRecurrenteMode ? 'Ej: Alquiler oficina, Servicio eléctrico' : 'Descripción del gasto'}
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Monto <span className="text-red-500">*</span>
                  </label>
                  {mostrarBloqueServicio ? (
                    <input
                      type="text"
                      value={montoCalculadoServicio > 0
                        ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: form.moneda === 'USD' ? 'USD' : 'ARS', minimumFractionDigits: 2 }).format(montoCalculadoServicio)
                        : '—'
                      }
                      readOnly
                      tabIndex={-1}
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm tabular-nums text-gray-700 cursor-default"
                      title="Calculado en vivo: horas × valor hora"
                    />
                  ) : (
                    <input type="number" min="0.01" step="0.01" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} className={inputCls} placeholder="0.00" />
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Moneda</label>
                  <input type="text" value={form.moneda} readOnly className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 outline-none cursor-default" placeholder="Se completa con el fondo" />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Prioridad</label>
                <select value={form.prioridad_pago} onChange={(e) => setForm({ ...form, prioridad_pago: e.target.value })} className={inputCls}>
                  <option value="1">1 — Crítica</option>
                  <option value="2">2 — Alta</option>
                  <option value="3">3 — Normal</option>
                  <option value="4">4 — Baja</option>
                </select>
              </div>

              {/* ─── Campos exclusivos: Gasto ─────────────────────────────── */}
              {!isRecurrenteMode && (
                <>
                  {/* Pagos asociados — solo en edit de gasto, no en borrador */}
                  {editingGastoLatest && editingGastoLatest.estado !== 'borrador' && (() => {
                    const pagosDelGasto = pagosPorGastoId.get(editingGastoLatest.id) ?? []
                    const totalPagado = pagosDelGasto.filter(p => p.estado === 'pagado').reduce((s, p) => s + Number(p.monto), 0)
                    const totalGasto = Number(editingGastoLatest.monto)
                    const saldo = totalGasto - totalPagado
                    return (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                        <p className="text-sm font-medium text-gray-700">Pagos asociados</p>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="text-center">
                            <p className="text-xs text-gray-500">Total</p>
                            <p className="text-sm font-semibold text-gray-900">{formatMonto(totalGasto, editingGastoLatest.moneda)}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-xs text-gray-500">Pagado</p>
                            <p className="text-sm font-semibold text-emerald-700">{formatMonto(totalPagado, editingGastoLatest.moneda)}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-xs text-gray-500">Saldo</p>
                            <p className={`text-sm font-semibold ${saldo > 0.01 ? 'text-amber-700' : 'text-gray-500'}`}>{formatMonto(Math.max(0, saldo), editingGastoLatest.moneda)}</p>
                          </div>
                        </div>
                        {pagosDelGasto.length > 0 && (
                          <ul className="text-xs space-y-1 border-t border-gray-200 pt-2">
                            {pagosDelGasto.map(p => (
                              <li key={p.id} className="flex justify-between gap-2">
                                <span className="text-gray-600 truncate">
                                  {p.fecha_pago} · {p.tipo} · <span className="font-mono">{p.nro_pago}</span>
                                </span>
                                <span className={`whitespace-nowrap font-medium ${p.estado === 'pagado' ? 'text-emerald-700' : p.estado === 'anulado' ? 'text-gray-400 line-through' : 'text-gray-500'}`}>
                                  {formatMonto(Number(p.monto), p.moneda)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <a
                          href="/pagos"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block text-xs text-blue-700 hover:underline"
                        >
                          Ver / agregar pagos en módulo Pagos →
                        </a>
                      </div>
                    )
                  })()}

                  {/* Origen recurrente — solo en edición de gasto auto-generado */}
                  {editingGastoLatest?.recurrente_id && (() => {
                    const origen = recurrentes.find(r => r.id === editingGastoLatest.recurrente_id)
                    return (
                      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs space-y-0.5">
                        <p className="font-semibold text-indigo-800">Generado automáticamente desde recurrente</p>
                        {origen ? (
                          <>
                            <p className="text-indigo-700">Concepto plantilla: <span className="font-medium">{origen.concepto}</span></p>
                            <p className="text-indigo-700">Día vencimiento plantilla: <span className="font-medium">{origen.dia_vencimiento}</span></p>
                          </>
                        ) : (
                          <p className="text-indigo-700 italic">Plantilla original eliminada o sin acceso.</p>
                        )}
                        <p className="text-indigo-700">Período: <span className="font-medium">{editingGastoLatest.periodo ?? '—'}</span></p>
                      </div>
                    )
                  })()}

                  {/* P3a: checkbox opt-in solo si el proveedor permite horas.
                       El usuario decide gasto por gasto si lo carga como servicio. */}
                  {mostrarCheckboxServicio && (
                    <div className="rounded-lg border border-amber-100 bg-amber-50/30 p-3 space-y-1">
                      <label className="flex cursor-pointer items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.usar_servicio_horas}
                          onChange={(e) => setForm(prev => ({
                            ...prev,
                            usar_servicio_horas: e.target.checked,
                            // Si desactiva, limpiar campos para evitar enviar valores residuales.
                            ...(e.target.checked ? {} : {
                              descripcion_servicio: '',
                              periodo_servicio_desde: '',
                              periodo_servicio_hasta: '',
                              horas_servicio: '',
                            }),
                          }))}
                          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                        />
                        <span>
                          <span className="font-medium text-gray-800">Cargar este gasto como servicio por hora</span>
                          <span className="block text-xs text-gray-500">
                            Este proveedor permite carga por horas. Activá esta opción solo si este gasto corresponde a horas de servicio.
                          </span>
                        </span>
                      </label>
                    </div>
                  )}

                  {/* P3a: bloque "Detalle del servicio" solo si el checkbox está activo */}
                  {mostrarBloqueServicio && proveedorEnForm && (
                    <DetalleServicioBlock
                      mode="gasto"
                      valorHoraProveedor={Number(proveedorEnForm.valor_hora) || 0}
                      porcentajeUpliftProveedor={proveedorEnForm.tiene_uplift ? Number(proveedorEnForm.porcentaje_uplift) || 0 : 0}
                      descripcion={form.descripcion_servicio}
                      horas={form.horas_servicio}
                      periodoDesde={form.periodo_servicio_desde}
                      periodoHasta={form.periodo_servicio_hasta}
                      onChange={(partial) => setForm(prev => ({
                        ...prev,
                        ...(partial.descripcion !== undefined && { descripcion_servicio: partial.descripcion }),
                        ...(partial.horas !== undefined && { horas_servicio: partial.horas }),
                        ...(partial.periodoDesde !== undefined && { periodo_servicio_desde: partial.periodoDesde }),
                        ...(partial.periodoHasta !== undefined && { periodo_servicio_hasta: partial.periodoHasta }),
                      }))}
                    />
                  )}

                  {/* P3a-fc: canal de pago — Medios propios RISA vs Tercero de la red.
                       Internamente: forma_cancelacion='risa' o 'financiador'; financiador_id FK opcional. */}
                  <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                    <p className="text-sm font-semibold text-gray-800">Canal de pago</p>
                    <div className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-6">
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          type="radio"
                          name="canal_pago"
                          value="medios_propios"
                          checked={!form.es_financiado}
                          onChange={() => setForm(prev => ({ ...prev, es_financiado: false, financiador_id: '' }))}
                          className="mt-0.5 h-4 w-4 border-gray-300 text-slate-900 focus:ring-slate-500"
                        />
                        <span className="font-medium text-gray-800">Medios propios RISA</span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          type="radio"
                          name="canal_pago"
                          value="tercero"
                          checked={form.es_financiado}
                          onChange={() => setForm(prev => ({ ...prev, es_financiado: true }))}
                          className="mt-0.5 h-4 w-4 border-gray-300 text-slate-900 focus:ring-slate-500"
                        />
                        <span className="font-medium text-gray-800">Tercero de la red</span>
                      </label>
                    </div>

                    {!form.es_financiado && (
                      <p className="text-xs text-gray-500">
                        El pago se registrará contra medios propios RISA.
                      </p>
                    )}

                    {form.es_financiado && (
                      <div className="space-y-1 pt-1">
                        <label className="block text-xs font-medium text-gray-700">
                          Tercero que afronta el pago <span className="text-red-500">*</span>
                        </label>
                        {effectiveFinanciadores.length === 0 ? (
                          <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                            No hay terceros cargados.
                            {canWrite && (
                              <>
                                {' '}
                                <button
                                  type="button"
                                  onClick={() => setQuickFinanOpen(true)}
                                  className="underline hover:no-underline font-medium"
                                >
                                  Crear uno
                                </button>
                                .
                              </>
                            )}
                          </div>
                        ) : (
                          <FinanciadorSelect
                            financiadores={effectiveFinanciadores}
                            value={form.financiador_id}
                            onChange={(id) => setForm(prev => ({ ...prev, financiador_id: id }))}
                            onRequestCreate={canWrite ? () => setQuickFinanOpen(true) : undefined}
                          />
                        )}
                        <p className="text-xs text-gray-500">
                          El gasto será pagado por un tercero de la red. PdeP/RISA registrará una cuenta corriente pendiente de reintegro con ese tercero.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Fecha <span className="text-red-500">*</span>
                      </label>
                      <input type="date" value={form.fecha_gasto} onChange={(e) => setForm({ ...form, fecha_gasto: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Fecha de vencimiento</label>
                      <input type="date" value={form.fecha_vencimiento} onChange={(e) => setForm({ ...form, fecha_vencimiento: e.target.value })} className={inputCls} />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Observaciones</label>
                    <textarea value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} rows={2} className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20" placeholder="Notas internas opcionales" />
                  </div>

                  <div className="rounded-lg border border-gray-200 p-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.tiene_anticipo}
                        onChange={(e) => setForm({ ...form, tiene_anticipo: e.target.checked, monto_anticipo: '', fecha_prevista_pago_anticipo: '', fecha_comprometida_pago_saldo: '', condiciones_pago_notas: '' })}
                        className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
                      />
                      <span className="text-sm font-medium text-gray-700">Requiere anticipo</span>
                    </label>

                    {form.tiene_anticipo && (
                      <div className="mt-3 space-y-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Monto anticipo <span className="text-red-500">*</span>
                            </label>
                            <input type="number" min="0.01" step="0.01" value={form.monto_anticipo} onChange={(e) => setForm({ ...form, monto_anticipo: e.target.value })} className={inputCls} placeholder="0.00" />
                            {form.monto && form.monto_anticipo && !isNaN(parseFloat(form.monto_anticipo)) && parseFloat(form.monto) > 0 && (
                              <p className="mt-0.5 text-xs text-gray-400">
                                {Math.round((parseFloat(form.monto_anticipo) / parseFloat(form.monto)) * 10000) / 100}% del total
                              </p>
                            )}
                          </div>
                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">Fecha prevista pago anticipo</label>
                            <input type="date" value={form.fecha_prevista_pago_anticipo} onChange={(e) => setForm({ ...form, fecha_prevista_pago_anticipo: e.target.value })} className={inputCls} />
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">Fecha comprometida pago saldo</label>
                          <input type="date" value={form.fecha_comprometida_pago_saldo} onChange={(e) => setForm({ ...form, fecha_comprometida_pago_saldo: e.target.value })} className={inputCls} />
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">Condiciones de pago</label>
                          <textarea value={form.condiciones_pago_notas} onChange={(e) => setForm({ ...form, condiciones_pago_notas: e.target.value })} rows={2} className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20" placeholder="Condiciones acordadas con el proveedor" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ─── Comprobante (modo crear nuevo gasto) ──────────────── */}
                  {!editing && (
                    <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                      <label className="block text-sm font-medium text-gray-700">Comprobante (opcional)</label>
                      {pendingComprobante ? (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-gray-900 truncate">{pendingComprobante.name}</p>
                            <p className="text-xs text-gray-400">{formatBytes(pendingComprobante.size)}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setPendingComprobante(null)}
                            disabled={isPending}
                            className="rounded px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                          >
                            Quitar
                          </button>
                        </div>
                      ) : (
                        <label className={`block rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 transition-colors ${isPending ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                          Adjuntar archivo (PDF, JPG, PNG, WEBP — max 10 MB)
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                            className="hidden"
                            disabled={isPending}
                            onChange={(e) => {
                              const f = e.target.files?.[0]
                              e.target.value = ''
                              if (!f) return
                              if (!/\.(pdf|jpe?g|png|webp)$/i.test(f.name)) {
                                setComprobanteError('Extensión no permitida. Aceptados: PDF, JPG, JPEG, PNG, WEBP.')
                                return
                              }
                              if (f.size > 10 * 1024 * 1024) {
                                setComprobanteError('Archivo supera 10 MB.')
                                return
                              }
                              setComprobanteError('')
                              setPendingComprobante(f)
                            }}
                          />
                        </label>
                      )}
                      {comprobanteError && (
                        <p className="text-xs text-red-600">{comprobanteError}</p>
                      )}
                    </div>
                  )}

                  {/* ─── Comprobante (solo edit de gasto en borrador) ──────── */}
                  {editingGastoLatest && !['pagado', 'rechazado'].includes(editingGastoLatest.estado) && (
                    <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                      <label className="block text-sm font-medium text-gray-700">Comprobante</label>
                      {editingGastoLatest.comprobante_path && editingGastoLatest.comprobante_nombre ? (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-gray-900 truncate">{editingGastoLatest.comprobante_nombre}</p>
                            <p className="text-xs text-gray-400">{formatBytes(editingGastoLatest.comprobante_size_bytes ?? 0)}</p>
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => handleViewComprobante(editingGastoLatest.comprobante_path!)}
                              className="rounded px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 transition-colors"
                            >
                              Ver
                            </button>
                            <label className={`rounded px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors ${comprobanteUploading || isPending ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                              {comprobanteUploading ? 'Subiendo...' : 'Reemplazar'}
                              <input
                                type="file"
                                accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                                className="hidden"
                                disabled={comprobanteUploading || isPending}
                                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleUploadComprobante(f) }}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={handleRemoveComprobante}
                              disabled={isPending || comprobanteUploading}
                              className="rounded px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                            >
                              Quitar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label className={`block rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 transition-colors ${comprobanteUploading || isPending ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                          {comprobanteUploading ? 'Subiendo...' : 'Adjuntar archivo (PDF, JPG, PNG, WEBP — max 10 MB)'}
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                            className="hidden"
                            disabled={comprobanteUploading || isPending}
                            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleUploadComprobante(f) }}
                          />
                        </label>
                      )}
                      {comprobanteError && (
                        <p className="text-xs text-red-600">{comprobanteError}</p>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* ─── Campos exclusivos: Recurrente ────────────────────────── */}
              {/* TIPOS-GASTO (2026-05-25): el campo Categoría libre fue
                  reemplazado por el select Tipo de gasto (ya renderizado
                  arriba con los demás campos comunes). */}
              {isRecurrenteMode && (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Día vencimiento <span className="text-red-500">*</span>
                      </label>
                      <input type="number" min="1" max="28" value={form.dia_vencimiento} onChange={(e) => setForm({ ...form, dia_vencimiento: e.target.value })} className={inputCls} />
                      <p className="mt-0.5 text-xs text-gray-400">1–28</p>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Fecha inicio <span className="text-red-500">*</span>
                      </label>
                      <input type="date" value={form.fecha_inicio} onChange={(e) => setForm({ ...form, fecha_inicio: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Fecha fin</label>
                      <input type="date" value={form.fecha_fin} onChange={(e) => setForm({ ...form, fecha_fin: e.target.value })} className={inputCls} />
                    </div>
                  </div>

                  <div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500" />
                      <span className="text-sm font-medium text-gray-700">Activo</span>
                    </label>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Observaciones</label>
                    <textarea value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} rows={2} className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20" placeholder="Notas internas opcionales" />
                  </div>
                </>
              )}

              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {formError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} disabled={isPending} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50">
                  Cancelar
                </button>
                <button type="submit" disabled={isPending} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
                  {isPending
                    ? 'Guardando...'
                    : isEditing
                    ? 'Guardar cambios'
                    : isRecurrenteMode ? 'Crear recurrente' : 'Crear gasto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* P3a-fc: Modal Quick Crear Financiador — sibling overlay sobre el modal de gasto */}
      <FinanciadorQuickCreateModal
        open={quickFinanOpen}
        onClose={() => setQuickFinanOpen(false)}
        onCreate={onCrearFinanciador}
        onCreated={handleFinanciadorCreated}
      />

      {/* TIPOS-GASTO: Modal Quick Crear Tipo de gasto */}
      <TipoGastoQuickCreateModal
        open={quickTipoOpen}
        onClose={() => setQuickTipoOpen(false)}
        onCreate={onCrearTipoGasto}
        onCreated={handleTipoGastoCreated}
      />

      {/* Modal Quick Crear Proveedor — sibling overlay sobre el modal de gasto */}
      {quickProvOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="mb-1 text-lg font-semibold text-gray-900">Crear proveedor</h2>
            <p className="mb-4 text-xs text-gray-500">Quedará seleccionado en el gasto al guardar.</p>
            <form onSubmit={handleQuickProvSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Nombre / Razón social <span className="text-red-500">*</span>
                </label>
                <input type="text" value={qpNombre} onChange={e => setQpNombre(e.target.value)} className={inputCls} autoFocus />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">CUIT</label>
                <input type="text" value={qpCuit} onChange={e => setQpCuit(e.target.value)} className={inputCls} placeholder="opcional" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
                <input type="email" value={qpEmail} onChange={e => setQpEmail(e.target.value)} className={inputCls} placeholder="opcional" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Teléfono</label>
                <input type="text" value={qpTelefono} onChange={e => setQpTelefono(e.target.value)} className={inputCls} placeholder="opcional" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Observaciones</label>
                <textarea value={qpObs} onChange={e => setQpObs(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20" placeholder="opcional" />
              </div>
              {qpError && <p className="text-sm text-red-700">{qpError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setQuickProvOpen(false)} disabled={qpSubmitting} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={qpSubmitting} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
                  {qpSubmitting ? 'Creando...' : 'Crear proveedor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
