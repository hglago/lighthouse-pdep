import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import GastosClient, { type GastoRow, type GastoRecurrenteRow, type PagoDeGasto } from './GastosClient'
import type { Fondo, Proveedor, Financiador, UserRole, TipoGasto } from '@/types'
import { createGasto, updateGasto, deleteGasto, cambiarEstadoGasto, createGastoRecurrente, updateGastoRecurrente, deleteGastoRecurrente, setComprobanteGasto, removeComprobanteGasto, generarGastosRecurrentes, bulkAprobarGastos, bulkRechazarGastos, bulkDeleteGastos, crearTipoGasto } from './actions'
import { createProveedorQuick } from '../proveedores/actions'
import { crearFinanciador } from '../fondos/actions'

export default async function GastosPage() {
  const supabase = createClient()

  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) redirect('/login')

  {
    const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (p?.role === 'socio') redirect('/reportes')
  }

  // Generar gastos pendientes desde recurrentes activos (idempotente vía UNIQUE)
  // antes de leer la lista — así los recién generados aparecen en la primera carga.
  await generarGastosRecurrentes()

  // Fase 2D (2026-05-25): fetch del profile primero para saber si aplica
  // ownership filter por created_by. USER ve solo sus propios gastos.
  const profileResult = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  const isUserRole = (profileResult.data?.role ?? 'visualizador') === 'user'

  // Builder con ownership filter condicional para USER.
  let gastosQuery = supabase
    .from('gastos')
    .select('id, codigo, fondo_id, proveedor_id, tipo_gasto_id, forma_cancelacion, financiador_id, descripcion, monto, moneda, estado, fecha_gasto, notas, tiene_anticipo, monto_anticipo, porcentaje_anticipo, fecha_prevista_pago_anticipo, fecha_comprometida_pago_saldo, condiciones_pago_notas, fecha_vencimiento, fecha_pago_prevista, prioridad_pago, es_servicio_horas, descripcion_servicio, periodo_servicio_desde, periodo_servicio_hasta, horas_servicio, valor_hora_aplicado, porcentaje_uplift_snapshot, importe_base_servicio, periodo_analitico, comprobante_path, comprobante_nombre, comprobante_mime, comprobante_size_bytes, comprobante_uploaded_by, comprobante_subido_en, recurrente_id, periodo, created_by, created_at, fondos(nombre, moneda), proveedores(nombre), financiadores:financiador_id(id, codigo, nombre), tipos_gasto:tipo_gasto_id(id, codigo, nombre)')
    .is('deleted_at', null)
  if (isUserRole) gastosQuery = gastosQuery.eq('created_by', user.id)

  const [gastosResult, fondosResult, proveedoresResult, recurrentesResult, pagosDeGastosResult, financiadoresResult, tiposGastoResult] = await Promise.all([
    gastosQuery.order('fecha_gasto', { ascending: false }),
    supabase
      .from('fondos')
      .select('id, codigo, nombre, moneda')
      .is('deleted_at', null)
      .eq('estado', 'activo')
      .order('nombre', { ascending: true }),
    supabase
      .from('proveedores')
      .select('id, nombre, permite_horas_servicio, valor_hora, tiene_uplift, porcentaje_uplift')
      .is('deleted_at', null)
      .order('nombre', { ascending: true }),
    supabase
      .from('gastos_recurrentes')
      .select('id, fondo_id, proveedor_id, concepto, categoria, tipo_gasto_id, monto, moneda, dia_vencimiento, fecha_inicio, fecha_fin, activo, prioridad_pago, observaciones, created_by, created_at, fondos(nombre, moneda), proveedores(nombre), tipos_gasto:tipo_gasto_id(id, codigo, nombre)')
      .is('deleted_at', null)
      .order('concepto', { ascending: true }),
    supabase
      .from('pagos')
      .select('id, gasto_id, nro_pago, tipo, estado, monto, moneda, fecha_pago')
      .not('gasto_id', 'is', null)
      .order('fecha_pago', { ascending: true }),
    // P3a-fc: financiadores activos para el selector del modal de gasto
    supabase
      .from('financiadores')
      .select('id, codigo, nombre, cuit, email, telefono, observaciones, deleted_at, created_by, created_at, updated_at')
      .is('deleted_at', null)
      .order('nombre'),

    // TIPOS-GASTO: tipos activos para el select del modal. Si tabla no existe
    // aún (migración pendiente), tolerancia → array vacío.
    supabase
      .from('tipos_gasto')
      .select('id, codigo, nombre, descripcion, activo, created_at, updated_at, created_by')
      .eq('activo', true)
      .order('nombre'),
  ])

  // Tolerancia: si alguna columna nueva no se aplicó todavía, retry sin ellas
  // e hidratar defaults. El listado funciona siempre.
  // Cubre: codigo (commit 9872748), snapshot servicio P1 (2026-05-23) y
  // forma_cancelacion/financiador_id (Etapa 1).
  let gastosData = gastosResult.data
  if (
    gastosResult.error?.code === '42703' &&
    /codigo|es_servicio_horas|descripcion_servicio|periodo_servicio|horas_servicio|valor_hora_aplicado|porcentaje_uplift_snapshot|importe_base_servicio|forma_cancelacion|financiador_id|tipo_gasto_id|periodo_analitico|fecha_pago_prevista/.test(gastosResult.error.message ?? '')
  ) {
    console.warn('[gastos] columna nueva no disponible aún; retry con SELECT base:', gastosResult.error.message)
    // Fase 2D: aplicar mismo ownership filter al retry.
    let fallbackQuery = supabase
      .from('gastos')
      .select('id, fondo_id, proveedor_id, descripcion, monto, moneda, estado, fecha_gasto, notas, tiene_anticipo, monto_anticipo, porcentaje_anticipo, fecha_prevista_pago_anticipo, fecha_comprometida_pago_saldo, condiciones_pago_notas, fecha_vencimiento, prioridad_pago, comprobante_path, comprobante_nombre, comprobante_mime, comprobante_size_bytes, comprobante_uploaded_by, comprobante_subido_en, recurrente_id, periodo, created_by, created_at, fondos(nombre, moneda), proveedores(nombre)')
      .is('deleted_at', null)
    if (isUserRole) fallbackQuery = fallbackQuery.eq('created_by', user.id)
    const fallback = await fallbackQuery.order('fecha_gasto', { ascending: false })
    gastosData = (fallback.data ?? []).map(g => {
      // PG-PERIODO: si la columna no se aplicó, derivamos en cliente con
      // la misma fórmula para mantener el contrato del tipo.
      const fechaIso = (g as { fecha_gasto?: string }).fecha_gasto ?? ''
      const periodoFromFecha = fechaIso ? fechaIso.slice(0, 7) : null
      return {
        ...g,
        codigo: null,
        es_servicio_horas: false,
        descripcion_servicio: null,
        periodo_servicio_desde: null,
        periodo_servicio_hasta: null,
        horas_servicio: null,
        valor_hora_aplicado: null,
        porcentaje_uplift_snapshot: 0,
        importe_base_servicio: null,
        periodo_analitico: periodoFromFecha,
        fecha_pago_prevista: (g as { fecha_vencimiento?: string }).fecha_vencimiento ?? fechaIso,
        forma_cancelacion: 'risa' as const,
        financiador_id: null,
        financiadores: null,
        tipo_gasto_id: null,
        tipos_gasto: null,
      }
    }) as unknown as typeof gastosResult.data
  }

  // Tolerancia proveedores: si columnas permite_horas_servicio/valor_hora/uplift no están aplicadas
  // todavía (post-P1), retry con SELECT base e hidrato defaults — el modal de gasto sigue funcionando
  // tratando a todo proveedor como común.
  let proveedoresData = proveedoresResult.data
  if (
    proveedoresResult.error?.code === '42703' &&
    /permite_horas_servicio|valor_hora|tiene_uplift|porcentaje_uplift/.test(proveedoresResult.error.message ?? '')
  ) {
    console.warn('[gastos] columnas proveedor servicio/uplift no disponibles; retry base:', proveedoresResult.error.message)
    const fallback = await supabase
      .from('proveedores')
      .select('id, nombre')
      .is('deleted_at', null)
      .order('nombre', { ascending: true })
    proveedoresData = (fallback.data ?? []).map(p => ({
      ...p,
      permite_horas_servicio: false,
      valor_hora: 0,
      tiene_uplift: false,
      porcentaje_uplift: 0,
    })) as unknown as typeof proveedoresResult.data
  }

  // TIPOS-GASTO: tolerancia D4. Si la tabla aún no se aplicó, log + array vacío.
  if (tiposGastoResult.error) {
    console.warn('[gastos] tipos_gasto no disponible aún; select sin opciones:',
      tiposGastoResult.error.code, tiposGastoResult.error.message)
  }
  // Tolerancia recurrentes: si tipo_gasto_id aún no existe (migración pendiente),
  // retry sin esa columna + join.
  let recurrentesData = recurrentesResult.data
  if (
    recurrentesResult.error?.code === '42703' &&
    /tipo_gasto_id/.test(recurrentesResult.error.message ?? '')
  ) {
    console.warn('[gastos] gastos_recurrentes.tipo_gasto_id no disponible aún; retry sin él.')
    const fb = await supabase
      .from('gastos_recurrentes')
      .select('id, fondo_id, proveedor_id, concepto, categoria, monto, moneda, dia_vencimiento, fecha_inicio, fecha_fin, activo, prioridad_pago, observaciones, created_by, created_at, fondos(nombre, moneda), proveedores(nombre)')
      .is('deleted_at', null)
      .order('concepto', { ascending: true })
    recurrentesData = (fb.data ?? []).map(r => ({ ...r, tipo_gasto_id: null, tipos_gasto: null })) as unknown as typeof recurrentesResult.data
  }

  const role: UserRole = (profileResult.data?.role as UserRole) ?? 'visualizador'
  const gastos: GastoRow[] = (gastosData ?? []) as unknown as GastoRow[]
  const fondos = (fondosResult.data ?? []) as Pick<Fondo, 'id' | 'codigo' | 'nombre' | 'moneda'>[]
  const proveedores = (proveedoresData ?? []) as unknown as Pick<Proveedor, 'id' | 'nombre' | 'permite_horas_servicio' | 'valor_hora' | 'tiene_uplift' | 'porcentaje_uplift'>[]
  const recurrentes: GastoRecurrenteRow[] = (recurrentesData ?? []) as unknown as GastoRecurrenteRow[]
  const pagosDeGastos: PagoDeGasto[] = (pagosDeGastosResult.data ?? []) as PagoDeGasto[]
  const financiadores: Financiador[] = (financiadoresResult.data ?? []) as Financiador[]
  const tiposGasto: TipoGasto[] = (tiposGastoResult.data ?? []) as TipoGasto[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Gastos</h1>
        <p className="mt-1 text-sm text-gray-500">
          Registro y control de gastos por fondo.
        </p>
      </div>

      <GastosClient
        gastos={gastos}
        recurrentes={recurrentes}
        fondos={fondos}
        proveedores={proveedores}
        financiadores={financiadores}
        tiposGasto={tiposGasto}
        pagosDeGastos={pagosDeGastos}
        role={role}
        onCreateGasto={createGasto}
        onUpdateGasto={updateGasto}
        onDeleteGasto={deleteGasto}
        onCambiarEstado={cambiarEstadoGasto}
        onCreateRecurrente={createGastoRecurrente}
        onUpdateRecurrente={updateGastoRecurrente}
        onDeleteRecurrente={deleteGastoRecurrente}
        onSetComprobante={setComprobanteGasto}
        onRemoveComprobante={removeComprobanteGasto}
        onCreateProveedorQuick={createProveedorQuick}
        onCrearFinanciador={crearFinanciador}
        onCrearTipoGasto={crearTipoGasto}
        onBulkAprobar={bulkAprobarGastos}
        onBulkRechazar={bulkRechazarGastos}
        onBulkDelete={bulkDeleteGastos}
      />
    </div>
  )
}
