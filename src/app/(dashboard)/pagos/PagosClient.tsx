'use client'

import { useState, useTransition } from 'react'
import type { UserRole, PagoEstado, PagoTipo, ObligacionPendiente, ObligacionTipo } from '@/types'
import type { PagoPayload } from './actions'
import { exportToExcel, todayForFile } from '@/lib/excel'

export interface PagoRow {
  id: string
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
  gastos: { descripcion: string } | null
  anticipos: { concepto: string } | null
}

// UiTipo: opciones visibles en el modal de pago. Distinto a PagoTipo (enum DB).
//   anticipo / saldo / parcial / final → linkean a un gasto vía obligación
//   recurrente → linkea a un gasto_recurrente_id
//   directo → pago sin obligación, requiere nota justificativa
type UiTipo = 'anticipo' | 'saldo' | 'parcial' | 'final' | 'recurrente' | 'directo'

interface Props {
  pagos: PagoRow[]
  fondos: { id: string; nombre: string; moneda: string }[]
  proveedores: { id: string; nombre: string }[]
  obligaciones: ObligacionPendiente[]
  role: UserRole
  onCreatePagoYConfirmar: (data: PagoPayload) => Promise<{ ok: true } | { ok: false; error: string }>
  onUpdatePago: (id: string, data: PagoPayload) => Promise<void>
  onConfirmarPago: (id: string) => Promise<void>
  onAnularPago: (id: string) => Promise<void>
  onConfirmarPagosBulk: (ids: string[]) => Promise<{ confirmados: string[]; errores: { id: string; error: string }[] }>
}

interface FormState {
  ui_tipo: UiTipo
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

export default function PagosClient({
  pagos,
  fondos,
  proveedores,
  obligaciones,
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
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [actionError, setActionError] = useState('')
  const [isPending, startTransition] = useTransition()

  // ── Multi-select + bulk state ───────────────────────────────────────────────
  const [selectedObIds, setSelectedObIds] = useState<Set<string>>(new Set())
  const [ocultarConBorrador, setOcultarConBorrador] = useState(false)
  const [bulkMessage, setBulkMessage] = useState<{ text: string; isError: boolean } | null>(null)
  const [selectedPagoIds, setSelectedPagoIds] = useState<Set<string>>(new Set())
  const [bulkPagosMessage, setBulkPagosMessage] = useState<{ text: string; isError: boolean } | null>(null)

  const canWrite = role === 'admin' || role === 'contador'
  const isAdmin = role === 'admin'

  // ── Derived: which obligations already have a borrador pago ─────────────────
  const gastoIdsEnBorrador = new Set(
    pagos.filter(p => p.estado === 'borrador' && p.gasto_id).map(p => p.gasto_id as string)
  )
  const recurrentesEnBorrador = new Set(
    pagos.filter(p => p.estado === 'borrador' && p.gasto_recurrente_id).map(p => p.gasto_recurrente_id as string)
  )

  function tieneBorrador(o: ObligacionPendiente): boolean {
    if (o.gasto_id && gastoIdsEnBorrador.has(o.gasto_id)) return true
    if (o.gasto_recurrente_id && recurrentesEnBorrador.has(o.gasto_recurrente_id)) return true
    return false
  }

  const obligacionesMostradas = ocultarConBorrador
    ? obligaciones.filter(o => !tieneBorrador(o))
    : obligaciones

  // ── Selection helpers ───────────────────────────────────────────────────────
  const selectedVisible = obligacionesMostradas.filter(o => selectedObIds.has(o.obligacion_id))
  const allVisibleSelected = obligacionesMostradas.length > 0 &&
    obligacionesMostradas.every(o => selectedObIds.has(o.obligacion_id))

  const totalesPorMoneda: Map<string, number> = new Map()
  for (const o of selectedVisible) {
    totalesPorMoneda.set(o.moneda, (totalesPorMoneda.get(o.moneda) ?? 0) + o.monto_pendiente)
  }

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setSelectedObIds(new Set())
    } else {
      setSelectedObIds(new Set(obligacionesMostradas.map(o => o.obligacion_id)))
    }
  }

  function toggleSelectOb(id: string) {
    setSelectedObIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleOcultarConBorradorChange(checked: boolean) {
    setOcultarConBorrador(checked)
    setSelectedObIds(new Set())
  }

  function toggleSelectAllPagos() {
    if (allVisibleBorradoresSelected) {
      setSelectedPagoIds(new Set())
    } else {
      setSelectedPagoIds(new Set(visibleBorradores.map(p => p.id)))
    }
  }

  function toggleSelectPago(id: string) {
    setSelectedPagoIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleBulkConfirmar() {
    if (selectedVisibleBorradores.length === 0) return
    const totalesStr = Array.from(totalesPagosPorMoneda.entries())
      .map(([moneda, total]) => formatMonto(total, moneda))
      .join(' / ')
    if (
      !confirm(
        `Se confirmarán ${selectedVisibleBorradores.length} pago${selectedVisibleBorradores.length !== 1 ? 's' : ''} por un total de ${totalesStr}. Esto impactará los saldos de los fondos.`
      )
    )
      return
    setBulkPagosMessage(null)
    setActionError('')
    const ids = selectedVisibleBorradores.map(p => p.id)
    startTransition(async () => {
      try {
        const result = await onConfirmarPagosBulk(ids)
        const nConfirm = result.confirmados.length
        const nErr = result.errores.length
        if (nConfirm > 0) {
          setSelectedPagoIds(new Set())
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
    setEditing(null)
    setForm({
      ui_tipo,
      obligacion_id: ob.obligacion_id,
      fondo_id: ob.fondo_id,
      proveedor_id: ob.proveedor_id ?? '',
      gasto_id: ob.gasto_id ?? '',
      gasto_recurrente_id: ob.gasto_recurrente_id ?? '',
      anticipo_id: '',
      concepto: ob.concepto,
      monto: String(ob.monto_pendiente),
      moneda: fondo?.moneda ?? ob.moneda,
      fecha_pago: new Date().toISOString().slice(0, 10),
      comprobante_url: '',
      notas: '',
    })
    setFormError('')
    setModalOpen(true)
  }

  function handleBulkCreate() {
    const conProveedor = selectedVisible.filter(o => !!o.proveedor_id)
    const sinProveedor = selectedVisible.filter(o => !o.proveedor_id)

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

      setSelectedObIds(new Set())

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

  // ── Obligation selector filter (modal) ──────────────────────────────────────
  const obligacionesFiltradas = (() => {
    if (form.ui_tipo === 'anticipo')   return obligaciones.filter(o => o.tipo_obligacion === 'anticipo')
    if (form.ui_tipo === 'saldo')      return obligaciones.filter(o => o.tipo_obligacion === 'saldo')
    if (form.ui_tipo === 'parcial' || form.ui_tipo === 'final') {
      return obligaciones.filter(o => o.tipo_obligacion === 'gasto_total' || o.tipo_obligacion === 'saldo')
    }
    if (form.ui_tipo === 'recurrente') return obligaciones.filter(o => o.tipo_obligacion === 'recurrente')
    return []  // directo
  })()

  // ── Modal handlers ──────────────────────────────────────────────────────────

  // Encuentra una obligación "hermana" (mismo gasto/recurrente, distinto tipo)
  // que matchee con el nuevo UiTipo. Permite cambiar tipo sin perder contexto.
  function findSisterObligacion(currentOb: ObligacionPendiente, newUiTipo: UiTipo): ObligacionPendiente | undefined {
    if (newUiTipo === 'recurrente') {
      if (!currentOb.gasto_recurrente_id) return undefined
      return obligaciones.find(o =>
        o.gasto_recurrente_id === currentOb.gasto_recurrente_id
        && o.tipo_obligacion === 'recurrente'
      )
    }
    if (!currentOb.gasto_id) return undefined
    if (newUiTipo === 'anticipo') {
      return obligaciones.find(o => o.gasto_id === currentOb.gasto_id && o.tipo_obligacion === 'anticipo')
    }
    if (newUiTipo === 'saldo') {
      return obligaciones.find(o => o.gasto_id === currentOb.gasto_id && o.tipo_obligacion === 'saldo')
    }
    if (newUiTipo === 'parcial' || newUiTipo === 'final') {
      return obligaciones.find(o =>
        o.gasto_id === currentOb.gasto_id
        && (o.tipo_obligacion === 'gasto_total' || o.tipo_obligacion === 'saldo')
      )
    }
    return undefined
  }

  function handleUiTipoChange(newUiTipo: UiTipo) {
    setForm(prev => {
      // Pago directo no requiere obligación → limpiamos contexto de obligación
      if (newUiTipo === 'directo') {
        return { ...EMPTY_FORM, fecha_pago: prev.fecha_pago, ui_tipo: 'directo' }
      }

      // Si hay obligación seleccionada, buscar hermana compatible con nuevo tipo
      if (prev.obligacion_id) {
        const currentOb = obligaciones.find(o => o.obligacion_id === prev.obligacion_id)
        if (currentOb) {
          const sister = findSisterObligacion(currentOb, newUiTipo)
          if (sister) {
            const fondo = fondos.find(f => f.id === sister.fondo_id)
            // Pago parcial: dejamos monto vacío para que el usuario tipee
            // Resto: sugerimos el pendiente total
            const newMonto = newUiTipo === 'parcial' ? '' : String(sister.monto_pendiente)
            return {
              ...prev,
              ui_tipo: newUiTipo,
              obligacion_id: sister.obligacion_id,
              gasto_id: sister.gasto_id ?? '',
              gasto_recurrente_id: sister.gasto_recurrente_id ?? '',
              fondo_id: sister.fondo_id,
              moneda: fondo?.moneda ?? sister.moneda,
              proveedor_id: sister.proveedor_id ?? prev.proveedor_id,
              concepto: sister.concepto,
              monto: newMonto,
            }
          }
        }
      }

      // No hay obligación compatible: cambiar solo el tipo, limpiar obligacion_id
      // pero conservar fondo/proveedor/concepto/monto si los hubo (por si tipea manual)
      return { ...prev, ui_tipo: newUiTipo, obligacion_id: '' }
    })
  }

  function handleObligacionChange(obligacion_id: string) {
    const ob = obligaciones.find(o => o.obligacion_id === obligacion_id)
    if (!ob) {
      setForm(prev => ({ ...prev, obligacion_id: '', gasto_id: '', gasto_recurrente_id: '', concepto: '', monto: '', moneda: '', fondo_id: '', proveedor_id: '' }))
      return
    }
    const fondo = fondos.find(f => f.id === ob.fondo_id)
    setForm(prev => ({
      ...prev,
      obligacion_id,
      gasto_id: ob.gasto_id ?? '',
      gasto_recurrente_id: ob.gasto_recurrente_id ?? '',
      fondo_id: ob.fondo_id,
      moneda: fondo?.moneda ?? ob.moneda,
      proveedor_id: ob.proveedor_id ?? prev.proveedor_id,
      concepto: ob.concepto,
      monto: prev.ui_tipo === 'parcial' ? '' : String(ob.monto_pendiente),
      fecha_pago: new Date().toISOString().slice(0, 10),
    }))
  }

  function handleFondoChange(fondo_id: string) {
    const fondo = fondos.find(f => f.id === fondo_id)
    setForm(prev => ({ ...prev, fondo_id, moneda: fondo?.moneda ?? '' }))
  }

  function openNew() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(p: PagoRow) {
    setEditing(p)
    let ui_tipo: UiTipo = 'directo'
    if (p.tipo === 'anticipo') ui_tipo = 'anticipo'
    else if (p.tipo === 'saldo_anticipo') ui_tipo = 'saldo'
    else if (p.tipo === 'recurrente') ui_tipo = 'recurrente'
    else if (p.tipo === 'gasto') ui_tipo = 'final'
    setForm({
      ui_tipo,
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
    setForm(EMPTY_FORM)
    setFormError('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    executeSubmit()
  }

  // Crea pagos en estado 'pagado' atómicamente. El flujo "borrador" se eliminó
  // del UI; legacy borradores siguen siendo confirmables/editables desde la tabla.
  function executeSubmit() {
    setFormError('')
    if (!form.fondo_id) { setFormError('Seleccioná un fondo.'); return }
    if (!form.proveedor_id) { setFormError('Seleccioná un proveedor.'); return }
    if (!form.concepto.trim()) { setFormError('El concepto es requerido.'); return }
    const monto = parseFloat(form.monto)
    if (!form.monto || isNaN(monto) || monto <= 0) { setFormError('El monto debe ser mayor a 0.'); return }
    if (!form.fecha_pago) { setFormError('La fecha es requerida.'); return }
    const tiposRequierenGasto: UiTipo[] = ['anticipo', 'saldo', 'parcial', 'final']
    if (tiposRequierenGasto.includes(form.ui_tipo) && !form.gasto_id) {
      setFormError('Seleccioná la obligación vinculada.'); return
    }
    if (form.ui_tipo === 'recurrente' && !form.gasto_recurrente_id) {
      setFormError('Seleccioná la obligación recurrente vinculada.'); return
    }
    if (form.ui_tipo === 'directo' && !form.notas.trim()) {
      setFormError('Los pagos directos requieren justificación en el campo Notas.'); return
    }

    const selectedOb = obligaciones.find(o => o.obligacion_id === form.obligacion_id)
    const tipo = editing
      ? editing.tipo
      : resolveDbTipo(form.ui_tipo, selectedOb?.tipo_obligacion ?? null)

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
  const filteredPagos = q
    ? pagos.filter(
        p =>
          p.concepto.toLowerCase().includes(q) ||
          (p.fondos?.nombre ?? '').toLowerCase().includes(q) ||
          (p.proveedores?.nombre ?? '').toLowerCase().includes(q)
      )
    : pagos

  const visibleBorradores = filteredPagos.filter(p => p.estado === 'borrador')
  const selectedVisibleBorradores = visibleBorradores.filter(p => selectedPagoIds.has(p.id))
  const allVisibleBorradoresSelected =
    visibleBorradores.length > 0 && visibleBorradores.every(p => selectedPagoIds.has(p.id))

  const totalesPagosPorMoneda: Map<string, number> = new Map()
  for (const p of selectedVisibleBorradores) {
    totalesPagosPorMoneda.set(p.moneda, (totalesPagosPorMoneda.get(p.moneda) ?? 0) + p.monto)
  }

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

        {/* Selection summary + bulk action */}
        {selectedVisible.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5">
            <span className="text-sm font-medium text-slate-700">
              {selectedVisible.length} seleccionada{selectedVisible.length !== 1 ? 's' : ''}
            </span>
            <span className="text-slate-300">·</span>
            {Array.from(totalesPorMoneda.entries()).map(([moneda, total]) => (
              <span key={moneda} className="text-sm font-semibold text-slate-800">
                {formatMonto(total, moneda)}
              </span>
            ))}
            <span className="hidden text-xs text-slate-400 sm:inline">— solo confirmar impacta el saldo</span>
            {canWrite && (
              <button
                onClick={handleBulkCreate}
                disabled={isPending}
                className="ml-auto rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                Registrar pagos seleccionados ({selectedVisible.length})
              </button>
            )}
          </div>
        )}

        {/* Bulk result message */}
        {bulkMessage && (
          <div className={`rounded-lg border px-3 py-2 text-sm ${bulkMessage.isError ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {bulkMessage.text}
          </div>
        )}

        {/* Obligations table */}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {obligacionesMostradas.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-400">
              {obligaciones.length === 0
                ? 'No hay obligaciones pendientes.'
                : 'Todas las obligaciones tienen pago en borrador. Desmarcá "Ocultar con borrador" para verlas.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
                      />
                    </th>
                    <th className="hidden px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 sm:table-cell">Tipo</th>
                    <th className="hidden px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 md:table-cell">Proveedor</th>
                    <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Concepto</th>
                    <th className="hidden px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 lg:table-cell">Fondo</th>
                    <th className="hidden px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 md:table-cell">Vence</th>
                    <th className="hidden px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 sm:table-cell">Prior.</th>
                    <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Monto</th>
                    {canWrite && (
                      <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Acción</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {obligacionesMostradas.map(o => {
                    const conBorrador = tieneBorrador(o)
                    const isSelected = selectedObIds.has(o.obligacion_id)
                    return (
                      <tr
                        key={o.obligacion_id}
                        className={`transition-colors ${isSelected ? 'bg-slate-50' : 'hover:bg-gray-50'} ${conBorrador ? 'opacity-60' : ''}`}
                      >
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectOb(o.obligacion_id)}
                            className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
                          />
                        </td>
                        <td className="hidden px-3 py-2.5 sm:table-cell">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${OBLIGACION_TIPO_COLORS[o.tipo_obligacion]}`}>
                            {OBLIGACION_TIPO_LABELS[o.tipo_obligacion]}
                          </span>
                        </td>
                        <td className="hidden px-3 py-2.5 text-sm text-gray-600 md:table-cell">
                          {o.proveedor_nombre ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="text-sm font-medium text-gray-900 max-w-[200px] truncate">{o.concepto}</div>
                          {conBorrador && (
                            <span className="text-xs text-amber-600">En borrador</span>
                          )}
                        </td>
                        <td className="hidden px-3 py-2.5 text-sm text-gray-500 lg:table-cell">
                          {o.fondo_nombre}
                        </td>
                        <td className="hidden px-3 py-2.5 text-sm text-gray-500 md:table-cell whitespace-nowrap">
                          {o.fecha_vencimiento ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className={`hidden px-3 py-2.5 text-sm sm:table-cell ${PRIORIDAD_COLORS[o.prioridad_pago] ?? 'text-gray-500'}`}>
                          {PRIORIDAD_LABELS[o.prioridad_pago] ?? o.prioridad_pago}
                        </td>
                        <td className="px-3 py-2.5 text-right text-sm font-semibold text-gray-900 whitespace-nowrap">
                          {formatMonto(o.monto_pendiente, o.moneda)}
                        </td>
                        {canWrite && (
                          <td className="px-3 py-2.5 text-right">
                            <button
                              onClick={() => openPagarObligation(o)}
                              disabled={isPending}
                              className="rounded px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 transition-colors disabled:opacity-50"
                            >
                              Pagar
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── SECTION 2: Pagos registrados ────────────────────────────────────── */}
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
              placeholder="Buscar..."
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

        {selectedVisibleBorradores.length > 0 && canWrite && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5">
            <span className="text-sm font-medium text-emerald-800">
              {selectedVisibleBorradores.length} borrador{selectedVisibleBorradores.length !== 1 ? 'es' : ''} seleccionado{selectedVisibleBorradores.length !== 1 ? 's' : ''}
            </span>
            <span className="text-emerald-300">·</span>
            {Array.from(totalesPagosPorMoneda.entries()).map(([moneda, total]) => (
              <span key={moneda} className="text-sm font-semibold text-emerald-900">
                {formatMonto(total, moneda)}
              </span>
            ))}
            <span className="text-xs font-medium text-amber-700">Confirmar impactará saldos de fondos</span>
            <button
              onClick={handleBulkConfirmar}
              disabled={isPending}
              className="ml-auto rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              Confirmar pagos seleccionados ({selectedVisibleBorradores.length})
            </button>
          </div>
        )}

        {bulkPagosMessage && (
          <div className={`rounded-lg border px-3 py-2 text-sm ${bulkPagosMessage.isError ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {bulkPagosMessage.text}
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {filteredPagos.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-400">
              {search ? 'Sin resultados para esa búsqueda.' : 'No hay pagos registrados.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {canWrite && (
                      <th className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={allVisibleBorradoresSelected}
                          onChange={toggleSelectAllPagos}
                          disabled={visibleBorradores.length === 0}
                          className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500 disabled:opacity-40"
                        />
                      </th>
                    )}
                    <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 sm:table-cell">Nro</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Fecha</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Concepto</th>
                    <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 sm:table-cell">Tipo</th>
                    <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 md:table-cell">Fondo</th>
                    <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 md:table-cell">Proveedor</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Monto</th>
                    <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 lg:table-cell">Estado</th>
                    {(canWrite || isAdmin) && (
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Acciones</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredPagos.map(p => (
                    <tr key={p.id} className={`transition-colors ${selectedPagoIds.has(p.id) ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}>
                      {canWrite && (
                        <td className="px-4 py-3">
                          {p.estado === 'borrador' ? (
                            <input
                              type="checkbox"
                              checked={selectedPagoIds.has(p.id)}
                              onChange={() => toggleSelectPago(p.id)}
                              className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
                            />
                          ) : (
                            <span className="inline-block w-4" />
                          )}
                        </td>
                      )}
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
                      {(canWrite || isAdmin) && (
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            {canWrite && p.estado === 'borrador' && (
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
                            )}
                            {isAdmin && p.estado === 'pagado' && (
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

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Fecha <span className="text-red-500">*</span>
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
                    Tipo <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.ui_tipo}
                    onChange={e => handleUiTipoChange(e.target.value as UiTipo)}
                    disabled={!!editing}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 disabled:bg-gray-50 disabled:text-gray-500"
                  >
                    <option value="anticipo">Anticipo</option>
                    <option value="saldo">Pagar saldo</option>
                    <option value="parcial">Pago parcial</option>
                    <option value="final">Pago final</option>
                    <option value="recurrente">Recurrente</option>
                    <option value="directo">Pago directo</option>
                  </select>
                </div>
              </div>

              {form.ui_tipo !== 'directo' && !editing && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Obligación pendiente <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.obligacion_id}
                    onChange={e => handleObligacionChange(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  >
                    <option value="">Seleccionar obligación...</option>
                    {obligacionesFiltradas.map(o => (
                      <option key={o.obligacion_id} value={o.obligacion_id}>
                        [{OBLIGACION_TIPO_LABELS[o.tipo_obligacion]}] {o.concepto} — {o.fondo_nombre} — {formatMonto(o.monto_pendiente, o.moneda)}
                      </option>
                    ))}
                  </select>
                  {obligacionesFiltradas.length === 0 && (
                    <p className="mt-1 text-xs text-gray-400">No hay obligaciones pendientes para este tipo.</p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Fondo <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.fondo_id}
                    onChange={e => handleFondoChange(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  >
                    <option value="">Seleccionar fondo...</option>
                    {fondos.map(f => (
                      <option key={f.id} value={f.id}>{f.nombre} ({f.moneda})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Proveedor <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.proveedor_id}
                    onChange={e => setForm({ ...form, proveedor_id: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  >
                    <option value="">Seleccionar proveedor...</option>
                    {proveedores.map(p => (
                      <option key={p.id} value={p.id}>{p.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Concepto <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.concepto}
                  onChange={e => setForm({ ...form, concepto: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  placeholder="Descripción del pago"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Monto <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={form.monto}
                    onChange={e => setForm({ ...form, monto: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Moneda</label>
                  <input
                    type="text"
                    value={form.moneda}
                    readOnly
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 outline-none cursor-default"
                    placeholder="Se completa con el fondo"
                  />
                </div>
              </div>

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

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Notas
                  {form.ui_tipo === 'directo' && <span className="ml-1 text-red-500">*</span>}
                  {form.ui_tipo === 'directo' && (
                    <span className="ml-1 text-xs font-normal text-gray-400">(requerida para pagos directos)</span>
                  )}
                </label>
                <textarea
                  value={form.notas}
                  onChange={e => setForm({ ...form, notas: e.target.value })}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  placeholder={form.ui_tipo === 'directo' ? 'Justificación obligatoria para pagos directos' : 'Notas internas opcionales'}
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
                  disabled={isPending}
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
          </div>
        </div>
      )}
    </div>
  )
}
