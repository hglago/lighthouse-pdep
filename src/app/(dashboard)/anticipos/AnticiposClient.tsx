'use client'

import { useState, useTransition } from 'react'
import type { Fondo, Proveedor, UserRole, AnticipoEstado } from '@/types'
import type { AnticipoPayload } from './actions'

export interface AnticipoRow {
  id: string
  proveedor_id: string
  fondo_id: string
  concepto: string
  monto_total: number
  porcentaje_anticipo: number
  monto_anticipo: number
  monto_saldo: number
  moneda: string
  fecha_acuerdo: string
  fecha_vencimiento_saldo: string | null
  estado: AnticipoEstado
  observaciones: string | null
  created_by: string
  created_at: string
  proveedores: { nombre: string } | null
  fondos: { nombre: string; moneda: string } | null
}

interface Props {
  anticipos: AnticipoRow[]
  fondos: Pick<Fondo, 'id' | 'nombre' | 'moneda'>[]
  proveedores: Pick<Proveedor, 'id' | 'nombre'>[]
  role: UserRole
  onCreateAnticipo: (data: AnticipoPayload) => Promise<void>
  onUpdateAnticipo: (id: string, data: AnticipoPayload) => Promise<void>
  onCambiarEstado: (id: string, nuevoEstado: Exclude<AnticipoEstado, 'borrador'>) => Promise<void>
}

const ESTADO_LABELS: Record<AnticipoEstado, string> = {
  borrador: 'Borrador',
  comprometido: 'Comprometido',
  parcialmente_pagado: 'Parcialmente pagado',
  pagado: 'Pagado',
  cancelado: 'Cancelado',
}

const ESTADO_COLORS: Record<AnticipoEstado, string> = {
  borrador: 'bg-gray-100 text-gray-700',
  comprometido: 'bg-blue-100 text-blue-700',
  parcialmente_pagado: 'bg-yellow-100 text-yellow-700',
  pagado: 'bg-green-100 text-green-700',
  cancelado: 'bg-red-100 text-red-700',
}

const MONEDAS = ['ARS', 'USD', 'EUR']

const emptyForm = (): AnticipoPayload => ({
  proveedor_id: '',
  fondo_id: '',
  concepto: '',
  monto_total: 0,
  porcentaje_anticipo: 0,
  monto_anticipo: 0,
  moneda: 'ARS',
  fecha_acuerdo: new Date().toISOString().split('T')[0],
  fecha_vencimiento_saldo: null,
  observaciones: null,
})

export default function AnticiposClient({
  anticipos,
  fondos,
  proveedores,
  role,
  onCreateAnticipo,
  onUpdateAnticipo,
  onCambiarEstado,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<AnticipoPayload>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const canWrite = role === 'admin' || role === 'contador'
  const isAdmin = role === 'admin'

  function openCreate() {
    setForm(emptyForm())
    setEditingId(null)
    setFormError(null)
    setShowForm(true)
  }

  function openEdit(a: AnticipoRow) {
    setForm({
      proveedor_id: a.proveedor_id,
      fondo_id: a.fondo_id,
      concepto: a.concepto,
      monto_total: a.monto_total,
      porcentaje_anticipo: a.porcentaje_anticipo,
      monto_anticipo: a.monto_anticipo,
      moneda: a.moneda,
      fecha_acuerdo: a.fecha_acuerdo,
      fecha_vencimiento_saldo: a.fecha_vencimiento_saldo,
      observaciones: a.observaciones,
    })
    setEditingId(a.id)
    setFormError(null)
    setShowForm(true)
  }

  function setField<K extends keyof AnticipoPayload>(key: K, value: AnticipoPayload[K]) {
    setForm(prev => {
      const next = { ...prev, [key]: value }
      if (key === 'monto_total' || key === 'porcentaje_anticipo') {
        const total = key === 'monto_total' ? (value as number) : prev.monto_total
        const pct = key === 'porcentaje_anticipo' ? (value as number) : prev.porcentaje_anticipo
        next.monto_anticipo = Math.round(total * pct) / 100
      }
      if (key === 'monto_anticipo') {
        const total = prev.monto_total
        next.porcentaje_anticipo = total > 0 ? Math.round((value as number) / total * 10000) / 100 : 0
      }
      if (key === 'fondo_id') {
        const fondo = fondos.find(f => f.id === (value as string))
        if (fondo) next.moneda = fondo.moneda
      }
      return next
    })
  }

  const montoSaldo = form.monto_total - form.monto_anticipo

  function handleSubmit() {
    if (!form.proveedor_id) { setFormError('Seleccioná un proveedor.'); return }
    if (!form.fondo_id) { setFormError('Seleccioná un fondo.'); return }
    if (!form.concepto.trim()) { setFormError('El concepto es requerido.'); return }
    if (form.monto_total <= 0) { setFormError('El monto total debe ser mayor a 0.'); return }
    if (form.monto_anticipo <= 0 || form.monto_anticipo > form.monto_total) {
      setFormError('El monto anticipo debe ser mayor a 0 y no superar el total.')
      return
    }
    if (!form.fecha_acuerdo) { setFormError('La fecha de acuerdo es requerida.'); return }

    setFormError(null)
    startTransition(async () => {
      try {
        if (editingId) {
          await onUpdateAnticipo(editingId, form)
        } else {
          await onCreateAnticipo(form)
        }
        setShowForm(false)
        setEditingId(null)
      } catch (e) {
        setFormError(e instanceof Error ? e.message : 'Error al guardar.')
      }
    })
  }

  function handleEstado(id: string, nuevoEstado: Exclude<AnticipoEstado, 'borrador'>) {
    setActionError(null)
    startTransition(async () => {
      try {
        await onCambiarEstado(id, nuevoEstado)
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Error al cambiar estado.')
      }
    })
  }

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex justify-end">
          <button
            onClick={openCreate}
            disabled={isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Nuevo anticipo
          </button>
        </div>
      )}

      {actionError && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{actionError}</div>
      )}

      {showForm && (
        <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
          <h3 className="text-sm font-semibold text-gray-800">
            {editingId ? 'Editar anticipo' : 'Nuevo anticipo'}
          </h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Proveedor *</label>
              <select
                value={form.proveedor_id}
                onChange={e => setField('proveedor_id', e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                <option value="">Seleccionar proveedor</option>
                {proveedores.map(p => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Fondo *</label>
              <select
                value={form.fondo_id}
                onChange={e => setField('fondo_id', e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                <option value="">Seleccionar fondo</option>
                {fondos.map(f => (
                  <option key={f.id} value={f.id}>{f.nombre} ({f.moneda})</option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Concepto *</label>
              <input
                type="text"
                value={form.concepto}
                onChange={e => setField('concepto', e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm"
                placeholder="Descripción del anticipo"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Moneda</label>
              <select
                value={form.moneda}
                onChange={e => setField('moneda', e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                {MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Monto total *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.monto_total || ''}
                onChange={e => setField('monto_total', parseFloat(e.target.value) || 0)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">% Anticipo *</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.porcentaje_anticipo || ''}
                onChange={e => setField('porcentaje_anticipo', parseFloat(e.target.value) || 0)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Monto anticipo *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.monto_anticipo || ''}
                onChange={e => setField('monto_anticipo', parseFloat(e.target.value) || 0)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Monto saldo (calculado)</label>
              <input
                type="number"
                value={montoSaldo.toFixed(2)}
                readOnly
                className="w-full border rounded-md px-3 py-2 text-sm bg-gray-100 text-gray-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Fecha acuerdo *</label>
              <input
                type="date"
                value={form.fecha_acuerdo}
                onChange={e => setField('fecha_acuerdo', e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Fecha vencimiento saldo</label>
              <input
                type="date"
                value={form.fecha_vencimiento_saldo ?? ''}
                onChange={e => setField('fecha_vencimiento_saldo', e.target.value || null)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Observaciones</label>
              <textarea
                value={form.observaciones ?? ''}
                onChange={e => setField('observaciones', e.target.value || null)}
                rows={2}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>

          {formError && (
            <p className="text-sm text-red-600">{formError}</p>
          )}

          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowForm(false); setEditingId(null) }}
              disabled={isPending}
              className="px-3 py-2 text-sm border rounded-md hover:bg-gray-100 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={isPending}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? 'Guardando...' : editingId ? 'Actualizar' : 'Crear'}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Proveedor</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Concepto</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Fondo</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Total</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Anticipo</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Saldo</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Fecha</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Estado</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {anticipos.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                  No hay anticipos registrados.
                </td>
              </tr>
            )}
            {anticipos.map(a => (
              <tr key={a.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {a.proveedores?.nombre ?? a.proveedor_id.slice(0, 8)}
                </td>
                <td className="px-4 py-3 text-gray-700 max-w-xs truncate">{a.concepto}</td>
                <td className="px-4 py-3 text-gray-600">{a.fondos?.nombre ?? '—'}</td>
                <td className="px-4 py-3 text-right text-gray-700">
                  {a.moneda} {a.monto_total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3 text-right text-gray-700">
                  {a.moneda} {a.monto_anticipo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  <span className="ml-1 text-xs text-gray-400">({a.porcentaje_anticipo}%)</span>
                </td>
                <td className="px-4 py-3 text-right text-gray-700">
                  {a.moneda} {a.monto_saldo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3 text-gray-600">{a.fecha_acuerdo}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ESTADO_COLORS[a.estado]}`}>
                    {ESTADO_LABELS[a.estado]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {a.estado === 'borrador' && canWrite && (
                      <>
                        <button
                          onClick={() => openEdit(a)}
                          disabled={isPending}
                          className="px-2 py-1 text-xs border rounded hover:bg-gray-100 disabled:opacity-50"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleEstado(a.id, 'comprometido')}
                          disabled={isPending}
                          className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                          Comprometer
                        </button>
                      </>
                    )}
                    {a.estado === 'comprometido' && canWrite && (
                      <button
                        onClick={() => handleEstado(a.id, 'parcialmente_pagado')}
                        disabled={isPending}
                        className="px-2 py-1 text-xs bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50"
                      >
                        Reg. anticipo
                      </button>
                    )}
                    {a.estado === 'parcialmente_pagado' && canWrite && (
                      <button
                        onClick={() => handleEstado(a.id, 'pagado')}
                        disabled={isPending}
                        className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                      >
                        Reg. pago final
                      </button>
                    )}
                    {a.estado !== 'pagado' && a.estado !== 'cancelado' && isAdmin && (
                      <button
                        onClick={() => handleEstado(a.id, 'cancelado')}
                        disabled={isPending}
                        className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
