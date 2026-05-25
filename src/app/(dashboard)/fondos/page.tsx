import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FondosClient, { type AporteFondoRow, type MovimientoFondoRow } from './FondosClient'
import type { Fondo, Socio, Financiador, SaldoFinanciadorRow, UserRole } from '@/types'
import {
  createFondo, updateFondo, deleteFondo, registrarAporte, getFondoDependencies,
  crearSocio, crearFinanciador, registrarAporteSocio, registrarAporteSocioV2,
  anularAporteSocio,
} from './actions'

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
    // FIN2.5: SIN filtro deleted_at — los aportes anulados se muestran con
    // estado visible "Anulado" para mantener trazabilidad. Incluimos
    // anulado_por/anulado_en/motivo_anulacion.
    supabase
      .from('aportes_fondo')
      .select('id, codigo, fondo_id, movimiento_id, fecha_aporte, monto, moneda, tipo_aporte, aportante, socio_id, destino_aporte, financiador_id, concepto, comprobante_url, observaciones, created_by, created_at, updated_at, deleted_at, anulado_por, anulado_en, motivo_anulacion, fondos(nombre), socios(nombre), financiadores(nombre, codigo)')
      .order('fecha_aporte', { ascending: false }),

    // Etapa 2B: SELECT con codigo. Si la migración de socios.codigo no se aplicó,
    // el SELECT falla con 42703; en ese caso retry sin codigo (hidratado a null).
    supabase
      .from('socios')
      .select('id, codigo, nombre, cuit, email, telefono, observaciones, deleted_at, created_by, created_at, updated_at')
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

    // movimientos_fondo (todos; el cliente filtra por RISA).
    // Etapa 2D: incluimos aporte_id para trazabilidad mov → aporte. Tolerante:
    // si la migración no se aplicó, retry sin aporte_id.
    supabase
      .from('movimientos_fondo')
      .select('id, fondo_id, pago_id, aporte_id, tipo, monto, saldo_anterior, saldo_resultante, concepto, fecha, created_by, created_at')
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false }),
  ])

  // Tolerancia: si socios.codigo aún no existe (Etapa 2B SQL pendiente), retry
  // sin codigo. Esto permite que el listado siga funcionando hasta que el
  // usuario aplique la migración.
  let sociosData = sociosResult.data
  if (
    sociosResult.error?.code === '42703' &&
    (sociosResult.error.message ?? '').includes('codigo')
  ) {
    console.warn('[fondos] socios.codigo no disponible aún; retry sin codigo')
    const fb = await supabase
      .from('socios')
      .select('id, nombre, cuit, email, telefono, observaciones, deleted_at, created_by, created_at, updated_at')
      .is('deleted_at', null)
      .order('nombre')
    sociosData = (fb.data ?? []).map(s => ({ ...s, codigo: null }))
  }

  // FIN2.5: si aportes_fondo.anulado_por/anulado_en/motivo_anulacion aún
  // no existen (migración FIN2.5 pendiente), retry sin ellas hidratando null.
  let aportesData = aportesResult.data
  if (
    aportesResult.error?.code === '42703' &&
    /anulado_por|anulado_en|motivo_anulacion/.test(aportesResult.error.message ?? '')
  ) {
    console.warn('[fondos] aportes_fondo columnas FIN2.5 no disponibles; retry base')
    const fb = await supabase
      .from('aportes_fondo')
      .select('id, codigo, fondo_id, movimiento_id, fecha_aporte, monto, moneda, tipo_aporte, aportante, socio_id, destino_aporte, financiador_id, concepto, comprobante_url, observaciones, created_by, created_at, updated_at, deleted_at, fondos(nombre), socios(nombre), financiadores(nombre, codigo)')
      .order('fecha_aporte', { ascending: false })
    aportesData = (fb.data ?? []).map(a => ({
      ...a,
      anulado_por: null,
      anulado_en: null,
      motivo_anulacion: null,
    })) as unknown as typeof aportesResult.data
  }

  // Tolerancia: si movimientos_fondo.aporte_id aún no existe (Etapa 2D SQL
  // pendiente), retry sin aporte_id y hidratar null.
  let movimientosData = movimientosResult.data
  if (
    movimientosResult.error?.code === '42703' &&
    (movimientosResult.error.message ?? '').includes('aporte_id')
  ) {
    console.warn('[fondos] movimientos_fondo.aporte_id no disponible aún; retry sin aporte_id')
    const fb = await supabase
      .from('movimientos_fondo')
      .select('id, fondo_id, pago_id, tipo, monto, saldo_anterior, saldo_resultante, concepto, fecha, created_by, created_at')
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
    movimientosData = (fb.data ?? []).map(m => ({ ...m, aporte_id: null }))
  }

  const role: UserRole = (profileResult.data?.role as UserRole) ?? 'visualizador'
  const fondos: Fondo[] = (fondosResult.data ?? []) as Fondo[]
  const aportes = (aportesData ?? []) as unknown as AporteFondoRow[]
  const socios = (sociosData ?? []) as Socio[]
  const financiadores = (financiadoresResult.data ?? []) as Financiador[]
  const saldosFinanciadores = (saldosFinResult.data ?? []) as SaldoFinanciadorRow[]
  const movimientos = (movimientosData ?? []) as MovimientoFondoRow[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Caja RISA y terceros</h1>
        <p className="mt-1 text-sm text-gray-500">
          Cuenta corriente de RISA, aportes de socios y deuda pendiente con terceros.
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
        onCrearSocio={crearSocio}
        onCrearFinanciador={crearFinanciador}
        onRegistrarAporteSocio={registrarAporteSocio}
        onRegistrarAporteSocioV2={registrarAporteSocioV2}
        onAnularAporteSocio={anularAporteSocio}
      />
    </div>
  )
}
