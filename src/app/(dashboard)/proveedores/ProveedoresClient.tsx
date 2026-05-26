'use client'

import { useState, useTransition } from 'react'
import type { Proveedor, UserRole } from '@/types'
import { createProveedor, updateProveedor, deleteProveedor, getProveedorDependencies } from './actions'
import DataTable, { type Column } from '@/components/DataTable'

interface Props {
  proveedores: Proveedor[]
  role: UserRole
}

interface FormState {
  nombre: string
  nombre_informe: string
  cuit: string
  email: string
  telefono: string
  direccion: string
  observaciones: string
  tiene_uplift: boolean
  porcentaje_uplift: string
  permite_horas_servicio: boolean
  valor_hora: string
}

const EMPTY_FORM: FormState = {
  nombre: '',
  nombre_informe: '',
  cuit: '',
  email: '',
  telefono: '',
  direccion: '',
  observaciones: '',
  tiene_uplift: false,
  porcentaje_uplift: '',
  permite_horas_servicio: false,
  valor_hora: '',
}

function toNullable(s: string): string | null {
  return s.trim() || null
}

function formatMoneda(valor: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(valor)
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
          {p.nombre_informe && <div className="text-xs text-indigo-500 truncate max-w-xs">Informe: {p.nombre_informe}</div>}
          {p.direccion && <div className="text-xs text-gray-400 truncate max-w-xs">{p.direccion}</div>}
        </div>
      ),
    },
    { key: 'cuit', label: 'CUIT', accessor: (p) => p.cuit ?? '', type: 'text', className: 'hidden sm:table-cell' },
    { key: 'email', label: 'Email', accessor: (p) => p.email ?? '', type: 'text', className: 'hidden md:table-cell' },
    { key: 'telefono', label: 'Teléfono', accessor: (p) => p.telefono ?? '', type: 'text', className: 'hidden lg:table-cell' },
    {
      key: 'servicio',
      label: 'Servicio',
      accessor: (p) => p.permite_horas_servicio ? p.valor_hora : -1, // -1 ordena los "—" al final
      type: 'number',
      className: 'hidden md:table-cell',
      render: (p) => p.permite_horas_servicio
        ? <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 whitespace-nowrap">{`Por hora — ${formatMoneda(p.valor_hora)}`}</span>
        : <span className="text-gray-300">—</span>,
    },
    {
      key: 'uplift',
      label: 'Uplift',
      accessor: (p) => p.tiene_uplift ? p.porcentaje_uplift : -1,
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
      nombre_informe: p.nombre_informe ?? '',
      cuit: p.cuit ?? '',
      email: p.email ?? '',
      telefono: p.telefono ?? '',
      direccion: p.direccion ?? '',
      observaciones: (p.observaciones ?? null) ?? '',
      tiene_uplift: p.tiene_uplift === true,
      porcentaje_uplift: p.tiene_uplift && p.porcentaje_uplift > 0
        ? String(p.porcentaje_uplift)
        : '',
      permite_horas_servicio: p.permite_horas_servicio === true,
      valor_hora: p.permite_horas_servicio && p.valor_hora > 0
        ? String(p.valor_hora)
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

    // Validación servicios por hora: si el checkbox está activo, valor_hora >= 0
    let valorHora = 0
    if (form.permite_horas_servicio) {
      const raw = form.valor_hora.trim().replace(',', '.')
      if (raw === '') {
        setFormError('Indicá el valor hora o desmarcá la opción.')
        return
      }
      const n = parseFloat(raw)
      if (!Number.isFinite(n) || n < 0) {
        setFormError('El valor hora debe ser un número mayor o igual a 0.')
        return
      }
      valorHora = n
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
      permite_horas_servicio: form.permite_horas_servicio,
      valor_hora: valorHora,
      nombre_informe: toNullable(form.nombre_informe),
    }

    startTransition(async () => {
      const result = editing
        ? await updateProveedor(editing.id, payload)
        : await createProveedor(payload)
      if (result.ok) {
        closeModal()
        return
      }
      const msg = result.error || 'Error al guardar.'
      setFormError(
        msg.includes('proveedores_cuit_unico')
          ? 'Ya existe un proveedor con ese CUIT.'
          : msg
      )
    })
  }

  // Dar de baja: NO es eliminación física. Marca deleted_at, preserva historia.
  // Antes del confirm consultamos cantidad de dependencias para informar al user.
  function handleDelete(id: string, nombre: string) {
    startTransition(async () => {
      const deps = await getProveedorDependencies(id)
      if (!deps.ok) {
        alert(`No se pudieron verificar dependencias: ${deps.error}`)
        return
      }

      const partes: string[] = []
      if (deps.gastos > 0) partes.push(`${deps.gastos} gasto${deps.gastos !== 1 ? 's' : ''}`)
      if (deps.pagos > 0)  partes.push(`${deps.pagos} pago${deps.pagos !== 1 ? 's' : ''}`)

      const ctx = partes.length > 0
        ? `Este proveedor tiene ${partes.join(' y ')} asociados. No se borrará la historia: ` +
          `el proveedor solo será dado de baja y no estará disponible para nuevas cargas.`
        : `Este proveedor no tiene gastos ni pagos asociados. Se dará de baja para que no ` +
          `aparezca en nuevas cargas. La historia queda intacta.`

      if (!confirm(`${ctx}\n\n¿Dar de baja "${nombre}"?`)) return

      const result = await deleteProveedor(id)
      if (!result.ok) {
        alert(`No se pudo dar de baja: ${result.error}`)
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
              type="button"
              onClick={() => openEdit(p)}
              disabled={isPending}
              className="rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
            >
              Editar
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={() => handleDelete(p.id, p.nombre)}
                disabled={isPending}
                className="rounded px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-50"
                title="No elimina físicamente — marca el proveedor como inactivo para nuevas cargas"
              >
                Dar de baja
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

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Nombre para informes</label>
                <input
                  type="text"
                  value={form.nombre_informe}
                  onChange={(e) => setForm({ ...form, nombre_informe: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  placeholder="Nombre que aparecerá en reportes"
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

              {/* Tipo de proveedor: servicios por hora.
                  Si el proveedor permite horas, el gasto activará bloque "Detalle del servicio"
                  con descripción, período, horas y valor hora aplicado (snapshot). Ver D23. */}
              <div className="rounded-lg border border-amber-100 bg-amber-50/40 p-3 space-y-2">
                <p className="text-sm font-semibold text-gray-800">Tipo de proveedor</p>
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-800">
                  <input
                    type="checkbox"
                    checked={form.permite_horas_servicio}
                    onChange={(e) => setForm({
                      ...form,
                      permite_horas_servicio: e.target.checked,
                      // Si desactivan el checkbox, limpio el valor para evitar confusión
                      valor_hora: e.target.checked ? form.valor_hora : '',
                    })}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  Permite cargar horas de servicio
                </label>
                {form.permite_horas_servicio && (
                  <div className="flex items-center gap-2 pl-6">
                    <label className="text-sm text-gray-600">Valor hora</label>
                    <span className="text-sm text-gray-400">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.valor_hora}
                      onChange={(e) => setForm({ ...form, valor_hora: e.target.value })}
                      className="w-40 rounded-lg border border-gray-300 px-3 py-1.5 text-sm tabular-nums outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                      placeholder="0.00"
                    />
                  </div>
                )}
              </div>

              {/* Uplift para liquidación: solo informativo. No modifica gasto, pago, fondo ni deuda.
                  Se snapshotea al gasto de servicio para futura liquidación a socios. Ver D22. */}
              <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 space-y-2">
                <p className="text-sm font-semibold text-gray-800">Uplift para liquidación</p>
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-800">
                  <input
                    type="checkbox"
                    checked={form.tiene_uplift}
                    onChange={(e) => setForm({
                      ...form,
                      tiene_uplift: e.target.checked,
                      porcentaje_uplift: e.target.checked ? form.porcentaje_uplift : '',
                    })}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  Tiene uplift
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
                <p className="text-xs text-gray-500 pt-1">
                  El uplift no modifica el gasto ni el pago. Se usará solo para futuras liquidaciones a socios.
                </p>
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
