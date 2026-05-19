'use client'

import { useState, useTransition } from 'react'
import type { Fondo, Proveedor, UserRole, GastoEstado } from '@/types'
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
  created_by: string
  created_at: string
  fondos: { nombre: string; moneda: string } | null
  proveedores: { nombre: string } | null
}

type GastoPayload = {
  fondo_id: string
  proveedor_id: string
  descripcion: string
  monto: number
  moneda: string
  fecha_gasto: string
  notas: string | null
}

interface Props {
  gastos: GastoRow[]
  fondos: Pick<Fondo, 'id' | 'nombre' | 'moneda'>[]
  proveedores: Pick<Proveedor, 'id' | 'nombre'>[]
  role: UserRole
  onCreateGasto: (data: GastoPayload) => Promise<void>
  onUpdateGasto: (id: string, data: GastoPayload) => Promise<void>
  onDeleteGasto: (id: string) => Promise<void>
  onCambiarEstado: (id: string, nuevoEstado: 'enviado' | 'aprobado' | 'rechazado') => Promise<void>
}

interface FormState {
  fondo_id: string
  proveedor_id: string
  descripcion: string
  monto: string
  moneda: string
  fecha_gasto: string
  notas: string
}

const EMPTY_FORM: FormState = {
  fondo_id: '',
  proveedor_id: '',
  descripcion: '',
  monto: '',
  moneda: '',
  fecha_gasto: new Date().toISOString().slice(0, 10),
  notas: '',
}

function formatMonto(monto: number, moneda: string) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: moneda === 'USD' ? 'USD' : 'ARS',
    minimumFractionDigits: 2,
  }).format(monto)
}

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

export default function GastosClient({ gastos, fondos, proveedores, role, onCreateGasto, onUpdateGasto, onDeleteGasto, onCambiarEstado }: Props) {
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<GastoRow | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [actionError, setActionError] = useState('')

  const canWrite = role === 'admin' || role === 'contador'
  const canDelete = role === 'admin'
  const canApprove = role === 'admin' || role === 'revisor'

  const q = search.trim().toLowerCase()
  const filtered = q
    ? gastos.filter(
        (g) =>
          g.descripcion.toLowerCase().includes(q) ||
          (g.fondos?.nombre ?? '').toLowerCase().includes(q) ||
          (g.proveedores?.nombre ?? '').toLowerCase().includes(q)
      )
    : gastos

  function handleFondoChange(fondo_id: string) {
    const fondo = fondos.find((f) => f.id === fondo_id)
    setForm((prev) => ({ ...prev, fondo_id, moneda: fondo?.moneda ?? '' }))
  }

  function openNew() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(g: GastoRow) {
    setEditing(g)
    setForm({
      fondo_id: g.fondo_id,
      proveedor_id: g.proveedor_id ?? '',
      descripcion: g.descripcion,
      monto: String(g.monto),
      moneda: g.moneda,
      fecha_gasto: g.fecha_gasto,
      notas: g.notas ?? '',
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
    if (!form.descripcion.trim()) { setFormError('El concepto es requerido.'); return }
    const monto = parseFloat(form.monto)
    if (!form.monto || isNaN(monto) || monto <= 0) { setFormError('El monto debe ser mayor a 0.'); return }
    if (!form.fecha_gasto) { setFormError('La fecha es requerida.'); return }

    const payload = {
      fondo_id: form.fondo_id,
      proveedor_id: form.proveedor_id || '',
      descripcion: form.descripcion.trim(),
      monto,
      moneda: form.moneda,
      fecha_gasto: form.fecha_gasto,
      notas: form.notas.trim() || null,
    }

    startTransition(async () => {
      try {
        if (editing) {
          await onUpdateGasto(editing.id, payload)
        } else {
          await onCreateGasto(payload)
        }
        closeModal()
      } catch (err: unknown) {
        setFormError(err instanceof Error ? err.message : 'Error al guardar.')
      }
    })
  }

  function handleDelete(id: string, descripcion: string) {
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

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por concepto, fondo o proveedor..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 sm:max-w-sm"
        />
        {canWrite && (
          <button
            onClick={openNew}
            disabled={isPending}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            + Nuevo gasto
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
            {search ? 'Sin resultados para esa búsqueda.' : 'No hay gastos registrados.'}
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
                {filtered.map((g) => (
                  <tr key={g.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                      {g.fecha_gasto}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900 max-w-xs truncate">{g.descripcion}</div>
                      {g.notas && (
                        <div className="text-xs text-gray-400 truncate max-w-xs">{g.notas}</div>
                      )}
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
                            <button
                              onClick={() => openEdit(g)}
                              disabled={isPending}
                              className="rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
                            >
                              Editar
                            </button>
                          )}
                          {canWrite && g.estado === 'borrador' && (
                            <button
                              onClick={() => handleCambiarEstado(g.id, 'enviado')}
                              disabled={isPending}
                              className="rounded px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
                            >
                              Enviar
                            </button>
                          )}
                          {canDelete && g.estado === 'borrador' && (
                            <button
                              onClick={() => handleDelete(g.id, g.descripcion)}
                              disabled={isPending}
                              className="rounded px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                            >
                              Eliminar
                            </button>
                          )}
                          {canApprove && g.estado === 'enviado' && (
                            <button
                              onClick={() => handleCambiarEstado(g.id, 'aprobado')}
                              disabled={isPending}
                              className="rounded px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 transition-colors disabled:opacity-50"
                            >
                              Aprobar
                            </button>
                          )}
                          {canApprove && g.estado === 'enviado' && (
                            <button
                              onClick={() => handleCambiarEstado(g.id, 'rechazado')}
                              disabled={isPending}
                              className="rounded px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                            >
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

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="mb-5 text-lg font-semibold text-gray-900">
              {editing ? 'Editar gasto' : 'Nuevo gasto'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Fecha <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.fecha_gasto}
                    onChange={(e) => setForm({ ...form, fecha_gasto: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Fondo <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.fondo_id}
                    onChange={(e) => handleFondoChange(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  >
                    <option value="">Seleccionar fondo...</option>
                    {fondos.map((f) => (
                      <option key={f.id} value={f.id}>{f.nombre}</option>
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
                  value={form.descripcion}
                  onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  placeholder="Descripción del gasto"
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
                    onChange={(e) => setForm({ ...form, monto: e.target.value })}
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
                <label className="mb-1 block text-sm font-medium text-gray-700">Proveedor</label>
                <select
                  value={form.proveedor_id}
                  onChange={(e) => setForm({ ...form, proveedor_id: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                >
                  <option value="">Sin proveedor</option>
                  {proveedores.map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Observaciones</label>
                <textarea
                  value={form.notas}
                  onChange={(e) => setForm({ ...form, notas: e.target.value })}
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
                  {isPending ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear gasto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
