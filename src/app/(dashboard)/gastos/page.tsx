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
      .select('id, fondo_id, proveedor_id, descripcion, monto, moneda, estado, fecha_gasto, notas, tiene_anticipo, monto_anticipo, porcentaje_anticipo, fecha_prevista_pago_anticipo, fecha_comprometida_pago_saldo, condiciones_pago_notas, fecha_vencimiento, prioridad_pago, comprobante_path, comprobante_nombre, comprobante_mime, comprobante_size_bytes, comprobante_uploaded_by, comprobante_subido_en, recurrente_id, periodo, created_by, created_at, fondos(nombre, moneda), proveedores(nombre)')
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
      .select('id, nombre')
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

  const role: UserRole = (profileResult.data?.role as UserRole) ?? 'visualizador'
  const gastos: GastoRow[] = (gastosResult.data ?? []) as unknown as GastoRow[]
  const fondos = (fondosResult.data ?? []) as Pick<Fondo, 'id' | 'nombre' | 'moneda'>[]
  const proveedores = (proveedoresResult.data ?? []) as Pick<Proveedor, 'id' | 'nombre'>[]
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
