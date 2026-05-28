import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FondosClient, { type AporteFondoRow, type MovimientoFondoRow } from './FondosClient'
import type { Fondo, Socio, Financiador, SaldoFinanciadorRow, UserRole, PosicionGlobalRisaRow, AporteImputacionDetalleRow, MovimientoFinanciacion } from '@/types'
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

  {
    const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (p?.role === 'socio') redirect('/reportes')
  }

  const [
    profileResult,
    fondosResult,
    aportesResult,
    sociosResult,
    financiadoresResult,
    saldosFinResult,
    movimientosResult,
    posicionGlobalResult,
    imputacionesResult,
    movFinanciacionResult,
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

    // FIN2.6: vista única de Posición Global RISA por moneda. Si la
    // migración no se aplicó (PGRST205 / 42P01), el cliente cae al cálculo
    // local con array vacío + fallback.
    supabase
      .from('v_posicion_global_risa')
      .select('moneda, mp_total, mt_total, pg_total, mp_detalle, mt_detalle')
      .order('moneda'),

    // FIN2.7: detalle de imputaciones por aporte (read-only) con joins a
    // fondos y financiadores para evitar lookups en cliente. Tolerante: si
    // aporte_imputaciones aún no existe (FIN2.2 pendiente), array vacío.
    supabase
      .from('aporte_imputaciones')
      .select('id, aporte_id, destino_tipo, fondo_id, financiador_id, monto, moneda, movimiento_fondo_id, movimiento_financiacion_id, created_at, fondos(nombre), financiadores(codigo, nombre)')
      .order('created_at'),

    // UX-DETAILS (2026-05-25): movimientos_financiacion para el modal
    // "Ver detalle" de cada tercero. Volumen bajo en dev/early-stage, OK
    // traer todos y filtrar por financiador_id en cliente.
    // FONDOS-TERCEROS-DETALLE-1: ampliamos con joins PostgREST a pagos
    // (cod/fecha/estado) y gastos (cod/desc/fecha/estado + proveedor + tipo).
    // Si los joins fallan (FK ausente / PGRST200 / 42P01 / 42703), retry
    // al SELECT base — el modal degrada graciosamente.
    supabase
      .from('movimientos_financiacion')
      .select(`
        id, fecha, financiador_id, tipo_movimiento, importe, moneda,
        gasto_id, pago_id, aporte_id, socio_id, descripcion, created_by, created_at,
        pagos(codigo, fecha_pago, estado),
        gastos(codigo, descripcion, fecha_gasto, estado,
               proveedores(codigo, nombre),
               tipos_gasto(codigo, nombre))
      `)
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

  // FIN2.6: si la view no existe aún (PGRST205 / 42P01 / 42703), pasamos array
  // vacío y el cliente cae a su cálculo local de MP+MT=PG (compat).
  if (posicionGlobalResult.error) {
    console.warn('[fondos] v_posicion_global_risa no disponible; fallback a cálculo cliente.',
      posicionGlobalResult.error.code, posicionGlobalResult.error.message)
  }
  const posicionGlobal = (posicionGlobalResult.data ?? []) as PosicionGlobalRisaRow[]

  // FIN2.7: si aporte_imputaciones aún no existe (FIN2.2 pendiente), pasamos
  // array vacío y el cliente muestra "—" en la columna Detalle.
  if (imputacionesResult.error) {
    console.warn('[fondos] aporte_imputaciones no disponible; detalle vacío.',
      imputacionesResult.error.code, imputacionesResult.error.message)
  }
  const imputaciones = (imputacionesResult.data ?? []) as unknown as AporteImputacionDetalleRow[]

  // UX-DETAILS: movimientos_financiacion para detalle por tercero.
  // FONDOS-TERCEROS-DETALLE-1: si los joins enriquecidos (pagos/gastos/
  // proveedores/tipos_gasto) fallan por FK ausente, retry al SELECT base sin
  // joins. Códigos típicos: PGRST200 (FK missing), 42P01 (tabla), 42703 (col).
  let movFinanciacionData = movFinanciacionResult.data
  if (movFinanciacionResult.error) {
    const c = movFinanciacionResult.error.code ?? ''
    const m = movFinanciacionResult.error.message ?? ''
    const isJoinError = c === 'PGRST200' || c === '42P01' || c === '42703' || /relationship|join|foreign/i.test(m)
    if (isJoinError) {
      console.warn('[fondos] movimientos_financiacion joins no disponibles; retry base sin joins.', c, m)
      const fb = await supabase
        .from('movimientos_financiacion')
        .select('id, fecha, financiador_id, tipo_movimiento, importe, moneda, gasto_id, pago_id, aporte_id, socio_id, descripcion, created_by, created_at')
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false })
      movFinanciacionData = (fb.data ?? []).map(m => ({
        ...m,
        pagos: null,
        gastos: null,
      })) as unknown as typeof movFinanciacionResult.data
    } else {
      console.warn('[fondos] movimientos_financiacion no disponible aún.', c, m)
    }
  }
  const movimientosFinanciacion = (movFinanciacionData ?? []) as unknown as MovimientoFinanciacion[]

  return (
    <div className="space-y-6">
      <div
        className="relative overflow-hidden rounded-2xl border border-slate-200/70 px-5 py-4 shadow-sm sm:px-6 sm:py-5"
        style={{ background: 'linear-gradient(135deg, #07978314, #67B8550C, #0C1F6E08)' }}
      >
        <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#0C1F6E] sm:text-2xl">
              Caja RISA y terceros
            </h1>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">
              Cuenta corriente de RISA, aportes de socios y deuda pendiente con terceros.
            </p>
          </div>
          <span className="self-start rounded-full bg-[#079783] px-3 py-1 text-[11px] font-semibold text-white shadow-sm sm:self-auto sm:text-xs">
            Posición financiera
          </span>
        </div>
      </div>

      <FondosClient
        fondos={fondos}
        aportes={aportes}
        socios={socios}
        financiadores={financiadores}
        saldosFinanciadores={saldosFinanciadores}
        movimientos={movimientos}
        posicionGlobal={posicionGlobal}
        imputaciones={imputaciones}
        movimientosFinanciacion={movimientosFinanciacion}
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
