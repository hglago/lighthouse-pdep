'use client'

import { useState, useTransition, useRef, useMemo } from 'react'
import type { Fondo, UserRole, TipoAporte, FondoEstado, AporteFondo, Socio, Financiador, SaldoFinanciadorRow, MovimientoTipo, DestinoAporte } from '@/types'
import type {
  AportePayload, FondoActionResult, FondoDepsResult,
  SocioPayload, SocioActionResult,
  FinanciadorPayload, FinanciadorActionResult,
  AporteSocioPayload, AporteSocioActionResult,
} from './actions'
import { useSortable } from '@/lib/useSortable'
import SortableHeader from '@/components/SortableHeader'
import DataTable, { type Column } from '@/components/DataTable'

export interface AporteFondoRow extends AporteFondo {
  fondos: { nombre: string } | null
  socios: { nombre: string } | null
  financiadores: { nombre: string; codigo: string | null } | null
}

// Fila de movimientos_fondo tal como la trae page.tsx
export interface MovimientoFondoRow {
  id: string
  fondo_id: string
  pago_id: string | null
  tipo: MovimientoTipo
  monto: number
  saldo_anterior: number
  saldo_resultante: number
  concepto: string
  fecha: string
  created_by: string
  created_at: string
}

// Etapa 2A: el modelo nuevo es read-only. Los modales legacy
// (newFondo / editFondo / newAporte) se conservan en código por debajo
// pero NO hay botones que los disparen en este layout. Próximas subetapas
// (2B/2C) van a reemplazar progresivamente los flujos legacy.
const SHOW_LEGACY_UI = false

// ─── Constants ──────────────────────────────────────────────────────────────

const MONEDAS = ['ARS', 'USD', 'EUR']
const TIPOS_APORTE: TipoAporte[] = ['aporte_socios', 'transferencia', 'ajuste', 'reintegro', 'otro']
const ESTADOS_FONDO: FondoEstado[] = ['activo', 'cerrado', 'suspendido']

const TIPO_APORTE_LABELS: Record<TipoAporte, string> = {
  aporte_socios: 'Aporte socios',
  transferencia: 'Transferencia',
  ajuste: 'Ajuste',
  reintegro: 'Reintegro',
  otro: 'Otro',
}

const TIPO_APORTE_COLORS: Record<TipoAporte, string> = {
  aporte_socios: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  transferencia: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200',
  ajuste: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  reintegro: 'bg-green-50 text-green-700 ring-1 ring-green-200',
  otro: 'bg-gray-50 text-gray-600 ring-1 ring-gray-200',
}

const FONDO_ESTADO_LABELS: Record<FondoEstado, string> = {
  activo: 'Activo',
  cerrado: 'Cerrado',
  suspendido: 'Suspendido',
}

const FONDO_ESTADO_COLORS: Record<FondoEstado, string> = {
  activo: 'bg-green-50 text-green-700 ring-1 ring-green-200',
  cerrado: 'bg-gray-50 text-gray-500 ring-1 ring-gray-200',
  suspendido: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function todayIso() {
  return new Date().toISOString().split('T')[0]
}

function friendlyError(msg: string): string {
  if (
    msg.includes('23505') ||
    msg.includes('fondos_nombre_moneda_activo_unico') ||
    /duplicate key/i.test(msg)
  ) {
    return 'Ya existe un fondo activo con ese nombre y moneda.'
  }
  return msg
}

// ─── Types ───────────────────────────────────────────────────────────────────

type ModalType = 'none' | 'newFondo' | 'editFondo' | 'newAporte'

interface FondoForm {
  nombre: string
  moneda: string
  monto_inicial: string
  descripcion: string
  estado: FondoEstado
}

const EMPTY_FONDO_FORM: FondoForm = {
  nombre: '',
  moneda: 'ARS',
  monto_inicial: '',
  descripcion: '',
  estado: 'activo',
}

interface AporteForm {
  fondo_id: string
  fecha_aporte: string
  monto: string
  tipo_aporte: TipoAporte
  aportante: string
  concepto: string
  comprobante_url: string
  observaciones: string
}

function emptyAporteForm(defaultFondoId = ''): AporteForm {
  return {
    fondo_id: defaultFondoId,
    fecha_aporte: todayIso(),
    monto: '',
    tipo_aporte: 'aporte_socios',
    aportante: '',
    concepto: '',
    comprobante_url: '',
    observaciones: '',
  }
}

interface Props {
  fondos: Fondo[]
  aportes: AporteFondoRow[]
  socios: Socio[]
  financiadores: Financiador[]
  saldosFinanciadores: SaldoFinanciadorRow[]
  movimientos: MovimientoFondoRow[]
  role: UserRole
  onCreateFondo: (data: { nombre: string; moneda: string; monto_inicial: number; descripcion: string | null }) => Promise<void>
  onUpdateFondo: (id: string, data: { nombre: string; descripcion: string | null; estado: FondoEstado }) => Promise<void>
  onDeleteFondo: (id: string, motivo?: string | null) => Promise<FondoActionResult>
  onGetFondoDependencies: (id: string) => Promise<FondoDepsResult>
  onRegistrarAporte: (data: AportePayload) => Promise<void>
  // Etapa 2B/2C
  onCrearSocio: (data: SocioPayload) => Promise<SocioActionResult>
  onCrearFinanciador: (data: FinanciadorPayload) => Promise<FinanciadorActionResult>
  onRegistrarAporteSocio: (data: AporteSocioPayload) => Promise<AporteSocioActionResult>
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FondosClient({
  fondos,
  aportes,
  socios,
  financiadores,
  saldosFinanciadores,
  movimientos,
  role,
  onCreateFondo,
  onUpdateFondo,
  onDeleteFondo,
  onGetFondoDependencies,
  onRegistrarAporte,
  onCrearSocio,
  onCrearFinanciador,
  onRegistrarAporteSocio,
}: Props) {
  const [modal, setModal] = useState<ModalType>('none')
  const [editingFondo, setEditingFondo] = useState<Fondo | null>(null)
  const [fondoForm, setFondoForm] = useState<FondoForm>(EMPTY_FONDO_FORM)
  const [aporteForm, setAporteForm] = useState<AporteForm>(emptyAporteForm())
  const [fondoFormError, setFondoFormError] = useState('')
  const [aporteFormError, setAporteFormError] = useState('')
  const [isPending, startTransition] = useTransition()

  const [filterFondoId, setFilterFondoId] = useState('')
  const [filterTipo, setFilterTipo] = useState<TipoAporte | ''>('')
  const [filterFechaDesde, setFilterFechaDesde] = useState('')
  const [filterFechaHasta, setFilterFechaHasta] = useState('')
  const [filterAportante, setFilterAportante] = useState('')

  const aportesSectionRef = useRef<HTMLDivElement>(null)

  const canWrite = role === 'admin' || role === 'contador'
  const canDelete = role === 'admin'

  const fondoMap = new Map(fondos.map((f) => [f.id, f]))
  const activeFondos = fondos.filter((f) => f.estado === 'activo')

  // Columnas DataTable para Fondos (sort + filter por columna)
  const fondoColumns: Column<Fondo>[] = [
    { key: 'nombre', label: 'Nombre', accessor: (f) => f.nombre, type: 'text' },
    { key: 'moneda', label: 'Moneda', accessor: (f) => f.moneda, type: 'enum' },
    {
      key: 'monto_inicial',
      label: 'Monto inicial',
      accessor: (f) => f.monto_inicial,
      type: 'number',
      align: 'right',
      render: (f) => <span className="tabular-nums text-gray-500">{fmt(f.monto_inicial)}</span>,
    },
    {
      key: 'saldo_actual',
      label: 'Saldo actual',
      accessor: (f) => f.saldo_actual,
      type: 'number',
      align: 'right',
      render: (f) => <span className="tabular-nums font-semibold text-gray-900">{fmt(f.saldo_actual)}</span>,
    },
    {
      key: 'estado',
      label: 'Estado',
      accessor: (f) => f.estado,
      type: 'enum',
      enumOptions: ESTADOS_FONDO.map(e => ({ value: e, label: FONDO_ESTADO_LABELS[e] })),
      render: (f) => (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${FONDO_ESTADO_COLORS[f.estado]}`}>
          {FONDO_ESTADO_LABELS[f.estado]}
        </span>
      ),
    },
  ]

  const filteredAportes = aportes.filter((a) => {
    if (filterFondoId && a.fondo_id !== filterFondoId) return false
    if (filterTipo && a.tipo_aporte !== filterTipo) return false
    if (filterFechaDesde && a.fecha_aporte < filterFechaDesde) return false
    if (filterFechaHasta && a.fecha_aporte > filterFechaHasta) return false
    if (filterAportante && !a.aportante?.toLowerCase().includes(filterAportante.toLowerCase())) return false
    return true
  })

  const hasFilters = !!(filterFondoId || filterTipo || filterFechaDesde || filterFechaHasta || filterAportante)

  const aportesAccessors = useMemo(() => ({
    fecha: (a: AporteFondoRow) => a.fecha_aporte,
    fondo: (a: AporteFondoRow) => a.fondos?.nombre ?? '',
    tipo: (a: AporteFondoRow) => a.tipo_aporte,
    concepto: (a: AporteFondoRow) => a.concepto,
    aportante: (a: AporteFondoRow) => a.aportante ?? '',
    monto: (a: AporteFondoRow) => a.monto,
  }), [])
  const { sorted: sortedAportes, sortKey: aSortKey, sortDir: aSortDir, onSort: onAporteSort } =
    useSortable(filteredAportes, aportesAccessors, { key: 'fecha', dir: 'desc' })

  // ─── Modal openers ────────────────────────────────────────────────────────

  function openNewFondo() {
    setFondoForm(EMPTY_FONDO_FORM)
    setFondoFormError('')
    setModal('newFondo')
  }

  function openEditFondo(fondo: Fondo) {
    setEditingFondo(fondo)
    setFondoForm({
      nombre: fondo.nombre,
      moneda: fondo.moneda,
      monto_inicial: String(fondo.monto_inicial),
      descripcion: fondo.descripcion ?? '',
      estado: fondo.estado,
    })
    setFondoFormError('')
    setModal('editFondo')
  }

  function openNewAporte(fondoId?: string) {
    setAporteForm(emptyAporteForm(fondoId ?? ''))
    setAporteFormError('')
    setModal('newAporte')
  }

  function closeModal() {
    setModal('none')
    setEditingFondo(null)
    setFondoFormError('')
    setAporteFormError('')
  }

  function scrollToAportes(fondoId?: string) {
    if (fondoId) setFilterFondoId(fondoId)
    aportesSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // ─── Submit handlers ──────────────────────────────────────────────────────

  function handleFondoSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFondoFormError('')

    const nombre = fondoForm.nombre.trim()
    if (!nombre) {
      setFondoFormError('El nombre es requerido.')
      return
    }

    if (modal === 'newFondo') {
      const monto = parseFloat(fondoForm.monto_inicial)
      if (fondoForm.monto_inicial === '' || isNaN(monto) || monto < 0) {
        setFondoFormError('El monto inicial debe ser un número no negativo.')
        return
      }
    }

    startTransition(async () => {
      try {
        if (modal === 'editFondo' && editingFondo) {
          await onUpdateFondo(editingFondo.id, {
            nombre,
            descripcion: fondoForm.descripcion.trim() || null,
            estado: fondoForm.estado,
          })
        } else {
          await onCreateFondo({
            nombre,
            moneda: fondoForm.moneda,
            monto_inicial: parseFloat(fondoForm.monto_inicial),
            descripcion: fondoForm.descripcion.trim() || null,
          })
        }
        closeModal()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error al guardar.'
        setFondoFormError(friendlyError(msg))
      }
    })
  }

  function handleAporteSubmit(e: React.FormEvent) {
    e.preventDefault()
    setAporteFormError('')

    if (!aporteForm.fondo_id) {
      setAporteFormError('Seleccioná un fondo.')
      return
    }
    const monto = parseFloat(aporteForm.monto)
    if (aporteForm.monto === '' || isNaN(monto) || monto <= 0) {
      setAporteFormError('El monto debe ser mayor a 0.')
      return
    }
    if (!aporteForm.concepto.trim()) {
      setAporteFormError('El concepto es requerido.')
      return
    }

    startTransition(async () => {
      try {
        await onRegistrarAporte({
          fondo_id: aporteForm.fondo_id,
          fecha_aporte: aporteForm.fecha_aporte,
          monto,
          tipo_aporte: aporteForm.tipo_aporte,
          aportante: aporteForm.aportante.trim() || null,
          concepto: aporteForm.concepto.trim(),
          comprobante_url: aporteForm.comprobante_url.trim() || null,
          observaciones: aporteForm.observaciones.trim() || null,
        })
        closeModal()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error al registrar aporte.'
        setAporteFormError(msg)
      }
    })
  }

  // Dar de baja fondo: BAJA LÓGICA. La RPC valida saldo=0 en el SQL.
  // Antes del confirm consultamos conteos + saldo para mostrar contexto.
  function handleDeleteFondo(id: string, nombre: string) {
    startTransition(async () => {
      const deps = await onGetFondoDependencies(id)
      if (!deps.ok) {
        alert(`No se pudieron verificar dependencias: ${deps.error}`)
        return
      }

      const saldoStr = `${deps.moneda} ${fmt(deps.saldo_actual)}`

      // Bloqueo de saldo distinto de cero (UX antes de invocar RPC; el RPC también bloquea)
      if (Math.abs(deps.saldo_actual) > 0.001) {
        alert(
          `No se puede dar de baja el fondo "${nombre}".\n\n` +
          `Saldo actual: ${saldoStr}\n\n` +
          `Primero transferí ese saldo a otra caja o regularizalo. ` +
          `Cuando el saldo sea 0, podrás darlo de baja.`
        )
        return
      }

      const partes: string[] = []
      if (deps.gastos      > 0) partes.push(`${deps.gastos} gasto${deps.gastos !== 1 ? 's' : ''}`)
      if (deps.pagos       > 0) partes.push(`${deps.pagos} pago${deps.pagos !== 1 ? 's' : ''}`)
      if (deps.aportes     > 0) partes.push(`${deps.aportes} aporte${deps.aportes !== 1 ? 's' : ''}`)
      if (deps.movimientos > 0) partes.push(`${deps.movimientos} movimiento${deps.movimientos !== 1 ? 's' : ''}`)

      const ctx = partes.length > 0
        ? `Este fondo tiene ${partes.join(', ')} asociados. La historia se conservará intacta; ` +
          `el fondo solo dejará de estar disponible para nuevas operaciones.`
        : `Este fondo no tiene movimientos registrados. Se dará de baja para que no aparezca en nuevas operaciones.`

      const msg = `${ctx}\n\nSaldo: ${saldoStr} (= 0 ✓)\n\n¿Dar de baja "${nombre}"?`
      if (!confirm(msg)) return

      const result = await onDeleteFondo(id)
      if (!result.ok) {
        alert(`No se pudo dar de baja: ${result.error}`)
      }
    })
  }

  const selectedFondoForAporte = fondoMap.get(aporteForm.fondo_id)

  const inputCls =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20'
  const readonlyCls =
    'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 outline-none cursor-default'

  // ─── Etapa 2A: lookup de RISA + derivados ──────────────────────────────────
  // Buscamos RISA por codigo='FON-001' (fuente canónica). Fallback por nombre
  // por si la migración asignó codigo distinto.
  const risa = useMemo(
    () => fondos.find(f => f.codigo === 'FON-001') ?? fondos.find(f => f.nombre === 'RISA') ?? null,
    [fondos]
  )
  const movimientosRisa = useMemo(
    () => (risa ? movimientos.filter(m => m.fondo_id === risa.id) : []),
    [risa, movimientos]
  )
  const destinoLabel = (d: DestinoAporte): string =>
    d === 'risa' ? 'RISA' : 'Cancelación de financiación'

  // ─── Etapa 2B/2C: state + handlers para los nuevos modales ─────────────────

  type NuevoModal = 'none' | 'newSocio' | 'newFinanciador' | 'newAporte'
  const [nuevoModal, setNuevoModal] = useState<NuevoModal>('none')
  const [nuevoError, setNuevoError] = useState<string>('')

  // Socio
  const [socioForm, setSocioForm] = useState({ nombre: '', cuit: '', email: '', telefono: '', observaciones: '' })
  function resetSocioForm() {
    setSocioForm({ nombre: '', cuit: '', email: '', telefono: '', observaciones: '' })
  }

  // Financiador
  const [finForm, setFinForm] = useState({ nombre: '', cuit: '', email: '', telefono: '', observaciones: '' })
  function resetFinForm() {
    setFinForm({ nombre: '', cuit: '', email: '', telefono: '', observaciones: '' })
  }

  // Aporte
  const [aporteSocioForm, setAporteSocioForm] = useState({
    fecha:           todayIso(),
    socio_id:        '',
    importe:         '',
    moneda:          'ARS',
    destino_aporte:  'risa' as DestinoAporte,
    financiador_id:  '',
    observaciones:   '',
  })
  function resetAporteSocioForm() {
    setAporteSocioForm({
      fecha:           todayIso(),
      socio_id:        '',
      importe:         '',
      moneda:          'ARS',
      destino_aporte:  'risa',
      financiador_id:  '',
      observaciones:   '',
    })
  }

  function openModal(m: NuevoModal) {
    setNuevoError('')
    if (m === 'newSocio') resetSocioForm()
    if (m === 'newFinanciador') resetFinForm()
    if (m === 'newAporte') resetAporteSocioForm()
    setNuevoModal(m)
  }
  function closeNuevoModal() {
    setNuevoModal('none')
    setNuevoError('')
  }

  function handleCrearSocio(e: React.FormEvent) {
    e.preventDefault()
    setNuevoError('')
    if (!socioForm.nombre.trim()) {
      setNuevoError('El nombre es requerido.')
      return
    }
    startTransition(async () => {
      const result = await onCrearSocio({
        nombre:        socioForm.nombre.trim(),
        cuit:          socioForm.cuit.trim() || null,
        email:         socioForm.email.trim() || null,
        telefono:      socioForm.telefono.trim() || null,
        observaciones: socioForm.observaciones.trim() || null,
      })
      if (!result.ok) {
        setNuevoError(result.error)
        return
      }
      closeNuevoModal()
    })
  }

  function handleCrearFinanciador(e: React.FormEvent) {
    e.preventDefault()
    setNuevoError('')
    if (!finForm.nombre.trim()) {
      setNuevoError('El nombre es requerido.')
      return
    }
    startTransition(async () => {
      const result = await onCrearFinanciador({
        nombre:        finForm.nombre.trim(),
        cuit:          finForm.cuit.trim() || null,
        email:         finForm.email.trim() || null,
        telefono:      finForm.telefono.trim() || null,
        observaciones: finForm.observaciones.trim() || null,
      })
      if (!result.ok) {
        setNuevoError(result.error)
        return
      }
      closeNuevoModal()
    })
  }

  function handleRegistrarAporteSocio(e: React.FormEvent) {
    e.preventDefault()
    setNuevoError('')
    const importe = parseFloat(aporteSocioForm.importe.replace(',', '.'))
    if (!aporteSocioForm.socio_id) {
      setNuevoError('Seleccioná un socio.')
      return
    }
    if (!Number.isFinite(importe) || importe <= 0) {
      setNuevoError('El importe debe ser mayor a 0.')
      return
    }
    if (aporteSocioForm.destino_aporte === 'cancelacion_financiacion' && !aporteSocioForm.financiador_id) {
      setNuevoError('Seleccioná un financiador para cancelar financiación.')
      return
    }
    startTransition(async () => {
      const result = await onRegistrarAporteSocio({
        fecha:           aporteSocioForm.fecha,
        socio_id:        aporteSocioForm.socio_id,
        importe,
        moneda:          aporteSocioForm.moneda,
        destino_aporte:  aporteSocioForm.destino_aporte,
        financiador_id:  aporteSocioForm.destino_aporte === 'cancelacion_financiacion' ? aporteSocioForm.financiador_id : null,
        observaciones:   aporteSocioForm.observaciones.trim() || null,
      })
      if (!result.ok) {
        setNuevoError(result.error)
        return
      }
      closeNuevoModal()
    })
  }

  // Datos auxiliares para selectores y validaciones del modal Aporte
  const sociosActivos = useMemo(() => socios.filter(s => !s.deleted_at), [socios])
  const financiadoresActivos = useMemo(() => financiadores.filter(f => !f.deleted_at), [financiadores])
  const financiadoresConDeuda = useMemo(
    () => saldosFinanciadores.filter(s => s.saldo_pendiente > 0 && !s.financiador_deleted_at),
    [saldosFinanciadores]
  )
  const saldoPendienteSeleccionado = useMemo(() => {
    if (aporteSocioForm.destino_aporte !== 'cancelacion_financiacion') return null
    const f = financiadoresConDeuda.find(
      x => x.financiador_id === aporteSocioForm.financiador_id && x.moneda === aporteSocioForm.moneda
    )
    return f?.saldo_pendiente ?? null
  }, [aporteSocioForm, financiadoresConDeuda])

  return (
    <div className="space-y-8">

      {/* ═══════════════════════════════════════════════════════════════════════
          Etapa 2A — Caja RISA y financiación (read-only)
          ═══════════════════════════════════════════════════════════════════════ */}

      {/* ── Card resumen RISA ─────────────────────────────────────────────── */}
      {!risa ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ⚠ Fondo RISA no encontrado. Verificá que la migración de Etapa 1 se haya aplicado en Supabase y que exista un fondo con código <span className="font-mono">FON-001</span>.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-mono uppercase tracking-wide text-slate-500">
                {risa.codigo ?? 'Sin código'}
              </p>
              <h2 className="mt-1 text-xl font-semibold text-gray-900">{risa.nombre}</h2>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-400">
                <span>{risa.moneda}</span>
                <span aria-hidden="true">·</span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${FONDO_ESTADO_COLORS[risa.estado]}`}>
                  {FONDO_ESTADO_LABELS[risa.estado]}
                </span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-500">Saldo actual</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${risa.saldo_actual < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                {risa.moneda} {fmt(risa.saldo_actual)}
              </p>
              <p className="mt-0.5 text-[11px] text-gray-400">El saldo puede ser negativo.</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Acciones principales (Etapa 2B/2C) ────────────────────────────── */}
      {canWrite && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Acciones</span>
          <button
            type="button"
            onClick={() => openModal('newAporte')}
            disabled={isPending}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            + Nuevo aporte
          </button>
          <button
            type="button"
            onClick={() => openModal('newSocio')}
            disabled={isPending}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50"
          >
            + Nuevo socio
          </button>
          <button
            type="button"
            onClick={() => openModal('newFinanciador')}
            disabled={isPending}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50"
          >
            + Nuevo financiador
          </button>
        </div>
      )}

      {/* ── Cuenta corriente RISA ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-900">
          Cuenta corriente RISA{risa?.codigo ? ` — ${risa.codigo}` : ''}
        </h3>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {movimientosRisa.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              No hay movimientos en la cuenta corriente.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Fecha</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Tipo</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Concepto</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Ingreso</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Egreso</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Saldo resultante</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {movimientosRisa.map(m => {
                    const esCredito = m.tipo === 'credito'
                    return (
                      <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{m.fecha}</td>
                        <td className="px-4 py-3 text-xs">
                          <span className={`inline-flex rounded-full px-2 py-0.5 font-medium ${esCredito ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'}`}>
                            {esCredito ? 'Ingreso' : 'Egreso'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{m.concepto}</td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-emerald-700">
                          {esCredito ? fmt(m.monto) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-rose-700">
                          {!esCredito ? fmt(m.monto) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className={`px-4 py-3 text-right text-sm font-medium tabular-nums ${m.saldo_resultante < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                          {fmt(m.saldo_resultante)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Financiación pendiente (v_saldos_financiadores) ─────────────────── */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-900">Financiación pendiente</h3>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {saldosFinanciadores.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              No hay financiación pendiente.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Código</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Financiador</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Moneda</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Deuda generada</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Cancelado con aportes</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Saldo pendiente</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {saldosFinanciadores.map(s => (
                    <tr key={`${s.financiador_id}-${s.moneda}`} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-xs font-mono text-slate-600">{s.financiador_codigo ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {s.financiador_nombre}
                        {s.financiador_deleted_at && <span className="ml-2 text-xs text-gray-400">(dado de baja)</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{s.moneda}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums text-gray-700">{fmt(s.total_deuda_generada)}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums text-gray-700">{fmt(s.total_cancelado)}</td>
                      <td className={`px-4 py-3 text-right text-sm font-medium tabular-nums ${s.saldo_pendiente > 0 ? 'text-amber-700' : 'text-gray-900'}`}>
                        {fmt(s.saldo_pendiente)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Aportes de socios ─────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-900">Aportes de socios</h3>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {aportes.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              No hay aportes registrados.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Código</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Fecha</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Socio / aportante</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Destino</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Financiador</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Importe</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Moneda</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Observaciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {aportes.map(a => {
                    const socioCodigo = socios.find(s => s.id === a.socio_id)?.codigo ?? null
                    const socioLabel = a.socios?.nombre ?? a.aportante ?? null
                    return (
                    <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-xs font-mono text-slate-600">{a.codigo ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{a.fecha_aporte}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {socioLabel
                          ? (socioCodigo
                              ? <span><span className="font-mono text-xs text-slate-500">{socioCodigo}</span> — {socioLabel}</span>
                              : socioLabel)
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className={`inline-flex rounded-full px-2 py-0.5 font-medium ${a.destino_aporte === 'risa' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' : 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'}`}>
                          {destinoLabel(a.destino_aporte)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {a.financiadores
                          ? <span><span className="text-xs font-mono text-slate-500">{a.financiadores.codigo}</span> · {a.financiadores.nombre}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-medium tabular-nums text-gray-900">{fmt(a.monto)}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{a.moneda}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate" title={a.observaciones ?? ''}>
                        {a.observaciones ?? <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Socios ──────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-900">Socios</h3>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {socios.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              No hay socios registrados.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Código</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Nombre</th>
                    <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 sm:table-cell">CUIT</th>
                    <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 md:table-cell">Email</th>
                    <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 lg:table-cell">Teléfono</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {socios.map(s => (
                    <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-xs font-mono text-slate-600">{s.codigo ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{s.nombre}</td>
                      <td className="hidden px-4 py-3 text-sm text-gray-500 sm:table-cell">{s.cuit ?? <span className="text-gray-300">—</span>}</td>
                      <td className="hidden px-4 py-3 text-sm text-gray-500 md:table-cell">{s.email ?? <span className="text-gray-300">—</span>}</td>
                      <td className="hidden px-4 py-3 text-sm text-gray-500 lg:table-cell">{s.telefono ?? <span className="text-gray-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Financiadores ───────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-900">Financiadores</h3>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {financiadores.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              No hay financiadores registrados.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Código</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Nombre</th>
                    <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 sm:table-cell">CUIT</th>
                    <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 md:table-cell">Email</th>
                    <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 lg:table-cell">Teléfono</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {financiadores.map(f => (
                    <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-xs font-mono text-slate-600">{f.codigo ?? '—'}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{f.nombre}</td>
                      <td className="hidden px-4 py-3 text-sm text-gray-500 sm:table-cell">{f.cuit ?? <span className="text-gray-300">—</span>}</td>
                      <td className="hidden px-4 py-3 text-sm text-gray-500 md:table-cell">{f.email ?? <span className="text-gray-300">—</span>}</td>
                      <td className="hidden px-4 py-3 text-sm text-gray-500 lg:table-cell">{f.telefono ?? <span className="text-gray-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          LEGACY UI (oculta en 2A; controlada por flag SHOW_LEGACY_UI).
          Etapas 2B/2C/2D reemplazarán los flujos legacy con la nueva UI.
          ═══════════════════════════════════════════════════════════════════════ */}
      {SHOW_LEGACY_UI && (<>

      {/* ─── Section A: Fondos ─────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Fondos</h2>
          {canWrite && (
            <button
              onClick={openNewFondo}
              disabled={isPending}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              + Nuevo fondo
            </button>
          )}
        </div>

        <DataTable
          rows={fondos}
          columns={fondoColumns}
          getRowId={(f) => f.id}
          initialSort={{ key: 'nombre', dir: 'asc' }}
          emptyMessage="No hay fondos registrados."
          rowActions={(fondo) => (
            <>
              {canWrite && (
                <button
                  onClick={() => openEditFondo(fondo)}
                  disabled={isPending}
                  className="rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
                >
                  Editar
                </button>
              )}
              {canWrite && fondo.estado === 'activo' && (
                <button
                  onClick={() => openNewAporte(fondo.id)}
                  disabled={isPending}
                  className="rounded px-2.5 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50"
                >
                  + Aporte
                </button>
              )}
              <button
                onClick={() => scrollToAportes(fondo.id)}
                disabled={isPending}
                className="rounded px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                Ver aportes
              </button>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => handleDeleteFondo(fondo.id, fondo.nombre)}
                  disabled={isPending}
                  className="rounded px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-50"
                  title="No elimina físicamente — marca el fondo como inactivo. Requiere saldo = 0."
                >
                  Dar de baja
                </button>
              )}
            </>
          )}
        />
      </div>

      {/* ─── Section B: Aportes ────────────────────────────────────────────── */}
      <div ref={aportesSectionRef} className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Aportes registrados</h2>
          {canWrite && (
            <button
              onClick={() => openNewAporte()}
              disabled={isPending}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors disabled:opacity-50"
            >
              + Registrar aporte
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <select
            value={filterFondoId}
            onChange={(e) => setFilterFondoId(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
          >
            <option value="">Todos los fondos</option>
            {fondos.map((f) => (
              <option key={f.id} value={f.id}>{f.nombre}</option>
            ))}
          </select>

          <select
            value={filterTipo}
            onChange={(e) => setFilterTipo(e.target.value as TipoAporte | '')}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
          >
            <option value="">Todos los tipos</option>
            {TIPOS_APORTE.map((t) => (
              <option key={t} value={t}>{TIPO_APORTE_LABELS[t]}</option>
            ))}
          </select>

          <input
            type="date"
            value={filterFechaDesde}
            onChange={(e) => setFilterFechaDesde(e.target.value)}
            title="Fecha desde"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
          />

          <input
            type="date"
            value={filterFechaHasta}
            onChange={(e) => setFilterFechaHasta(e.target.value)}
            title="Fecha hasta"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
          />

          <input
            type="text"
            value={filterAportante}
            onChange={(e) => setFilterAportante(e.target.value)}
            placeholder="Aportante..."
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
          />

          {hasFilters && (
            <button
              onClick={() => {
                setFilterFondoId('')
                setFilterTipo('')
                setFilterFechaDesde('')
                setFilterFechaHasta('')
                setFilterAportante('')
              }}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
            >
              Limpiar filtros
            </button>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {filteredAportes.length === 0 ? (
            <div className="p-12 text-center text-sm text-gray-400">
              {aportes.length === 0
                ? 'No hay aportes registrados.'
                : 'No hay aportes que coincidan con los filtros.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <SortableHeader label="Fecha" sortKey="fecha" activeKey={aSortKey} dir={aSortDir} onSort={onAporteSort} />
                    <SortableHeader label="Fondo" sortKey="fondo" activeKey={aSortKey} dir={aSortDir} onSort={onAporteSort} />
                    <SortableHeader label="Tipo" sortKey="tipo" activeKey={aSortKey} dir={aSortDir} onSort={onAporteSort} />
                    <SortableHeader label="Concepto" sortKey="concepto" activeKey={aSortKey} dir={aSortDir} onSort={onAporteSort} />
                    <SortableHeader label="Aportante" sortKey="aportante" activeKey={aSortKey} dir={aSortDir} onSort={onAporteSort} />
                    <SortableHeader label="Monto" sortKey="monto" activeKey={aSortKey} dir={aSortDir} onSort={onAporteSort} align="right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedAportes.map((a) => (
                    <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-sm tabular-nums text-gray-500">{a.fecha_aporte}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {a.fondos?.nombre ?? fondoMap.get(a.fondo_id)?.nombre ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TIPO_APORTE_COLORS[a.tipo_aporte as TipoAporte] ?? 'bg-gray-50 text-gray-600 ring-1 ring-gray-200'}`}>
                          {TIPO_APORTE_LABELS[a.tipo_aporte as TipoAporte] ?? a.tipo_aporte}
                        </span>
                      </td>
                      <td className="max-w-xs truncate px-4 py-3 text-sm text-gray-700">{a.concepto}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {a.aportante ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums font-medium text-gray-900">
                        {a.moneda} {fmt(a.monto)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      </>)}

      {/* ═══════════════════════════════════════════════════════════════════════
          Etapa 2B/2C — Modales nuevos
          ═══════════════════════════════════════════════════════════════════════ */}

      {/* ── Modal: Nuevo socio ──────────────────────────────────────────────── */}
      {nuevoModal === 'newSocio' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="mb-5 text-lg font-semibold text-gray-900">Nuevo socio</h2>
            <form onSubmit={handleCrearSocio} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Nombre <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  value={socioForm.nombre}
                  onChange={e => setSocioForm({ ...socioForm, nombre: e.target.value })}
                  className={inputCls}
                  placeholder="Juan Pérez"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">CUIT</label>
                  <input type="text" value={socioForm.cuit} onChange={e => setSocioForm({ ...socioForm, cuit: e.target.value })} className={inputCls} placeholder="20-12345678-9" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
                  <input type="email" value={socioForm.email} onChange={e => setSocioForm({ ...socioForm, email: e.target.value })} className={inputCls} placeholder="socio@email.com" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Teléfono</label>
                  <input type="text" value={socioForm.telefono} onChange={e => setSocioForm({ ...socioForm, telefono: e.target.value })} className={inputCls} placeholder="+54 11 1234-5678" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Observaciones</label>
                <textarea value={socioForm.observaciones} onChange={e => setSocioForm({ ...socioForm, observaciones: e.target.value })} rows={2} className={`${inputCls} resize-none`} />
              </div>
              {nuevoError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{nuevoError}</div>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={closeNuevoModal} disabled={isPending} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={isPending} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50">{isPending ? 'Guardando…' : 'Crear socio'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Nuevo financiador ─────────────────────────────────────────── */}
      {nuevoModal === 'newFinanciador' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="mb-5 text-lg font-semibold text-gray-900">Nuevo financiador</h2>
            <form onSubmit={handleCrearFinanciador} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Nombre <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  value={finForm.nombre}
                  onChange={e => setFinForm({ ...finForm, nombre: e.target.value })}
                  className={inputCls}
                  placeholder="Juan Gómez"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">CUIT</label>
                  <input type="text" value={finForm.cuit} onChange={e => setFinForm({ ...finForm, cuit: e.target.value })} className={inputCls} placeholder="20-12345678-9" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
                  <input type="email" value={finForm.email} onChange={e => setFinForm({ ...finForm, email: e.target.value })} className={inputCls} placeholder="financiador@email.com" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Teléfono</label>
                  <input type="text" value={finForm.telefono} onChange={e => setFinForm({ ...finForm, telefono: e.target.value })} className={inputCls} placeholder="+54 11 1234-5678" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Observaciones</label>
                <textarea value={finForm.observaciones} onChange={e => setFinForm({ ...finForm, observaciones: e.target.value })} rows={2} className={`${inputCls} resize-none`} />
              </div>
              {nuevoError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{nuevoError}</div>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={closeNuevoModal} disabled={isPending} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={isPending} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50">{isPending ? 'Guardando…' : 'Crear financiador'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Nuevo aporte ─────────────────────────────────────────────── */}
      {nuevoModal === 'newAporte' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="mb-5 text-lg font-semibold text-gray-900">Registrar nuevo aporte</h2>
            <form onSubmit={handleRegistrarAporteSocio} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Fecha</label>
                  <input
                    type="date"
                    value={aporteSocioForm.fecha}
                    onChange={e => setAporteSocioForm({ ...aporteSocioForm, fecha: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Moneda</label>
                  <select
                    value={aporteSocioForm.moneda}
                    onChange={e => setAporteSocioForm({ ...aporteSocioForm, moneda: e.target.value })}
                    className={inputCls}
                  >
                    {MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Socio <span className="text-red-500">*</span>
                </label>
                <select
                  value={aporteSocioForm.socio_id}
                  onChange={e => setAporteSocioForm({ ...aporteSocioForm, socio_id: e.target.value })}
                  className={inputCls}
                >
                  <option value="">— Seleccionar socio —</option>
                  {sociosActivos.map(s => (
                    <option key={s.id} value={s.id}>
                      {(s.codigo ?? 'Sin código') + ' — ' + s.nombre}
                    </option>
                  ))}
                </select>
                {sociosActivos.length === 0 && (
                  <p className="mt-1 text-xs text-amber-700">No hay socios. Creá uno con &quot;+ Nuevo socio&quot; primero.</p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Importe <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={aporteSocioForm.importe}
                  onChange={e => setAporteSocioForm({ ...aporteSocioForm, importe: e.target.value })}
                  className={`${inputCls} tabular-nums`}
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Destino del aporte</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    aporteSocioForm.destino_aporte === 'risa'
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}>
                    <input
                      type="radio"
                      name="destino"
                      value="risa"
                      checked={aporteSocioForm.destino_aporte === 'risa'}
                      onChange={() => setAporteSocioForm({ ...aporteSocioForm, destino_aporte: 'risa', financiador_id: '' })}
                      className="sr-only"
                    />
                    Aportar a RISA
                  </label>
                  <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    aporteSocioForm.destino_aporte === 'cancelacion_financiacion'
                      ? 'border-indigo-700 bg-indigo-700 text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}>
                    <input
                      type="radio"
                      name="destino"
                      value="cancelacion_financiacion"
                      checked={aporteSocioForm.destino_aporte === 'cancelacion_financiacion'}
                      onChange={() => setAporteSocioForm({ ...aporteSocioForm, destino_aporte: 'cancelacion_financiacion' })}
                      className="sr-only"
                    />
                    Cancelar financiación
                  </label>
                </div>
              </div>

              {aporteSocioForm.destino_aporte === 'cancelacion_financiacion' && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Financiador <span className="text-red-500">*</span>
                  </label>
                  {financiadoresConDeuda.length === 0 ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      No hay financiación pendiente para cancelar.
                    </p>
                  ) : (
                    <>
                      <select
                        value={aporteSocioForm.financiador_id}
                        onChange={e => setAporteSocioForm({ ...aporteSocioForm, financiador_id: e.target.value })}
                        className={inputCls}
                      >
                        <option value="">— Seleccionar financiador —</option>
                        {financiadoresConDeuda
                          .filter(f => f.moneda === aporteSocioForm.moneda)
                          .map(f => (
                            <option key={`${f.financiador_id}-${f.moneda}`} value={f.financiador_id}>
                              {(f.financiador_codigo ?? 'Sin código') + ' — ' + f.financiador_nombre + ' · saldo pendiente ' + f.moneda + ' ' + fmt(f.saldo_pendiente)}
                            </option>
                          ))}
                      </select>
                      {saldoPendienteSeleccionado !== null && (
                        <p className="mt-1 text-xs text-gray-500">
                          Saldo pendiente con este financiador: <span className="font-medium tabular-nums">{aporteSocioForm.moneda} {fmt(saldoPendienteSeleccionado)}</span>
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Observaciones</label>
                <textarea
                  value={aporteSocioForm.observaciones}
                  onChange={e => setAporteSocioForm({ ...aporteSocioForm, observaciones: e.target.value })}
                  rows={2}
                  className={`${inputCls} resize-none`}
                />
              </div>

              {nuevoError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{nuevoError}</div>}

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={closeNuevoModal} disabled={isPending} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={isPending} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50">{isPending ? 'Guardando…' : 'Registrar aporte'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Modal: Nuevo / Editar fondo ───────────────────────────────────── */}
      {(modal === 'newFondo' || modal === 'editFondo') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-5 text-lg font-semibold text-gray-900">
              {modal === 'editFondo' ? 'Editar fondo' : 'Nuevo fondo'}
            </h2>

            <form onSubmit={handleFondoSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Nombre <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={fondoForm.nombre}
                  onChange={(e) => setFondoForm({ ...fondoForm, nombre: e.target.value })}
                  className={inputCls}
                  placeholder="Nombre del fondo"
                  autoFocus
                />
              </div>

              {modal === 'newFondo' ? (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Moneda</label>
                    <select
                      value={fondoForm.moneda}
                      onChange={(e) => setFondoForm({ ...fondoForm, moneda: e.target.value })}
                      className={inputCls}
                    >
                      {MONEDAS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Monto inicial <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={fondoForm.monto_inicial}
                      onChange={(e) => setFondoForm({ ...fondoForm, monto_inicial: e.target.value })}
                      className={inputCls}
                      placeholder="0.00"
                    />
                    <p className="mt-1 text-xs text-gray-400">
                      Representa el capital inicial. No genera movimiento contable.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Moneda</label>
                    <input type="text" readOnly value={editingFondo?.moneda ?? ''} className={readonlyCls} />
                    <p className="mt-1 text-xs text-gray-400">
                      No puede modificarse si el fondo tiene movimientos.
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Monto inicial</label>
                    <input
                      type="text"
                      readOnly
                      value={editingFondo ? fmt(editingFondo.monto_inicial) : ''}
                      className={readonlyCls}
                    />
                    <p className="mt-1 text-xs text-gray-400">
                      Inmutable. Para ajustar el saldo, registrá un aporte de tipo &ldquo;ajuste&rdquo;.
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Saldo actual</label>
                    <input
                      type="text"
                      readOnly
                      value={editingFondo ? `${editingFondo.moneda} ${fmt(editingFondo.saldo_actual)}` : ''}
                      className={readonlyCls}
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Estado</label>
                    <select
                      value={fondoForm.estado}
                      onChange={(e) => setFondoForm({ ...fondoForm, estado: e.target.value as FondoEstado })}
                      className={inputCls}
                    >
                      {ESTADOS_FONDO.map((s) => (
                        <option key={s} value={s}>{FONDO_ESTADO_LABELS[s]}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Descripción</label>
                <textarea
                  value={fondoForm.descripcion}
                  onChange={(e) => setFondoForm({ ...fondoForm, descripcion: e.target.value })}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  placeholder="Descripción opcional"
                />
              </div>

              {fondoFormError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {fondoFormError}
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
                  {isPending ? 'Guardando...' : modal === 'editFondo' ? 'Guardar cambios' : 'Crear fondo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Modal: Registrar aporte ───────────────────────────────────────── */}
      {modal === 'newAporte' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Registrar aporte</h2>

            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              Este aporte impactará el saldo del fondo de forma inmediata e irreversible.
              Para corregir un error, registrá un aporte de tipo <strong>ajuste</strong> con el monto equivalente.
            </div>

            <form onSubmit={handleAporteSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Fondo <span className="text-red-500">*</span>
                </label>
                <select
                  value={aporteForm.fondo_id}
                  onChange={(e) => setAporteForm({ ...aporteForm, fondo_id: e.target.value })}
                  className={inputCls}
                >
                  <option value="">Seleccioná un fondo</option>
                  {activeFondos.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nombre} ({f.moneda})
                    </option>
                  ))}
                </select>
                {selectedFondoForAporte && (
                  <p className="mt-1 text-xs text-gray-500">
                    Saldo actual:{' '}
                    <span className="font-medium tabular-nums">
                      {selectedFondoForAporte.moneda} {fmt(selectedFondoForAporte.saldo_actual)}
                    </span>
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Fecha <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={aporteForm.fecha_aporte}
                    onChange={(e) => setAporteForm({ ...aporteForm, fecha_aporte: e.target.value })}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Monto <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={aporteForm.monto}
                    onChange={(e) => setAporteForm({ ...aporteForm, monto: e.target.value })}
                    className={inputCls}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Tipo de aporte</label>
                <select
                  value={aporteForm.tipo_aporte}
                  onChange={(e) => setAporteForm({ ...aporteForm, tipo_aporte: e.target.value as TipoAporte })}
                  className={inputCls}
                >
                  {TIPOS_APORTE.map((t) => (
                    <option key={t} value={t}>{TIPO_APORTE_LABELS[t]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Concepto <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={aporteForm.concepto}
                  onChange={(e) => setAporteForm({ ...aporteForm, concepto: e.target.value })}
                  className={inputCls}
                  placeholder="Descripción del aporte"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Aportante</label>
                <input
                  type="text"
                  value={aporteForm.aportante}
                  onChange={(e) => setAporteForm({ ...aporteForm, aportante: e.target.value })}
                  className={inputCls}
                  placeholder="Nombre del aportante (opcional)"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">URL comprobante</label>
                <input
                  type="url"
                  value={aporteForm.comprobante_url}
                  onChange={(e) => setAporteForm({ ...aporteForm, comprobante_url: e.target.value })}
                  className={inputCls}
                  placeholder="https://... (opcional)"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Observaciones</label>
                <textarea
                  value={aporteForm.observaciones}
                  onChange={(e) => setAporteForm({ ...aporteForm, observaciones: e.target.value })}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
                  placeholder="Observaciones opcionales"
                />
              </div>

              {aporteFormError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {aporteFormError}
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
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors disabled:opacity-50"
                >
                  {isPending ? 'Registrando...' : 'Registrar aporte'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
