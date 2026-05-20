import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PagosClient, { type PagoRow } from './PagosClient'
import type { UserRole, ObligacionPendiente } from '@/types'
import { createPago, updatePago, confirmarPago, anularPago } from './actions'

export default async function PagosPage() {
  const supabase = createClient()

  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) redirect('/login')

  const [
    profileResult,
    pagosResult,
    fondosResult,
    proveedoresResult,
    obligacionesResult,
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single(),
    supabase
      .from('pagos')
      .select(
        'id, nro_pago, fondo_id, proveedor_id, gasto_id, anticipo_id, gasto_recurrente_id, tipo, concepto, monto, moneda, fecha_pago, comprobante_url, estado, notas, created_by, anulado_por, anulado_en, created_at, fondos(nombre, moneda), proveedores(nombre), gastos(descripcion), anticipos(concepto)'
      )
      .order('fecha_pago', { ascending: false }),
    supabase
      .from('fondos')
      .select('id, nombre, moneda')
      .is('deleted_at', null)
      .eq('estado', 'activo')
      .order('nombre'),
    supabase
      .from('proveedores')
      .select('id, nombre')
      .is('deleted_at', null)
      .eq('activo', true)
      .order('nombre'),
    supabase
      .from('v_obligaciones_pendientes')
      .select('obligacion_id, tipo_obligacion, gasto_id, gasto_recurrente_id, fondo_id, proveedor_id, concepto, monto_pendiente, moneda, fecha_vencimiento, prioridad_pago, fecha_gasto, fondo_nombre, fondo_saldo_actual, proveedor_nombre')
      .order('prioridad_pago', { ascending: true }),
  ])

  console.log('[pagos] obligaciones', {
    count: obligacionesResult.data?.length ?? 0,
    error: obligacionesResult.error?.message,
    sample: obligacionesResult.data?.slice(0, 2),
  })

  const role: UserRole = (profileResult.data?.role as UserRole) ?? 'visualizador'
  const pagos = (pagosResult.data ?? []) as unknown as PagoRow[]
  const fondos = (fondosResult.data ?? []) as { id: string; nombre: string; moneda: string }[]
  const proveedores = (proveedoresResult.data ?? []) as { id: string; nombre: string }[]
  const obligaciones = (obligacionesResult.data ?? []) as ObligacionPendiente[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Pagos</h1>
        <p className="mt-1 text-sm text-gray-500">
          Pagos reales a proveedores con impacto en fondos.
        </p>
      </div>

      <PagosClient
        pagos={pagos}
        fondos={fondos}
        proveedores={proveedores}
        obligaciones={obligaciones}
        role={role}
        onCreatePago={createPago}
        onUpdatePago={updatePago}
        onConfirmarPago={confirmarPago}
        onAnularPago={anularPago}
      />
    </div>
  )
}
