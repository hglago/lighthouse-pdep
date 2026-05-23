import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import GastosClient, { type GastoRow, type GastoRecurrenteRow, type PagoDeGasto } from './GastosClient'
import type { Fondo, Proveedor, UserRole } from '@/types'
import { createGasto, updateGasto, deleteGasto, cambiarEstadoGasto, createGastoRecurrente, updateGastoRecurrente, deleteGastoRecurrente, setComprobanteGasto, removeComprobanteGasto, generarGastosRecurrentes, bulkAprobarGastos, bulkRechazarGastos, bulkDeleteGastos } from './actions'
import { createProveedorQuick } from '../proveedores/actions'

export default async function GastosPage() {
  const supabase = createClient()

  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) redirect('/login')

  // Generar gastos pendientes desde recurrentes activos (idempotente vía UNIQUE)
  // antes de leer la lista — así los recién generados aparecen en la primera carga.
  await generarGastosRecurrentes()

  const [profileResult, gastosResult, fondosResult, proveedoresResult, recurrentesResult, pagosDeGastosResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single(),
    supabase
      .from('gastos')
      .select('id, codigo, fondo_id, proveedor_id, descripcion, monto, moneda, estado, fecha_gasto, notas, tiene_anticipo, monto_anticipo, porcentaje_anticipo, fecha_prevista_pago_anticipo, fecha_comprometida_pago_saldo, condiciones_pago_notas, fecha_vencimiento, prioridad_pago, es_servicio_horas, descripcion_servicio, periodo_servicio_desde, periodo_servicio_hasta, horas_servicio, valor_hora_aplicado, porcentaje_uplift_snapshot, importe_base_servicio, comprobante_path, comprobante_nombre, comprobante_mime, comprobante_size_bytes, comprobante_uploaded_by, comprobante_subido_en, recurrente_id, periodo, created_by, created_at, fondos(nombre, moneda), proveedores(nombre)')
      .is('deleted_at', null)
      .order('fecha_gasto', { ascending: false }),
    supabase
      .from('fondos')
      .select('id, nombre, moneda')
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
      .select('id, fondo_id, proveedor_id, concepto, categoria, monto, moneda, dia_vencimiento, fecha_inicio, fecha_fin, activo, prioridad_pago, observaciones, created_by, created_at, fondos(nombre, moneda), proveedores(nombre)')
      .is('deleted_at', null)
      .order('concepto', { ascending: true }),
    supabase
      .from('pagos')
      .select('id, gasto_id, nro_pago, tipo, estado, monto, moneda, fecha_pago')
      .not('gasto_id', 'is', null)
      .order('fecha_pago', { ascending: true }),
  ])

  // Tolerancia: si alguna columna nueva no se aplicó todavía, retry sin ellas
  // e hidratar defaults. El listado funciona siempre.
  // Cubre: codigo (commit 9872748) y campos snapshot servicio P1 (2026-05-23).
  let gastosData = gastosResult.data
  if (
    gastosResult.error?.code === '42703' &&
    /codigo|es_servicio_horas|descripcion_servicio|periodo_servicio|horas_servicio|valor_hora_aplicado|porcentaje_uplift_snapshot|importe_base_servicio/.test(gastosResult.error.message ?? '')
  ) {
    console.warn('[gastos] columna nueva no disponible aún; retry con SELECT base:', gastosResult.error.message)
    const fallback = await supabase
      .from('gastos')
      .select('id, fondo_id, proveedor_id, descripcion, monto, moneda, estado, fecha_gasto, notas, tiene_anticipo, monto_anticipo, porcentaje_anticipo, fecha_prevista_pago_anticipo, fecha_comprometida_pago_saldo, condiciones_pago_notas, fecha_vencimiento, prioridad_pago, comprobante_path, comprobante_nombre, comprobante_mime, comprobante_size_bytes, comprobante_uploaded_by, comprobante_subido_en, recurrente_id, periodo, created_by, created_at, fondos(nombre, moneda), proveedores(nombre)')
      .is('deleted_at', null)
      .order('fecha_gasto', { ascending: false })
    gastosData = (fallback.data ?? []).map(g => ({
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
    })) as unknown as typeof gastosResult.data
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

  const role: UserRole = (profileResult.data?.role as UserRole) ?? 'visualizador'
  const gastos: GastoRow[] = (gastosData ?? []) as unknown as GastoRow[]
  const fondos = (fondosResult.data ?? []) as Pick<Fondo, 'id' | 'nombre' | 'moneda'>[]
  const proveedores = (proveedoresData ?? []) as unknown as Pick<Proveedor, 'id' | 'nombre' | 'permite_horas_servicio' | 'valor_hora' | 'tiene_uplift' | 'porcentaje_uplift'>[]
  const recurrentes: GastoRecurrenteRow[] = (recurrentesResult.data ?? []) as unknown as GastoRecurrenteRow[]
  const pagosDeGastos: PagoDeGasto[] = (pagosDeGastosResult.data ?? []) as PagoDeGasto[]

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
        onBulkAprobar={bulkAprobarGastos}
        onBulkRechazar={bulkRechazarGastos}
        onBulkDelete={bulkDeleteGastos}
      />
    </div>
  )
}
