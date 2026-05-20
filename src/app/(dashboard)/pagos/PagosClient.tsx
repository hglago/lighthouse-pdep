'use client'

import { useState, useTransition } from 'react'
import type { UserRole, PagoEstado, PagoTipo } from '@/types'
import type { PagoPayload } from './actions'

export interface PagoRow {
  id: string
  nro_pago: string
  fondo_id: string
  proveedor_id: string
  gasto_id: string | null
  anticipo_id: string | null
  tipo: PagoTipo
  concepto: string
  monto: number
  moneda: string
  fecha_pago: string
  comprobante_url: string | null
  estado: PagoEstado
  notas: string | null
  created_by: string
  anulado_por: string | null
  anulado_en: string | null
  created_at: string
  fondos: { nombre: string; moneda: string } | null
  proveedores: { nombre: string } | null
  gastos: { descripcion: string } | null
  anticipos: { concepto: string } | null
}

interface Props {
  pagos: PagoRow[]
  fondos: { id: string; nombre: string; moneda: string }[]
  proveedores: { id: string; nombre: string }[]
  gastosAprobados: { id: string; descripcion: string; fondo_id: string; monto: number; proveedor_id: string | null }[]
  anticiposActivos: { id: string; concepto: string; fondo_id: string }[]
  role: UserRole
  onCreatePago: (data: PagoPayload) => Promise<void>
  onUpdatePago: (id: string, data: PagoPayload) => Promise<void>
  onConfirmarPago: (id: string) => Promise<void>
  onAnularPago: (id: string) => Promise<void>
}

interface FormState {
  fondo_id: string
  proveedor_id: string
  gasto_id: string
  anticipo_id: string
  tipo: PagoTipo
  concepto: string
  monto: string
  moneda: string
  fecha_pago: string
  comprobante_url: string
  notas: string
}

const EMPTY_FORM: FormState = {
  fondo_id: '',
  proveedor_id: '',
  gasto_id: '',
  anticipo_id: '',
  tipo: 'directo',
  concepto: '',
  monto: '',
  moneda: '',
  fecha_pago: new Date().toISOString().slice(0, 10),
  comprobante_url: '',
  notas: '',
}

const TIPO_LABELS: Record<PagoTipo, string> = {
  directo: 'Pago directo',
  gasto: 'Gasto aprobado',
  anticipo: 'Anticipo',
  saldo_anticipo: 'Saldo anticipo',
}

const TIPO_COLORS: Record<PagoTipo, string> = {
  directo: 'bg-slate-100 text-slate-600',
  gasto: 'bg-blue-100 text-blue-700',
  anticipo: 'bg-purple-100 text-purple-700',
  saldo_anticipo: 'bg-orange-100 text-orange-700',
}

const ESTADO_LABELS: Record<PagoEstado, string> = {
  borrador: 'Borrador',
  pagado: 'Pagado',
  anulado: 'Anulado',
}

const ESTADO_COLORS: Record<PagoEstado, string> = {
  borrador: 'bg-gray-100 text-gray-600',
  pagado: 'bg-emerald-100 text-emerald-700',
  anulado: 'bg-red-100 text-red-700',
}

function formatMonto(monto: number, moneda: string) {
  const currency = moneda === 'USD' ? 'USD' : moneda === 'EUR' ? 'EUR' : 'ARS'
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(monto)
}

export default function PagosClient({
  pagos,
  fondos,
  proveedores,
  gastosAprobados,
  anticiposActivos,
  role,
  onCreatePago,
  onUpdatePago,
  onConfirmarPago,
  onAnularPago,
}: Props) {
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<PagoRow | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [actionError, setActionError] = useState('')
  const [isPending, startTransition] = useTransition()

  const canWrite = role === 'admin' || role === 'contador'
  const isAdmin = role === 'admin'

  const q = search.trim().toLowerCase()
  const filtered = q
    ? pagos.filter(
        p =>
          p.concepto.toLowerCase().includes(q) ||
          (p.fondos?.nombre ?? '').toLowerCase().includes(q) ||
          (p.proveedores?.nombre ?? '').toLowerCase().includes(q)
      )
    : pagos

  // Para tipo='gasto' el gasto dirige el fondo (no al revés): mostrar todos sin filtrar.
  // Para anticipo/saldo_anticipo, filtrar por fondo seleccionado.
  const gastosParaFondo = form.tipo === 'gasto'
    ? gastosAprobados
    : form.fondo_id
      ? gastosAprobados.filter(g => g.fondo_id === form.fondo_id)
      : gastosAprobados

  const anticiposParaFondo = form.fondo_id
    ? anticiposActivos.filter(a => a.fondo_id === form.fondo_id)
    : anticiposActivos

  function handleFondoChange(fondo_id: string) {
    const fondo = fondos.find(f => f.id === fondo_id)
    setForm(prev => ({ ...prev, fondo_id, moneda: fondo?.moneda ?? '', gasto_id: '', anticipo_id: '' }))
  }

  function handleTipoChange(tipo: PagoTipo) {
    setForm(prev => ({ ...prev, tipo, gasto_id: '', anticipo_id: '' }))
  }

  function handleGastoChange(gasto_id: string) {
    const gasto = gastosAprobados.find(g => g.id === gasto_id)
    const fondo = gasto ? fondos.find(f => f.id === gasto.fondo_id) : undefined
    setForm(prev => ({
      ...prev,
      gasto_id,
      concepto: gasto?.descripcion ?? prev.concepto,
      fondo_id: gasto?.fondo_id ?? prev.fondo_id,
      moneda: fondo?.moneda ?? prev.moneda,
      monto: gasto ? String(gasto.monto) : prev.monto,
      proveedor_id: gasto?.proveedor_id ?? prev.proveedor_id,
    }))
  }

  function handleAnticipoChange(anticipo_id: string) {
    const anticipo = anticiposActivos.find(a => a.id === anticipo_id)
    setForm(prev => ({
      ...prev,
      anticipo_id,
      concepto: anticipo?.concepto ?? prev.concepto,
    }))
  }

  function openNew() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(p: PagoRow) {
    setEditing(p)
    setForm({
      fondo_id: p.fondo_id,
      proveedor_id: p.proveedor_id,
      gasto_id: p.gasto_id ?? '',
      anticipo_id: p.anticipo_id ?? '',
      tipo: p.tipo,
      concepto: p.concepto,
      monto: String(p.monto),
      moneda: p.moneda,
      fecha_pago: p.fecha_pago,
      comprobante_url: p.comprobante_url ?? '',
      notas: p.notas ?? '',
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
    if (!form.proveedor_id) { setFormError('Seleccioná un proveedor.'); return }
    if (!form.concepto.trim()) { setFormError('El concepto es requerido.'); return }
    const monto = parseFloat(form.monto)
    if (!form.monto || isNaN(monto) || monto <= 0) { setFormError('El monto debe ser mayor a 0.'); return }
    if (!form.fecha_pago) { setFormError('La fecha es requerida.'); return }
    if (form.tipo === 'gasto' && !form.gasto_id) { setFormError('Seleccioná el gasto vinculado.'); return }
    if ((form.tipo === 'anticipo' || form.tipo === 'saldo_anticipo') && !form.anticipo_id) {
      setFormError('Seleccioná el anticipo vinculado.')
      return
    }
    if (form.tipo === 'directo' && !form.notas.trim()) {
      setFormError('Los pagos directos requieren justificación en el campo Notas.')
      return
    }

    const payload: PagoPayload = {
      fondo_id: form.fondo_id,
      proveedor_id: form.proveedor_id,
      gasto_id: form.gasto_id || null,
      anticipo_id: form.anticipo_id || null,
      tipo: form.tipo,
      concepto: form.concepto.trim(),
      monto,
      moneda: form.moneda,
      fecha_pago: form.fecha_pago,
      comprobante_url: form.comprobante_url.trim() || null,
      notas: form.notas.trim() || null,
    }

    startTransition(async () => {
      try {
        if (editing) {
          await onUpdatePago(editing.id, payload)
        } else {
          await onCreatePago(payload)
        }
        closeModal()
      } catch (err: unknown) {
        setFormError(err instanceof Error ? err.message : 'Error al guardar.')
      }
    })
  }

  function handleConfirmar(id: string) {
    setActionError('')
    startTransition(async () => {
      try {
        await onConfirmarPago(id)
      } catch (err: unknown) {
        setActionError(err instanceof Error ? err.message : 'Error al confirmar pago.')
      }
    })
  }

  function handleAnular(id: string, concepto: string) {
    if (!confirm(`¿Anular el pago "${concepto}"? Esta acción genera un movimiento de reversión en el fondo.`)) return
    setActionError('')
    startTransition(async () => {
      try {
        await onAnularPago(id)
      } catch (err: unknown) {
        setActionError(err instanceof Error ? err.message : 'Error al anular pago.')
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
          placeholder="Buscar por concepto, fondo o proveedor..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 sm:max-w-sm"
        />
        {canWrite && (
          <button
            onClick={openNew}
            disabled={isPending}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            + Nuevo pago
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
            {search ? 'Sin resultados para esa búsqueda.' : 'No hay pagos registrados.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 sm:table-cell">Nro</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Fecha</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Concepto</th>
                  <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 sm:table-cell">Tipo</th>
                  <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 md:table-cell">Fondo</th>
                  <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 md:table-cell">Proveedor</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Monto</th>
                  <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 lg:table-cell">Estado</th>
                  {(canWrite || isAdmin) && (
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Acciones</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="hidden px-4 py-3 text-xs text-gray-400 whitespace-nowrap font-mono sm:table-cell">{p.nro_pago}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{p.fecha_pago}</td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900 max-w-xs truncate">{p.concepto}</div>
                      {p.comprobante_url && (
                        <a
                          href={p.comprobante_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Ver comprobante
                        </a>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TIPO_COLORS[p.tipo]}`}>
                        {TIPO_LABELS[p.tipo]}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 text-sm text-gray-500 md:table-cell">
                      {p.fondos?.nombre ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="hidden px-4 py-3 text-sm text-gray-500 md:table-cell">
                      {p.proveedores?.nombre ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 whitespace-nowrap">
                      {formatMonto(p.monto, p.moneda)}
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_COLORS[p.estado]}`}>
                        {ESTADO_LABELS[p.estado]}
                      </span>
                    </td>
                    {(canWrite || isAdmin) && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {canWrite && p.estado === 'borrador' && (
                            <>
                              <button
                                onClick={() => openEdit(p)}
                                disabled={isPending}
                                className="rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
                              >
                                Editar
                              </button>
                              <button
                                onClick={() => handleConfirmar(p.id)}
                                disabled={isPending}
                                className="rounded px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 transition-colors disabled:opacity-50"
                              >
                                Confirmar
                              </button>
                            </>
                          )}
                          {isAdmin && p.estado === 'pagado' && (
                            <button
                              onClick={() => handleAnular(p.id, p.concepto)}
                              disabled={isPending}
                              className="rounded px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                            >
                              Anular
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
              {editing ? 'Editar pago' : 'Nuevo pago'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Fecha <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.fecha_pago}
                    onChange={e => setForm({ ...form, fecha_pago: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Tipo <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.tipo}
                    onChange={e => handleTipoChange(e.target.value as PagoTipo)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  >
                    <option value="directo">Pago directo</option>
                    <option value="gasto">Gasto aprobado</option>
                    <option value="anticipo">Anticipo</option>
                    <option value="saldo_anticipo">Saldo anticipo</option>
                  </select>
                </div>
              </div>

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
                      <option key={f.id} value={f.id}>{f.nombre} ({f.moneda})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Proveedor <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.proveedor_id}
                    onChange={e => setForm({ ...form, proveedor_id: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  >
                    <option value="">Seleccionar proveedor...</option>
                    {proveedores.map(p => (
                      <option key={p.id} value={p.id}>{p.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>

              {form.tipo === 'gasto' && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Gasto aprobado <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.gasto_id}
                    onChange={e => handleGastoChange(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  >
                    <option value="">Seleccionar gasto...</option>
                    {gastosParaFondo.map(g => (
                      <option key={g.id} value={g.id}>{g.descripcion}</option>
                    ))}
                  </select>
                  {gastosParaFondo.length === 0 && (
                    <p className="mt-1 text-xs text-gray-400">No hay gastos aprobados pendientes de pago.</p>
                  )}
                </div>
              )}

              {(form.tipo === 'anticipo' || form.tipo === 'saldo_anticipo') && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Anticipo <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.anticipo_id}
                    onChange={e => handleAnticipoChange(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  >
                    <option value="">Seleccionar anticipo...</option>
                    {anticiposParaFondo.map(a => (
                      <option key={a.id} value={a.id}>{a.concepto}</option>
                    ))}
                  </select>
                  {form.fondo_id && anticiposParaFondo.length === 0 && (
                    <p className="mt-1 text-xs text-gray-400">No hay anticipos activos para este fondo.</p>
                  )}
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Concepto <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.concepto}
                  onChange={e => setForm({ ...form, concepto: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  placeholder="Descripción del pago"
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

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">URL comprobante</label>
                <input
                  type="text"
                  value={form.comprobante_url}
                  onChange={e => setForm({ ...form, comprobante_url: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  placeholder="https://..."
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Notas
                  {form.tipo === 'directo' && (
                    <span className="ml-1 text-red-500">*</span>
                  )}
                  {form.tipo === 'directo' && (
                    <span className="ml-1 text-xs font-normal text-gray-400">(requerida para pagos directos)</span>
                  )}
                </label>
                <textarea
                  value={form.notas}
                  onChange={e => setForm({ ...form, notas: e.target.value })}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  placeholder={form.tipo === 'directo' ? 'Justificación obligatoria para pagos directos' : 'Notas internas opcionales'}
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
                  {isPending ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear pago'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
