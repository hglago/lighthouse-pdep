'use client'

import { useState, useTransition } from 'react'
import type { Fondo, Proveedor, UserRole, GastoEstado } from '@/types'
import type { GastoPayload, GastoRecurrentePayload } from './actions'
import { exportToExcel, todayForFile } from '@/lib/excel'

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
  created_by: string
  created_at: string
  fondos: { nombre: string; moneda: string } | null
  proveedores: { nombre: string } | null
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
  pagado: 'Pagado',
  rechazado: 'Rechazado',
}

const ESTADO_COLORS: Record<GastoEstado, string> = {
  borrador: 'bg-gray-100 text-gray-600',
  enviado: 'bg-blue-100 text-blue-700',
  aprobado: 'bg-green-100 text-green-700',
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
  role: UserRole
  onCreateGasto: (data: GastoPayload) => Promise<void>
  onUpdateGasto: (id: string, data: GastoPayload) => Promise<void>
  onDeleteGasto: (id: string) => Promise<void>
  onCambiarEstado: (id: string, nuevoEstado: 'enviado' | 'aprobado' | 'rechazado') => Promise<void>
  onCreateRecurrente: (data: GastoRecurrentePayload) => Promise<void>
  onUpdateRecurrente: (id: string, data: GastoRecurrentePayload) => Promise<void>
  onDeleteRecurrente: (id: string) => Promise<void>
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function GastosClient({
  gastos,
  recurrentes,
  fondos,
  proveedores,
  role,
  onCreateGasto,
  onUpdateGasto,
  onDeleteGasto,
  onCambiarEstado,
  onCreateRecurrente,
  onUpdateRecurrente,
  onDeleteRecurrente,
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

  const canWrite = role === 'admin' || role === 'contador'
  const canDelete = role === 'admin'
  const canApprove = role === 'admin' || role === 'revisor'

  const qg = searchGastos.trim().toLowerCase()
  const filteredGastos = qg
    ? gastos.filter(
        (g) =>
          g.descripcion.toLowerCase().includes(qg) ||
          (g.fondos?.nombre ?? '').toLowerCase().includes(qg) ||
          (g.proveedores?.nombre ?? '').toLowerCase().includes(qg)
      )
    : gastos

  const qr = searchRecurrentes.trim().toLowerCase()
  const filteredRecurrentes = qr
    ? recurrentes.filter(
        (r) =>
          r.concepto.toLowerCase().includes(qr) ||
          (r.fondos?.nombre ?? '').toLowerCase().includes(qr) ||
          (r.proveedores?.nombre ?? '').toLowerCase().includes(qr) ||
          (r.categoria ?? '').toLowerCase().includes(qr)
      )
    : recurrentes

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
        try {
          if (editing && editing.tipo === 'recurrente') {
            await onUpdateRecurrente(editing.row.id, payload)
          } else {
            await onCreateRecurrente(payload)
          }
          closeModal()
        } catch (err: unknown) {
          setFormError(err instanceof Error ? err.message : 'Error al guardar.')
        }
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
      try {
        await onDeleteRecurrente(id)
      } catch (err: unknown) {
        setActionError(err instanceof Error ? err.message : 'Error al eliminar.')
      }
    })
  }

  function handleToggleActivo(r: GastoRecurrenteRow) {
    setActionError('')
    startTransition(async () => {
      try {
        await onUpdateRecurrente(r.id, {
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
      } catch (err: unknown) {
        setActionError(err instanceof Error ? err.message : 'Error al cambiar estado.')
      }
    })
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
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Fecha</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Concepto</th>
                      <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 sm:table-cell">Fondo</th>
                      <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 md:table-cell">Proveedor</th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Monto</th>
                      <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 lg:table-cell">Estado</th>
                      {(canWrite || canApprove) && (
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Acciones</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredGastos.map((g) => (
                      <tr key={g.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{g.fecha_gasto}</td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-gray-900 max-w-xs truncate">{g.descripcion}</div>
                          <div className="flex gap-1 mt-0.5">
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
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_COLORS[g.estado]}`}>
                            {ESTADO_LABELS[g.estado]}
                          </span>
                        </td>
                        {(canWrite || canApprove) && (
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              {canWrite && g.estado === 'borrador' && (
                                <button onClick={() => openEditGasto(g)} disabled={isPending} className="rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50">
                                  Editar
                                </button>
                              )}
                              {canWrite && g.estado === 'borrador' && (
                                <button onClick={() => handleCambiarEstado(g.id, 'enviado')} disabled={isPending} className="rounded px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50">
                                  Enviar
                                </button>
                              )}
                              {canDelete && g.estado === 'borrador' && (
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
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Concepto</th>
                      <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 sm:table-cell">Fondo</th>
                      <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 md:table-cell">Proveedor</th>
                      <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Día</th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Monto</th>
                      <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 lg:table-cell">Estado</th>
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
                          <div className="flex gap-1 mt-0.5">
                            {r.categoria && <span className="text-xs text-gray-400">{r.categoria}</span>}
                            {r.prioridad_pago <= 2 && (
                              <span className="inline-flex rounded px-1.5 py-0 text-xs font-medium bg-amber-100 text-amber-700">{PRIORIDAD_LABELS[r.prioridad_pago]}</span>
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
                  <select value={form.proveedor_id} onChange={(e) => setForm({ ...form, proveedor_id: e.target.value })} className={inputCls}>
                    <option value="">Sin proveedor</option>
                    {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
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
    </div>
  )
}
