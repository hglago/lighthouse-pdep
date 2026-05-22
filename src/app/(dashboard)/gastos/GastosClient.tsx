'use client'

import { useState, useTransition, useMemo } from 'react'
import type { Fondo, Proveedor, UserRole, GastoEstado, PagoEstado, PagoTipo } from '@/types'
import type { GastoPayload, GastoRecurrentePayload, ComprobantePayload, RecurrenteActionResult, BulkGastoResult } from './actions'
import type { ProveedorQuickResult } from '../proveedores/actions'
import { exportToExcel, todayForFile } from '@/lib/excel'
import { createClient as createSupabaseBrowser } from '@/lib/supabase/client'
import { useSortable } from '@/lib/useSortable'
import SortableHeader from '@/components/SortableHeader'

// ─── Row types ───────────────────────────────────────────────────────────────

export interface GastoRow {
  id: string
  fondo_id: string
  proveedor_id: string | null
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
  fondos: { nombre: string; moneda: string } | null
  proveedores: { nombre: string } | null
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
  categoria: string | null
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
  fondos: Pick<Fondo, 'id' | 'nombre' | 'moneda'>[]
  proveedores: Pick<Proveedor, 'id' | 'nombre'>[]
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
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function GastosClient({
  gastos,
  recurrentes,
  fondos,
  proveedores,
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
  const [localExtraProveedores, setLocalExtraProveedores] = useState<{ id: string; nombre: string }[]>([])
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
    // Append a la lista local + autoseleccionar en el form de gasto
    setLocalExtraProveedores(prev =>
      prev.some(p => p.id === result.id) ? prev : [...prev, { id: result.id, nombre: result.nombre }]
    )
    setForm(prev => ({ ...prev, proveedor_id: result.id }))
    setQuickProvOpen(false)
  }

  // Lista efectiva de proveedores: props + locales (deduplicado por id), ordenado
  const effectiveProveedores = (() => {
    const map = new Map<string, { id: string; nombre: string }>()
    proveedores.forEach(p => map.set(p.id, { id: p.id, nombre: p.nombre }))
    localExtraProveedores.forEach(p => { if (!map.has(p.id)) map.set(p.id, p) })
    return Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre))
  })()

  const canWrite = role === 'admin' || role === 'contador'
  const canDelete = role === 'admin'
  const canApprove = role === 'admin' || role === 'revisor'

  const qg = searchGastos.trim().toLowerCase()
  const filteredGastosBase = qg
    ? gastos.filter(
        (g) =>
          g.descripcion.toLowerCase().includes(qg) ||
          (g.fondos?.nombre ?? '').toLowerCase().includes(qg) ||
          (g.proveedores?.nombre ?? '').toLowerCase().includes(qg)
      )
    : gastos

  const gastosAccessors = useMemo(() => ({
    fecha: (g: GastoRow) => g.fecha_gasto,
    descripcion: (g: GastoRow) => g.descripcion,
    fondo: (g: GastoRow) => g.fondos?.nombre ?? '',
    proveedor: (g: GastoRow) => g.proveedores?.nombre ?? '',
    monto: (g: GastoRow) => g.monto,
    estado: (g: GastoRow) => g.estado,
  }), [])
  const { sorted: filteredGastos, sortKey: gSortKey, sortDir: gSortDir, onSort: onGastoSort } =
    useSortable(filteredGastosBase, gastosAccessors, { key: 'fecha', dir: 'desc' })

  // Selección de gastos (mismo patrón que pagos: Set<string> + header select-all visible)
  const [selectedGastoIds, setSelectedGastoIds] = useState<Set<string>>(new Set())
  const selectedVisibleCount = filteredGastos.reduce((n, g) => n + (selectedGastoIds.has(g.id) ? 1 : 0), 0)
  const allVisibleGastosSelected = filteredGastos.length > 0 && selectedVisibleCount === filteredGastos.length
  const someVisibleGastosSelected = selectedVisibleCount > 0 && !allVisibleGastosSelected
  function toggleSelectGasto(id: string) {
    setSelectedGastoIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleSelectAllGastos() {
    if (allVisibleGastosSelected) setSelectedGastoIds(new Set())
    else setSelectedGastoIds(new Set(filteredGastos.map(g => g.id)))
  }

  // ─── Bulk actions: estado + handlers ────────────────────────────────────────
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
    actionFn: (ids: string[]) => Promise<BulkGastoResult>,
    accionDescriptiva: string,
  ) {
    const ids = Array.from(selectedGastoIds)
    if (ids.length === 0) return
    setBulkMessage(null)
    startTransition(async () => {
      try {
        const result = await actionFn(ids)
        setBulkMessage(describirResultado(result, accionDescriptiva))
        setSelectedGastoIds(new Set())
      } catch (err) {
        setBulkMessage({ text: err instanceof Error ? err.message : 'Error inesperado.', isError: true })
      }
    })
  }

  function handleBulkAprobar() {
    runBulk(onBulkAprobar, 'autorizado(s)')
  }
  function handleBulkRechazar() {
    if (!confirm(`¿Cancelar ${selectedGastoIds.size} gasto(s)? Quedarán en estado "rechazado".`)) return
    runBulk(onBulkRechazar, 'cancelado(s)')
  }
  function handleBulkDelete() {
    if (!confirm(`¿Eliminar ${selectedGastoIds.size} gasto(s)? Solo se eliminarán los que no tengan pagos asociados.`)) return
    runBulk(onBulkDelete, 'eliminado(s)')
  }

  const qr = searchRecurrentes.trim().toLowerCase()
  const filteredRecurrentesBase = qr
    ? recurrentes.filter(
        (r) =>
          r.concepto.toLowerCase().includes(qr) ||
          (r.fondos?.nombre ?? '').toLowerCase().includes(qr) ||
          (r.proveedores?.nombre ?? '').toLowerCase().includes(qr) ||
          (r.categoria ?? '').toLowerCase().includes(qr)
      )
    : recurrentes

  const recurrentesAccessors = useMemo(() => ({
    concepto: (r: GastoRecurrenteRow) => r.concepto,
    fondo: (r: GastoRecurrenteRow) => r.fondos?.nombre ?? '',
    proveedor: (r: GastoRecurrenteRow) => r.proveedores?.nombre ?? '',
    dia: (r: GastoRecurrenteRow) => r.dia_vencimiento,
    monto: (r: GastoRecurrenteRow) => r.monto,
    estado: (r: GastoRecurrenteRow) => (r.activo ? 'activo' : 'inactivo'),
  }), [])
  const { sorted: filteredRecurrentes, sortKey: rSortKey, sortDir: rSortDir, onSort: onRecurrenteSort } =
    useSortable(filteredRecurrentesBase, recurrentesAccessors, { key: 'concepto', dir: 'asc' })

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function handleFondoChange(fondo_id: string) {
    const fondo = fondos.find((f) => f.id === fondo_id)
    setForm((prev) => ({ ...prev, fondo_id, moneda: fondo?.moneda ?? '' }))
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
      es_recurrente: tipo === 'recurrente',
      fecha_gasto: todayIso(),
      fecha_inicio: todayIso(),
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
      if (!form.fondo_id) { setFormError('Seleccioná un fondo.'); return }
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
        categoria: form.categoria.trim() || null,
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
      if (!form.fondo_id) { setFormError('Seleccioná un fondo.'); return }
      if (!form.descripcion.trim()) { setFormError('El concepto es requerido.'); return }
      const monto = parseFloat(form.monto)
      if (!form.monto || isNaN(monto) || monto <= 0) { setFormError('El monto debe ser mayor a 0.'); return }
      if (!form.fecha_gasto) { setFormError('La fecha es requerida.'); return }

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
    const rows = filteredGastos.map(g => ({
      fecha: g.fecha_gasto,
      proveedor: g.proveedores?.nombre ?? '',
      concepto: g.descripcion,
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
    const rows = filteredRecurrentes.map(r => ({
      fecha: r.fecha_inicio,
      proveedor: r.proveedores?.nombre ?? '',
      concepto: r.concepto,
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
  const recurrentesGeneradosEsteMes = new Set(
    gastos
      .filter(g => g.recurrente_id && g.periodo === periodoActual)
      .map(g => g.recurrente_id as string)
  )

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
              placeholder="Buscar por concepto, fondo o proveedor..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 sm:max-w-sm"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportGastos}
                disabled={filteredGastos.length === 0}
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

          {/* Barra de acciones masivas — solo cuando hay selección */}
          {canWrite && selectedGastoIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
              <span className="text-sm font-medium text-emerald-900">
                {selectedGastoIds.size} seleccionado{selectedGastoIds.size !== 1 ? 's' : ''}
              </span>
              <span className="text-emerald-300">·</span>
              <button
                type="button"
                onClick={handleBulkAprobar}
                disabled={isPending}
                className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 transition-colors disabled:opacity-50"
              >
                Autorizar seleccionados
              </button>
              <button
                type="button"
                onClick={handleBulkRechazar}
                disabled={isPending}
                className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-50"
              >
                Cancelar seleccionados
              </button>
              {canDelete && (
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  disabled={isPending}
                  className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  Eliminar seleccionados
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedGastoIds(new Set())}
                disabled={isPending}
                className="ml-auto rounded-md px-2 py-1.5 text-xs text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-50"
              >
                Limpiar selección
              </button>
            </div>
          )}

          {/* Feedback de última acción masiva */}
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

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            {filteredGastos.length === 0 ? (
              <div className="p-12 text-center text-sm text-gray-400">
                {searchGastos ? 'Sin resultados para esa búsqueda.' : 'No hay gastos registrados.'}
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
                            ref={el => { if (el) el.indeterminate = someVisibleGastosSelected }}
                            checked={allVisibleGastosSelected}
                            onChange={toggleSelectAllGastos}
                            disabled={filteredGastos.length === 0}
                            className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500 disabled:opacity-40"
                            aria-label="Seleccionar todos los gastos visibles"
                          />
                        </th>
                      )}
                      <SortableHeader label="Fecha" sortKey="fecha" activeKey={gSortKey} dir={gSortDir} onSort={onGastoSort} />
                      <SortableHeader label="Concepto" sortKey="descripcion" activeKey={gSortKey} dir={gSortDir} onSort={onGastoSort} />
                      <SortableHeader label="Fondo" sortKey="fondo" activeKey={gSortKey} dir={gSortDir} onSort={onGastoSort} className="hidden sm:table-cell" />
                      <SortableHeader label="Proveedor" sortKey="proveedor" activeKey={gSortKey} dir={gSortDir} onSort={onGastoSort} className="hidden md:table-cell" />
                      <SortableHeader label="Monto" sortKey="monto" activeKey={gSortKey} dir={gSortDir} onSort={onGastoSort} align="right" />
                      <SortableHeader label="Estado" sortKey="estado" activeKey={gSortKey} dir={gSortDir} onSort={onGastoSort} className="hidden lg:table-cell" />
                      {(canWrite || canApprove) && (
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Acciones</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredGastos.map((g) => (
                      <tr key={g.id} className={`transition-colors ${selectedGastoIds.has(g.id) ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}>
                        {canWrite && (
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={selectedGastoIds.has(g.id)}
                              onChange={() => toggleSelectGasto(g.id)}
                              className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
                              aria-label={`Seleccionar gasto ${g.descripcion}`}
                            />
                          </td>
                        )}
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{g.fecha_gasto}</td>
                        <td className="px-4 py-3">
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
                          <div className="flex gap-1 mt-0.5 items-center">
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
                        </td>
                        <td className="hidden px-4 py-3 text-sm text-gray-500 sm:table-cell">
                          {g.fondos?.nombre ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="hidden px-4 py-3 text-sm text-gray-500 md:table-cell">
                          {g.proveedores?.nombre ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 whitespace-nowrap">
                          {formatMonto(g.monto, g.moneda)}
                        </td>
                        <td className="hidden px-4 py-3 lg:table-cell">
                          {(() => {
                            const ui = estadoUI(g)
                            return (
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ui.cls}`}>
                                {ui.label}
                              </span>
                            )
                          })()}
                        </td>
                        {(canWrite || canApprove) && (
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              {canWrite && (g.estado === 'borrador' || g.estado === 'enviado') && (
                                <button onClick={() => openEditGasto(g)} disabled={isPending} className="rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50">
                                  Editar
                                </button>
                              )}
                              {/* "Enviar" solo legacy: nuevos gastos nacen 'enviado' */}
                              {canWrite && g.estado === 'borrador' && (
                                <button onClick={() => handleCambiarEstado(g.id, 'enviado')} disabled={isPending} className="rounded px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50">
                                  Enviar
                                </button>
                              )}
                              {canDelete && (g.estado === 'borrador' || g.estado === 'enviado') && (
                                <button onClick={() => handleDeleteGasto(g.id, g.descripcion)} disabled={isPending} className="rounded px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
                                  Eliminar
                                </button>
                              )}
                              {canApprove && g.estado === 'enviado' && (
                                <button onClick={() => handleCambiarEstado(g.id, 'aprobado')} disabled={isPending} className="rounded px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 transition-colors disabled:opacity-50">
                                  Aprobar
                                </button>
                              )}
                              {canApprove && g.estado === 'enviado' && (
                                <button onClick={() => handleCambiarEstado(g.id, 'rechazado')} disabled={isPending} className="rounded px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
                                  Rechazar
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
                disabled={filteredRecurrentes.length === 0}
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

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            {filteredRecurrentes.length === 0 ? (
              <div className="p-12 text-center text-sm text-gray-400">
                {searchRecurrentes ? 'Sin resultados para esa búsqueda.' : 'No hay gastos recurrentes configurados.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <SortableHeader label="Concepto" sortKey="concepto" activeKey={rSortKey} dir={rSortDir} onSort={onRecurrenteSort} />
                      <SortableHeader label="Fondo" sortKey="fondo" activeKey={rSortKey} dir={rSortDir} onSort={onRecurrenteSort} className="hidden sm:table-cell" />
                      <SortableHeader label="Proveedor" sortKey="proveedor" activeKey={rSortKey} dir={rSortDir} onSort={onRecurrenteSort} className="hidden md:table-cell" />
                      <SortableHeader label="Día" sortKey="dia" activeKey={rSortKey} dir={rSortDir} onSort={onRecurrenteSort} align="center" />
                      <SortableHeader label="Monto" sortKey="monto" activeKey={rSortKey} dir={rSortDir} onSort={onRecurrenteSort} align="right" />
                      <SortableHeader label="Estado" sortKey="estado" activeKey={rSortKey} dir={rSortDir} onSort={onRecurrenteSort} className="hidden lg:table-cell" />
                      {(canWrite || canDelete) && (
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Acciones</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredRecurrentes.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-gray-900 max-w-xs truncate">{r.concepto}</div>
                          <div className="flex gap-1 mt-0.5 items-center">
                            {r.categoria && <span className="text-xs text-gray-400">{r.categoria}</span>}
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
                        </td>
                        <td className="hidden px-4 py-3 text-sm text-gray-500 sm:table-cell">
                          {r.fondos?.nombre ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="hidden px-4 py-3 text-sm text-gray-500 md:table-cell">
                          {r.proveedores?.nombre ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-center text-gray-600">{r.dia_vencimiento}</td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 whitespace-nowrap">
                          {formatMonto(r.monto, r.moneda)}
                        </td>
                        <td className="hidden px-4 py-3 lg:table-cell">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${r.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {r.activo ? 'Activo' : 'Inactivo'}
                          </span>
                        </td>
                        {(canWrite || canDelete) && (
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
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

              {/* Campos comunes */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Fondo <span className="text-red-500">*</span>
                  </label>
                  <select value={form.fondo_id} onChange={(e) => handleFondoChange(e.target.value)} className={inputCls}>
                    <option value="">Seleccionar fondo...</option>
                    {fondos.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Proveedor</label>
                  <div className="flex gap-2">
                    <select
                      value={form.proveedor_id}
                      onChange={(e) => setForm({ ...form, proveedor_id: e.target.value })}
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
                  <input type="number" min="0.01" step="0.01" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} className={inputCls} placeholder="0.00" />
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
              {isRecurrenteMode && (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Categoría</label>
                    <input type="text" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} className={inputCls} placeholder="Ej: Servicios, Alquileres" />
                  </div>

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
