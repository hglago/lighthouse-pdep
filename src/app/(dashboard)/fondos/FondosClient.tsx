'use client'

import { useState, useTransition } from 'react'
import type { Fondo, UserRole } from '@/types'
import { createFondo, updateFondo, deleteFondo } from './actions'

interface Props {
  fondos: Fondo[]
  role: UserRole
}

interface FormState {
  nombre: string
  moneda: string
  monto_inicial: string
  descripcion: string
}

const EMPTY_FORM: FormState = { nombre: '', moneda: 'ARS', monto_inicial: '', descripcion: '' }
const MONEDAS = ['ARS', 'USD', 'EUR']

export default function FondosClient({ fondos, role }: Props) {
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Fondo | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [isPending, startTransition] = useTransition()

  const canWrite = role === 'admin' || role === 'contador'
  const canDelete = role === 'admin'

  function openNew() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(fondo: Fondo) {
    setEditing(fondo)
    setForm({
      nombre: fondo.nombre,
      moneda: fondo.moneda,
      monto_inicial: '',
      descripcion: fondo.descripcion ?? '',
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

    const nombre = form.nombre.trim()
    if (!nombre) {
      setFormError('El nombre es requerido.')
      return
    }

    if (!editing) {
      const monto = parseFloat(form.monto_inicial)
      if (form.monto_inicial === '' || isNaN(monto) || monto < 0) {
        setFormError('El saldo inicial debe ser un número no negativo.')
        return
      }
    }

    startTransition(async () => {
      try {
        if (editing) {
          await updateFondo(editing.id, {
            nombre,
            moneda: form.moneda,
            descripcion: form.descripcion.trim() || null,
          })
        } else {
          await createFondo({
            nombre,
            moneda: form.moneda,
            monto_inicial: parseFloat(form.monto_inicial),
            descripcion: form.descripcion.trim() || null,
          })
        }
        closeModal()
      } catch (err: unknown) {
        setFormError(err instanceof Error ? err.message : 'Error al guardar.')
      }
    })
  }

  function handleDelete(id: string, nombre: string) {
    if (!confirm(`¿Eliminar el fondo "${nombre}"?`)) return
    startTransition(async () => {
      try {
        await deleteFondo(id)
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Error al eliminar.')
      }
    })
  }

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex justify-end">
          <button
            onClick={openNew}
            disabled={isPending}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            + Nuevo fondo
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {fondos.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">
            No hay fondos registrados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Nombre
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Moneda
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">
                    Saldo actual
                  </th>
                  <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 sm:table-cell">
                    Descripción
                  </th>
                  {canWrite && (
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">
                      Acciones
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {fondos.map((fondo) => (
                  <tr key={fondo.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {fondo.nombre}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {fondo.moneda}
                    </td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-gray-900">
                      {fondo.saldo_actual.toLocaleString('es-AR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="hidden px-4 py-3 text-sm text-gray-500 sm:table-cell">
                      {fondo.descripcion ?? <span className="text-gray-300">—</span>}
                    </td>
                    {canWrite && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => openEdit(fondo)}
                            disabled={isPending}
                            className="rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
                          >
                            Editar
                          </button>
                          {canDelete && (
                            <button
                              onClick={() => handleDelete(fondo.id, fondo.nombre)}
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
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-5 text-lg font-semibold text-gray-900">
              {editing ? 'Editar fondo' : 'Nuevo fondo'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Nombre <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  placeholder="Nombre del fondo"
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Moneda</label>
                <select
                  value={form.moneda}
                  onChange={(e) => setForm({ ...form, moneda: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                >
                  {MONEDAS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              {!editing && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Saldo inicial <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.monto_inicial}
                    onChange={(e) => setForm({ ...form, monto_inicial: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                    placeholder="0.00"
                  />
                </div>
              )}

              {editing && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Saldo actual
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={editing.saldo_actual.toLocaleString('es-AR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 outline-none cursor-default"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    El saldo se actualiza con los movimientos del fondo.
                  </p>
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Descripción</label>
                <textarea
                  value={form.descripcion}
                  onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  placeholder="Descripción opcional"
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
                    : 'Crear fondo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
