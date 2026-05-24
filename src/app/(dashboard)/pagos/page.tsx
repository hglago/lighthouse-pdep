import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PagosClient, { type PagoRow, type GastoInfo } from './PagosClient'
import type { UserRole, ObligacionPendiente } from '@/types'
import { updatePago, confirmarPago, anularPago, confirmarPagosBulk, createPagoYConfirmar } from './actions'

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
    gastosInfoResult,
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single(),
    supabase
      .from('pagos')
      .select(
        'id, codigo, nro_pago, fondo_id, proveedor_id, gasto_id, anticipo_id, gasto_recurrente_id, tipo, concepto, monto, moneda, fecha_pago, comprobante_url, estado, notas, created_by, anulado_por, anulado_en, created_at, fondos(nombre, moneda), proveedores(nombre), gastos(descripcion, codigo, monto, forma_cancelacion, financiador_id, financiadores:financiador_id(codigo, nombre)), anticipos(concepto)'
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
    // P4c.2: info de gastos vinculados a obligaciones — necesario en el modal
    // para mostrar canal de pago (RISA/Tercero) en el resumen readonly.
    supabase
      .from('gastos')
      .select('id, codigo, monto, descripcion, forma_cancelacion, financiador_id, financiadores:financiador_id(codigo, nombre)')
      .is('deleted_at', null)
      .in('estado', ['aprobado', 'pagado_parcial']),
  ])

  // Tolerancia: si pagos.codigo (P######) no existe todavía en DB (migración pendiente),
  // retry sin esa columna e hidratar codigo=null. El listado funciona igual.
  type PagoRaw = Record<string, unknown>
  let pagosData: PagoRaw[] | null = pagosResult.data as PagoRaw[] | null
  if (
    pagosResult.error?.code === '42703' &&
    /codigo/.test(pagosResult.error.message ?? '')
  ) {
    console.warn('[pagos] columna codigo no disponible aún; retry con SELECT base:', pagosResult.error.message)
    const fallback = await supabase
      .from('pagos')
      .select(
        'id, nro_pago, fondo_id, proveedor_id, gasto_id, anticipo_id, gasto_recurrente_id, tipo, concepto, monto, moneda, fecha_pago, comprobante_url, estado, notas, created_by, anulado_por, anulado_en, created_at, fondos(nombre, moneda), proveedores(nombre), gastos(descripcion), anticipos(concepto)'
      )
      .order('fecha_pago', { ascending: false })
    pagosData = ((fallback.data ?? []) as PagoRaw[]).map(p => ({ ...p, codigo: null }))
  }

  // Tolerancia gastosInfo: si forma_cancelacion/financiador_id aún no están en
  // DB (P1 servicio por hora ya está, Etapa 1 también, pero por defensa retry).
  let gastosInfoData = gastosInfoResult.data
  if (
    gastosInfoResult.error?.code === '42703' &&
    /forma_cancelacion|financiador_id|codigo/.test(gastosInfoResult.error.message ?? '')
  ) {
    console.warn('[pagos] columnas gastos extendidas no disponibles; retry base:', gastosInfoResult.error.message)
    const fallback = await supabase
      .from('gastos')
      .select('id, monto, descripcion')
      .is('deleted_at', null)
      .in('estado', ['aprobado', 'pagado_parcial'])
    gastosInfoData = (fallback.data ?? []).map(g => ({
      ...g,
      codigo: null,
      forma_cancelacion: 'risa' as const,
      financiador_id: null,
      financiadores: null,
    })) as unknown as typeof gastosInfoResult.data
  }

  const role: UserRole = (profileResult.data?.role as UserRole) ?? 'visualizador'
  const pagos = (pagosData ?? []) as unknown as PagoRow[]
  const fondos = (fondosResult.data ?? []) as { id: string; nombre: string; moneda: string }[]
  const proveedores = (proveedoresResult.data ?? []) as { id: string; nombre: string }[]
  const obligaciones = (obligacionesResult.data ?? []) as ObligacionPendiente[]
  const gastosInfo = (gastosInfoData ?? []) as unknown as GastoInfo[]

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
        gastosInfo={gastosInfo}
        role={role}
        onCreatePagoYConfirmar={createPagoYConfirmar}
        onUpdatePago={updatePago}
        onConfirmarPago={confirmarPago}
        onAnularPago={anularPago}
        onConfirmarPagosBulk={confirmarPagosBulk}
      />
    </div>
  )
}
