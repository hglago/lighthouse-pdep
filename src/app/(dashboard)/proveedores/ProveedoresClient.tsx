'use client'

import { useState, useTransition } from 'react'
import type { Proveedor, UserRole } from '@/types'
import { createProveedor, updateProveedor, deleteProveedor } from './actions'
import DataTable, { type Column } from '@/components/DataTable'

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
  tiene_uplift: boolean
  porcentaje_uplift: string  // string en el form, se castea a number al submit
}

const EMPTY_FORM: FormState = {
  nombre: '',
  cuit: '',
  email: '',
  telefono: '',
  direccion: '',
  observaciones: '',
  tiene_uplift: false,
  porcentaje_uplift: '',
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

  // Columnas para DataTable (sort + filter por columna habilitados por defecto).
  const columns: Column<Proveedor>[] = [
    {
      key: 'nombre',
      label: 'Nombre',
      accessor: (p) => p.nombre,
      type: 'text',
      render: (p) => (
        <div>
          <div className="text-sm font-medium text-gray-900">{p.nombre}</div>
          {p.direccion && <div className="text-xs text-gray-400 truncate max-w-xs">{p.direccion}</div>}
        </div>
      ),
    },
    { key: 'cuit', label: 'CUIT', accessor: (p) => p.cuit ?? '', type: 'text', className: 'hidden sm:table-cell' },
    { key: 'email', label: 'Email', accessor: (p) => p.email ?? '', type: 'text', className: 'hidden md:table-cell' },
    { key: 'telefono', label: 'Teléfono', accessor: (p) => p.telefono ?? '', type: 'text', className: 'hidden lg:table-cell' },
    {
      key: 'uplift',
      label: 'Uplift',
      accessor: (p) => p.tiene_uplift ? p.porcentaje_uplift : -1, // -1 ordena los "sin uplift" al final
      type: 'number',
      align: 'right',
      className: 'hidden md:table-cell',
      render: (p) => p.tiene_uplift && p.porcentaje_uplift > 0
        ? <span className="tabular-nums text-indigo-700 font-medium">{p.porcentaje_uplift.toFixed(2)}%</span>
        : <span className="text-gray-300">—</span>,
    },
  ]

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
      tiene_uplift: p.tiene_uplift === true,
      porcentaje_uplift: p.tiene_uplift && p.porcentaje_uplift > 0
        ? String(p.porcentaje_uplift)
        : '',
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

    // Validación uplift: solo requerido si el checkbox está activo
    let porcentajeUplift = 0
    if (form.tiene_uplift) {
      const raw = form.porcentaje_uplift.trim().replace(',', '.')
      if (raw === '') {
        setFormError('Indicá el % de uplift o desmarcá la opción.')
        return
      }
      const n = parseFloat(raw)
      if (!Number.isFinite(n) || n < 0) {
        setFormError('El % de uplift debe ser un número mayor o igual a 0.')
        return
      }
      porcentajeUplift = n
    }

    const payload = {
      nombre,
      cuit: toNullable(form.cuit),
      email: toNullable(form.email),
      telefono: toNullable(form.telefono),
      direccion: toNullable(form.direccion),
      observaciones: toNullable(form.observaciones),
      tiene_uplift: form.tiene_uplift,
      porcentaje_uplift: porcentajeUplift,
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

      <DataTable
        rows={proveedores}
        columns={columns}
        getRowId={(p) => p.id}
        searchTerm={search}
        searchKeys={['nombre', 'cuit', 'email']}
        initialSort={{ key: 'nombre', dir: 'asc' }}
        emptyMessage={search ? 'Sin resultados para esa búsqueda.' : 'No hay proveedores registrados.'}
        rowActions={canWrite ? (p) => (
          <>
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
          </>
        ) : undefined}
      />

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

              {/* Uplift: porcentaje incremental para rendición/informes.
                  No modifica el importe original del gasto/honorario. */}
              <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 space-y-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-800">
                  <input
                    type="checkbox"
                    checked={form.tiene_uplift}
                    onChange={(e) => setForm({
                      ...form,
                      tiene_uplift: e.target.checked,
                      // Si desactivan el checkbox, limpio el % para evitar confusión
                      porcentaje_uplift: e.target.checked ? form.porcentaje_uplift : '',
                    })}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  Tiene uplift
                  <span className="text-xs font-normal text-gray-500">
                    (incremento para rendición — no afecta importes cargados)
                  </span>
                </label>
                {form.tiene_uplift && (
                  <div className="flex items-center gap-2 pl-6">
                    <label className="text-sm text-gray-600">% uplift</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.porcentaje_uplift}
                      onChange={(e) => setForm({ ...form, porcentaje_uplift: e.target.value })}
                      className="w-28 rounded-lg border border-gray-300 px-3 py-1.5 text-sm tabular-nums outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                      placeholder="0.00"
                    />
                    <span className="text-sm text-gray-400">%</span>
                  </div>
                )}
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
