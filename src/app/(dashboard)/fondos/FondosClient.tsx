'use client'

import { useState, useTransition, useRef, useMemo, useEffect } from 'react'
import type { Fondo, UserRole, TipoAporte, FondoEstado, AporteFondo, Socio, Financiador, SaldoFinanciadorRow, MovimientoTipo, DestinoAporte, PosicionGlobalRisaRow, AporteImputacionDetalleRow, MovimientoFinanciacion } from '@/types'
import type {
  AportePayload, FondoActionResult, FondoDepsResult,
  SocioPayload, SocioActionResult,
  FinanciadorPayload, FinanciadorActionResult,
  AporteSocioPayload, AporteSocioActionResult,
  AporteSocioV2Payload,
  AnularAporteSocioActionResult,
} from './actions'
import { useSortable } from '@/lib/useSortable'
import SortableHeader from '@/components/SortableHeader'
import DataTable, { type Column } from '@/components/DataTable'
import RowActionMenu, { type RowActionItem } from '@/components/RowActionMenu'
import { exportToExcel, exportWorkbookToExcel, todayForFile } from '@/lib/excel'
import { buildPagoTransaccionRows, type PagoExportInput, type OrdenPagoLite } from '@/lib/pagosExport'

export interface AporteFondoRow extends AporteFondo {
  fondos: { nombre: string } | null
  socios: { nombre: string } | null
  financiadores: { nombre: string; codigo: string | null } | null
}

// FONDOS-TERCEROS-DETALLE-1: forma enriquecida del row con joins PostgREST.
// Todos los joins son opcionales — el fallback en page.tsx puede hidratar null.
export interface MovimientoFinanciacionRow extends MovimientoFinanciacion {
  pagos?: { codigo: string | null; fecha_pago: string | null; estado: string | null } | null
  gastos?: {
    codigo: string | null
    descripcion: string | null
    fecha_gasto: string | null
    estado: string | null
    proveedores: { codigo: string | null; nombre: string } | null
    tipos_gasto: { codigo: string | null; nombre: string } | null
  } | null
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
  // FIN2.6: Posición Global RISA (MP+MT=PG) por moneda. Si la view aún no
  // existe, llega array vacío y se cae al cálculo cliente legacy.
  posicionGlobal: PosicionGlobalRisaRow[]
  // FIN2.7: imputaciones (read-only) con joins fondos/financiadores. Si la
  // tabla aún no existe, llega vacío y la columna Detalle muestra "—".
  imputaciones: AporteImputacionDetalleRow[]
  // UX-DETAILS (2026-05-25): movimientos_financiacion para "Ver detalle" de
  // tercero. Volumen bajo: el cliente filtra por financiador_id al abrir modal.
  movimientosFinanciacion: MovimientoFinanciacion[]
  // TRANSACCIONES-EXPORT (2026-06-17): pagos registrados + OPs para la solapa
  // "Transacciones" del export de Fondos. Solo se usan en el export.
  pagos: PagoExportInput[]
  ordenesPago: OrdenPagoLite[]
  // Deep-link (2026-06-05): codigo APO-### para abrir el modal de detalle de
  // ese aporte al montar (viene de /fondos?aporte=...). null = sin deep-link.
  aporteInicial?: string | null
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
  // FIN2.5: anula un aporte y genera reversas atómicas.
  onAnularAporteSocio: (aporte_id: string, motivo?: string | null) => Promise<AnularAporteSocioActionResult>
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FondosClient({
  fondos,
  aportes,
  socios,
  financiadores,
  saldosFinanciadores,
  movimientos,
  posicionGlobal,
  imputaciones,
  movimientosFinanciacion,
  pagos,
  ordenesPago,
  aporteInicial = null,
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
  onAnularAporteSocio,
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

  // UX-DETAILS (2026-05-25): "resumen primero, detalle bajo demanda".
  //   - risaCollapsed: tabla de movimientos RISA escondida por default.
  //   - terceroDetalleId: id del tercero abierto en modal de detalle, o null.
  //   - aporteDetalleId: id del aporte abierto en modal de detalle, o null.
  const [risaCollapsed, setRisaCollapsed] = useState(true)
  const [aportesCollapsed, setAportesCollapsed] = useState(true)
  const [terceroDetalleId, setTerceroDetalleId] = useState<string | null>(null)
  const [aporteDetalleId, setAporteDetalleId] = useState<string | null>(null)

  // Deep-link (2026-06-05): /fondos?aporte=APO-### abre el detalle al montar.
  // Solo al primer render; después el modal se maneja con estado local.
  useEffect(() => {
    if (!aporteInicial) return
    const found = aportes.find(a => a.codigo === aporteInicial)
    if (found) setAporteDetalleId(found.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // ─── FIN2.7: imputaciones agrupadas por aporte_id para mostrar detalle inline.
  //            Si un aporte no tiene imputaciones (legacy pre-FIN2), no aparece
  //            en el Map y la columna renderiza "—".
  const imputacionesPorAporte = useMemo(() => {
    const m = new Map<string, AporteImputacionDetalleRow[]>()
    for (const i of imputaciones) {
      const arr = m.get(i.aporte_id) ?? []
      arr.push(i)
      m.set(i.aporte_id, arr)
    }
    return m
  }, [imputaciones])

  // UX-DETAILS-2 (2026-05-25): resumen de aportes para mostrar antes de la
  // tabla. Total activo por moneda (excluye anulados) + counts.
  const aportesSummary = useMemo(() => {
    const totalesActivos = new Map<string, number>()
    let activos = 0
    let anulados = 0
    for (const a of aportes) {
      if (a.deleted_at) {
        anulados++
      } else {
        activos++
        totalesActivos.set(a.moneda, (totalesActivos.get(a.moneda) ?? 0) + Number(a.monto))
      }
    }
    return { totalesActivos, activos, anulados }
  }, [aportes])

  // ─── Etapa F1: búsqueda local por tabla ────────────────────────────────────
  // L&F-FONDOS-2: removidos los buscadores de Terceros (cta. cte.) y Socios
  // por redundantes — quedan los filtros por columna del DataTable.
  const [searchAportes, setSearchAportes] = useState('')
  const [searchMovimientos, setSearchMovimientos] = useState('')
  const [searchFinanciadores, setSearchFinanciadores] = useState('')

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
      // FIN2.7b (2026-05-25): Destino derivado de las imputaciones:
      //   - 0 imputaciones (legacy): usa destino_aporte de la cabecera.
      //   - 1 imputación MP → "RISA" (azul).
      //   - 1 imputación Tercero → nombre del tercero (índigo).
      //   - 2+ imputaciones → "Mixto" (violeta).
      key: 'destino', label: 'Destino',
      accessor: a => {
        const list = imputacionesPorAporte.get(a.id) ?? []
        if (list.length === 0) return a.destino_aporte === 'risa' ? 'risa' : 'tercero'
        if (list.length === 1) return list[0].destino_tipo === 'medios_propios' ? 'risa' : 'tercero'
        return 'mixto'
      },
      type: 'enum',
      enumOptions: [
        { value: 'risa',   label: 'RISA' },
        { value: 'tercero', label: 'Tercero' },
        { value: 'mixto',  label: 'Mixto' },
      ],
      render: a => {
        const list = imputacionesPorAporte.get(a.id) ?? []
        if (list.length === 0) {
          // Legacy: usar la cabecera. Reuso el estilo previo.
          return (
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${a.destino_aporte === 'risa' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' : 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'}`}>
              {destinoLabel(a.destino_aporte)}
            </span>
          )
        }
        if (list.length === 1) {
          const i = list[0]
          if (i.destino_tipo === 'medios_propios') {
            return (
              <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 ring-1 ring-blue-200">
                RISA
              </span>
            )
          }
          const cod = i.financiadores?.codigo
          const nom = i.financiadores?.nombre ?? 'Tercero'
          return (
            <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200" title={nom}>
              {cod ? `${cod} · ${nom}` : nom}
            </span>
          )
        }
        return (
          <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-purple-50 text-purple-700 ring-1 ring-purple-200">
            Mixto
          </span>
        )
      },
    },
    // UX-DETAILS (2026-05-25): columna Detalle inline movida al modal
    // "Ver detalle" (rowAction). Mantiene la tabla resumida.
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
    {
      key: 'estado', label: 'Estado',
      // FIN2.5: derivado de deleted_at. anulado = soft-deleted con metadatos.
      accessor: a => a.deleted_at ? 'anulado' : 'activo',
      type: 'enum',
      enumOptions: [
        { value: 'activo',  label: 'Activo'  },
        { value: 'anulado', label: 'Anulado' },
      ],
      render: a => a.deleted_at
        ? (
          <span
            className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-red-50 text-red-700 ring-1 ring-red-200"
            title={a.motivo_anulacion ? `Anulado: ${a.motivo_anulacion}` : 'Anulado'}
          >
            Anulado
          </span>
        )
        : (
          <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
            Activo
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

  // FIN2.5: handler para anular un aporte vivo. Pide motivo opcional vía prompt.
  function handleAnularAporte(aporte_id: string, codigo: string | null) {
    const ref = codigo ?? 'aporte'
    const motivo = prompt(`Motivo de anulación de ${ref} (opcional):`, '')
    if (motivo === null) return  // usuario canceló el prompt
    if (!confirm(`¿Anular ${ref}? Se generarán movimientos de reversa por cada imputación.`)) return
    startTransition(async () => {
      const result = await onAnularAporteSocio(aporte_id, motivo.trim() || null)
      if (!result.ok) {
        alert(`No se pudo anular: ${result.error}`)
        return
      }
      alert(`${ref} anulado correctamente.`)
    })
  }

  // UX-EXPORT-FONDOS (2026-05-25): genera un xlsx con 5 hojas. Reutiliza los
  // datos ya cargados en cliente (no nuevos SELECT). Aportes anulados se
  // exportan con estado 'Anulado' y no se filtran.
  function handleExportFondos() {
    // Hoja 1 — Cuenta_RISA: movimientos_fondo (solo los del fondo RISA)
    const cuentaRisa = movimientosRisa.map(m => ({
      fecha: m.fecha,
      nro_transaccion: m.aporte_id ? (aporteCodigoPorId.get(m.aporte_id) ?? '') : '',
      tipo: m.tipo,
      concepto: m.concepto,
      ingreso: m.tipo === 'credito' ? Number(m.monto) : 0,
      egreso:  m.tipo === 'debito'  ? Number(m.monto) : 0,
      saldo_resultante: Number(m.saldo_resultante),
      moneda: risa?.moneda ?? '',
    }))

    // Hoja 2 — Terceros_Resumen: v_saldos_financiadores
    const tercerosResumen = saldosFinanciadores.map(s => ({
      codigo: s.financiador_codigo ?? '',
      tercero: s.financiador_nombre,
      moneda: s.moneda,
      deuda_generada: Number(s.total_deuda_generada),
      cancelado_con_aportes: Number(s.total_cancelado),
      saldo_pendiente: Number(s.saldo_pendiente),
    }))

    // Hoja 3 — Terceros_Movimientos: movimientos_financiacion
    // Map auxiliar para resolver tercero_codigo/nombre desde financiador_id.
    const finPorId = new Map<string, Financiador>()
    for (const f of financiadores) finPorId.set(f.id, f)
    // Map aporte_id → codigo APO ya existe (aporteCodigoPorId). No tenemos
    // map directo pago_id → nro_pago a nivel /fondos; queda vacío salvo que
    // el descripcion lo contenga (descripciones de fn_confirmar_pago
    // incluyen "Pago {nro_pago} — concepto"). Lo dejamos en blanco.
    const tercerosMovs = movimientosFinanciacion.map(m => {
      const f = finPorId.get(m.financiador_id) ?? null
      return {
        fecha: m.fecha,
        tercero_codigo: f?.codigo ?? '',
        tercero_nombre: f?.nombre ?? '',
        tipo_movimiento: m.tipo_movimiento,
        descripcion: m.descripcion ?? '',
        importe: Number(m.importe),
        moneda: m.moneda,
        nro_aporte: m.aporte_id ? (aporteCodigoPorId.get(m.aporte_id) ?? '') : '',
      }
    })

    // Hoja 4 — Aportes
    const aportesRows = aportes.map(a => ({
      nro_aporte: a.codigo ?? '',
      fecha: a.fecha_aporte,
      socio: a.socios?.nombre ?? a.aportante ?? '',
      importe: Number(a.monto),
      moneda: a.moneda,
      destino: destinoLabel(a.destino_aporte),
      estado: a.deleted_at ? 'Anulado' : 'Activo',
      observaciones: a.observaciones ?? '',
      motivo_anulacion: a.motivo_anulacion ?? '',
    }))

    // Hoja 5 — Aporte_Imputaciones
    const aporteCodigoPorAporteId = new Map<string, string>()
    for (const a of aportes) if (a.codigo) aporteCodigoPorAporteId.set(a.id, a.codigo)
    const socioPorAporteId = new Map<string, string>()
    for (const a of aportes) socioPorAporteId.set(a.id, a.socios?.nombre ?? a.aportante ?? '')
    const imputacionesRows = imputaciones.map(i => ({
      nro_aporte: aporteCodigoPorAporteId.get(i.aporte_id) ?? '',
      socio: socioPorAporteId.get(i.aporte_id) ?? '',
      destino_tipo: i.destino_tipo === 'medios_propios' ? 'Medios Propios' : 'Tercero',
      fondo: i.fondos?.nombre ?? '',
      tercero: i.financiadores
        ? `${i.financiadores.codigo ? i.financiadores.codigo + ' ' : ''}${i.financiadores.nombre}`
        : '',
      importe: Number(i.monto),
      moneda: i.moneda,
    }))

    // Hoja 6 — Transacciones: pagos registrados (pagado + anulado) con N°, OP,
    // proveedor, tipo, concepto, canal, tercero, fecha, modalidad, monto, estado.
    const transaccionesRows = buildPagoTransaccionRows(pagos, ordenesPago)

    exportWorkbookToExcel(
      [
        { name: 'Cuenta_RISA',          rows: cuentaRisa,
          headers: ['fecha', 'nro_transaccion', 'tipo', 'concepto', 'ingreso', 'egreso', 'saldo_resultante', 'moneda'] },
        { name: 'Transacciones',        rows: transaccionesRows,
          headers: ['nro_pago', 'nro_op', 'proveedor', 'tipo', 'concepto', 'canal', 'tercero', 'fecha', 'pago', 'monto', 'moneda', 'estado'] },
        { name: 'Terceros_Resumen',     rows: tercerosResumen,
          headers: ['codigo', 'tercero', 'moneda', 'deuda_generada', 'cancelado_con_aportes', 'saldo_pendiente'] },
        { name: 'Terceros_Movimientos', rows: tercerosMovs,
          headers: ['fecha', 'tercero_codigo', 'tercero_nombre', 'tipo_movimiento', 'descripcion', 'importe', 'moneda', 'nro_aporte'] },
        { name: 'Aportes',              rows: aportesRows,
          headers: ['nro_aporte', 'fecha', 'socio', 'importe', 'moneda', 'destino', 'estado', 'observaciones', 'motivo_anulacion'] },
        { name: 'Aporte_Imputaciones',  rows: imputacionesRows,
          headers: ['nro_aporte', 'socio', 'destino_tipo', 'fondo', 'tercero', 'importe', 'moneda'] },
      ],
      `fondos_${todayForFile()}.xlsx`,
    )
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
  // ── FIN2.6: encabezado MP + MT = RISA desde v_posicion_global_risa ─────────
  // Fuente de verdad: vista SQL agrupada por moneda. Fallback: cálculo cliente
  // si la view aún no se aplicó (posicionGlobal vacío).
  const monedaPG = risa?.moneda ?? 'ARS'

  const posicionGlobalEffective: PosicionGlobalRisaRow[] = useMemo(() => {
    if (posicionGlobal.length > 0) return posicionGlobal
    // Fallback legacy: replicar el cálculo de FIN2.6-pre para monedaPG.
    const mp = fondos
      .filter(f => !f.deleted_at && f.estado === 'activo' && f.moneda === monedaPG)
      .reduce((s, f) => s + Number(f.saldo_actual), 0)
    const tercerosDeuda = saldosFinanciadores
      .filter(s => s.moneda === monedaPG && s.saldo_pendiente > 0 && !s.financiador_deleted_at)
      .sort((a, b) => b.saldo_pendiente - a.saldo_pendiente)
    const mtDeuda = tercerosDeuda.reduce((s, t) => s + Number(t.saldo_pendiente), 0)
    return [{
      moneda: monedaPG,
      mp_total: mp,
      mt_total: -mtDeuda,
      pg_total: mp - mtDeuda,
      mp_detalle: fondos
        .filter(f => !f.deleted_at && f.estado === 'activo' && f.moneda === monedaPG)
        .map(f => ({ fondo_id: f.id, codigo: f.codigo, nombre: f.nombre, saldo_actual: Number(f.saldo_actual) })),
      mt_detalle: tercerosDeuda.map(t => ({
        financiador_id:   t.financiador_id,
        codigo:           t.financiador_codigo,
        nombre:           t.financiador_nombre,
        saldo_pendiente:  Number(t.saldo_pendiente),
      })),
    }]
  }, [posicionGlobal, fondos, saldosFinanciadores, monedaPG])

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
    <div className="space-y-6 rounded-2xl bg-gradient-to-b from-slate-50/70 via-transparent to-transparent -mx-2 px-2 py-2 sm:-mx-3 sm:px-3">

      {/* ═══════════════════════════════════════════════════════════════════════
          Etapa 2A — Caja RISA y terceros (read-only)
          ═══════════════════════════════════════════════════════════════════════ */}

      {/* ── Encabezado: MP + MT = RISA (FIN2.6 — v_posicion_global_risa) ────── */}
      {!risa ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ⚠ Fondo RISA no encontrado. Verificá que la migración de Etapa 1 se haya aplicado en Supabase y que exista un fondo con código <span className="font-mono">FON-001</span>.
        </div>
      ) : posicionGlobalEffective.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          Sin movimientos para mostrar.
        </div>
      ) : (
        <div className="space-y-3">
          {posicionGlobalEffective.length > 1 && (
            <p className="text-[11px] uppercase tracking-wide text-slate-400">
              Posición global por moneda
            </p>
          )}
          {posicionGlobalEffective.map(pg => (
            <div
              key={pg.moneda}
              className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]"
            >
              {/* Tarjeta 1 — MP */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-slate-500">Medios Propios</p>
                <p className={`mt-2 text-2xl font-semibold tabular-nums ${pg.mp_total < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                  {pg.moneda} {fmt(pg.mp_total)}
                </p>
                <p className="mt-1 text-[11px] text-gray-400">
                  Σ saldo_actual de fondos activos
                </p>
              </div>

              {/* Signo + */}
              <div className="hidden lg:flex items-center justify-center text-3xl font-light text-slate-400 select-none">
                +
              </div>

              {/* Tarjeta 2 — MT */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-slate-500">Medios de Terceros</p>
                <p className={`mt-2 text-2xl font-semibold tabular-nums ${pg.mt_total < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                  {pg.moneda} {fmt(pg.mt_total)}
                </p>
                {pg.mt_detalle.length === 0 ? (
                  <p className="mt-2 text-[11px] text-gray-400">Sin deuda con terceros</p>
                ) : (
                  <ul className="mt-2 space-y-0.5 text-[11px] text-gray-600">
                    {pg.mt_detalle.slice(0, 3).map(t => (
                      <li key={t.financiador_id} className="flex items-center justify-between gap-2">
                        <span className="truncate">
                          {t.codigo ? `${t.codigo} ` : ''}{t.nombre}
                        </span>
                        <span className="tabular-nums whitespace-nowrap">
                          deuda {pg.moneda} {fmt(t.saldo_pendiente)}
                        </span>
                      </li>
                    ))}
                    {pg.mt_detalle.length > 3 && (
                      <li className="text-gray-400">
                        + {pg.mt_detalle.length - 3} tercero{pg.mt_detalle.length - 3 !== 1 ? 's' : ''} más
                      </li>
                    )}
                  </ul>
                )}
              </div>

              {/* Signo = */}
              <div className="hidden lg:flex items-center justify-center text-3xl font-light text-slate-400 select-none">
                =
              </div>

              {/* Tarjeta 3 — RISA (PG) */}
              <div className="rounded-xl border border-slate-300 bg-slate-50 p-5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">RISA</p>
                    <p className="text-[11px] text-gray-400">Posición global</p>
                  </div>
                  {pg.moneda === monedaPG && (
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${FONDO_ESTADO_COLORS[risa.estado]}`}>
                      {FONDO_ESTADO_LABELS[risa.estado]}
                    </span>
                  )}
                </div>
                <p className={`mt-2 text-2xl font-semibold tabular-nums ${pg.pg_total < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                  {pg.moneda} {fmt(pg.pg_total)}
                </p>
                <p className="mt-1 text-[11px] text-gray-400">PG = MP + MT</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Acciones principales (Etapa 2B/2C) ────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Acciones</span>
        {canWrite && (
          <>
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
          </>
        )}
        {/* UX-EXPORT-FONDOS: disponible para todos los roles (lectura/auditoría). */}
        <button
          type="button"
          onClick={handleExportFondos}
          className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
        >
          Exportar Fondos
        </button>
      </div>

      {/* ── Cuenta corriente RISA — collapse por default (UX-DETAILS) ───── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-3 border-l-4 border-[#079783] pl-3">
            <h3 className="text-lg font-bold text-[#0C1F6E]">
              Cuenta corriente RISA{risa?.codigo ? ` — ${risa.codigo}` : ''}
            </h3>
            <span className="text-sm text-slate-500">
              {movimientosRisa.length} movimiento{movimientosRisa.length !== 1 ? 's' : ''}
              {risa && ` · saldo ${risa.moneda} ${fmt(risa.saldo_actual)}`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!risaCollapsed && (
              <input
                type="text"
                value={searchMovimientos}
                onChange={e => setSearchMovimientos(e.target.value)}
                placeholder="Buscar… (APO-###, concepto, tipo)"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none transition focus:border-[#079783] focus:ring-2 focus:ring-[#079783]/20 sm:max-w-xs"
              />
            )}
            <button
              type="button"
              onClick={() => setRisaCollapsed(prev => !prev)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              {risaCollapsed ? '▸ Ver movimientos' : '▾ Ocultar movimientos'}
            </button>
          </div>
        </div>
        {!risaCollapsed && (
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
        )}
      </section>

      {/* ── Deuda pendiente con terceros (v_saldos_financiadores) ──────────── */}
      <section className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="border-l-4 border-[#079783] pl-3 text-lg font-bold text-[#0C1F6E]">
            Cuenta corriente de terceros
          </h3>
          <span className="text-sm text-slate-500">
            {saldosFinanciadores.length} línea{saldosFinanciadores.length !== 1 ? 's' : ''}
          </span>
        </div>
        <DataTable<SaldoFinanciadorRow>
          rows={saldosFinanciadores}
          columns={finPendienteColumns}
          getRowId={s => `${s.financiador_id}-${s.moneda}`}
          initialSort={{ key: 'saldo_pendiente', dir: 'desc' }}
          emptyMessage={
            saldosFinanciadores.length === 0
              ? 'No hay deuda pendiente con terceros.'
              : 'No hay deuda con terceros que coincida con los filtros.'
          }
          rowActions={(s) => (
            <RowActionMenu items={[
              { label: 'Ver detalle', onClick: () => setTerceroDetalleId(s.financiador_id) },
            ]} />
          )}
        />
      </section>

      {/* ── Aportes de socios — collapse por default (UX-DETAILS-2c) ─────── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="border-l-4 border-[#079783] pl-3 text-lg font-bold text-[#0C1F6E]">
            Aportes de socios
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {!aportesCollapsed && (
              <input
                type="text"
                value={searchAportes}
                onChange={e => setSearchAportes(e.target.value)}
                placeholder="Buscar… (APO-###, socio, tercero, destino)"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none transition focus:border-[#079783] focus:ring-2 focus:ring-[#079783]/20 sm:max-w-xs"
              />
            )}
            <button
              type="button"
              onClick={() => setAportesCollapsed(prev => !prev)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              {aportesCollapsed ? '▸ Ver aportes' : '▾ Ocultar aportes'}
            </button>
          </div>
        </div>

        {/* UX-DETAILS-2: resumen acumulado de aportes (activos por moneda + counts).
            Los anulados NO suman al total activo. Siempre visible. */}
        {aportes.length > 0 && (
          <div className="mb-4 rounded-xl border border-[#079783]/20 bg-gradient-to-r from-[#079783]/5 to-transparent px-4 py-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#079783]">Total aportado activo</p>
                {aportesSummary.totalesActivos.size === 0 ? (
                  <p className="mt-0.5 text-slate-400">Sin aportes activos</p>
                ) : (
                  <ul className="mt-0.5 space-y-0.5">
                    {Array.from(aportesSummary.totalesActivos.entries()).map(([moneda, total]) => (
                      <li key={moneda} className="text-base font-bold tabular-nums text-[#0C1F6E]">
                        {moneda} {fmt(total)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="text-xs text-slate-600">
                <span className="font-semibold text-emerald-700">Activos: {aportesSummary.activos}</span>
                <span className="mx-2 text-slate-300">·</span>
                <span className={aportesSummary.anulados > 0 ? 'font-semibold text-red-700' : 'text-slate-500'}>
                  Anulados: {aportesSummary.anulados}
                </span>
              </div>
            </div>
          </div>
        )}

        {!aportesCollapsed && (
          <DataTable<AporteFondoRow>
            rows={aportes}
            columns={aportesColumns}
            getRowId={a => a.id}
            searchTerm={searchAportes}
            searchKeys={['codigo', 'socio', 'destino', 'observaciones', 'moneda']}
            initialSort={{ key: 'codigo', dir: 'desc' }}
            rowClassName={a => a.deleted_at ? 'opacity-60' : ''}
            emptyMessage={
              aportes.length === 0
                ? 'No hay aportes registrados.'
                : 'No hay aportes que coincidan con los filtros.'
            }
            rowActions={(a) => {
              // UX-DETAILS: "Ver detalle" disponible para todos los roles (read-only).
              // "Anular" solo si canWrite y aporte no anulado.
              const items: RowActionItem[] = [
                { label: 'Ver detalle', onClick: () => setAporteDetalleId(a.id) },
              ]
              if (canWrite && !a.deleted_at) {
                items.push({
                  label: 'Anular',
                  variant: 'danger',
                  onClick: () => handleAnularAporte(a.id, a.codigo),
                })
              }
              return <RowActionMenu items={items} />
            }}
          />
        )}
      </section>

      {/* ── Socios ──────────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="border-l-4 border-[#079783] pl-3 text-lg font-bold text-[#0C1F6E]">
            Socios
          </h3>
          <span className="text-sm text-slate-500">
            {socios.length} {socios.length === 1 ? 'socio' : 'socios'}
          </span>
        </div>
        <DataTable<Socio>
          rows={socios}
          columns={sociosColumns}
          getRowId={s => s.id}
          initialSort={{ key: 'codigo', dir: 'asc' }}
          emptyMessage={
            socios.length === 0
              ? 'No hay socios registrados.'
              : 'No hay socios que coincidan con los filtros.'
          }
        />
      </section>

      {/* ── Financiadores ───────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="border-l-4 border-[#079783] pl-3 text-lg font-bold text-[#0C1F6E]">
            Terceros
          </h3>
          <input
            type="text"
            value={searchFinanciadores}
            onChange={e => setSearchFinanciadores(e.target.value)}
            placeholder="Buscar… (FIN-###, nombre, CUIT, email)"
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none transition focus:border-[#079783] focus:ring-2 focus:ring-[#079783]/20 sm:max-w-xs"
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
      </section>

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

      {/* ── FONDOS-TERCEROS-DETALLE-1: Modal Cuenta Corriente Tercero ───── */}
      {terceroDetalleId && (() => {
        const tercero = financiadores.find(f => f.id === terceroDetalleId)
        if (!tercero) return null
        const saldosDelTercero = saldosFinanciadores.filter(s => s.financiador_id === terceroDetalleId)
        const movs = (movimientosFinanciacion as MovimientoFinanciacionRow[])
          .filter(m => m.financiador_id === terceroDetalleId)
        const aporteIdToDeleted = new Map<string, boolean>()
        for (const a of aportes) aporteIdToDeleted.set(a.id, !!a.deleted_at)
        return (
          <TerceroDetalleModal
            tercero={tercero}
            saldos={saldosDelTercero}
            movimientos={movs}
            aporteIdToDeleted={aporteIdToDeleted}
            onClose={() => setTerceroDetalleId(null)}
          />
        )
      })()}

      {/* ── UX-DETAILS-2: Modal Detalle Aporte (con movs asociados) ─────────── */}
      {aporteDetalleId && (() => {
        const aporte = aportes.find(a => a.id === aporteDetalleId)
        if (!aporte) return null
        const list = imputacionesPorAporte.get(aporte.id) ?? []
        const esMixto = list.length >= 2

        // UX-DETAILS-2: enriquecer cada imputación con su movimiento asociado.
        // El link es directo via movimiento_fondo_id / movimiento_financiacion_id
        // que la RPC registrar_aporte_socio_v2 setea al crear cada imputación.
        const imputacionesConMov = list.map(i => {
          const movFondo = i.movimiento_fondo_id
            ? movimientos.find(m => m.id === i.movimiento_fondo_id) ?? null
            : null
          const movFin = i.movimiento_financiacion_id
            ? movimientosFinanciacion.find(m => m.id === i.movimiento_financiacion_id) ?? null
            : null
          return { imp: i, movFondo, movFin }
        })

        // UX-DETAILS-2: si el aporte está anulado, buscar movs de reversa por
        // coincidencia de concepto/descripcion con el codigo del aporte.
        // fn_anular_aporte_socio escribe:
        //   - mov_fondo.concepto    = 'Reversa aporte {codigo} — MP'
        //   - mov_financiacion.descripcion = 'Reversa aporte {codigo}'
        const reversasMovFondo = aporte.deleted_at && aporte.codigo
          ? movimientos.filter(m => (m.concepto ?? '').startsWith(`Reversa aporte ${aporte.codigo}`))
          : []
        const reversasMovFin = aporte.deleted_at && aporte.codigo
          ? movimientosFinanciacion.filter(m => (m.descripcion ?? '').startsWith(`Reversa aporte ${aporte.codigo}`))
          : []

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Detalle del aporte</p>
                  <h2 className="text-lg font-semibold text-gray-900">
                    <span className="font-mono text-slate-600">{aporte.codigo ?? '—'}</span>
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setAporteDetalleId(null)}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  Cerrar
                </button>
              </div>

              {/* Cabecera */}
              <dl className="mb-4 grid grid-cols-1 gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="inline text-gray-500">Fecha: </dt>
                  <dd className="inline text-gray-900">{aporte.fecha_aporte}</dd>
                </div>
                <div>
                  <dt className="inline text-gray-500">Socio: </dt>
                  <dd className="inline text-gray-900">{aporte.socios?.nombre ?? aporte.aportante ?? '—'}</dd>
                </div>
                <div>
                  <dt className="inline text-gray-500">Importe total: </dt>
                  <dd className="inline font-semibold tabular-nums text-gray-900">{aporte.moneda} {fmt(aporte.monto)}</dd>
                </div>
                <div>
                  <dt className="inline text-gray-500">Estado: </dt>
                  <dd className="inline">
                    {aporte.deleted_at
                      ? <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-red-50 text-red-700 ring-1 ring-red-200">Anulado</span>
                      : <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">Activo</span>
                    }
                  </dd>
                </div>
              </dl>

              {/* Imputaciones con mov asociado */}
              <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                Imputaciones {esMixto ? `(${list.length})` : ''}
              </p>
              {imputacionesConMov.length === 0 ? (
                <p className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-gray-500">
                  Aporte sin imputaciones registradas (legacy pre-FIN2). Destino cabecera: <span className="font-medium">{destinoLabel(aporte.destino_aporte)}</span>.
                </p>
              ) : (
                <ul className="space-y-2">
                  {imputacionesConMov.map(({ imp: i, movFondo, movFin }) => {
                    const nombreDestino = i.destino_tipo === 'medios_propios'
                      ? `Medios Propios${i.fondos?.nombre ? ` · ${i.fondos.nombre}` : ''}`
                      : `Tercero${i.financiadores ? ` · ${i.financiadores.codigo ? i.financiadores.codigo + ' ' : ''}${i.financiadores.nombre}` : ''}`
                    return (
                      <li key={i.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-medium text-gray-800">{nombreDestino}</span>
                          <span className="tabular-nums text-gray-700">{i.moneda} {fmt(i.monto)}</span>
                        </div>
                        {movFondo && (
                          <div className="mt-1 text-xs text-gray-500">
                            <span className="uppercase tracking-wide">Mov. fondo:</span>{' '}
                            <span className="text-gray-700">{movFondo.fecha} · {movFondo.tipo} · {movFondo.concepto}</span>
                          </div>
                        )}
                        {movFin && (
                          <div className="mt-1 text-xs text-gray-500">
                            <span className="uppercase tracking-wide">Mov. financiación:</span>{' '}
                            <span className="text-gray-700">{movFin.fecha} · {movFin.tipo_movimiento}{movFin.descripcion ? ` · ${movFin.descripcion}` : ''}</span>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}

              {/* Movimientos de reversa (si anulado) */}
              {aporte.deleted_at && (reversasMovFondo.length + reversasMovFin.length) > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-xs uppercase tracking-wide text-red-700">
                    Movimientos de reversa ({reversasMovFondo.length + reversasMovFin.length})
                  </p>
                  <ul className="space-y-1">
                    {reversasMovFondo.map(m => (
                      <li key={m.id} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
                        <span className="uppercase tracking-wide text-red-700">Mov. fondo:</span>{' '}
                        {m.fecha} · {m.tipo} · {m.concepto}{' '}
                        <span className="float-right tabular-nums">{fmt(m.monto)}</span>
                      </li>
                    ))}
                    {reversasMovFin.map(m => (
                      <li key={m.id} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
                        <span className="uppercase tracking-wide text-red-700">Mov. financiación:</span>{' '}
                        {m.fecha} · {m.tipo_movimiento}{m.descripcion ? ` · ${m.descripcion}` : ''}{' '}
                        <span className="float-right tabular-nums">{m.moneda} {fmt(m.importe)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {aporte.observaciones && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-sm">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Observaciones</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-gray-700">{aporte.observaciones}</p>
                </div>
              )}

              {aporte.deleted_at && aporte.motivo_anulacion && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                  <p className="text-xs uppercase tracking-wide text-red-700">Motivo de anulación</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-red-800">{aporte.motivo_anulacion}</p>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ─── FONDOS-TERCEROS-DETALLE-1: Modal Cuenta Corriente de Tercero ──────────
// Operativo con búsqueda + sort client-side + export Excel.
// No toca lógica financiera ni cálculos; solo presenta data ya cargada.

const TIPO_MOV_FIN_LABELS: Record<string, string> = {
  deuda_generada:        'Deuda generada',
  cancelacion_por_aporte:'Cancelación con aporte',
  ajuste:                'Ajuste',
  reversa:               'Reversa',
}

const TIPO_MOV_FIN_COLORS: Record<string, string> = {
  deuda_generada:        'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  cancelacion_por_aporte:'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  ajuste:                'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  reversa:               'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
}

const PAGO_ESTADO_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  pagado:   'Pagado',
  anulado:  'Anulado',
}

const PAGO_ESTADO_COLORS: Record<string, string> = {
  borrador: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  pagado:   'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  anulado:  'bg-red-50 text-red-700 ring-1 ring-red-200',
}

type TerceroSortKey = 'fecha' | 'estado' | 'cod_pago' | 'cod_gasto' | 'proveedor' | 'importe'

interface TerceroDetalleModalProps {
  tercero: Financiador
  saldos: SaldoFinanciadorRow[]
  movimientos: MovimientoFinanciacionRow[]
  aporteIdToDeleted: Map<string, boolean>
  onClose: () => void
}

interface MovRowDerivado {
  m: MovimientoFinanciacionRow
  tipoLabel: string
  tipoKey: string
  estadoLabel: string
  estadoColor: string
  codPago: string
  fechaPago: string
  codGasto: string
  proveedor: string
  proveedorCodigo: string
  tipoGasto: string
  descripcionVisible: string
}

function deriveEstadoTercero(
  m: MovimientoFinanciacionRow,
  aporteIdToDeleted: Map<string, boolean>,
): { label: string; color: string } {
  if (m.tipo_movimiento === 'reversa') {
    return { label: 'Reversado', color: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200' }
  }
  if (m.tipo_movimiento === 'cancelacion_por_aporte') {
    if (m.aporte_id && aporteIdToDeleted.get(m.aporte_id) === true) {
      return { label: 'Cancelación reversada', color: 'bg-red-50 text-red-700 ring-1 ring-red-200' }
    }
    return { label: 'Cancelado con aporte', color: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' }
  }
  if (m.tipo_movimiento === 'deuda_generada') {
    const e = m.pagos?.estado ?? null
    if (e && PAGO_ESTADO_LABELS[e]) {
      return { label: PAGO_ESTADO_LABELS[e], color: PAGO_ESTADO_COLORS[e] ?? 'bg-slate-100 text-slate-600' }
    }
    return { label: 'Generada', color: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' }
  }
  if (m.tipo_movimiento === 'ajuste') {
    return { label: 'Ajuste', color: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' }
  }
  return { label: '—', color: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200' }
}

function slugTercero(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

function TerceroDetalleModal({
  tercero,
  saldos,
  movimientos,
  aporteIdToDeleted,
  onClose,
}: TerceroDetalleModalProps) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<TerceroSortKey>('fecha')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(k: TerceroSortKey) {
    if (sortKey === k) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(k)
      setSortDir(k === 'fecha' || k === 'importe' ? 'desc' : 'asc')
    }
  }

  // Derivación de filas (campos visibles + claves para sort/search)
  const derivados = useMemo<MovRowDerivado[]>(() => {
    return movimientos.map(m => {
      const est = deriveEstadoTercero(m, aporteIdToDeleted)
      return {
        m,
        tipoLabel: TIPO_MOV_FIN_LABELS[m.tipo_movimiento] ?? m.tipo_movimiento,
        tipoKey: m.tipo_movimiento,
        estadoLabel: est.label,
        estadoColor: est.color,
        codPago: m.pagos?.codigo ?? '',
        fechaPago: m.pagos?.fecha_pago ?? '',
        codGasto: m.gastos?.codigo ?? '',
        proveedor: m.gastos?.proveedores?.nombre ?? '',
        proveedorCodigo: m.gastos?.proveedores?.codigo ?? '',
        tipoGasto: m.gastos?.tipos_gasto?.nombre ?? '',
        descripcionVisible: m.descripcion ?? m.gastos?.descripcion ?? '',
      }
    })
  }, [movimientos, aporteIdToDeleted])

  // Búsqueda case-insensitive sobre los campos pedidos
  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('es')
    if (!q) return derivados
    return derivados.filter(r =>
      r.codPago.toLocaleLowerCase('es').includes(q) ||
      r.codGasto.toLocaleLowerCase('es').includes(q) ||
      r.proveedor.toLocaleLowerCase('es').includes(q) ||
      r.descripcionVisible.toLocaleLowerCase('es').includes(q) ||
      r.tipoLabel.toLocaleLowerCase('es').includes(q) ||
      r.estadoLabel.toLocaleLowerCase('es').includes(q) ||
      String(r.m.importe).includes(q)
    )
  }, [derivados, search])

  // Sort client-side
  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'fecha':     cmp = (a.m.fecha + a.m.created_at).localeCompare(b.m.fecha + b.m.created_at); break
        case 'estado':    cmp = a.estadoLabel.localeCompare(b.estadoLabel, 'es'); break
        case 'cod_pago':  cmp = a.codPago.localeCompare(b.codPago, 'es'); break
        case 'cod_gasto': cmp = a.codGasto.localeCompare(b.codGasto, 'es'); break
        case 'proveedor': cmp = a.proveedor.localeCompare(b.proveedor, 'es'); break
        case 'importe':   cmp = a.m.importe - b.m.importe; break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [filtered, sortKey, sortDir])

  function handleExport() {
    const rows = sorted.map(r => ({
      'Fecha':       r.m.fecha,
      'Tipo':        r.tipoLabel,
      'Estado':      r.estadoLabel,
      'Cód. pago':   r.codPago || '—',
      'Fecha pago':  r.fechaPago || '—',
      'Cód. gasto':  r.codGasto || '—',
      'Proveedor':   r.proveedor || '—',
      'Tipo gasto':  r.tipoGasto || '—',
      'Descripción': r.descripcionVisible || '—',
      'Importe':     Number(r.m.importe),
      'Moneda':      r.m.moneda,
    }))
    const cod = tercero.codigo ?? tercero.id.slice(0, 8)
    const nom = slugTercero(tercero.nombre)
    exportToExcel(rows, `cuenta_corriente_tercero_${cod}_${nom}_${todayForFile()}.xlsx`, 'Cuenta corriente')
  }

  // Moneda principal del header: la del primer saldo (si existe).
  const monedaHeader = saldos[0]?.moneda ?? ''

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 py-6 sm:py-10" onClick={onClose}>
      <div
        className="flex w-[96vw] max-w-7xl flex-col rounded-2xl bg-white shadow-xl max-h-[88vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#079783]">
              Cuenta corriente de tercero
            </p>
            <h2 className="mt-0.5 text-lg font-bold text-[#0C1F6E] sm:text-xl">
              {tercero.codigo ? <span className="font-mono text-slate-500">{tercero.codigo} · </span> : null}
              {tercero.nombre}
              {monedaHeader && (
                <span className="ml-2 inline-flex rounded-full bg-[#079783]/10 px-2 py-0.5 text-xs font-semibold text-[#079783]">
                  {monedaHeader}
                </span>
              )}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-[#0C1F6E] transition-colors"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Resumen + toolbar */}
        <div className="space-y-3 border-b border-slate-200 bg-slate-50/40 px-5 py-4 sm:px-6">
          {saldos.length > 0 && (
            <div className="rounded-xl border border-[#079783]/20 bg-gradient-to-r from-[#079783]/5 to-transparent px-4 py-3 text-sm">
              <div className="space-y-1">
                {saldos.map(s => (
                  <div key={s.moneda} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[#079783]">{s.moneda}</span>
                    <span className="tabular-nums">
                      <span className="text-slate-500">Generada:</span>{' '}
                      <span className="font-medium text-slate-800">{fmt(s.total_deuda_generada)}</span>
                      <span className="mx-2 text-slate-300">·</span>
                      <span className="text-slate-500">Cancelada:</span>{' '}
                      <span className="font-medium text-emerald-700">{fmt(s.total_cancelado)}</span>
                      <span className="mx-2 text-slate-300">·</span>
                      <span className="text-slate-500">Saldo pendiente:</span>{' '}
                      <span className={`font-bold ${s.saldo_pendiente > 0 ? 'text-amber-800' : 'text-slate-700'}`}>
                        {fmt(s.saldo_pendiente)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-slate-400">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                </svg>
              </span>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar… (cód. pago, gasto, proveedor, descripción, tipo, estado, importe)"
                className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-sm outline-none transition focus:border-[#079783] focus:ring-2 focus:ring-[#079783]/20"
              />
            </div>
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#079783] px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-[#06806f] transition-colors"
              title="Exportar a Excel"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v8.586l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V4a1 1 0 011-1z" clipRule="evenodd" />
                <path d="M3 15a1 1 0 011 1v1h12v-1a1 1 0 112 0v2a1 1 0 01-1 1H3a1 1 0 01-1-1v-2a1 1 0 011-1z" />
              </svg>
              <span>Exportar Excel</span>
            </button>
          </div>
        </div>

        {/* Tabla */}
        <div className="flex-1 overflow-auto px-5 py-4 sm:px-6">
          {sorted.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
              {movimientos.length === 0
                ? 'Sin movimientos registrados para este tercero.'
                : 'No hay movimientos que coincidan con la búsqueda.'}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-[960px] w-full text-xs">
                <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
                  <tr>
                    <SortTh label="Fecha"       active={sortKey==='fecha'}     dir={sortDir} onClick={() => toggleSort('fecha')} />
                    <Th    label="Tipo" />
                    <SortTh label="Estado"      active={sortKey==='estado'}    dir={sortDir} onClick={() => toggleSort('estado')} />
                    <SortTh label="Cód. pago"   active={sortKey==='cod_pago'}  dir={sortDir} onClick={() => toggleSort('cod_pago')} />
                    <Th    label="Fecha pago" />
                    <SortTh label="Cód. gasto"  active={sortKey==='cod_gasto'} dir={sortDir} onClick={() => toggleSort('cod_gasto')} />
                    <SortTh label="Proveedor"   active={sortKey==='proveedor'} dir={sortDir} onClick={() => toggleSort('proveedor')} />
                    <Th    label="Tipo gasto" />
                    <Th    label="Descripción" />
                    <SortTh label="Importe"     active={sortKey==='importe'}   dir={sortDir} onClick={() => toggleSort('importe')} align="right" />
                    <Th    label="Moneda" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {sorted.map((r, i) => (
                    <tr key={r.m.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}>
                      <td className="px-2.5 py-1.5 whitespace-nowrap text-slate-600">{r.m.fecha}</td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${TIPO_MOV_FIN_COLORS[r.tipoKey] ?? 'bg-slate-100 text-slate-600'}`}>
                          {r.tipoLabel}
                        </span>
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${r.estadoColor}`}>
                          {r.estadoLabel}
                        </span>
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap font-mono text-[11px] text-slate-600">
                        {r.codPago || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap text-slate-600">
                        {r.fechaPago || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap font-mono text-[11px] text-slate-600">
                        {r.codGasto || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2.5 py-1.5 text-slate-700">
                        {r.proveedor
                          ? <span title={r.proveedorCodigo ? `${r.proveedorCodigo} · ${r.proveedor}` : r.proveedor}>{r.proveedor}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap text-slate-600">
                        {r.tipoGasto || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2.5 py-1.5 max-w-xs truncate text-slate-700" title={r.descripcionVisible || undefined}>
                        {r.descripcionVisible || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums font-medium text-slate-800">
                        {fmt(r.m.importe)}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap text-slate-500">{r.m.moneda}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-xs text-slate-500 sm:px-6">
          <span>
            {sorted.length} de {movimientos.length} movimiento{movimientos.length !== 1 ? 's' : ''}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}

function Th({ label, align = 'left' }: { label: string; align?: 'left' | 'right' }) {
  return (
    <th className={`px-2.5 py-2 text-${align} text-[10px] font-semibold uppercase tracking-wide`}>
      {label}
    </th>
  )
}

function SortTh({
  label, active, dir, onClick, align = 'left',
}: {
  label: string
  active: boolean
  dir: 'asc' | 'desc'
  onClick: () => void
  align?: 'left' | 'right'
}) {
  const justify = align === 'right' ? 'justify-end' : 'justify-start'
  const color = active ? 'text-[#079783]' : 'text-slate-400'
  return (
    <th className={`px-2.5 py-2 text-${align} text-[10px] font-semibold uppercase tracking-wide`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 ${justify} w-full hover:text-[#0C1F6E] transition-colors`}
      >
        <span>{label}</span>
        {active && dir === 'asc' ? (
          <svg className={`h-3.5 w-3.5 ${color}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M10 5a1 1 0 01.78.375l4 5A1 1 0 0114 12H6a1 1 0 01-.78-1.625l4-5A1 1 0 0110 5z" clipRule="evenodd" />
          </svg>
        ) : active && dir === 'desc' ? (
          <svg className={`h-3.5 w-3.5 ${color}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M10 15a1 1 0 01-.78-.375l-4-5A1 1 0 016 8h8a1 1 0 01.78 1.625l-4 5A1 1 0 0110 15z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg className={`h-3.5 w-3.5 ${color}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M10 3a.75.75 0 01.53.22l3 3a.75.75 0 11-1.06 1.06L10 4.81 7.53 7.28A.75.75 0 116.47 6.22l3-3A.75.75 0 0110 3zM6.47 12.72a.75.75 0 011.06 0L10 15.19l2.47-2.47a.75.75 0 111.06 1.06l-3 3a.75.75 0 01-1.06 0l-3-3a.75.75 0 010-1.06z" />
          </svg>
        )}
      </button>
    </th>
  )
}
