'use client'

import { useState, useTransition } from 'react'
import type { Fondo, Proveedor, UserRole } from '@/types'
import type { GastoRecurrentePayload } from './actions'

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

interface Props {
  recurrentes: GastoRecurrenteRow[]
  fondos: Pick<Fondo, 'id' | 'nombre' | 'moneda'>[]
  proveedores: Pick<Proveedor, 'id' | 'nombre'>[]
  role: UserRole
  onCreateRecurrente: (data: GastoRecurrentePayload) => Promise<void>
  onUpdateRecurrente: (id: string, data: GastoRecurrentePayload) => Promise<void>
  onDeleteRecurrente: (id: string) => Promise<void>
}

interface FormState {
  fondo_id: string
  proveedor_id: string
  concepto: string
  categoria: string
  monto: string
  moneda: string
  dia_vencimiento: string
  fecha_inicio: string
  fecha_fin: string
  activo: boolean
  prioridad_pago: string
  observaciones: string
}

const EMPTY_FORM: FormState = {
  fondo_id: '',
  proveedor_id: '',
  concepto: '',
  categoria: '',
  monto: '',
  moneda: '',
  dia_vencimiento: '1',
  fecha_inicio: new Date().toISOString().slice(0, 10),
  fecha_fin: '',
  activo: true,
  prioridad_pago: '3',
  observaciones: '',
}

const PRIORIDAD_LABELS: Record<number, string> = {
  1: 'Crítica',
  2: 'Alta',
  3: 'Normal',
  4: 'Baja',
}

function formatMonto(monto: number, moneda: string) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: moneda === 'USD' ? 'USD' : 'ARS',
    minimumFractionDigits: 2,
  }).format(monto)
}

export default function GastosRecurrentesClient({
  recurrentes,
  fondos,
  proveedores,
  role,
  onCreateRecurrente,
  onUpdateRecurrente,
  onDeleteRecurrente,
}: Props) {
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<GastoRecurrenteRow | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [actionError, setActionError] = useState('')

  const canWrite = role === 'admin' || role === 'contador'
  const canDelete = role === 'admin'

  const q = search.trim().toLowerCase()
  const filtered = q
    ? recurrentes.filter(
        r =>
          r.concepto.toLowerCase().includes(q) ||
          (r.fondos?.nombre ?? '').toLowerCase().includes(q) ||
          (r.proveedores?.nombre ?? '').toLowerCase().includes(q) ||
          (r.categoria ?? '').toLowerCase().includes(q)
      )
    : recurrentes

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

  function openEdit(r: GastoRecurrenteRow) {
    setEditing(r)
    setForm({
      fondo_id: r.fondo_id,
      proveedor_id: r.proveedor_id ?? '',
      concepto: r.concepto,
      categoria: r.categoria ?? '',
      monto: String(r.monto),
      moneda: r.moneda,
      dia_vencimiento: String(r.dia_vencimiento),
      fecha_inicio: r.fecha_inicio,
      fecha_fin: r.fecha_fin ?? '',
      activo: r.activo,
      prioridad_pago: String(r.prioridad_pago),
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')

    if (!form.fondo_id) { setFormError('Seleccioná un fondo.'); return }
    if (!form.concepto.trim()) { setFormError('El concepto es requerido.'); return }
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
      concepto: form.concepto.trim(),
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
        if (editing) {
          await onUpdateRecurrente(editing.id, payload)
        } else {
          await onCreateRecurrente(payload)
        }
        closeModal()
      } catch (err: unknown) {
        setFormError(err instanceof Error ? err.message : 'Error al guardar.')
      }
    })
  }

  function handleDelete(id: string, concepto: string) {
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

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por concepto, fondo, proveedor o categoría..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 sm:max-w-sm"
        />
        {canWrite && (
          <button
            onClick={openNew}
            disabled={isPending}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            + Nuevo recurrente
          </button>
        )}
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">
            {search ? 'Sin resultados para esa búsqueda.' : 'No hay gastos recurrentes registrados.'}
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
                {filtered.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900 max-w-xs truncate">{r.concepto}</div>
                      <div className="flex gap-1 mt-0.5">
                        {r.categoria && (
                          <span className="text-xs text-gray-400">{r.categoria}</span>
                        )}
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
                    <td className="px-4 py-3 text-sm text-center text-gray-600">
                      {r.dia_vencimiento}
                    </td>
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
                            <button
                              onClick={() => openEdit(r)}
                              disabled={isPending}
                              className="rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
                            >
                              Editar
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => handleDelete(r.id, r.concepto)}
                              disabled={isPending}
                              className="rounded px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                            >
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

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="mb-5 text-lg font-semibold text-gray-900">
              {editing ? 'Editar gasto recurrente' : 'Nuevo gasto recurrente'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
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
                      <option key={f.id} value={f.id}>{f.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Proveedor</label>
                  <select
                    value={form.proveedor_id}
                    onChange={e => setForm({ ...form, proveedor_id: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  >
                    <option value="">Sin proveedor</option>
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
                  placeholder="Ej: Alquiler oficina, Servicio eléctrico"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Categoría</label>
                  <input
                    type="text"
                    value={form.categoria}
                    onChange={e => setForm({ ...form, categoria: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                    placeholder="Ej: Servicios, Alquileres"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Prioridad</label>
                  <select
                    value={form.prioridad_pago}
                    onChange={e => setForm({ ...form, prioridad_pago: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  >
                    <option value="1">1 — Crítica</option>
                    <option value="2">2 — Alta</option>
                    <option value="3">3 — Normal</option>
                    <option value="4">4 — Baja</option>
                  </select>
                </div>
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

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Día vencimiento <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="28"
                    value={form.dia_vencimiento}
                    onChange={e => setForm({ ...form, dia_vencimiento: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  />
                  <p className="mt-0.5 text-xs text-gray-400">1–28</p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Fecha inicio <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.fecha_inicio}
                    onChange={e => setForm({ ...form, fecha_inicio: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Fecha fin</label>
                  <input
                    type="date"
                    value={form.fecha_fin}
                    onChange={e => setForm({ ...form, fecha_fin: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.activo}
                    onChange={e => setForm({ ...form, activo: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
                  />
                  <span className="text-sm font-medium text-gray-700">Activo</span>
                </label>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Observaciones</label>
                <textarea
                  value={form.observaciones}
                  onChange={e => setForm({ ...form, observaciones: e.target.value })}
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
                  disabled={isPending}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  {isPending ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear recurrente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
