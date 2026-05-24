'use client'

import { useState, useTransition, useRef, useMemo } from 'react'
import type { Fondo, UserRole, TipoAporte, FondoEstado, AporteFondo, Socio, Financiador, SaldoFinanciadorRow, MovimientoTipo, DestinoAporte } from '@/types'
import type {
  AportePayload, FondoActionResult, FondoDepsResult,
  SocioPayload, SocioActionResult,
  FinanciadorPayload, FinanciadorActionResult,
  AporteSocioPayload, AporteSocioActionResult,
  AporteSocioV2Payload,
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
  aporte_id: string | null  // Etapa 2D: trazabilidad. Null si la migración no se aplicó.
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
  // FIN2.4: nueva firma con imputaciones múltiples (split MP + Terceros).
  onRegistrarAporteSocioV2: (data: AporteSocioV2Payload) => Promise<AporteSocioActionResult>
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
  onRegistrarAporteSocioV2,
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
    d === 'risa' ? 'RISA' : 'Cancelación de deuda con tercero'

  // ─── Etapa 2D: lookup aporte_id → APO-### para mostrar N° transacción
  //              en cuenta corriente RISA
  const aporteCodigoPorId = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of aportes) {
      if (a.codigo) m.set(a.id, a.codigo)
    }
    return m
  }, [aportes])

  // ─── Etapa F1: búsqueda local por tabla ────────────────────────────────────
  const [searchAportes, setSearchAportes] = useState('')
  const [searchMovimientos, setSearchMovimientos] = useState('')
  const [searchSocios, setSearchSocios] = useState('')
  const [searchFinanciadores, setSearchFinanciadores] = useState('')
  const [searchFinPendiente, setSearchFinPendiente] = useState('')

  // ─── Etapa F1: columnas DataTable por tabla ────────────────────────────────

  // Aportes
  const aportesColumns: Column<AporteFondoRow>[] = [
    {
      key: 'codigo', label: 'N° transacción',
      accessor: a => a.codigo ?? '',
      type: 'text',
      render: a => <span className="font-mono text-xs text-slate-600">{a.codigo ?? '—'}</span>,
    },
    {
      key: 'fecha_aporte', label: 'Fecha',
      accessor: a => a.fecha_aporte,
      type: 'date',
      render: a => <span className="whitespace-nowrap">{a.fecha_aporte}</span>,
    },
    {
      key: 'socio', label: 'Socio / aportante',
      accessor: a => a.socios?.nombre ?? a.aportante ?? '',
      type: 'text',
      render: a => {
        const codigoSocio = socios.find(s => s.id === a.socio_id)?.codigo ?? null
        const label = a.socios?.nombre ?? a.aportante ?? null
        if (!label) return <span className="text-gray-300">—</span>
        return codigoSocio
          ? <span><span className="font-mono text-xs text-slate-500">{codigoSocio}</span> — {label}</span>
          : <>{label}</>
      },
    },
    {
      key: 'destino', label: 'Destino',
      accessor: a => a.destino_aporte,
      type: 'enum',
      enumOptions: [
        { value: 'risa', label: 'RISA' },
        { value: 'cancelacion_financiacion', label: 'Cancelación deuda tercero' },
      ],
      render: a => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${a.destino_aporte === 'risa' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' : 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'}`}>
          {destinoLabel(a.destino_aporte)}
        </span>
      ),
    },
    {
      key: 'financiador', label: 'Tercero',
      accessor: a => a.financiadores?.nombre ?? '',
      type: 'text',
      render: a => a.financiadores
        ? <span><span className="font-mono text-xs text-slate-500">{a.financiadores.codigo}</span> · {a.financiadores.nombre}</span>
        : <span className="text-gray-300">—</span>,
    },
    {
      key: 'monto', label: 'Importe',
      accessor: a => a.monto,
      type: 'number',
      align: 'right',
      render: a => <span className="font-medium tabular-nums">{fmt(a.monto)}</span>,
    },
    { key: 'moneda', label: 'Moneda', accessor: a => a.moneda, type: 'enum' },
    {
      key: 'observaciones', label: 'Observaciones',
      accessor: a => a.observaciones ?? '',
      type: 'text',
      render: a => (
        <span className="block max-w-xs truncate text-gray-500" title={a.observaciones ?? ''}>
          {a.observaciones ?? <span className="text-gray-300">—</span>}
        </span>
      ),
    },
  ]

  // Cuenta corriente RISA (movimientos_fondo)
  const movimientosColumns: Column<MovimientoFondoRow>[] = [
    {
      key: 'nro_tx', label: 'N° transacción',
      accessor: m => m.aporte_id ? (aporteCodigoPorId.get(m.aporte_id) ?? '') : '',
      type: 'text',
      render: m => {
        const nro = m.aporte_id ? aporteCodigoPorId.get(m.aporte_id) ?? null : null
        return nro
          ? <span className="font-mono text-xs text-slate-600 whitespace-nowrap">{nro}</span>
          : <span className="text-gray-300">—</span>
      },
    },
    { key: 'fecha', label: 'Fecha', accessor: m => m.fecha, type: 'date' },
    {
      key: 'tipo', label: 'Tipo',
      accessor: m => m.tipo,
      type: 'enum',
      enumOptions: [
        { value: 'credito', label: 'Ingreso' },
        { value: 'debito', label: 'Egreso' },
      ],
      render: m => {
        const esCredito = m.tipo === 'credito'
        return (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${esCredito ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'}`}>
            {esCredito ? 'Ingreso' : 'Egreso'}
          </span>
        )
      },
    },
    { key: 'concepto', label: 'Concepto', accessor: m => m.concepto, type: 'text' },
    {
      key: 'ingreso', label: 'Ingreso',
      accessor: m => m.tipo === 'credito' ? m.monto : 0,
      type: 'number', align: 'right', filterable: false,
      render: m => m.tipo === 'credito'
        ? <span className="tabular-nums text-emerald-700">{fmt(m.monto)}</span>
        : <span className="text-gray-300">—</span>,
    },
    {
      key: 'egreso', label: 'Egreso',
      accessor: m => m.tipo === 'debito' ? m.monto : 0,
      type: 'number', align: 'right', filterable: false,
      render: m => m.tipo === 'debito'
        ? <span className="tabular-nums text-rose-700">{fmt(m.monto)}</span>
        : <span className="text-gray-300">—</span>,
    },
    {
      key: 'saldo_resultante', label: 'Saldo resultante',
      accessor: m => m.saldo_resultante,
      type: 'number', align: 'right',
      render: m => (
        <span className={`tabular-nums font-medium ${m.saldo_resultante < 0 ? 'text-red-700' : 'text-gray-900'}`}>
          {fmt(m.saldo_resultante)}
        </span>
      ),
    },
  ]

  // Socios
  const sociosColumns: Column<Socio>[] = [
    { key: 'codigo', label: 'Código', accessor: s => s.codigo ?? '', type: 'text',
      render: s => <span className="font-mono text-xs text-slate-600">{s.codigo ?? '—'}</span> },
    { key: 'nombre', label: 'Nombre', accessor: s => s.nombre, type: 'text' },
    { key: 'cuit', label: 'CUIT', accessor: s => s.cuit ?? '', type: 'text', className: 'hidden sm:table-cell' },
    { key: 'email', label: 'Email', accessor: s => s.email ?? '', type: 'text', className: 'hidden md:table-cell' },
    { key: 'telefono', label: 'Teléfono', accessor: s => s.telefono ?? '', type: 'text', className: 'hidden lg:table-cell' },
  ]

  // Financiadores
  const financiadoresColumns: Column<Financiador>[] = [
    { key: 'codigo', label: 'Código', accessor: f => f.codigo ?? '', type: 'text',
      render: f => <span className="font-mono text-xs text-slate-600">{f.codigo ?? '—'}</span> },
    { key: 'nombre', label: 'Nombre', accessor: f => f.nombre, type: 'text' },
    { key: 'cuit', label: 'CUIT', accessor: f => f.cuit ?? '', type: 'text', className: 'hidden sm:table-cell' },
    { key: 'email', label: 'Email', accessor: f => f.email ?? '', type: 'text', className: 'hidden md:table-cell' },
    { key: 'telefono', label: 'Teléfono', accessor: f => f.telefono ?? '', type: 'text', className: 'hidden lg:table-cell' },
  ]

  // Financiación pendiente (v_saldos_financiadores)
  // Cada fila se identifica por la combinación (financiador_id, moneda)
  type SaldoFinRow = SaldoFinanciadorRow
  const finPendienteColumns: Column<SaldoFinRow>[] = [
    { key: 'codigo', label: 'Código', accessor: s => s.financiador_codigo ?? '', type: 'text',
      render: s => <span className="font-mono text-xs text-slate-600">{s.financiador_codigo ?? '—'}</span> },
    {
      key: 'nombre', label: 'Tercero',
      accessor: s => s.financiador_nombre,
      type: 'text',
      render: s => (
        <span>
          {s.financiador_nombre}
          {s.financiador_deleted_at && <span className="ml-2 text-xs text-gray-400">(dado de baja)</span>}
        </span>
      ),
    },
    { key: 'moneda', label: 'Moneda', accessor: s => s.moneda, type: 'enum' },
    { key: 'total_deuda_generada', label: 'Deuda generada', accessor: s => s.total_deuda_generada, type: 'number', align: 'right',
      render: s => <span className="tabular-nums text-gray-700">{fmt(s.total_deuda_generada)}</span> },
    { key: 'total_cancelado', label: 'Cancelado con aportes', accessor: s => s.total_cancelado, type: 'number', align: 'right',
      render: s => <span className="tabular-nums text-gray-700">{fmt(s.total_cancelado)}</span> },
    {
      key: 'saldo_pendiente', label: 'Saldo pendiente',
      accessor: s => s.saldo_pendiente,
      type: 'number', align: 'right',
      render: s => (
        <span className={`tabular-nums font-medium ${s.saldo_pendiente > 0 ? 'text-amber-700' : 'text-gray-900'}`}>
          {fmt(s.saldo_pendiente)}
        </span>
      ),
    },
  ]

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

  // FIN2.4 / FIN2.4b / FIN2.4d: aporte con imputaciones múltiples
  // (split MP + Terceros).
  // - montoEditado=true: el user tipeó el monto; el sistema no lo pisa por
  //   sugerencias automáticas (excepto recálculo de línea Saldo).
  // - esSaldo=true: esta línea se mantiene == saldo restante; su monto se
  //   recalcula cada vez que cambia monto_total o otra línea. Solo una línea
  //   puede tener esSaldo=true al mismo tiempo.
  type AporteItemForm = {
    destino_tipo:   'medios_propios' | 'tercero'
    fondo_id:       string  // usado si destino_tipo='medios_propios'
    financiador_id: string  // usado si destino_tipo='tercero'
    monto:          string  // string para input controlado; se parsea al submit
    montoEditado:   boolean // true si el user lo modificó manualmente
    esSaldo:        boolean // true si esta línea representa el saldo restante
  }
  type AporteFormState = {
    fecha:         string
    socio_id:      string
    moneda:        string
    monto_total:   string
    observaciones: string
    items:         AporteItemForm[]
  }

  function makeEmptyItem(monto: string = ''): AporteItemForm {
    return {
      destino_tipo: 'medios_propios',
      fondo_id:     '',
      financiador_id: '',
      monto,
      montoEditado: false,
      esSaldo:      false,
    }
  }

  // FIN2.4d: recalcula el monto de la línea esSaldo (si existe) según
  // monto_total - SUM(otras líneas). Si el saldo restante quedaría ≤ 0,
  // se desmarca esa línea automáticamente (no se puede sostener una
  // línea Saldo sin saldo positivo).
  function recomputeSaldoLine(state: AporteFormState): AporteFormState {
    const idx = state.items.findIndex(it => it.esSaldo)
    if (idx === -1) return state
    const total = parseMonto(state.monto_total)
    const sumOtros = state.items.reduce(
      (s, it, i) => i === idx ? s : s + parseMonto(it.monto),
      0,
    )
    const restante = total - sumOtros
    if (restante <= 0.01) {
      return {
        ...state,
        items: state.items.map((it, i) =>
          i === idx ? { ...it, esSaldo: false } : it
        ),
      }
    }
    return {
      ...state,
      items: state.items.map((it, i) =>
        i === idx ? { ...it, monto: restante.toFixed(2) } : it
      ),
    }
  }

  // Parseo seguro de input numérico (acepta coma o punto).
  function parseMonto(s: string): number {
    const v = parseFloat(s.replace(',', '.'))
    return Number.isFinite(v) ? v : 0
  }
  function sumaItems(items: AporteItemForm[]): number {
    return items.reduce((s, it) => s + parseMonto(it.monto), 0)
  }

  const [aporteSocioForm, setAporteSocioForm] = useState<AporteFormState>({
    fecha:         todayIso(),
    socio_id:      '',
    moneda:        'ARS',
    monto_total:   '',
    observaciones: '',
    items:         [makeEmptyItem()],
  })
  function resetAporteSocioForm() {
    setAporteSocioForm({
      fecha:         todayIso(),
      socio_id:      '',
      moneda:        'ARS',
      monto_total:   '',
      observaciones: '',
      items:         [makeEmptyItem()],
    })
  }

  // Update genérico de item (cambiar destino, fondo, financiador). NO marca
  // montoEditado. Para cambios de monto desde input usar onChangeMontoManual.
  function updateItem(idx: number, patch: Partial<AporteItemForm>) {
    setAporteSocioForm(prev => ({
      ...prev,
      items: prev.items.map((it, i) => i === idx ? { ...it, ...patch } : it),
    }))
  }

  // Marca montoEditado=true (el user tipeó). Si esa línea es la Saldo, no
  // hace nada (la línea Saldo es readonly desde la UI; este guard es defensivo).
  function onChangeMontoManual(idx: number, monto: string) {
    setAporteSocioForm(prev => {
      if (prev.items[idx]?.esSaldo) return prev
      const next: AporteFormState = {
        ...prev,
        items: prev.items.map((it, i) => i === idx ? { ...it, monto, montoEditado: true } : it),
      }
      // Si OTRA línea está marcada como Saldo, recomputarla.
      return recomputeSaldoLine(next)
    })
  }

  // FIN2.4b/d: cambiar monto_total puede autocompletar el monto del único
  // item si ese item no fue editado manualmente. También recomputa la
  // línea Saldo si existe.
  function onChangeMontoTotal(v: string) {
    setAporteSocioForm(prev => {
      let next: AporteFormState = { ...prev, monto_total: v }
      if (prev.items.length === 1 && !prev.items[0].montoEditado && !prev.items[0].esSaldo) {
        next.items = [{ ...prev.items[0], monto: v, montoEditado: false }]
      }
      next = recomputeSaldoLine(next)
      return next
    })
  }

  // FIN2.4b/d: agregar item con monto sugerido = saldo pendiente de imputar.
  // Si existe una línea Saldo, no sugerir (la Saldo absorbe el resto).
  function addItem() {
    setAporteSocioForm(prev => {
      const haySaldo = prev.items.some(it => it.esSaldo)
      const total      = parseMonto(prev.monto_total)
      const sumActual  = sumaItems(prev.items)
      const pendiente  = total - sumActual
      const sugerido   = !haySaldo && pendiente > 0.01 ? pendiente.toFixed(2) : ''
      const next: AporteFormState = { ...prev, items: [...prev.items, makeEmptyItem(sugerido)] }
      return recomputeSaldoLine(next)
    })
  }

  function removeItem(idx: number) {
    setAporteSocioForm(prev => {
      const next = prev.items.filter((_, i) => i !== idx)
      const ensured = next.length > 0 ? next : [makeEmptyItem()]
      return recomputeSaldoLine({ ...prev, items: ensured })
    })
  }

  // FIN2.4d: marca/desmarca una línea como "Saldo".
  // - Solo una línea puede tener esSaldo=true a la vez (las otras se desmarcan).
  // - Al marcar, valida saldo > 0; si ≤ 0 → alert y no marca.
  // - Al marcar, setea el monto = saldo restante + montoEditado=true.
  function toggleEsSaldo(idx: number) {
    setAporteSocioForm(prev => {
      const wasSaldo = prev.items[idx]?.esSaldo ?? false
      if (wasSaldo) {
        return {
          ...prev,
          items: prev.items.map((it, i) => i === idx ? { ...it, esSaldo: false } : it),
        }
      }
      const total = parseMonto(prev.monto_total)
      const sumOtros = prev.items.reduce(
        (s, it, i) => i === idx ? s : s + parseMonto(it.monto),
        0,
      )
      const restante = total - sumOtros
      if (restante <= 0.01) {
        alert('No queda saldo pendiente para imputar.')
        return prev
      }
      return {
        ...prev,
        items: prev.items.map((it, i) => {
          if (i === idx) return { ...it, esSaldo: true, monto: restante.toFixed(2), montoEditado: true }
          return { ...it, esSaldo: false }
        }),
      }
    })
  }

  // FIN2.4c: setea el monto del item al saldo restante (total - sum(otros items)).
  // Si no queda saldo (≤ 0), avisa y no modifica.
  function handleUsarSaldoEnItem(idx: number) {
    setAporteSocioForm(prev => {
      const total = parseMonto(prev.monto_total)
      const sumOtros = prev.items.reduce(
        (s, it, i) => i === idx ? s : s + parseMonto(it.monto),
        0,
      )
      const restante = total - sumOtros
      if (restante <= 0.01) {
        alert('No queda saldo pendiente para imputar en esta línea.')
        return prev
      }
      return {
        ...prev,
        items: prev.items.map((it, i) =>
          i === idx ? { ...it, monto: restante.toFixed(2), montoEditado: true } : it
        ),
      }
    })
  }

  // FIN2.4c: ajusta la última imputación para que la suma == monto_total.
  // Si el ajuste dejaría esa línea en ≤ 0, avisa y no modifica.
  function handleAjustarUltimaImputacion() {
    setAporteSocioForm(prev => {
      if (prev.items.length === 0) return prev
      const total   = parseMonto(prev.monto_total)
      const lastIdx = prev.items.length - 1
      const sumOtros = prev.items.slice(0, lastIdx).reduce(
        (s, it) => s + parseMonto(it.monto),
        0,
      )
      const nuevoUltimo = total - sumOtros
      if (nuevoUltimo <= 0.01) {
        alert('La última imputación quedaría en cero. Eliminala o ajustá otra línea.')
        return prev
      }
      return {
        ...prev,
        items: prev.items.map((it, i) =>
          i === lastIdx ? { ...it, monto: nuevoUltimo.toFixed(2), montoEditado: true } : it
        ),
      }
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

  // FIN2.4: handler que arma payload v2 y llama a registrar_aporte_socio_v2.
  // La RPC valida server-side y es transaccional; este handler solo da feedback
  // rápido al usuario sobre errores de forma.
  function handleRegistrarAporteSocio(e: React.FormEvent) {
    e.preventDefault()
    setNuevoError('')

    const monto_total = parseFloat(aporteSocioForm.monto_total.replace(',', '.'))
    if (!aporteSocioForm.socio_id) {
      setNuevoError('Seleccioná un socio.'); return
    }
    if (!Number.isFinite(monto_total) || monto_total <= 0) {
      setNuevoError('El monto total debe ser mayor a 0.'); return
    }
    if (!risa?.id) {
      setNuevoError('Fondo RISA no encontrado.'); return
    }

    const items: AporteSocioV2Payload['items'] = []
    let suma = 0
    for (let i = 0; i < aporteSocioForm.items.length; i++) {
      const it = aporteSocioForm.items[i]
      const m = parseFloat(it.monto.replace(',', '.'))
      if (!Number.isFinite(m) || m <= 0) {
        setNuevoError(`Imputación ${i + 1}: monto inválido.`); return
      }
      if (it.destino_tipo === 'medios_propios') {
        const fid = it.fondo_id || risa.id
        items.push({ destino_tipo: 'medios_propios', fondo_id: fid, monto: m })
      } else {
        if (!it.financiador_id) {
          setNuevoError(`Imputación ${i + 1}: seleccioná un tercero.`); return
        }
        items.push({ destino_tipo: 'tercero', financiador_id: it.financiador_id, monto: m })
      }
      suma += m
    }
    if (Math.abs(suma - monto_total) > 0.01) {
      setNuevoError(
        `Suma de imputaciones (${suma.toFixed(2)}) no coincide con monto total (${monto_total.toFixed(2)}).`
      )
      return
    }

    startTransition(async () => {
      const result = await onRegistrarAporteSocioV2({
        fecha:         aporteSocioForm.fecha,
        socio_id:      aporteSocioForm.socio_id,
        fondo_id:      risa.id,
        moneda:        aporteSocioForm.moneda,
        monto_total,
        observaciones: aporteSocioForm.observaciones.trim() || null,
        items,
      })
      if (!result.ok) { setNuevoError(result.error); return }
      const codigo = result.aporte_codigo ?? 'APO-?'
      alert(`Aporte ${codigo} registrado correctamente.`)
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
  // FIN2.4: lookup rápido por (financiador_id, moneda) para mostrar
  // deuda viva junto al select del item tercero.
  const deudaPorFinanciador = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of financiadoresConDeuda) {
      m.set(`${s.financiador_id}-${s.moneda}`, s.saldo_pendiente)
    }
    return m
  }, [financiadoresConDeuda])

  // Total imputado viva para feedback del form.
  const totalImputado = useMemo(
    () => sumaItems(aporteSocioForm.items),
    [aporteSocioForm.items],
  )
  const montoTotalNum = useMemo(
    () => parseMonto(aporteSocioForm.monto_total),
    [aporteSocioForm.monto_total],
  )
  const diferencia = totalImputado - montoTotalNum  // <0 falta, >0 sobra, ==0 OK
  const sumaCoincide = Math.abs(diferencia) < 0.01 && montoTotalNum > 0

  // FIN2.4b: validación item por item para habilitar el botón Registrar.
  // - monto > 0
  // - destino_tipo=tercero requiere financiador_id y monto ≤ deuda viva
  const itemsValidos = useMemo(() => {
    return aporteSocioForm.items.every(it => {
      const m = parseMonto(it.monto)
      if (m <= 0) return false
      if (it.destino_tipo === 'tercero') {
        if (!it.financiador_id) return false
        const deuda = deudaPorFinanciador.get(`${it.financiador_id}-${aporteSocioForm.moneda}`) ?? 0
        if (m > deuda + 0.01) return false
      }
      return true
    })
  }, [aporteSocioForm.items, aporteSocioForm.moneda, deudaPorFinanciador])

  const puedeRegistrar =
    !!aporteSocioForm.socio_id &&
    montoTotalNum > 0 &&
    aporteSocioForm.items.length > 0 &&
    itemsValidos &&
    sumaCoincide

  // Razón principal por la que el submit está bloqueado (texto visible al user).
  const razonBloqueo: string | null = (() => {
    if (puedeRegistrar) return null
    if (!aporteSocioForm.socio_id) return 'Seleccioná un socio.'
    if (montoTotalNum <= 0) return 'Ingresá el monto total.'
    // Items inválidos
    for (let i = 0; i < aporteSocioForm.items.length; i++) {
      const it = aporteSocioForm.items[i]
      const m = parseMonto(it.monto)
      if (m <= 0) return `Imputación ${i + 1}: ingresá un monto > 0.`
      if (it.destino_tipo === 'tercero') {
        if (!it.financiador_id) return `Imputación ${i + 1}: seleccioná un tercero.`
        const deuda = deudaPorFinanciador.get(`${it.financiador_id}-${aporteSocioForm.moneda}`) ?? 0
        if (m > deuda + 0.01) return `Imputación ${i + 1}: el monto supera la deuda viva del tercero.`
      }
    }
    if (!sumaCoincide) {
      if (diferencia < 0) return `Falta imputar ${aporteSocioForm.moneda} ${fmt(Math.abs(diferencia))}.`
      return `Sobra ${aporteSocioForm.moneda} ${fmt(diferencia)} de imputación.`
    }
    return 'Revisá los datos del aporte.'
  })()

  return (
    <div className="space-y-8">

      {/* ═══════════════════════════════════════════════════════════════════════
          Etapa 2A — Caja RISA y terceros (read-only)
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
            + Nuevo tercero
          </button>
        </div>
      )}

      {/* ── Cuenta corriente RISA ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-gray-900">
            Cuenta corriente RISA{risa?.codigo ? ` — ${risa.codigo}` : ''}
          </h3>
          <input
            type="text"
            value={searchMovimientos}
            onChange={e => setSearchMovimientos(e.target.value)}
            placeholder="Buscar… (APO-###, concepto, tipo)"
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 sm:max-w-xs"
          />
        </div>
        <DataTable<MovimientoFondoRow>
          rows={movimientosRisa}
          columns={movimientosColumns}
          getRowId={m => m.id}
          searchTerm={searchMovimientos}
          searchKeys={['nro_tx', 'concepto', 'tipo']}
          initialSort={{ key: 'fecha', dir: 'desc' }}
          emptyMessage={
            movimientosRisa.length === 0
              ? 'No hay movimientos en la cuenta corriente.'
              : 'No hay movimientos que coincidan con los filtros.'
          }
        />
      </div>

      {/* ── Deuda pendiente con terceros (v_saldos_financiadores) ──────────── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-gray-900">Cuenta corriente de terceros</h3>
          <input
            type="text"
            value={searchFinPendiente}
            onChange={e => setSearchFinPendiente(e.target.value)}
            placeholder="Buscar… (FIN-###, nombre, moneda)"
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 sm:max-w-xs"
          />
        </div>
        <DataTable<SaldoFinanciadorRow>
          rows={saldosFinanciadores}
          columns={finPendienteColumns}
          getRowId={s => `${s.financiador_id}-${s.moneda}`}
          searchTerm={searchFinPendiente}
          searchKeys={['codigo', 'nombre', 'moneda']}
          initialSort={{ key: 'saldo_pendiente', dir: 'desc' }}
          emptyMessage={
            saldosFinanciadores.length === 0
              ? 'No hay deuda pendiente con terceros.'
              : 'No hay deuda con terceros que coincida con los filtros.'
          }
        />
      </div>

      {/* ── Aportes de socios ─────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-gray-900">Aportes de socios</h3>
          <input
            type="text"
            value={searchAportes}
            onChange={e => setSearchAportes(e.target.value)}
            placeholder="Buscar… (APO-###, socio, tercero, destino)"
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 sm:max-w-xs"
          />
        </div>
        <DataTable<AporteFondoRow>
          rows={aportes}
          columns={aportesColumns}
          getRowId={a => a.id}
          searchTerm={searchAportes}
          searchKeys={['codigo', 'socio', 'financiador', 'destino', 'observaciones', 'moneda']}
          initialSort={{ key: 'codigo', dir: 'desc' }}
          emptyMessage={
            aportes.length === 0
              ? 'No hay aportes registrados.'
              : 'No hay aportes que coincidan con los filtros.'
          }
        />
      </div>

      {/* ── Socios ──────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-gray-900">Socios</h3>
          <input
            type="text"
            value={searchSocios}
            onChange={e => setSearchSocios(e.target.value)}
            placeholder="Buscar… (SOC-###, nombre, CUIT, email)"
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 sm:max-w-xs"
          />
        </div>
        <DataTable<Socio>
          rows={socios}
          columns={sociosColumns}
          getRowId={s => s.id}
          searchTerm={searchSocios}
          searchKeys={['codigo', 'nombre', 'cuit', 'email', 'telefono']}
          initialSort={{ key: 'codigo', dir: 'asc' }}
          emptyMessage={
            socios.length === 0
              ? 'No hay socios registrados.'
              : 'No hay socios que coincidan con los filtros.'
          }
        />
      </div>

      {/* ── Financiadores ───────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-gray-900">Terceros</h3>
          <input
            type="text"
            value={searchFinanciadores}
            onChange={e => setSearchFinanciadores(e.target.value)}
            placeholder="Buscar… (FIN-###, nombre, CUIT, email)"
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 sm:max-w-xs"
          />
        </div>
        <DataTable<Financiador>
          rows={financiadores}
          columns={financiadoresColumns}
          getRowId={f => f.id}
          searchTerm={searchFinanciadores}
          searchKeys={['codigo', 'nombre', 'cuit', 'email', 'telefono']}
          initialSort={{ key: 'codigo', dir: 'asc' }}
          emptyMessage={
            financiadores.length === 0
              ? 'No hay terceros registrados.'
              : 'No hay terceros que coincidan con los filtros.'
          }
        />
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

      {/* ── Modal: Nuevo tercero ─────────────────────────────────────────────── */}
      {nuevoModal === 'newFinanciador' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="mb-5 text-lg font-semibold text-gray-900">Nuevo tercero</h2>
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
                  <input type="email" value={finForm.email} onChange={e => setFinForm({ ...finForm, email: e.target.value })} className={inputCls} placeholder="tercero@email.com" />
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
                <button type="submit" disabled={isPending} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50">{isPending ? 'Guardando…' : 'Crear tercero'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Nuevo aporte (FIN2.4 — imputaciones múltiples) ────────── */}
      {nuevoModal === 'newAporte' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="mb-1 text-lg font-semibold text-gray-900">Registrar nuevo aporte</h2>
            <p className="mb-5 text-xs text-gray-500">
              El aporte se puede imputar a Medios Propios RISA y/o a uno o más Terceros. La suma de las imputaciones debe coincidir con el monto total.
            </p>
            <form onSubmit={handleRegistrarAporteSocio} className="space-y-4">

              {/* Cabecera */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Monto total <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={aporteSocioForm.monto_total}
                    onChange={e => onChangeMontoTotal(e.target.value)}
                    className={`${inputCls} tabular-nums`}
                    placeholder="0.00"
                  />
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

              {/* Imputaciones */}
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Imputaciones</span>
                  <button
                    type="button"
                    onClick={addItem}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    + Agregar imputación
                  </button>
                </div>

                <div className="space-y-2">
                  {aporteSocioForm.items.map((it, i) => {
                    const deudaKey = `${it.financiador_id}-${aporteSocioForm.moneda}`
                    const deudaViva = it.destino_tipo === 'tercero' ? deudaPorFinanciador.get(deudaKey) ?? null : null
                    const montoNum = parseFloat(it.monto.replace(',', '.'))
                    const excedeDeuda =
                      it.destino_tipo === 'tercero' &&
                      it.financiador_id !== '' &&
                      Number.isFinite(montoNum) &&
                      deudaViva !== null &&
                      montoNum > deudaViva + 0.01
                    return (
                      <div key={i} className="rounded-md border border-gray-200 bg-white p-2.5">
                        <div className="grid grid-cols-12 gap-2 items-end">
                          <div className="col-span-12 sm:col-span-3">
                            <label className="mb-0.5 block text-[11px] uppercase tracking-wide text-gray-500">Destino</label>
                            <select
                              value={it.destino_tipo}
                              onChange={e => updateItem(i, {
                                destino_tipo: e.target.value as AporteItemForm['destino_tipo'],
                                financiador_id: e.target.value === 'medios_propios' ? '' : it.financiador_id,
                                fondo_id:       e.target.value === 'tercero'        ? '' : it.fondo_id,
                              })}
                              className={inputCls}
                            >
                              <option value="medios_propios">Medios Propios</option>
                              <option value="tercero">Tercero</option>
                            </select>
                          </div>

                          {it.destino_tipo === 'medios_propios' ? (
                            <div className="col-span-12 sm:col-span-5">
                              <label className="mb-0.5 block text-[11px] uppercase tracking-wide text-gray-500">Fondo</label>
                              <input
                                type="text"
                                value={risa ? `${risa.codigo ?? 'Sin código'} — ${risa.nombre}` : '—'}
                                disabled
                                className={`${inputCls} bg-gray-50 text-gray-500`}
                              />
                            </div>
                          ) : (
                            <div className="col-span-12 sm:col-span-5">
                              <label className="mb-0.5 block text-[11px] uppercase tracking-wide text-gray-500">Tercero</label>
                              <select
                                value={it.financiador_id}
                                onChange={e => updateItem(i, { financiador_id: e.target.value })}
                                className={`${inputCls} ${it.financiador_id === '' ? 'border-red-400 bg-red-50' : ''}`}
                              >
                                <option value="">— Seleccionar tercero —</option>
                                {financiadoresConDeuda
                                  .filter(f => f.moneda === aporteSocioForm.moneda)
                                  .map(f => (
                                    <option key={`${f.financiador_id}-${f.moneda}`} value={f.financiador_id}>
                                      {(f.financiador_codigo ?? 'Sin código') + ' — ' + f.financiador_nombre + ' · deuda ' + f.moneda + ' ' + fmt(f.saldo_pendiente)}
                                    </option>
                                  ))}
                              </select>
                              {it.financiador_id === '' && (
                                <p className="mt-1 text-[11px] text-red-600">Seleccioná un tercero</p>
                              )}
                            </div>
                          )}

                          <div className="col-span-10 sm:col-span-3">
                            <label className="mb-0.5 block text-[11px] uppercase tracking-wide text-gray-500">Monto</label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={it.monto}
                              onChange={e => onChangeMontoManual(i, e.target.value)}
                              readOnly={it.esSaldo}
                              className={`${inputCls} tabular-nums ${
                                excedeDeuda ? 'border-red-400 bg-red-50' :
                                it.esSaldo  ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''
                              }`}
                              placeholder="0.00"
                              title={it.esSaldo ? 'Línea Saldo: desmarcá el checkbox para editar manualmente.' : undefined}
                            />
                            <label className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={it.esSaldo}
                                onChange={() => toggleEsSaldo(i)}
                                className="h-3.5 w-3.5 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
                              />
                              <span>Saldo</span>
                            </label>
                          </div>

                          <div className="col-span-2 sm:col-span-1 flex justify-end">
                            <button
                              type="button"
                              onClick={() => removeItem(i)}
                              title="Quitar imputación"
                              className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                              aria-label={`Quitar imputación ${i + 1}`}
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        {it.destino_tipo === 'tercero' && it.financiador_id !== '' && deudaViva !== null && (
                          <p className={`mt-1.5 text-[11px] ${excedeDeuda ? 'text-red-600' : 'text-gray-500'}`}>
                            Deuda viva con este tercero: <span className="font-medium tabular-nums">{aporteSocioForm.moneda} {fmt(deudaViva)}</span>
                            {excedeDeuda && ' · supera la deuda'}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Resumen de coincidencia (FIN2.4b: muestra siempre pendiente/sobra) */}
                <div className={`mt-3 rounded-md border px-3 py-2 text-sm tabular-nums ${
                  sumaCoincide ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : montoTotalNum === 0 ? 'border-gray-200 bg-white text-gray-500'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}>
                  <div className="flex items-center justify-between">
                    <span>Monto total:</span>
                    <span className="font-semibold">{aporteSocioForm.moneda} {fmt(montoTotalNum)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Total imputado:</span>
                    <span className="font-semibold">{aporteSocioForm.moneda} {fmt(totalImputado)}</span>
                  </div>
                  {montoTotalNum > 0 && (
                    <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span>
                        {sumaCoincide ? '✓ Coincide con monto total' :
                          diferencia < 0 ? `Falta imputar ${aporteSocioForm.moneda} ${fmt(Math.abs(diferencia))}` :
                                            `Sobra imputar ${aporteSocioForm.moneda} ${fmt(diferencia)}`}
                      </span>
                      {!sumaCoincide && (
                        <button
                          type="button"
                          onClick={handleAjustarUltimaImputacion}
                          className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 transition-colors"
                        >
                          Ajustar última imputación
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

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

              {!nuevoError && razonBloqueo && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {razonBloqueo}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={closeNuevoModal} disabled={isPending} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50">Cancelar</button>
                <button
                  type="submit"
                  disabled={isPending || !puedeRegistrar}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  {isPending ? 'Guardando…' : 'Registrar aporte'}
                </button>
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
