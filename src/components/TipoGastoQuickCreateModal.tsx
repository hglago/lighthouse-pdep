'use client'

import { useState, useTransition } from 'react'

export type TipoGastoQuickPayload = {
  codigo: string
  nombre: string
  descripcion: string | null
}

export type TipoGastoQuickResult =
  | { ok: true; id: string; codigo: string; nombre: string }
  | { ok: false; error: string }

interface Props {
  open: boolean
  onClose: () => void
  /** Action que crea el tipo (uppercase del codigo se aplica acá antes de enviar). */
  onCreate: (data: TipoGastoQuickPayload) => Promise<TipoGastoQuickResult>
  /** Callback al crear con éxito. El padre debe seleccionar automáticamente el nuevo tipo. */
  onCreated: (result: { id: string; codigo: string; nombre: string }) => void
}

/**
 * TIPOS-GASTO (2026-05-25): Modal mínimo para crear un tipo de gasto desde el
 * modal de gasto. Código se normaliza a mayúsculas + trim. Validaciones inline.
 */
export default function TipoGastoQuickCreateModal({
  open,
  onClose,
  onCreate,
  onCreated,
}: Props) {
  const [form, setForm] = useState({ codigo: '', nombre: '', descripcion: '' })
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function reset() {
    setForm({ codigo: '', nombre: '', descripcion: '' })
    setError('')
  }

  function handleClose() {
    reset()
    onClose()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const codigo = form.codigo.trim().toUpperCase()
    const nombre = form.nombre.trim()

    if (!codigo) {
      setError('El código es requerido.')
      return
    }
    if (codigo.length < 2 || codigo.length > 12) {
      setError('El código debe tener entre 2 y 12 caracteres (sugerido 3 a 8).')
      return
    }
    if (/\s/.test(codigo)) {
      setError('El código no puede tener espacios.')
      return
    }
    if (!nombre) {
      setError('El nombre es requerido.')
      return
    }

    startTransition(async () => {
      const result = await onCreate({
        codigo,
        nombre,
        descripcion: form.descripcion.trim() || null,
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Nuevo tipo de gasto</h2>
        <p className="mb-4 text-xs text-gray-500">Quedará seleccionado en el gasto al guardar.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Código <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              autoFocus
              value={form.codigo}
              onChange={e => setForm({ ...form, codigo: e.target.value.toUpperCase() })}
              maxLength={12}
              className={`${inputCls} font-mono uppercase`}
              placeholder="LEGAL"
            />
            <p className="mt-1 text-[11px] text-gray-400">3 a 8 caracteres recomendado. Mayúsculas. Sin espacios.</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.nombre}
              onChange={e => setForm({ ...form, nombre: e.target.value })}
              className={inputCls}
              placeholder="Legal / Escribanía"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Descripción</label>
            <textarea
              value={form.descripcion}
              onChange={e => setForm({ ...form, descripcion: e.target.value })}
              rows={2}
              className={`${inputCls} resize-none`}
              placeholder="Opcional"
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
              {isPending ? 'Guardando…' : 'Crear tipo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
