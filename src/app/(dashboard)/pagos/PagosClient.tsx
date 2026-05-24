'use client'

import { useState, useTransition, useMemo } from 'react'
import type { UserRole, PagoEstado, PagoTipo, ObligacionPendiente, ObligacionTipo } from '@/types'
import type { PagoPayload } from './actions'
import { exportToExcel, todayForFile } from '@/lib/excel'
import { useSortable } from '@/lib/useSortable'
import SortableHeader from '@/components/SortableHeader'
import DataTable, { type Column } from '@/components/DataTable'

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
  role: UserRole
  onCreatePagoYConfirmar: (data: PagoPayload) => Promise<{ ok: true } | { ok: false; error: string }>
  onUpdatePago: (id: string, data: PagoPayload) => Promise<void>
  onConfirmarPago: (id: string) => Promise<void>
  onAnularPago: (id: string) => Promise<void>
  onConfirmarPagosBulk: (ids: string[]) => Promise<{ confirmados: string[]; errores: { id: string; error: string }[] }>
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

const TIPO_LABELS: Record<PagoTipo, string> = {
  directo: 'Pago directo',
  gasto: 'Pago de gasto',
  anticipo: 'Anticipo',
  saldo_anticipo: 'Pagar saldo',
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
  role,
  onCreatePagoYConfirmar,
  onUpdatePago,
  onConfirmarPago,
  onAnularPago,
  onConfirmarPagosBulk,
}: Props) {
  // ── Modal / form state ──────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<PagoRow | null>(null)
  // P4c.2-fix: true cuando el modal se abre desde un botón "Pagar" de fila
  // (obligación pre-determinada, NO se puede cambiar). false cuando se abre
  // desde el botón "Nuevo pago" general (el usuario debe elegir obligación).
  const [obligacionPreseleccionada, setObligacionPreseleccionada] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [actionError, setActionError] = useState('')
  const [isPending, startTransition] = useTransition()

  // ── Bulk state (F2.3: la selección de obligaciones se delegó al DataTable) ──
  const [ocultarConBorrador, setOcultarConBorrador] = useState(false)
  const [bulkMessage, setBulkMessage] = useState<{ text: string; isError: boolean } | null>(null)
  // F2.4: la selección de borradores la maneja el DataTable de la nueva sección.
  const [bulkPagosMessage, setBulkPagosMessage] = useState<{ text: string; isError: boolean } | null>(null)

  const canWrite = role === 'admin' || role === 'contador'
  const isAdmin = role === 'admin'

  // P4c.2: lookup rápido por gasto_id para mostrar canal de pago en el modal
  // (Resumen de obligación) y al renderear pagos en tabla.
  const gastoInfoPorId = useMemo(() => {
    const m = new Map<string, GastoInfo>()
    for (const g of gastosInfo) m.set(g.id, g)
    return m
  }, [gastosInfo])

  // ── Derived: which obligations already have a borrador pago ─────────────────
  // F2.3: memoizado para evitar loop con el onVisibleRowsChange del DataTable.
  const gastoIdsEnBorrador = useMemo(
    () => new Set(pagos.filter(p => p.estado === 'borrador' && p.gasto_id).map(p => p.gasto_id as string)),
    [pagos]
  )
  const recurrentesEnBorrador = useMemo(
    () => new Set(pagos.filter(p => p.estado === 'borrador' && p.gasto_recurrente_id).map(p => p.gasto_recurrente_id as string)),
    [pagos]
  )

  const tieneBorrador = useMemo(() => (o: ObligacionPendiente): boolean => {
    if (o.gasto_id && gastoIdsEnBorrador.has(o.gasto_id)) return true
    if (o.gasto_recurrente_id && recurrentesEnBorrador.has(o.gasto_recurrente_id)) return true
    return false
  }, [gastoIdsEnBorrador, recurrentesEnBorrador])

  const obligacionesMostradas = useMemo(
    () => (ocultarConBorrador ? obligaciones.filter(o => !tieneBorrador(o)) : obligaciones),
    [obligaciones, ocultarConBorrador, tieneBorrador]
  )

  function handleOcultarConBorradorChange(checked: boolean) {
    setOcultarConBorrador(checked)
    // F2.3: cambiar el key del DataTable lo remonta y limpia la selección automáticamente
    // (ver prop `key` en el JSX). No hay setSelectedObIds porque la selección la maneja DataTable.
  }

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
          {tieneBorrador(o) && <span className="text-xs text-amber-600">En borrador</span>}
        </div>
      ),
      type: 'text',
    },
    {
      key: 'fondo',
      label: 'Fondo',
      accessor: o => o.fondo_nombre,
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
  // tieneBorrador depende de gastoIdsEnBorrador/recurrentesEnBorrador (memoizados).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [tieneBorrador])

  // F2.4: la selección y el toggle del header son nativos del DataTable.
  // handleBulkConfirmar recibe ids + clear desde el slot bulkActions.
  function handleBulkConfirmar(ids: string[], clear: () => void) {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    const seleccionados = borradoresFiltrados.filter(p => idSet.has(p.id))
    const totales = new Map<string, number>()
    for (const p of seleccionados) {
      totales.set(p.moneda, (totales.get(p.moneda) ?? 0) + p.monto)
    }
    const totalesStr = Array.from(totales.entries())
      .map(([moneda, total]) => formatMonto(total, moneda))
      .join(' / ')
    if (
      !confirm(
        `Se confirmarán ${ids.length} pago${ids.length !== 1 ? 's' : ''} por un total de ${totalesStr}. Esto impactará los saldos de los fondos.`
      )
    ) return
    setBulkPagosMessage(null)
    setActionError('')
    startTransition(async () => {
      try {
        const result = await onConfirmarPagosBulk(ids)
        const nConfirm = result.confirmados.length
        const nErr = result.errores.length
        if (nConfirm > 0) {
          clear()
          setBulkMessage(null)
        }
        const partes: string[] = [
          `${nConfirm} pago${nConfirm !== 1 ? 's' : ''} confirmado${nConfirm !== 1 ? 's' : ''}.`,
        ]
        if (nErr > 0) {
          const detalle = result.errores.slice(0, 2).map(e => e.error || 'sin mensaje').join('; ')
          partes.push(`${nErr} error${nErr !== 1 ? 'es' : ''}: ${detalle}`)
        }
        setBulkPagosMessage({ text: partes.join(' '), isError: nErr > 0 })
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Error al confirmar pagos.')
      }
    })
  }

  // ── Obligation-driven helpers ───────────────────────────────────────────────
  function openPagarObligation(ob: ObligacionPendiente) {
    const ui_tipo = deriveUiTipoFromObligation(ob.tipo_obligacion)
    const fondo = fondos.find(f => f.id === ob.fondo_id)
    const gasto = ob.gasto_id ? gastoInfoPorId.get(ob.gasto_id) : undefined
    setEditing(null)
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
    setEditing(null)
    setObligacionPreseleccionada(false)          // P4c.2-fix: usuario debe elegir
    setForm(EMPTY_FORM)
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(p: PagoRow) {
    setEditing(p)
    setObligacionPreseleccionada(false)          // P4c.2-fix: edición no usa el flag
    let ui_tipo: UiTipo = 'directo'
    if (p.tipo === 'anticipo') ui_tipo = 'anticipo'
    else if (p.tipo === 'saldo_anticipo') ui_tipo = 'saldo'
    else if (p.tipo === 'recurrente') ui_tipo = 'recurrente'
    else if (p.tipo === 'gasto') ui_tipo = 'final'
    setForm({
      ui_tipo,
      modalidad: 'total',
      obligacion_id: '',
      fondo_id: p.fondo_id,
      proveedor_id: p.proveedor_id,
      gasto_id: p.gasto_id ?? '',
      gasto_recurrente_id: p.gasto_recurrente_id ?? '',
      anticipo_id: p.anticipo_id ?? '',
      concepto: p.concepto,
      monto: String(p.monto),
      moneda: p.moneda,
      fecha_pago: p.fecha_pago,
      comprobante_url: p.comprobante_url ?? '',
      notas: p.notas ?? '',
    })
    setFormError('')
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditing(null)
    setObligacionPreseleccionada(false)          // P4c.2-fix: reset al cerrar
    setForm(EMPTY_FORM)
    setFormError('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    executeSubmit()
  }

  // Crea pagos en estado 'pagado' atómicamente. El flujo "borrador" se eliminó
  // del UI; legacy borradores siguen siendo confirmables/editables desde la tabla.
  // P4c.2: alta de pago siempre desde una obligación. Datos del gasto heredados
  // (fondo, proveedor, concepto, moneda). El usuario solo elige modalidad + importe
  // parcial + fecha + comprobante + notas.
  function executeSubmit() {
    setFormError('')
    if (!form.fecha_pago) { setFormError('La fecha es requerida.'); return }

    if (!editing) {
      // Alta nueva: exige obligación seleccionada.
      if (!form.obligacion_id) {
        setFormError('Seleccioná una obligación pendiente.'); return
      }
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
    } else {
      // Edición de borrador legacy: mantenemos validación mínima.
      if (!form.fondo_id) { setFormError('Seleccioná un fondo.'); return }
      if (!form.proveedor_id) { setFormError('Seleccioná un proveedor.'); return }
      if (!form.concepto.trim()) { setFormError('El concepto es requerido.'); return }
      const monto = parseFloat(form.monto)
      if (!form.monto || isNaN(monto) || monto <= 0) {
        setFormError('El monto debe ser mayor a 0.'); return
      }
    }

    const selectedOb = obligaciones.find(o => o.obligacion_id === form.obligacion_id)
    const tipo = editing
      ? editing.tipo
      : resolveDbTipo(form.ui_tipo, selectedOb?.tipo_obligacion ?? null)
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
        if (editing) {
          await onUpdatePago(editing.id, payload)
        } else {
          // Alta nueva: siempre se crea ya pagado/confirmado (sin paso por borrador)
          const result = await onCreatePagoYConfirmar(payload)
          if (!result.ok) { setFormError(result.error); return }
        }
        closeModal()
      } catch (err: unknown) {
        setFormError(err instanceof Error ? err.message : 'Error al guardar.')
      }
    })
  }

  function handleConfirmar(id: string) {
    setActionError('')
    startTransition(async () => {
      try {
        await onConfirmarPago(id)
        setBulkMessage(null)
      } catch (err: unknown) {
        setActionError(err instanceof Error ? err.message : 'Error al confirmar pago.')
      }
    })
  }

  function handleExportPagos() {
    const rows = filteredPagos.map(p => ({
      nro_pago: p.nro_pago,
      fecha: p.fecha_pago,
      tipo: TIPO_LABELS[p.tipo] ?? p.tipo,
      pago: MODALIDAD_LABELS[modalidadPorPagoId.get(p.id) ?? 'desconocida'],
      fondo: p.fondos?.nombre ?? '',
      proveedor: p.proveedores?.nombre ?? '',
      concepto: p.concepto,
      monto: p.monto,
      moneda: p.moneda,
      estado: ESTADO_LABELS[p.estado] ?? p.estado,
      created_at: p.created_at,
    }))
    exportToExcel(rows, `pagos_${todayForFile()}.xlsx`, 'Pagos')
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
      if (p.tipo === 'anticipo') { map.set(p.id, 'anticipo'); continue }

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

  const pagosAccessors = useMemo(() => ({
    codigo: (p: PagoRow) => p.codigo ?? '',
    nro: (p: PagoRow) => p.nro_pago,
    fecha: (p: PagoRow) => p.fecha_pago,
    concepto: (p: PagoRow) => p.concepto,
    tipo: (p: PagoRow) => p.tipo,
    pago: (p: PagoRow) => modalidadPorPagoId.get(p.id) ?? 'desconocida',
    fondo: (p: PagoRow) => p.fondos?.nombre ?? '',
    proveedor: (p: PagoRow) => p.proveedores?.nombre ?? '',
    monto: (p: PagoRow) => p.monto,
    estado: (p: PagoRow) => p.estado,
  }), [modalidadPorPagoId])
  const { sorted: filteredPagos, sortKey: pSortKey, sortDir: pSortDir, onSort: onPagoSort } =
    useSortable(filteredPagosBase, pagosAccessors, { key: 'fecha', dir: 'desc' })

  // F2.4: dividir la tabla anterior en dos secciones independientes.
  //   - Borradores pendientes (DataTable, selectable, bulk Confirmar).
  //   - Pagos registrados (tabla manual por ahora, solo pagado + anulado;
  //     F2.5 la migrará a DataTable).
  // Ambas comparten la misma búsqueda (input arriba de Pagos registrados).
  const borradoresFiltrados = useMemo(
    () => filteredPagosBase.filter(p => p.estado === 'borrador'),
    [filteredPagosBase]
  )
  const noBorradoresFiltrados = useMemo(
    () => filteredPagos.filter(p => p.estado !== 'borrador'),
    [filteredPagos]
  )

  const borradoresColumns = useMemo<Column<PagoRow>[]>(() => [
    {
      key: 'codigo',
      label: 'Código',
      accessor: p => p.codigo ?? '',
      render: p => p.codigo
        ? <span className="text-xs font-mono tabular-nums text-slate-600 whitespace-nowrap">{p.codigo}</span>
        : <span className="text-gray-300">—</span>,
      type: 'text',
    },
    {
      key: 'nro',
      label: 'Nro',
      accessor: p => p.nro_pago,
      render: p => <span className="text-xs text-gray-400 whitespace-nowrap font-mono">{p.nro_pago}</span>,
      type: 'text',
      className: 'hidden sm:table-cell',
    },
    {
      key: 'fecha',
      label: 'Fecha',
      accessor: p => p.fecha_pago,
      render: p => <span className="text-sm text-gray-500 whitespace-nowrap">{p.fecha_pago}</span>,
      type: 'date',
    },
    {
      key: 'concepto',
      label: 'Concepto',
      accessor: p => p.concepto,
      render: p => (
        <div>
          <div className="text-sm font-medium text-gray-900 max-w-xs truncate">{p.concepto}</div>
          {p.comprobante_url && (
            <a href={p.comprobante_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
              Ver comprobante
            </a>
          )}
        </div>
      ),
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
      key: 'fondo',
      label: 'Fondo',
      accessor: p => p.fondos?.nombre ?? '',
      render: p => p.fondos?.nombre ?? <span className="text-gray-300">—</span>,
      type: 'text',
      className: 'hidden md:table-cell',
    },
    {
      key: 'proveedor',
      label: 'Proveedor',
      accessor: p => p.proveedores?.nombre ?? '',
      render: p => p.proveedores?.nombre ?? <span className="text-gray-300">—</span>,
      type: 'text',
      className: 'hidden md:table-cell',
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
  ], [modalidadPorPagoId])

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
              ({obligaciones.length}{ocultarConBorrador && obligacionesMostradas.length < obligaciones.length
                ? ` · ${obligacionesMostradas.length} mostradas`
                : ''})
            </span>
          </h2>
          <label className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-500">
            <input
              type="checkbox"
              checked={ocultarConBorrador}
              onChange={e => handleOcultarConBorradorChange(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
            />
            Ocultar con borrador
          </label>
        </div>

        {/* Bulk result message — externo al DataTable */}
        {bulkMessage && (
          <div className={`rounded-lg border px-3 py-2 text-sm ${bulkMessage.isError ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {bulkMessage.text}
          </div>
        )}

        <DataTable<ObligacionPendiente>
          // Cambiar el key al togglear "Ocultar con borrador" remonta el DataTable
          // y limpia la selección automáticamente (preserva la UX previa).
          key={ocultarConBorrador ? 'sin-borrador' : 'todo'}
          rows={obligacionesMostradas}
          getRowId={o => o.obligacion_id}
          selectable={canWrite}
          initialSort={{ key: 'prioridad', dir: 'asc' }}
          rowClassName={o => (tieneBorrador(o) ? 'opacity-60' : '')}
          emptyMessage={obligaciones.length === 0
            ? 'No hay obligaciones pendientes.'
            : 'Todas las obligaciones tienen pago en borrador. Desmarcá "Ocultar con borrador" para verlas.'}
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

      {/* ── SECTION 2: Borradores pendientes (F2.4) ─────────────────────────── */}
      {borradoresFiltrados.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-gray-900">
            Borradores pendientes
            <span className="ml-2 text-sm font-normal text-gray-400">({borradoresFiltrados.length})</span>
          </h2>

          {bulkPagosMessage && (
            <div className={`rounded-lg border px-3 py-2 text-sm ${bulkPagosMessage.isError ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
              {bulkPagosMessage.text}
            </div>
          )}

          <DataTable<PagoRow>
            rows={borradoresFiltrados}
            getRowId={p => p.id}
            selectable={canWrite}
            initialSort={{ key: 'fecha', dir: 'desc' }}
            emptyMessage="No hay borradores pendientes."
            columns={borradoresColumns}
            rowActions={canWrite ? (p) => (
              <>
                <button
                  onClick={() => openEdit(p)}
                  disabled={isPending}
                  className="rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
                >
                  Editar
                </button>
                <button
                  onClick={() => handleConfirmar(p.id)}
                  disabled={isPending}
                  className="rounded px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 transition-colors disabled:opacity-50"
                >
                  Confirmar
                </button>
              </>
            ) : undefined}
            bulkActions={canWrite ? (selectedIds, clear) => {
              const idSet = selectedIds
              const seleccionados = borradoresFiltrados.filter(p => idSet.has(p.id))
              const totales = new Map<string, number>()
              for (const p of seleccionados) {
                totales.set(p.moneda, (totales.get(p.moneda) ?? 0) + p.monto)
              }
              const ids = Array.from(selectedIds)
              return (
                <>
                  {Array.from(totales.entries()).map(([moneda, total]) => (
                    <span key={moneda} className="text-sm font-semibold text-emerald-900">
                      {formatMonto(total, moneda)}
                    </span>
                  ))}
                  <span className="text-xs font-medium text-amber-700">Confirmar impactará saldos</span>
                  <button
                    onClick={() => handleBulkConfirmar(ids, clear)}
                    disabled={isPending}
                    className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    Confirmar pagos seleccionados ({ids.length})
                  </button>
                </>
              )
            } : undefined}
          />
        </div>
      )}

      {/* ── SECTION 3: Pagos registrados (confirmados + anulados) ───────────── */}
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
              placeholder="Buscar por código, concepto, fondo o proveedor..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 sm:w-48"
            />
            <button
              onClick={handleExportPagos}
              disabled={filteredPagos.length === 0}
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

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {noBorradoresFiltrados.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-400">
              {search ? 'Sin resultados para esa búsqueda.' : 'No hay pagos registrados.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <SortableHeader label="Código" sortKey="codigo" activeKey={pSortKey} dir={pSortDir} onSort={onPagoSort} />
                    <SortableHeader label="Nro" sortKey="nro" activeKey={pSortKey} dir={pSortDir} onSort={onPagoSort} className="hidden sm:table-cell" />
                    <SortableHeader label="Fecha" sortKey="fecha" activeKey={pSortKey} dir={pSortDir} onSort={onPagoSort} />
                    <SortableHeader label="Concepto" sortKey="concepto" activeKey={pSortKey} dir={pSortDir} onSort={onPagoSort} />
                    <SortableHeader label="Tipo" sortKey="tipo" activeKey={pSortKey} dir={pSortDir} onSort={onPagoSort} className="hidden sm:table-cell" />
                    <SortableHeader label="Pago" sortKey="pago" activeKey={pSortKey} dir={pSortDir} onSort={onPagoSort} className="hidden sm:table-cell" />
                    <SortableHeader label="Fondo" sortKey="fondo" activeKey={pSortKey} dir={pSortDir} onSort={onPagoSort} className="hidden md:table-cell" />
                    <SortableHeader label="Proveedor" sortKey="proveedor" activeKey={pSortKey} dir={pSortDir} onSort={onPagoSort} className="hidden md:table-cell" />
                    <SortableHeader label="Monto" sortKey="monto" activeKey={pSortKey} dir={pSortDir} onSort={onPagoSort} align="right" />
                    <SortableHeader label="Estado" sortKey="estado" activeKey={pSortKey} dir={pSortDir} onSort={onPagoSort} className="hidden lg:table-cell" />
                    {isAdmin && (
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Acciones</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {noBorradoresFiltrados.map(p => (
                    <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-xs font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {p.codigo ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-gray-400 whitespace-nowrap font-mono sm:table-cell">{p.nro_pago}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{p.fecha_pago}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900 max-w-xs truncate">{p.concepto}</div>
                        {p.comprobante_url && (
                          <a href={p.comprobante_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                            Ver comprobante
                          </a>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TIPO_COLORS[p.tipo]}`}>
                          {TIPO_LABELS[p.tipo]}
                        </span>
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        {(() => {
                          const m = modalidadPorPagoId.get(p.id) ?? 'desconocida'
                          return (
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${MODALIDAD_COLORS[m]}`}>
                              {MODALIDAD_LABELS[m]}
                            </span>
                          )
                        })()}
                      </td>
                      <td className="hidden px-4 py-3 text-sm text-gray-500 md:table-cell">
                        {p.fondos?.nombre ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="hidden px-4 py-3 text-sm text-gray-500 md:table-cell">
                        {p.proveedores?.nombre ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 whitespace-nowrap">
                        {formatMonto(p.monto, p.moneda)}
                      </td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_COLORS[p.estado]}`}>
                          {ESTADO_LABELS[p.estado]}
                        </span>
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            {p.estado === 'pagado' && (
                              <button
                                onClick={() => handleAnular(p.id, p.concepto)}
                                disabled={isPending}
                                className="rounded px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                              >
                                Anular
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
              // Datos derivados para el resumen
              const ob = !editing && form.obligacion_id
                ? obligaciones.find(o => o.obligacion_id === form.obligacion_id)
                : null
              const gastoDeOb = ob?.gasto_id ? gastoInfoPorId.get(ob.gasto_id) : undefined
              const gastoDelPagoEditado = editing?.gastos
                ? {
                    codigo: editing.gastos.codigo ?? null,
                    descripcion: editing.gastos.descripcion,
                    monto: editing.gastos.monto,
                    forma_cancelacion: editing.gastos.forma_cancelacion,
                    financiadores: editing.gastos.financiadores,
                  }
                : null
              const gastoView = ob && gastoDeOb
                ? {
                    codigo: gastoDeOb.codigo,
                    descripcion: gastoDeOb.descripcion,
                    monto: gastoDeOb.monto,
                    forma_cancelacion: gastoDeOb.forma_cancelacion,
                    financiadores: gastoDeOb.financiadores,
                  }
                : gastoDelPagoEditado
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
              const proveedorNombre = ob?.proveedor_nombre ?? editing?.proveedores?.nombre ?? '—'
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
