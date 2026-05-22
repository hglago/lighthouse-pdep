'use client'

import { useState, useTransition, useMemo } from 'react'
import type { Proveedor, UserRole } from '@/types'
import { createProveedor, updateProveedor, deleteProveedor } from './actions'
import { useSortable } from '@/lib/useSortable'
import SortableHeader from '@/components/SortableHeader'

interface Props {
  proveedores: Proveedor[]
  role: UserRole
}

interface FormState {
  nombre: string
  cuit: string
  email: string
  telefono: string
  direccion: string
  observaciones: string
}

const EMPTY_FORM: FormState = {
  nombre: '',
  cuit: '',
  email: '',
  telefono: '',
  direccion: '',
  observaciones: '',
}

function toNullable(s: string): string | null {
  return s.trim() || null
}

export default function ProveedoresClient({ proveedores, role }: Props) {
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Proveedor | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [isPending, startTransition] = useTransition()

  const canWrite = role === 'admin' || role === 'contador'
  const canDelete = role === 'admin'

  const q = search.trim().toLowerCase()
  const filteredBase = q
    ? proveedores.filter(
        (p) =>
          p.nombre.toLowerCase().includes(q) ||
          (p.cuit ?? '').toLowerCase().includes(q)
      )
    : proveedores

  const provAccessors = useMemo(() => ({
    nombre: (p: Proveedor) => p.nombre,
    cuit: (p: Proveedor) => p.cuit ?? '',
    email: (p: Proveedor) => p.email ?? '',
    telefono: (p: Proveedor) => p.telefono ?? '',
  }), [])
  const { sorted: filtered, sortKey: pvSortKey, sortDir: pvSortDir, onSort: onProvSort } =
    useSortable(filteredBase, provAccessors, { key: 'nombre', dir: 'asc' })

  function openNew() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(p: Proveedor) {
    setEditing(p)
    setForm({
      nombre: p.nombre,
      cuit: p.cuit ?? '',
      email: p.email ?? '',
      telefono: p.telefono ?? '',
      direccion: p.direccion ?? '',
      observaciones: (p.observaciones ?? null) ?? '',
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

    const payload = {
      nombre,
      cuit: toNullable(form.cuit),
      email: toNullable(form.email),
      telefono: toNullable(form.telefono),
      direccion: toNullable(form.direccion),
      observaciones: toNullable(form.observaciones),
    }

    startTransition(async () => {
      try {
        if (editing) {
          await updateProveedor(editing.id, payload)
        } else {
          await createProveedor(payload)
        }
        closeModal()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error al guardar.'
        setFormError(
          msg.includes('proveedores_cuit_unico')
            ? 'Ya existe un proveedor con ese CUIT.'
            : msg
        )
      }
    })
  }

  function handleDelete(id: string, nombre: string) {
    if (!confirm(`¿Eliminar el proveedor "${nombre}"?`)) return
    startTransition(async () => {
      try {
        await deleteProveedor(id)
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Error al eliminar.')
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
          placeholder="Buscar por nombre o CUIT..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 sm:max-w-xs"
        />
        {canWrite && (
          <button
            onClick={openNew}
            disabled={isPending}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            + Nuevo proveedor
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">
            {search ? 'Sin resultados para esa búsqueda.' : 'No hay proveedores registrados.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <SortableHeader label="Nombre" sortKey="nombre" activeKey={pvSortKey} dir={pvSortDir} onSort={onProvSort} />
                  <SortableHeader label="CUIT" sortKey="cuit" activeKey={pvSortKey} dir={pvSortDir} onSort={onProvSort} className="hidden sm:table-cell" />
                  <SortableHeader label="Email" sortKey="email" activeKey={pvSortKey} dir={pvSortDir} onSort={onProvSort} className="hidden md:table-cell" />
                  <SortableHeader label="Teléfono" sortKey="telefono" activeKey={pvSortKey} dir={pvSortDir} onSort={onProvSort} className="hidden lg:table-cell" />
                  {canWrite && (
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Acciones</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">{p.nombre}</div>
                      {p.direccion && (
                        <div className="text-xs text-gray-400 truncate max-w-xs">{p.direccion}</div>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-sm text-gray-500 sm:table-cell">
                      {p.cuit ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="hidden px-4 py-3 text-sm text-gray-500 md:table-cell">
                      {p.email ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="hidden px-4 py-3 text-sm text-gray-500 lg:table-cell">
                      {p.telefono ?? <span className="text-gray-300">—</span>}
                    </td>
                    {canWrite && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => openEdit(p)}
                            disabled={isPending}
                            className="rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
                          >
                            Editar
                          </button>
                          {canDelete && (
                            <button
                              onClick={() => handleDelete(p.id, p.nombre)}
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
              {editing ? 'Editar proveedor' : 'Nuevo proveedor'}
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
                  placeholder="Razón social o nombre"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">CUIT</label>
                  <input
                    type="text"
                    value={form.cuit}
                    onChange={(e) => setForm({ ...form, cuit: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                    placeholder="20-12345678-9"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                    placeholder="contacto@empresa.com"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Teléfono</label>
                  <input
                    type="text"
                    value={form.telefono}
                    onChange={(e) => setForm({ ...form, telefono: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                    placeholder="+54 11 1234-5678"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Dirección</label>
                  <input
                    type="text"
                    value={form.direccion}
                    onChange={(e) => setForm({ ...form, direccion: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                    placeholder="Av. Corrientes 1234, CABA"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Observaciones</label>
                <textarea
                  value={form.observaciones}
                  onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
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
                  {isPending ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear proveedor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
