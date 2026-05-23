import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FondosClient, { type AporteFondoRow, type MovimientoFondoRow } from './FondosClient'
import type { Fondo, Socio, Financiador, SaldoFinanciadorRow, UserRole } from '@/types'
import { createFondo, updateFondo, deleteFondo, registrarAporte, getFondoDependencies } from './actions'

export default async function FondosPage() {
  const supabase = createClient()

  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) redirect('/login')

  const [
    profileResult,
    fondosResult,
    aportesResult,
    sociosResult,
    financiadoresResult,
    saldosFinResult,
    movimientosResult,
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single(),

    // Etapa 1: incluye codigo, deleted_by, motivo_baja
    supabase
      .from('fondos')
      .select('id, codigo, nombre, descripcion, monto_inicial, saldo_actual, moneda, estado, responsable_id, created_by, created_at, updated_at, deleted_at, deleted_by, motivo_baja')
      .is('deleted_at', null)
      .order('nombre'),

    // Etapa 1: incluye codigo, socio_id, destino_aporte, financiador_id + joins a socios/financiadores
    supabase
      .from('aportes_fondo')
      .select('id, codigo, fondo_id, movimiento_id, fecha_aporte, monto, moneda, tipo_aporte, aportante, socio_id, destino_aporte, financiador_id, concepto, comprobante_url, observaciones, created_by, created_at, updated_at, deleted_at, fondos(nombre), socios(nombre), financiadores(nombre, codigo)')
      .is('deleted_at', null)
      .order('fecha_aporte', { ascending: false }),

    // Etapa 1: tabla socios
    supabase
      .from('socios')
      .select('id, nombre, cuit, email, telefono, observaciones, deleted_at, created_by, created_at, updated_at')
      .is('deleted_at', null)
      .order('nombre'),

    // Etapa 1: tabla financiadores
    supabase
      .from('financiadores')
      .select('id, codigo, nombre, cuit, email, telefono, observaciones, deleted_at, created_by, created_at, updated_at')
      .is('deleted_at', null)
      .order('nombre'),

    // Etapa 1: view v_saldos_financiadores (sin filtro de deleted — la UI decide)
    supabase
      .from('v_saldos_financiadores')
      .select('financiador_id, financiador_codigo, financiador_nombre, financiador_deleted_at, moneda, total_deuda_generada, total_cancelado, total_ajustes, total_reversas, saldo_pendiente'),

    // movimientos_fondo (todos; el cliente filtra por RISA)
    supabase
      .from('movimientos_fondo')
      .select('id, fondo_id, pago_id, tipo, monto, saldo_anterior, saldo_resultante, concepto, fecha, created_by, created_at')
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false }),
  ])

  const role: UserRole = (profileResult.data?.role as UserRole) ?? 'visualizador'
  const fondos: Fondo[] = (fondosResult.data ?? []) as Fondo[]
  const aportes = (aportesResult.data ?? []) as unknown as AporteFondoRow[]
  const socios = (sociosResult.data ?? []) as Socio[]
  const financiadores = (financiadoresResult.data ?? []) as Financiador[]
  const saldosFinanciadores = (saldosFinResult.data ?? []) as SaldoFinanciadorRow[]
  const movimientos = (movimientosResult.data ?? []) as MovimientoFondoRow[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Caja RISA y financiación</h1>
        <p className="mt-1 text-sm text-gray-500">
          Cuenta corriente de RISA, aportes de socios y financiación pendiente.
        </p>
      </div>

      <FondosClient
        fondos={fondos}
        aportes={aportes}
        socios={socios}
        financiadores={financiadores}
        saldosFinanciadores={saldosFinanciadores}
        movimientos={movimientos}
        role={role}
        onCreateFondo={createFondo}
        onUpdateFondo={updateFondo}
        onDeleteFondo={deleteFondo}
        onGetFondoDependencies={getFondoDependencies}
        onRegistrarAporte={registrarAporte}
      />
    </div>
  )
}
