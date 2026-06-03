'use client'

import { useState, useTransition, useMemo } from 'react'
import type { UserRole, PagoEstado, PagoTipo, ObligacionPendiente, ObligacionTipo, OrdenPagoEstado } from '@/types'
import type { PagoPayload } from './actions'
import { exportToExcel, todayForFile } from '@/lib/excel'
import DataTable, { type Column } from '@/components/DataTable'
import RowActionMenu, { type RowActionItem } from '@/components/RowActionMenu'

// OP (2026-05-25): proyección mínima de la OP para mostrar codigo+estado en la
// fila del pago y habilitar "Ver OP". El detalle completo vive en
// /ordenes-pago/[codigo].
export interface OrdenPagoLite {
  id: string
  codigo: string
  pago_id: string
  estado: OrdenPagoEstado
}

export interface PagoRow {
  id: string
  codigo: string | null  // P000001... generado por trigger DB; null si la migración no se aplicó
  nro_pago: string
  fondo_id: string
  proveedor_id: string
  gasto_id: string | null
  anticipo_id: string | null
  gasto_recurrente_id: string | null
  tipo: PagoTipo
  concepto: string
  monto: number
  moneda: string
  fecha_pago: string
  comprobante_url: string | null
  estado: PagoEstado
  notas: string | null
  created_by: string
  anulado_por: string | null
  anulado_en: string | null
  created_at: string
  fondos: { nombre: string; moneda: string } | null
  proveedores: { nombre: string } | null
  // P4c.2: gasto joined trae info del canal de pago y monto original.
  gastos: {
    descripcion: string
    codigo: string | null
    monto: number
    forma_cancelacion: 'risa' | 'financiador'
    financiador_id: string | null
    financiadores: { codigo: string | null; nombre: string } | null
  } | null
  anticipos: { concepto: string } | null
}

// P4c.2: info de gastos vinculados a obligaciones, usada en el modal Registrar
// pago para mostrar canal de pago en el bloque "Resumen de obligación".
export interface GastoInfo {
  id: string
  codigo: string | null
  descripcion: string
  monto: number
  forma_cancelacion: 'risa' | 'financiador'
  financiador_id: string | null
  financiadores: { codigo: string | null; nombre: string } | null
}

// UiTipo: parte de obligación inferida desde la obligación seleccionada.
// Se conserva para mapear a pagos.tipo (enum DB). El usuario ya NO la elige
// manualmente desde el modal (P4c.2).
type UiTipo = 'anticipo' | 'saldo' | 'parcial' | 'final' | 'recurrente' | 'directo'

// P4c.2: modalidad de pago elegida explícitamente por el usuario.
// Total = saldo pendiente. Parcial = importe libre <= saldo pendiente.
type ModalidadPago = 'total' | 'parcial'

interface Props {
  pagos: PagoRow[]
  fondos: { id: string; nombre: string; moneda: string }[]
  proveedores: { id: string; nombre: string }[]
  obligaciones: ObligacionPendiente[]
  gastosInfo: GastoInfo[]
  // OP: array de OPs (un mapa pago_id → OP se construye en cliente).
  ordenesPago: OrdenPagoLite[]
  role: UserRole
  // PAGOS-UX (2026-05-25): unico camino para crear pagos. El UI ya no
  // tiene flujo "borrador → confirmar".
  onCreatePagoYConfirmar: (data: PagoPayload) => Promise<{ ok: true } | { ok: false; error: string }>
  onAnularPago: (id: string) => Promise<void>
}

interface FormState {
  ui_tipo: UiTipo
  modalidad: ModalidadPago
  obligacion_id: string
  fondo_id: string
  proveedor_id: string
  gasto_id: string
  gasto_recurrente_id: string
  anticipo_id: string
  concepto: string
  monto: string
  moneda: string
  fecha_pago: string
  comprobante_url: string
  notas: string
}

const EMPTY_FORM: FormState = {
  ui_tipo: 'final',
  modalidad: 'total',
  obligacion_id: '',
  fondo_id: '',
  proveedor_id: '',
  gasto_id: '',
  gasto_recurrente_id: '',
  anticipo_id: '',
  concepto: '',
  monto: '',
  moneda: '',
  fecha_pago: new Date().toISOString().slice(0, 10),
  comprobante_url: '',
  notas: '',
}

// UX-PAGOS: labels cortos. La columna Tipo dice qué se paga; la columna Pago
// dice si fue Total/Parcial/—. No duplicar la palabra "Pago" en el label.
const TIPO_LABELS: Record<PagoTipo, string> = {
  directo: 'Directo',
  gasto: 'Gasto',
  anticipo: 'Anticipo',
  saldo_anticipo: 'Saldo',
  recurrente: 'Recurrente',
}

const TIPO_COLORS: Record<PagoTipo, string> = {
  directo: 'bg-slate-100 text-slate-600',
  gasto: 'bg-blue-100 text-blue-700',
  anticipo: 'bg-purple-100 text-purple-700',
  saldo_anticipo: 'bg-orange-100 text-orange-700',
  recurrente: 'bg-teal-100 text-teal-700',
}

const ESTADO_LABELS: Record<PagoEstado, string> = {
  borrador: 'Borrador',
  pagado: 'Pagado',
  anulado: 'Anulado',
}

const ESTADO_COLORS: Record<PagoEstado, string> = {
  borrador: 'bg-gray-100 text-gray-600',
  pagado: 'bg-emerald-100 text-emerald-700',
  anulado: 'bg-red-100 text-red-700',
}

// UX-1 (2026-05-24): modalidad inferida del histórico del gasto.
// Total   = el pago saldó exactamente el saldo pendiente al momento de pagarse.
// Parcial = el pago fue menor al saldo pendiente al momento.
// Anticipo = pago.tipo === 'anticipo' (independiente del saldo).
// Desconocida = pago sin gasto vinculado o datos insuficientes para inferir.
type Modalidad = 'total' | 'parcial' | 'anticipo' | 'desconocida'

// UX-1b: la columna se llama "Pago" y muestra solo Total / Parcial / —.
// Para tipo='anticipo' mostramos "—" porque la columna Tipo ya indica el origen.
const MODALIDAD_LABELS: Record<Modalidad, string> = {
  total: 'Total',
  parcial: 'Parcial',
  anticipo: '—',
  desconocida: '—',
}

const MODALIDAD_COLORS: Record<Modalidad, string> = {
  total: 'bg-emerald-100 text-emerald-700',
  parcial: 'bg-amber-100 text-amber-800',
  anticipo: 'bg-gray-100 text-gray-400',
  desconocida: 'bg-gray-100 text-gray-400',
}

const OBLIGACION_TIPO_LABELS: Record<ObligacionTipo, string> = {
  gasto_total: 'Gasto',
  anticipo: 'Anticipo',
  saldo: 'Saldo',
  recurrente: 'Recurrente',
}

const OBLIGACION_TIPO_COLORS: Record<ObligacionTipo, string> = {
  gasto_total: 'bg-blue-100 text-blue-700',
  anticipo: 'bg-purple-100 text-purple-700',
  saldo: 'bg-orange-100 text-orange-700',
  recurrente: 'bg-teal-100 text-teal-700',
}

const PRIORIDAD_LABELS: Record<number, string> = { 1: 'Crítica', 2: 'Alta', 3: 'Normal', 4: 'Baja' }
const PRIORIDAD_COLORS: Record<number, string> = {
  1: 'text-red-600 font-semibold',
  2: 'text-amber-600 font-medium',
  3: 'text-gray-500',
  4: 'text-gray-400',
}

function formatMonto(monto: number, moneda: string) {
  const currency = moneda === 'USD' ? 'USD' : moneda === 'EUR' ? 'EUR' : 'ARS'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, minimumFractionDigits: 2 }).format(monto)
}

// PAGOS-UX-3 (2026-05-25): saca prefijos redundantes que Tipo + Pago ya
// expresan. El separador esperado es " — " (en dash con espacios).
// Si el concepto no matchea ningún prefijo conocido, se devuelve tal cual.
const CONCEPTO_PREFIJOS_REDUNDANTES = [
  'Pago total de saldo de gasto — ',
  'Pago parcial de saldo de gasto — ',
  'Pago total de gasto — ',
  'Pago parcial de gasto — ',
  'Anticipo de gasto — ',
]
function cleanConceptoPago(concepto: string): string {
  for (const p of CONCEPTO_PREFIJOS_REDUNDANTES) {
    if (concepto.startsWith(p)) return concepto.slice(p.length).trim()
  }
  return concepto
}

// Mapeo UI → DB. Preservamos los valores del enum PagoTipo existentes
// (anticipo / saldo_anticipo / gasto / recurrente / directo).
// parcial/final son distinciones de UI; en DB se mapean según la obligación.
function resolveDbTipo(uiTipo: UiTipo, obligacionTipo: ObligacionTipo | null): PagoTipo {
  if (uiTipo === 'directo') return 'directo'
  if (uiTipo === 'recurrente') return 'recurrente'
  if (uiTipo === 'anticipo') return 'anticipo'
  if (uiTipo === 'saldo') return 'saldo_anticipo'
  // parcial / final: derivar del tipo de obligación
  if (obligacionTipo === 'anticipo') return 'anticipo'
  if (obligacionTipo === 'saldo') return 'saldo_anticipo'
  if (obligacionTipo === 'recurrente') return 'recurrente'
  return 'gasto'
}

function deriveDbTipoFromObligation(tipo: ObligacionTipo): PagoTipo {
  if (tipo === 'gasto_total') return 'gasto'
  if (tipo === 'anticipo') return 'anticipo'
  if (tipo === 'saldo') return 'saldo_anticipo'
  return 'recurrente'
}

// Mapeo: cuando clickeas "Pagar" en una obligación, qué UI tipo pre-selecciono.
function deriveUiTipoFromObligation(tipo: ObligacionTipo): UiTipo {
  if (tipo === 'anticipo') return 'anticipo'
  if (tipo === 'saldo') return 'saldo'
  if (tipo === 'recurrente') return 'recurrente'
  return 'final' // gasto_total → sugerimos pago final (full pending)
}

// P4c.2: descripción del canal de pago para mostrar en el resumen readonly
// del modal Registrar pago. Usa info del gasto vinculado a la obligación.
// Si el gasto es financiado, muestra "Tercero de la red — FIN-### Nombre".
// Si es RISA (o no hay gasto vinculado, ej. recurrentes), muestra "Medios propios RISA".
function describirCanalPago(gasto: GastoInfo | undefined): string {
  if (gasto?.forma_cancelacion === 'financiador' && gasto.financiadores) {
    const codigo = gasto.financiadores.codigo ?? 'Sin código'
    return `Tercero de la red — ${codigo} — ${gasto.financiadores.nombre}`
  }
  if (gasto?.forma_cancelacion === 'financiador') {
    return 'Tercero de la red'
  }
  return 'Medios propios RISA'
}

// P4c.2: genera el concepto del pago automáticamente desde la obligación
// y la modalidad elegida. Reemplaza la edición manual del campo concepto.
function generarConceptoAuto(
  modalidad: ModalidadPago,
  obligacionTipo: ObligacionTipo,
  gastoCodigo: string | null | undefined,
  conceptoObligacion: string,
): string {
  const ref = gastoCodigo ?? 'gasto'
  const labelParte =
    obligacionTipo === 'anticipo' ? 'Anticipo'
    : obligacionTipo === 'saldo' ? (modalidad === 'parcial' ? 'Pago parcial de saldo' : 'Saldo final')
    : obligacionTipo === 'recurrente' ? (modalidad === 'parcial' ? 'Pago parcial recurrente' : 'Pago recurrente')
    : modalidad === 'parcial' ? 'Pago parcial' : 'Pago total'
  return `${labelParte} de ${ref} — ${conceptoObligacion}`
}

// P4c.2: etiqueta visible en el dropdown de obligaciones. Incluye N° gasto,
// concepto, proveedor, canal de pago y saldo pendiente.
function etiquetaObligacion(
  o: ObligacionPendiente,
  proveedorNombre: string,
  canalLabel: string,
  monto: number,
  moneda: string,
  parte: string,
  gastoCodigo: string | null,
): string {
  const ref = gastoCodigo ?? `[${parte}]`
  const monedaFmt = new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: moneda === 'USD' ? 'USD' : 'ARS', minimumFractionDigits: 2,
  }).format(monto)
  return `${ref} ${o.concepto} — ${proveedorNombre} — ${canalLabel} — Saldo pendiente ${monedaFmt}`
}

export default function PagosClient({
  pagos,
  fondos,
  proveedores,
  obligaciones,
  gastosInfo,
  ordenesPago,
  role,
  onCreatePagoYConfirmar,
  onAnularPago,
}: Props) {
  // OP: lookup pago_id → OrdenPagoLite. Si no existe OP para un pago, el
  // pago.estado != 'pagado' o la migración aún no se aplicó.
  const opPorPagoId = useMemo(() => {
    const m = new Map<string, OrdenPagoLite>()
    for (const op of ordenesPago) m.set(op.pago_id, op)
    return m
  }, [ordenesPago])
  // ── Modal / form state ──────────────────────────────────────────────────────
  // PAGOS-UX (2026-05-25): se eliminó el flujo "borrador → editar → confirmar".
  // El modal siempre crea + confirma vía createPagoYConfirmar. `editing` queda
  // como constante null para que las ramas conditionales del modal siguan
  // tipando — todas se evalúan al camino "alta nueva" en runtime.
  const editing: PagoRow | null = null
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  // P4c.2-fix: true cuando el modal se abre desde un botón "Pagar" de fila
  // (obligación pre-determinada, NO se puede cambiar). false cuando se abre
  // desde el botón "Nuevo pago" general (el usuario debe elegir obligación).
  const [obligacionPreseleccionada, setObligacionPreseleccionada] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [actionError, setActionError] = useState('')
  const [isPending, startTransition] = useTransition()

  // Bulk message para acciones masivas en obligaciones (Confirmar selección).
  const [bulkMessage, setBulkMessage] = useState<{ text: string; isError: boolean } | null>(null)

  const canWrite = role === 'admin' || role === 'contador'
  const isAdmin = role === 'admin'

  // P4c.2: lookup rápido por gasto_id para mostrar canal de pago en el modal
  // (Resumen de obligación) y al renderear pagos en tabla.
  const gastoInfoPorId = useMemo(() => {
    const m = new Map<string, GastoInfo>()
    for (const g of gastosInfo) m.set(g.id, g)
    return m
  }, [gastosInfo])

  // PAGOS-UX: sin filtro por borrador — el SELECT de page.tsx ya los excluye,
  // por lo que las obligaciones siempre se muestran tal como vienen.
  const obligacionesMostradas = obligaciones

  const obligacionesColumns = useMemo<Column<ObligacionPendiente>[]>(() => [
    {
      key: 'tipo',
      label: 'Tipo',
      accessor: o => o.tipo_obligacion,
      render: o => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${OBLIGACION_TIPO_COLORS[o.tipo_obligacion]}`}>
          {OBLIGACION_TIPO_LABELS[o.tipo_obligacion]}
        </span>
      ),
      type: 'enum',
      enumOptions: [
        { value: 'gasto_total', label: OBLIGACION_TIPO_LABELS.gasto_total },
        { value: 'anticipo', label: OBLIGACION_TIPO_LABELS.anticipo },
        { value: 'saldo', label: OBLIGACION_TIPO_LABELS.saldo },
        { value: 'recurrente', label: OBLIGACION_TIPO_LABELS.recurrente },
      ],
      className: 'hidden sm:table-cell',
    },
    {
      key: 'proveedor',
      label: 'Proveedor',
      accessor: o => o.proveedor_nombre ?? '',
      render: o => o.proveedor_nombre ?? <span className="text-gray-300">—</span>,
      type: 'text',
      className: 'hidden md:table-cell',
    },
    {
      key: 'concepto',
      label: 'Concepto',
      accessor: o => o.concepto,
      render: o => (
        <div>
          <div className="text-sm font-medium text-gray-900 max-w-[200px] truncate">{o.concepto}</div>
        </div>
      ),
      type: 'text',
    },
    {
      // UX-PAGOS-CANAL-COLUMNA (2026-05-25): reemplaza columna "Fondo" por
      // "Canal" (RISA o tercero) para alinear con /gastos. Deriva via
      // gastoInfoPorId. Si la obligación no tiene gasto asociado (saldo_anticipo
      // standalone), defaultea a RISA por convención G1.
      key: 'canal',
      label: 'Canal',
      accessor: o => {
        const g = o.gasto_id ? gastoInfoPorId.get(o.gasto_id) : undefined
        return g?.forma_cancelacion === 'financiador'
          ? (g.financiadores?.nombre ?? g.financiadores?.codigo ?? 'Tercero')
          : 'RISA'
      },
      render: o => {
        const g = o.gasto_id ? gastoInfoPorId.get(o.gasto_id) : undefined
        return g?.forma_cancelacion === 'financiador' ? (
          <span
            title="Pago a tercero de la red"
            className="inline-flex rounded px-1.5 py-0 text-xs font-medium bg-orange-100 text-orange-800"
          >
            {g.financiadores?.nombre ?? g.financiadores?.codigo ?? 'Tercero'}
          </span>
        ) : (
          <span
            title="Pago con medios propios RISA"
            className="inline-flex rounded px-1.5 py-0 text-xs font-medium bg-slate-100 text-slate-700"
          >
            RISA
          </span>
        )
      },
      type: 'text',
      className: 'hidden lg:table-cell',
    },
    {
      key: 'vence',
      label: 'Vence',
      accessor: o => o.fecha_vencimiento ?? '',
      render: o => o.fecha_vencimiento ?? <span className="text-gray-300">—</span>,
      type: 'date',
      className: 'hidden md:table-cell',
    },
    {
      key: 'prioridad',
      label: 'Prior.',
      accessor: o => o.prioridad_pago,
      render: o => (
        <span className={PRIORIDAD_COLORS[o.prioridad_pago] ?? 'text-gray-500'}>
          {PRIORIDAD_LABELS[o.prioridad_pago] ?? o.prioridad_pago}
        </span>
      ),
      type: 'enum',
      enumOptions: [
        { value: '1', label: 'Crítica' },
        { value: '2', label: 'Alta' },
        { value: '3', label: 'Normal' },
        { value: '4', label: 'Baja' },
      ],
      className: 'hidden sm:table-cell',
    },
    {
      key: 'monto',
      label: 'Monto',
      accessor: o => o.monto_pendiente,
      render: o => (
        <span className="whitespace-nowrap font-semibold text-gray-900">
          {formatMonto(o.monto_pendiente, o.moneda)}
        </span>
      ),
      type: 'number',
      align: 'right',
    },
  ], [gastoInfoPorId])

  // ── Obligation-driven helpers ───────────────────────────────────────────────
  function openPagarObligation(ob: ObligacionPendiente) {
    const ui_tipo = deriveUiTipoFromObligation(ob.tipo_obligacion)
    const fondo = fondos.find(f => f.id === ob.fondo_id)
    const gasto = ob.gasto_id ? gastoInfoPorId.get(ob.gasto_id) : undefined
    setObligacionPreseleccionada(true)            // P4c.2-fix: bloquear cambio de obligación
    setForm({
      ui_tipo,
      modalidad: 'total',                          // P4c.2: default Pago total
      obligacion_id: ob.obligacion_id,
      fondo_id: ob.fondo_id,
      proveedor_id: ob.proveedor_id ?? '',
      gasto_id: ob.gasto_id ?? '',
      gasto_recurrente_id: ob.gasto_recurrente_id ?? '',
      anticipo_id: '',
      // Concepto auto-generado (no editable en el modal nuevo).
      concepto: generarConceptoAuto('total', ob.tipo_obligacion, gasto?.codigo ?? null, ob.concepto),
      monto: String(ob.monto_pendiente),           // total = saldo pendiente
      moneda: fondo?.moneda ?? ob.moneda,
      fecha_pago: new Date().toISOString().slice(0, 10),
      comprobante_url: '',
      notas: '',
    })
    setFormError('')
    setModalOpen(true)
  }

  // F2.3: recibe ids + clear desde el slot bulkActions del DataTable.
  function handleBulkCreate(ids: string[], clear: () => void) {
    const idSet = new Set(ids)
    const seleccion = obligacionesMostradas.filter(o => idSet.has(o.obligacion_id))
    const conProveedor = seleccion.filter(o => !!o.proveedor_id)
    const sinProveedor = seleccion.filter(o => !o.proveedor_id)

    if (conProveedor.length === 0) {
      setBulkMessage({
        text: 'Las obligaciones seleccionadas no tienen proveedor asignado. Usá "Pagar" individual para completar cada una.',
        isError: true,
      })
      return
    }

    setBulkMessage(null)
    setActionError('')

    startTransition(async () => {
      let creados = 0
      const errores: string[] = []
      const today = new Date().toISOString().slice(0, 10)

      for (const ob of conProveedor) {
        const tipo = deriveDbTipoFromObligation(ob.tipo_obligacion)
        const payload: PagoPayload = {
          fondo_id: ob.fondo_id,
          proveedor_id: ob.proveedor_id!,
          gasto_id: ob.gasto_id ?? null,
          anticipo_id: null,
          gasto_recurrente_id: ob.gasto_recurrente_id ?? null,
          tipo,
          concepto: ob.concepto,
          monto: ob.monto_pendiente,
          moneda: ob.moneda,
          fecha_pago: today,
          comprobante_url: null,
          notas: null,
        }
        const result = await onCreatePagoYConfirmar(payload)
        if (result.ok) {
          creados++
        } else {
          errores.push(result.error)
        }
      }

      clear()

      const partes: string[] = [
        `${creados} pago${creados !== 1 ? 's' : ''} registrado${creados !== 1 ? 's' : ''}.`,
      ]
      if (sinProveedor.length > 0) {
        partes.push(`${sinProveedor.length} omitida${sinProveedor.length !== 1 ? 's' : ''} (sin proveedor).`)
      }
      if (errores.length > 0) {
        partes.push(`${errores.length} error${errores.length !== 1 ? 'es' : ''}: ${errores.slice(0, 2).join('; ')}`)
      }

      setBulkMessage({ text: partes.join(' '), isError: errores.length > 0 })
    })
  }

  // P4c.2: el selector ui_tipo / pago directo / obligaciones filtradas + búsqueda
  // de hermanas fue removido. Ahora el usuario solo elige una obligación pendiente;
  // ui_tipo se infiere de ella, y modalidad (total/parcial) se decide vía radio buttons.

  function handleObligacionChange(obligacion_id: string) {
    const ob = obligaciones.find(o => o.obligacion_id === obligacion_id)
    if (!ob) {
      setForm(prev => ({
        ...prev,
        obligacion_id: '',
        gasto_id: '',
        gasto_recurrente_id: '',
        concepto: '',
        monto: '',
        moneda: '',
        fondo_id: '',
        proveedor_id: '',
      }))
      return
    }
    const fondo = fondos.find(f => f.id === ob.fondo_id)
    const gasto = ob.gasto_id ? gastoInfoPorId.get(ob.gasto_id) : undefined
    const ui_tipo = deriveUiTipoFromObligation(ob.tipo_obligacion)
    // P4c.2: al cambiar de obligación, default Pago total + concepto auto.
    setForm(prev => ({
      ...prev,
      ui_tipo,
      modalidad: 'total',
      obligacion_id,
      gasto_id: ob.gasto_id ?? '',
      gasto_recurrente_id: ob.gasto_recurrente_id ?? '',
      fondo_id: ob.fondo_id,
      moneda: fondo?.moneda ?? ob.moneda,
      proveedor_id: ob.proveedor_id ?? prev.proveedor_id,
      concepto: generarConceptoAuto('total', ob.tipo_obligacion, gasto?.codigo ?? null, ob.concepto),
      monto: String(ob.monto_pendiente),
      fecha_pago: prev.fecha_pago || new Date().toISOString().slice(0, 10),
    }))
  }

  // P4c.2: handler para el toggle Pago total / Pago parcial. Setea monto
  // automáticamente para total (= saldo pendiente) y lo deja vacío para parcial.
  // También recalcula el concepto auto-generado.
  function handleModalidadChange(modalidad: ModalidadPago) {
    const ob = form.obligacion_id ? obligaciones.find(o => o.obligacion_id === form.obligacion_id) : null
    const gasto = ob?.gasto_id ? gastoInfoPorId.get(ob.gasto_id) : undefined
    setForm(prev => ({
      ...prev,
      modalidad,
      monto: modalidad === 'total' ? (ob ? String(ob.monto_pendiente) : prev.monto) : '',
      concepto: ob
        ? generarConceptoAuto(modalidad, ob.tipo_obligacion, gasto?.codigo ?? null, ob.concepto)
        : prev.concepto,
    }))
  }

  function openNew() {
    setObligacionPreseleccionada(false)          // P4c.2-fix: usuario debe elegir
    setForm(EMPTY_FORM)
    setFormError('')
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setObligacionPreseleccionada(false)          // P4c.2-fix: reset al cerrar
    setForm(EMPTY_FORM)
    setFormError('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    executeSubmit()
  }

  // PAGOS-UX (2026-05-25): el modal SIEMPRE crea + confirma vía
  // createPagoYConfirmar. Sin flujo borrador, sin edit. El pago queda en
  // estado 'pagado' y dispara la generación automática de OP.
  function executeSubmit() {
    setFormError('')
    if (!form.fecha_pago) { setFormError('La fecha es requerida.'); return }

    // Alta nueva: exige obligación seleccionada.
    if (!form.obligacion_id) {
      setFormError('Seleccioná una obligación pendiente.'); return
    }
    {
      const selectedOb = obligaciones.find(o => o.obligacion_id === form.obligacion_id)
      if (!selectedOb) {
        setFormError('La obligación seleccionada ya no está disponible.'); return
      }
      const saldoPendiente = Number(selectedOb.monto_pendiente)
      const monto = parseFloat(form.monto)
      if (!form.monto || isNaN(monto) || monto <= 0) {
        setFormError('El monto debe ser mayor a 0.'); return
      }
      if (monto > saldoPendiente + 0.001) {
        setFormError('El importe a pagar no puede superar el saldo pendiente.'); return
      }
      // Coherencia: si modalidad=total, monto debe coincidir con saldo (tolerancia centavo).
      if (form.modalidad === 'total' && Math.abs(monto - saldoPendiente) > 0.01) {
        setFormError('Inconsistencia: cambia a "Pago parcial" o reseteá el importe.'); return
      }
    }

    const selectedOb = obligaciones.find(o => o.obligacion_id === form.obligacion_id)
    const tipo = resolveDbTipo(form.ui_tipo, selectedOb?.tipo_obligacion ?? null)
    const monto = parseFloat(form.monto)

    const payload: PagoPayload = {
      fondo_id: form.fondo_id,
      proveedor_id: form.proveedor_id,
      gasto_id: form.gasto_id || null,
      anticipo_id: form.anticipo_id || null,
      gasto_recurrente_id: form.gasto_recurrente_id || null,
      tipo,
      concepto: form.concepto.trim(),
      monto,
      moneda: form.moneda,
      fecha_pago: form.fecha_pago,
      comprobante_url: form.comprobante_url.trim() || null,
      notas: form.notas.trim() || null,
    }

    startTransition(async () => {
      try {
        const result = await onCreatePagoYConfirmar(payload)
        if (!result.ok) { setFormError(result.error); return }
        closeModal()
      } catch (err: unknown) {
        setFormError(err instanceof Error ? err.message : 'Error al guardar.')
      }
    })
  }

  function handleExportPagos() {
    // F2.5c: export universal con 3 secciones:
    //   1. Obligación pendiente (de la vista v_obligaciones_pendientes)
    //   2. Borrador pendiente   (pagos.estado='borrador')
    //   3. Pago registrado       (pagos.estado IN 'pagado','anulado')
    // Columnas comunes: seccion, estado_operativo, nro_pago, fecha, tipo,
    // pago, canal_pago, tercero, fondo, proveedor, concepto, monto, moneda,
    // estado, created_at.

    // Helper local: deriva canal de pago para un pago. Si no hay info del
    // gasto vinculado, default 'Medios propios RISA' porque G1 impuso que
    // todo pasa por el fondo RISA. '—' queda reservado para casos en que
    // explícitamente no aplique.
    function canalPagoDePago(p: PagoRow): string {
      const f = p.gastos?.forma_cancelacion ?? null
      if (f === 'financiador') return 'Tercero de la red'
      if (f === 'risa') return 'Medios propios RISA'
      // Sin gasto vinculado (directo, saldo_anticipo standalone) o anulado
      // legacy: si el pago tuviera financiador_id propio sería tercero, pero
      // ese campo no está en PagoRow. Default a RISA por convención G1.
      return 'Medios propios RISA'
    }
    function terceroDePago(p: PagoRow): string {
      return p.gastos?.financiadores
        ? `${p.gastos.financiadores.codigo ?? ''} ${p.gastos.financiadores.nombre}`.trim()
        : ''
    }

    // Helper para obligaciones: derivamos canal/tercero desde gastoInfoPorId.
    function canalPagoDeObligacion(o: ObligacionPendiente): string {
      const g = o.gasto_id ? gastoInfoPorId.get(o.gasto_id) : undefined
      if (g?.forma_cancelacion === 'financiador') return 'Tercero de la red'
      return 'Medios propios RISA'
    }
    function terceroDeObligacion(o: ObligacionPendiente): string {
      const g = o.gasto_id ? gastoInfoPorId.get(o.gasto_id) : undefined
      return g?.financiadores
        ? `${g.financiadores.codigo ?? ''} ${g.financiadores.nombre}`.trim()
        : ''
    }

    const filasObligaciones = obligaciones.map(o => ({
      seccion: 'Obligación pendiente',
      estado: 'Pendiente',
      nro_pago: '',
      nro_op: '',
      fecha: o.fecha_vencimiento ?? o.fecha_gasto ?? '',
      tipo: OBLIGACION_TIPO_LABELS[o.tipo_obligacion] ?? o.tipo_obligacion,
      pago: '—',
      canal_pago: canalPagoDeObligacion(o),
      tercero: terceroDeObligacion(o),
      fondo: o.fondo_nombre ?? '',
      proveedor: o.proveedor_nombre ?? '',
      concepto: o.concepto,
      monto: o.monto_pendiente,
      moneda: o.moneda,
      created_at: '',
    }))

    const filasPagos = filteredPagosBase.map(p => {
      const esBorrador = p.estado === 'borrador'
      const op = opPorPagoId.get(p.id)
      return {
        seccion: esBorrador ? 'Borrador pendiente' : 'Pago registrado',
        estado: ESTADO_LABELS[p.estado] ?? p.estado,
        nro_pago: p.nro_pago,
        // OP: número de OP del pago confirmado. Vacío en borradores.
        nro_op: op?.codigo ?? '',
        fecha: p.fecha_pago,
        tipo: TIPO_LABELS[p.tipo] ?? p.tipo,
        pago: MODALIDAD_LABELS[modalidadPorPagoId.get(p.id) ?? 'desconocida'],
        canal_pago: canalPagoDePago(p),
        tercero: terceroDePago(p),
        fondo: p.fondos?.nombre ?? '',
        proveedor: p.proveedores?.nombre ?? '',
        concepto: p.concepto,
        monto: p.monto,
        moneda: p.moneda,
        created_at: p.created_at,
      }
    })

    exportToExcel([...filasObligaciones, ...filasPagos], `pagos_${todayForFile()}.xlsx`, 'Pagos')
  }

  function handleAnular(id: string, concepto: string) {
    if (!confirm(`¿Anular el pago "${concepto}"? Esta acción genera un movimiento de reversión en el fondo.`)) return
    setActionError('')
    startTransition(async () => {
      try {
        await onAnularPago(id)
      } catch (err: unknown) {
        setActionError(err instanceof Error ? err.message : 'Error al anular pago.')
      }
    })
  }

  const q = search.trim().toLowerCase()
  const filteredPagosBase = q
    ? pagos.filter(
        p =>
          (p.codigo ?? '').toLowerCase().includes(q) ||
          p.nro_pago.toLowerCase().includes(q) ||
          p.concepto.toLowerCase().includes(q) ||
          (p.fondos?.nombre ?? '').toLowerCase().includes(q) ||
          (p.proveedores?.nombre ?? '').toLowerCase().includes(q) ||
          (p.notas ?? '').toLowerCase().includes(q)
      )
    : pagos

  // UX-1c: estado de la columna "Pago" por pago. Prioridad de resolución:
  //   1. tipo='anticipo'                              → 'anticipo' (visible como —)
  //   2. concepto contiene 'parcial'                  → 'parcial'
  //   3. concepto contiene 'total' / 'saldo final' /
  //      'pago recurrente'                            → 'total'
  //   4. fallback: cálculo histórico contra gasto.monto + pagado_previo
  //   5. sino                                          → 'desconocida' (visible como —)
  //
  // El cálculo histórico solo aplica cuando el pago vincula a un gasto (gasto_id)
  // y trae gasto.monto en el join. Los pagos tipo 'saldo_anticipo' vinculan via
  // anticipo_id y no traen gasto.monto, por eso el parsing del concepto es la
  // ruta primaria — además es la fuente más fiable porque la UI genera el
  // texto explícitamente con la modalidad elegida (generarConceptoAuto).
  const modalidadPorPagoId = useMemo(() => {
    // Cálculo histórico pre-computado por gasto (fallback)
    const histPorPagoId = new Map<string, Modalidad>()
    const porGasto = new Map<string, PagoRow[]>()
    for (const p of pagos) {
      if (p.gasto_id) {
        const arr = porGasto.get(p.gasto_id)
        if (arr) arr.push(p); else porGasto.set(p.gasto_id, [p])
      }
    }
    for (const lista of Array.from(porGasto.values())) {
      const sorted = [...lista].sort((a, b) => a.created_at.localeCompare(b.created_at))
      let pagadoPrevio = 0
      for (const p of sorted) {
        const gastoMonto = Number(p.gastos?.monto ?? 0)
        const monto = Number(p.monto)
        if (Number.isFinite(gastoMonto) && gastoMonto > 0) {
          const saldoPre = gastoMonto - pagadoPrevio
          if (saldoPre > 0) {
            if (Math.abs(monto - saldoPre) < 0.01) histPorPagoId.set(p.id, 'total')
            else if (monto < saldoPre) histPorPagoId.set(p.id, 'parcial')
          }
        }
        if (p.estado === 'pagado') pagadoPrevio += monto
      }
    }

    // Decisión final por pago
    const map = new Map<string, Modalidad>()
    for (const p of pagos) {
      // UX-PAGOS-MODALIDAD-ANTICIPO (2026-05-25): los pagos tipo='anticipo'
      // ya NO se corto-circuitan a '—'. Caen en la cascada normal (keywords
      // → histórico por gasto → desconocida) para mostrar Total/Parcial
      // cuando hay datos suficientes.
      const concepto = (p.concepto ?? '').toLowerCase()
      // 'parcial' se chequea ANTES que 'total' porque "Pago parcial recurrente"
      // contiene ambos conceptos.
      if (concepto.includes('parcial')) { map.set(p.id, 'parcial'); continue }
      if (
        concepto.includes('saldo final') ||
        concepto.includes('pago total') ||
        concepto.includes('pago recurrente')
      ) { map.set(p.id, 'total'); continue }

      // Fallback: cálculo histórico
      const hist = histPorPagoId.get(p.id)
      if (hist) { map.set(p.id, hist); continue }

      map.set(p.id, 'desconocida')
    }
    return map
  }, [pagos])

  // F2.5: Pagos registrados migrada a DataTable; ya no hace falta useSortable
  // externo. filteredPagosBase es la lista filtrada por search (todos los
  // estados); el DataTable sub-filtra a no-borradores y aplica su propio sort.

  // F2.4: dividir la tabla anterior en dos secciones independientes.
  //   - Pagos registrados (DataTable, pagado + anulado).
  // PAGOS-UX (2026-05-25): la sección "Borradores pendientes" se eliminó.
  // El SELECT de page.tsx filtra estado='borrador', así que filteredPagosBase
  // ya contiene solo pagos confirmados o anulados.

  // F2.5: columnas para "Pagos registrados" (pagado + anulado).
  // PAGOS-UX-2 (2026-05-25): OP movida a la segunda posición — es el documento
  // operativo. Concepto + Proveedor con truncate + title para no dominar el ancho.
  // PAGOS-UX-3 (2026-05-25): el concepto persistido suele tener prefijo
  // redundante ("Pago total de gasto — Constitución"). Tipo + Pago ya lo
  // expresan, así que en UI mostramos solo lo que viene después del separador.
  // El concepto original se conserva en title para tooltip y en DB/OP intacto.
  const pagosRegistradosColumns = useMemo<Column<PagoRow>[]>(() => [
    // UX-PAGOS-COLUMNAS-ORDEN (2026-05-25): orden alineado con Obligaciones
    // pendientes — Tipo / Proveedor / Concepto / Canal como bloque central.
    {
      key: 'nro',
      label: 'Nro',
      accessor: p => p.nro_pago,
      render: p => <span className="text-xs text-slate-600 whitespace-nowrap font-mono tabular-nums">{p.nro_pago}</span>,
      type: 'text',
    },
    {
      // OP visible siempre (sin hidden) — es la columna clave operativa.
      key: 'op',
      label: 'OP',
      accessor: p => opPorPagoId.get(p.id)?.codigo ?? '',
      render: p => {
        const op = opPorPagoId.get(p.id)
        if (!op) return <span className="text-gray-300">—</span>
        return (
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <span className="font-mono text-xs text-slate-700">{op.codigo}</span>
            {op.estado === 'anulada' && (
              <span className="inline-flex rounded-full px-1.5 py-0 text-[10px] font-medium bg-red-50 text-red-700 ring-1 ring-red-200">
                anulada
              </span>
            )}
          </span>
        )
      },
      type: 'text',
    },
    {
      key: 'tipo',
      label: 'Tipo',
      accessor: p => p.tipo,
      render: p => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TIPO_COLORS[p.tipo]}`}>
          {TIPO_LABELS[p.tipo]}
        </span>
      ),
      type: 'enum',
      enumOptions: (Object.keys(TIPO_LABELS) as PagoTipo[]).map(k => ({ value: k, label: TIPO_LABELS[k] })),
      className: 'hidden sm:table-cell',
    },
    {
      key: 'proveedor',
      label: 'Proveedor',
      accessor: p => p.proveedores?.nombre ?? '',
      render: p => {
        const nombre = p.proveedores?.nombre
        if (!nombre) return <span className="text-gray-300">—</span>
        return <span className="block max-w-[110px] truncate" title={nombre}>{nombre}</span>
      },
      type: 'text',
      className: 'hidden md:table-cell',
    },
    {
      key: 'concepto',
      label: 'Concepto',
      // accessor sobre el concepto completo para que la búsqueda libre siga
      // matcheando contra el prefijo si el user lo tipea.
      accessor: p => p.concepto,
      render: p => {
        const limpio = cleanConceptoPago(p.concepto)
        return (
          <div className="max-w-[120px]">
            <div className="text-sm font-medium text-gray-900 truncate" title={p.concepto}>
              {limpio}
            </div>
            {p.comprobante_url && (
              <a href={p.comprobante_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                Ver comprobante
              </a>
            )}
          </div>
        )
      },
      type: 'text',
    },
    {
      // UX-PAGOS-CANAL-COLUMNA (2026-05-25): reemplaza columna "Fondo" por
      // "Canal" (RISA o tercero) usando el join p.gastos.
      key: 'canal',
      label: 'Canal',
      accessor: p => p.gastos?.forma_cancelacion === 'financiador'
        ? (p.gastos.financiadores?.nombre ?? p.gastos.financiadores?.codigo ?? 'Tercero')
        : 'RISA',
      render: p => p.gastos?.forma_cancelacion === 'financiador' ? (
        <span
          title="Pago a tercero de la red"
          className="inline-flex rounded px-1.5 py-0 text-xs font-medium bg-orange-100 text-orange-800"
        >
          {p.gastos.financiadores?.nombre ?? p.gastos.financiadores?.codigo ?? 'Tercero'}
        </span>
      ) : (
        <span
          title="Pago con medios propios RISA"
          className="inline-flex rounded px-1.5 py-0 text-xs font-medium bg-slate-100 text-slate-700"
        >
          RISA
        </span>
      ),
      type: 'text',
      className: 'hidden lg:table-cell',
    },
    {
      key: 'fecha',
      label: 'Fecha',
      accessor: p => p.fecha_pago,
      render: p => <span className="text-sm text-gray-500 whitespace-nowrap">{p.fecha_pago}</span>,
      type: 'date',
    },
    {
      key: 'pago',
      label: 'Pago',
      accessor: p => modalidadPorPagoId.get(p.id) ?? 'desconocida',
      render: p => {
        const m = modalidadPorPagoId.get(p.id) ?? 'desconocida'
        return (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${MODALIDAD_COLORS[m]}`}>
            {MODALIDAD_LABELS[m]}
          </span>
        )
      },
      type: 'enum',
      enumOptions: [
        { value: 'total', label: 'Total' },
        { value: 'parcial', label: 'Parcial' },
        { value: 'anticipo', label: '—' },
        { value: 'desconocida', label: '—' },
      ],
      className: 'hidden sm:table-cell',
    },
    {
      key: 'monto',
      label: 'Monto',
      accessor: p => p.monto,
      render: p => (
        <span className="whitespace-nowrap font-medium text-gray-900">{formatMonto(p.monto, p.moneda)}</span>
      ),
      type: 'number',
      align: 'right',
    },
    {
      key: 'estado',
      label: 'Estado',
      accessor: p => p.estado,
      render: p => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_COLORS[p.estado]}`}>
          {ESTADO_LABELS[p.estado]}
        </span>
      ),
      type: 'enum',
      enumOptions: [
        { value: 'pagado', label: ESTADO_LABELS.pagado },
        { value: 'anulado', label: ESTADO_LABELS.anulado },
      ],
      className: 'hidden lg:table-cell',
    },
  ], [modalidadPorPagoId, opPorPagoId])

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">

      {/* ── SECTION 1: Obligaciones pendientes ─────────────────────────────── */}
      <div className="space-y-3">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">
            Obligaciones pendientes
            <span className="ml-2 text-sm font-normal text-gray-400">
              ({obligaciones.length})
            </span>
          </h2>
        </div>

        {/* Bulk result message — externo al DataTable */}
        {bulkMessage && (
          <div className={`rounded-lg border px-3 py-2 text-sm ${bulkMessage.isError ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {bulkMessage.text}
          </div>
        )}

        <DataTable<ObligacionPendiente>
          rows={obligacionesMostradas}
          getRowId={o => o.obligacion_id}
          selectable={canWrite}
          initialSort={{ key: 'prioridad', dir: 'asc' }}
          emptyMessage="No hay obligaciones pendientes."
          columns={obligacionesColumns}
          rowActions={canWrite ? (o) => (
            <button
              onClick={() => openPagarObligation(o)}
              disabled={isPending}
              className="rounded px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 transition-colors disabled:opacity-50"
            >
              Pagar
            </button>
          ) : undefined}
          bulkActions={canWrite ? (selectedIds, clear) => {
            const idSet = selectedIds
            const seleccionadas = obligacionesMostradas.filter(o => idSet.has(o.obligacion_id))
            const totales = new Map<string, number>()
            for (const o of seleccionadas) {
              totales.set(o.moneda, (totales.get(o.moneda) ?? 0) + o.monto_pendiente)
            }
            const ids = Array.from(selectedIds)
            return (
              <>
                {Array.from(totales.entries()).map(([moneda, total]) => (
                  <span key={moneda} className="text-sm font-semibold text-emerald-900">
                    {formatMonto(total, moneda)}
                  </span>
                ))}
                <span className="hidden text-xs text-emerald-700 sm:inline">— confirmar impacta el saldo</span>
                <button
                  onClick={() => handleBulkCreate(ids, clear)}
                  disabled={isPending}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  Registrar pagos seleccionados ({ids.length})
                </button>
              </>
            )
          } : undefined}
        />
      </div>

      {/* PAGOS-UX (2026-05-25): la sección "Borradores pendientes" se eliminó.
          createPagoYConfirmar deja el pago directamente en estado 'pagado'. */}

      {/* ── SECTION 2: Pagos registrados (confirmados + anulados) ───────────── */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            Pagos registrados
          </h2>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nro, concepto, proveedor..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 sm:w-48"
            />
            <button
              onClick={handleExportPagos}
              disabled={filteredPagosBase.length === 0}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              Exportar Excel
            </button>
            {canWrite && (
              <button
                onClick={openNew}
                disabled={isPending}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                + Nuevo pago
              </button>
            )}
          </div>
        </div>

        {actionError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {actionError}
          </div>
        )}

        <DataTable<PagoRow>
          rows={filteredPagosBase}
          getRowId={p => p.id}
          dense
          initialSort={{ key: 'fecha', dir: 'desc' }}
          emptyMessage={search ? 'Sin resultados para esa búsqueda.' : 'No hay pagos registrados.'}
          columns={pagosRegistradosColumns}
          rowActions={(p) => {
            // OP (2026-05-25): "Ver OP" disponible para todos los roles si la
            // OP existe. "Anular" solo admin.
            const items: RowActionItem[] = []
            const op = opPorPagoId.get(p.id)
            if (op) {
              items.push({
                label: `Ver OP ${op.codigo}`,
                onClick: () => window.open(`/ordenes-pago/${op.codigo}`, '_blank'),
              })
            }
            if (isAdmin && p.estado === 'pagado') {
              items.push({
                label: 'Anular',
                variant: 'danger',
                onClick: () => handleAnular(p.id, p.concepto),
              })
            }
            let tooltipBloqueo: string | undefined
            if (items.length === 0) {
              if (p.estado === 'anulado') tooltipBloqueo = 'Pago anulado.'
              else if (!op) tooltipBloqueo = 'OP aún no generada.'
            }
            return <RowActionMenu items={items} emptyTooltip={tooltipBloqueo} buttonLabel="" />
          }}
        />
      </div>

      {/* ── Modal ───────────────────────────────────────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="mb-5 text-lg font-semibold text-gray-900">
              {editing ? 'Editar pago' : 'Registrar pago'}
            </h2>

            {/* P4c.2: modal Registrar pago rediseñado. Pago = confirmación de
                 obligación pendiente. Datos del gasto heredados readonly.
                 Editables: fecha, modalidad, importe (solo parcial), comprobante, notas.
                 Modo edición (borrador legacy) mantiene un fallback abajo. */}
            {(() => {
              // PAGOS-UX (2026-05-25): solo alta nueva. Sin gastoDelPagoEditado.
              const ob = form.obligacion_id
                ? obligaciones.find(o => o.obligacion_id === form.obligacion_id)
                : null
              const gastoDeOb = ob?.gasto_id ? gastoInfoPorId.get(ob.gasto_id) : undefined
              const gastoView = ob && gastoDeOb
                ? {
                    codigo: gastoDeOb.codigo,
                    descripcion: gastoDeOb.descripcion,
                    monto: gastoDeOb.monto,
                    forma_cancelacion: gastoDeOb.forma_cancelacion,
                    financiadores: gastoDeOb.financiadores,
                  }
                : null
              const canalLabel = gastoView
                ? gastoView.forma_cancelacion === 'financiador' && gastoView.financiadores
                  ? `Tercero de la red — ${gastoView.financiadores.codigo ?? 'Sin código'} — ${gastoView.financiadores.nombre}`
                  : gastoView.forma_cancelacion === 'financiador'
                    ? 'Tercero de la red'
                    : 'Medios propios RISA'
                : 'Medios propios RISA'
              const totalGasto = gastoView?.monto ?? 0
              const saldoPendiente = ob ? Number(ob.monto_pendiente) : 0
              const pagado = totalGasto - saldoPendiente
              const parteLabel = ob ? OBLIGACION_TIPO_LABELS[ob.tipo_obligacion] : null
              const proveedorNombre = ob?.proveedor_nombre ?? '—'
              return (
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* P4c.2-fix: dos modos de apertura.
                       (a) "Nuevo pago" general → muestra selector editable.
                       (b) "Pagar" desde fila → muestra card readonly con la obligación. */}
                  {!editing && !obligacionPreseleccionada && (
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Obligación pendiente <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={form.obligacion_id}
                        onChange={e => handleObligacionChange(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                        autoFocus
                      >
                        <option value="">Seleccionar obligación pendiente...</option>
                        {obligaciones.map(o => {
                          const g = o.gasto_id ? gastoInfoPorId.get(o.gasto_id) : undefined
                          const canal = describirCanalPago(g)
                          const parte = OBLIGACION_TIPO_LABELS[o.tipo_obligacion]
                          return (
                            <option key={o.obligacion_id} value={o.obligacion_id}>
                              {etiquetaObligacion(o, o.proveedor_nombre ?? '', canal, Number(o.monto_pendiente), o.moneda, parte, g?.codigo ?? null)}
                            </option>
                          )
                        })}
                      </select>
                      {obligaciones.length === 0 && (
                        <p className="mt-1 text-xs text-gray-400">No hay obligaciones pendientes.</p>
                      )}
                    </div>
                  )}

                  {/* Modo preseleccionado: tarjeta readonly compacta de la obligación */}
                  {!editing && obligacionPreseleccionada && ob && (
                    <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                      <p className="mb-0.5 text-xs font-medium uppercase tracking-wide text-gray-500">Obligación seleccionada</p>
                      <p className="font-mono text-gray-900">
                        {gastoView?.codigo ?? `[${OBLIGACION_TIPO_LABELS[ob.tipo_obligacion]}]`}{' '}
                        <span className="font-sans font-medium">{ob.concepto}</span>
                      </p>
                      <p className="text-xs text-gray-500">
                        Proveedor: <span className="text-gray-700">{proveedorNombre}</span>
                      </p>
                      <p className="text-xs text-gray-500">
                        Canal: <span className={gastoView?.forma_cancelacion === 'financiador' ? 'text-amber-800 font-medium' : 'text-slate-800 font-medium'}>{canalLabel}</span>
                      </p>
                      <p className="text-xs text-gray-500">
                        Saldo pendiente: <span className="font-semibold tabular-nums text-amber-800">{formatMonto(saldoPendiente, ob.moneda)}</span>
                      </p>
                    </div>
                  )}

                  {/* Resumen de obligación — readonly */}
                  {(ob || editing) && gastoView && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5 text-sm">
                      <p className="font-semibold text-gray-800">Resumen de obligación</p>
                      <dl className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
                        {gastoView.codigo && (
                          <div>
                            <dt className="inline text-gray-500">N° gasto: </dt>
                            <dd className="inline font-mono text-gray-900">{gastoView.codigo}</dd>
                          </div>
                        )}
                        {parteLabel && (
                          <div>
                            <dt className="inline text-gray-500">Parte: </dt>
                            <dd className="inline font-medium text-gray-900">{parteLabel}</dd>
                          </div>
                        )}
                        <div className="sm:col-span-2">
                          <dt className="inline text-gray-500">Proveedor: </dt>
                          <dd className="inline text-gray-900">{proveedorNombre}</dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="inline text-gray-500">Concepto: </dt>
                          <dd className="inline text-gray-900">{gastoView.descripcion}</dd>
                        </div>
                        <div>
                          <dt className="inline text-gray-500">Fondo operativo: </dt>
                          <dd className="inline font-medium text-gray-900">RISA</dd>
                        </div>
                        <div>
                          <dt className="inline text-gray-500">Moneda: </dt>
                          <dd className="inline font-mono text-gray-900">{form.moneda || (ob?.moneda ?? '—')}</dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="inline text-gray-500">Canal de pago: </dt>
                          <dd className={`inline font-medium ${gastoView.forma_cancelacion === 'financiador' ? 'text-amber-800' : 'text-slate-800'}`}>{canalLabel}</dd>
                        </div>
                        {ob && (
                          <>
                            <div>
                              <dt className="inline text-gray-500">Importe total: </dt>
                              <dd className="inline tabular-nums text-gray-900">{formatMonto(totalGasto, ob.moneda)}</dd>
                            </div>
                            <div>
                              <dt className="inline text-gray-500">Pagado: </dt>
                              <dd className="inline tabular-nums text-emerald-700">{formatMonto(Math.max(0, pagado), ob.moneda)}</dd>
                            </div>
                            <div className="sm:col-span-2">
                              <dt className="inline text-gray-500">Saldo pendiente: </dt>
                              <dd className="inline font-semibold tabular-nums text-amber-800">{formatMonto(saldoPendiente, ob.moneda)}</dd>
                            </div>
                          </>
                        )}
                      </dl>
                      {gastoView.forma_cancelacion === 'financiador' ? (
                        <p className="pt-1 text-xs text-amber-700">
                          Este pago se registrará en la cuenta corriente del tercero. No afecta Medios Propios RISA.
                        </p>
                      ) : (
                        <p className="pt-1 text-xs text-slate-600">
                          Este pago afectará Medios Propios RISA.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Modalidad de pago — solo en alta nueva con obligación seleccionada */}
                  {!editing && ob && (
                    <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                      <p className="text-sm font-semibold text-gray-800">Modalidad de pago</p>
                      <div className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-6">
                        <label className="flex cursor-pointer items-start gap-2">
                          <input
                            type="radio"
                            name="modalidad"
                            value="total"
                            checked={form.modalidad === 'total'}
                            onChange={() => handleModalidadChange('total')}
                            className="mt-0.5 h-4 w-4 border-gray-300 text-slate-900 focus:ring-slate-500"
                          />
                          <span className="font-medium text-gray-800">Pago total</span>
                        </label>
                        <label className="flex cursor-pointer items-start gap-2">
                          <input
                            type="radio"
                            name="modalidad"
                            value="parcial"
                            checked={form.modalidad === 'parcial'}
                            onChange={() => handleModalidadChange('parcial')}
                            className="mt-0.5 h-4 w-4 border-gray-300 text-slate-900 focus:ring-slate-500"
                          />
                          <span className="font-medium text-gray-800">Pago parcial</span>
                        </label>
                      </div>
                      {form.modalidad === 'total' && (
                        <p className="text-xs text-gray-500">Se pagará el saldo pendiente completo.</p>
                      )}
                    </div>
                  )}

                  {/* Fecha + Importe */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Fecha de pago <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={form.fecha_pago}
                        onChange={e => setForm({ ...form, fecha_pago: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Importe <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={form.monto}
                        onChange={e => setForm({ ...form, monto: e.target.value })}
                        readOnly={!editing && form.modalidad === 'total'}
                        tabIndex={!editing && form.modalidad === 'total' ? -1 : undefined}
                        className={
                          !editing && form.modalidad === 'total'
                            ? 'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm tabular-nums text-gray-700 cursor-default'
                            : 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm tabular-nums outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20'
                        }
                        placeholder="0.00"
                      />
                      {!editing && form.modalidad === 'parcial' && ob && (
                        <p className="mt-0.5 text-xs text-gray-400">
                          Máximo: {formatMonto(saldoPendiente, ob.moneda)} (saldo pendiente).
                        </p>
                      )}
                    </div>
                  </div>

                  {/* URL comprobante */}
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">URL comprobante</label>
                    <input
                      type="text"
                      value={form.comprobante_url}
                      onChange={e => setForm({ ...form, comprobante_url: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                      placeholder="https://..."
                    />
                  </div>

                  {/* Notas */}
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Notas</label>
                    <textarea
                      value={form.notas}
                      onChange={e => setForm({ ...form, notas: e.target.value })}
                      rows={2}
                      className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                      placeholder="Notas internas opcionales"
                    />
                  </div>

                  {formError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {formError}
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={closeModal}
                      disabled={isPending}
                      className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={isPending || (!editing && !ob)}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                    >
                      {isPending
                        ? 'Guardando...'
                        : editing
                          ? 'Guardar cambios'
                          : 'Registrar pago'}
                    </button>
                  </div>
                </form>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
