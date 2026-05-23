'use client'

import { useState, useTransition } from 'react'

export type FinanciadorQuickPayload = {
  nombre: string
  cuit: string | null
  email: string | null
  telefono: string | null
  observaciones: string | null
}

export type FinanciadorQuickResult =
  | { ok: true; id: string; codigo: string | null; nombre: string }
  | { ok: false; error: string }

interface Props {
  open: boolean
  onClose: () => void
  /** Action que crea el financiador (devuelve id + codigo + nombre). Se pasa desde el módulo padre. */
  onCreate: (data: FinanciadorQuickPayload) => Promise<FinanciadorQuickResult>
  /** Callback al crear con éxito. El padre debe seleccionar automáticamente el nuevo financiador. */
  onCreated: (result: { id: string; codigo: string | null; nombre: string }) => void
}

/**
 * Modal mínimo para crear financiador desde otro flujo (ej: alta de gasto).
 * Sin lógica de negocio compleja: nombre obligatorio, resto opcional.
 * El padre provee la action `onCreate` y un callback `onCreated` que selecciona
 * el financiador recién creado en el form que abrió el modal.
 */
export default function FinanciadorQuickCreateModal({
  open,
  onClose,
  onCreate,
  onCreated,
}: Props) {
  const [form, setForm] = useState({
    nombre: '',
    cuit: '',
    email: '',
    telefono: '',
    observaciones: '',
  })
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function reset() {
    setForm({ nombre: '', cuit: '', email: '', telefono: '', observaciones: '' })
    setError('')
  }

  function handleClose() {
    reset()
    onClose()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.nombre.trim()) {
      setError('El nombre es requerido.')
      return
    }
    startTransition(async () => {
      const result = await onCreate({
        nombre: form.nombre.trim(),
        cuit: form.cuit.trim() || null,
        email: form.email.trim() || null,
        telefono: form.telefono.trim() || null,
        observaciones: form.observaciones.trim() || null,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onCreated({ id: result.id, codigo: result.codigo, nombre: result.nombre })
      reset()
    })
  }

  if (!open) return null

  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="mb-5 text-lg font-semibold text-gray-900">Nuevo financiador</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              autoFocus
              value={form.nombre}
              onChange={e => setForm({ ...form, nombre: e.target.value })}
              className={inputCls}
              placeholder="Juan Gómez"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">CUIT</label>
              <input type="text" value={form.cuit} onChange={e => setForm({ ...form, cuit: e.target.value })} className={inputCls} placeholder="20-12345678-9" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className={inputCls} placeholder="financiador@email.com" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Teléfono</label>
              <input type="text" value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} className={inputCls} placeholder="+54 11 1234-5678" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Observaciones</label>
            <textarea
              value={form.observaciones}
              onChange={e => setForm({ ...form, observaciones: e.target.value })}
              rows={2}
              className={`${inputCls} resize-none`}
            />
          </div>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleClose}
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
              {isPending ? 'Guardando…' : 'Crear financiador'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
