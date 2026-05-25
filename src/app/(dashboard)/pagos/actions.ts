'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { PagoTipo } from '@/types'

export type PagoPayload = {
  fondo_id: string
  proveedor_id: string
  gasto_id: string | null
  anticipo_id: string | null
  gasto_recurrente_id: string | null
  tipo: PagoTipo
  concepto: string
  monto: number
  moneda: string
  fecha_pago: string
  comprobante_url: string | null
  notas: string | null
}

function cleanDbError(msg: string): string {
  return msg.replace(/^ERROR:\s*/i, '').replace(/\s*CONTEXT:[\s\S]*$/i, '').trim()
}

// PAGOS-UX (2026-05-25): el flujo "borrador" se eliminó del UI. Los pagos se
// crean siempre confirmados vía createPagoYConfirmar. Antes esta función
// detectaba duplicados sobre estado='borrador'; ahora detecta colisiones de
// idéntico (gasto, tipo, monto) en estado='pagado' creados en los últimos
// segundos — defensa contra doble-submit del modal por click rápido.
async function detectarPagoDuplicadoReciente(
  supabase: ReturnType<typeof createClient>,
  data: PagoPayload
): Promise<string | null> {
  if (!data.gasto_id) return null
  // Ventana defensiva corta: dos pagos idénticos del mismo gasto, mismo tipo,
  // mismo monto, creados en menos de 10s son sospechosos. La RPC ya valida
  // saldo en DB, así que un segundo intento legítimo (pago parcial extra del
  // mismo monto) es raro pero permitido fuera de la ventana.
  const cutoff = new Date(Date.now() - 10_000).toISOString()
  const { data: dups } = await supabase
    .from('pagos')
    .select('id, nro_pago')
    .eq('estado', 'pagado')
    .eq('gasto_id', data.gasto_id)
    .eq('tipo', data.tipo)
    .eq('monto', data.monto)
    .gte('created_at', cutoff)
  if (dups && dups.length > 0) {
    return `Ya se registró un pago idéntico hace unos segundos (${dups[0].nro_pago}). Verificá antes de duplicar.`
  }
  return null
}

// Valida que confirmar el pago no exceda el saldo pendiente del gasto vinculado.
// Devuelve null si OK, mensaje de error si excede.
async function validarSaldoPendiente(
  supabase: ReturnType<typeof createClient>,
  pagoId: string
): Promise<string | null> {
  const { data: pago } = await supabase
    .from('pagos')
    .select('gasto_id, monto, estado')
    .eq('id', pagoId)
    .maybeSingle()
  if (!pago || !pago.gasto_id) return null
  if (pago.estado === 'pagado') return null

  const { data: gasto } = await supabase
    .from('gastos')
    .select('monto, descripcion')
    .eq('id', pago.gasto_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!gasto) return null

  const { data: confirmados } = await supabase
    .from('pagos')
    .select('monto')
    .eq('gasto_id', pago.gasto_id)
    .eq('estado', 'pagado')
    .neq('id', pagoId)

  const totalConfirmado = (confirmados ?? []).reduce((s, p) => s + Number(p.monto), 0)
  const saldoPendiente = Number(gasto.monto) - totalConfirmado
  const nuevoPago = Number(pago.monto)
  if (nuevoPago > saldoPendiente + 0.001) {
    return `Excede el saldo pendiente del gasto "${gasto.descripcion}". Saldo: ${saldoPendiente.toFixed(2)}, intento de pago: ${nuevoPago.toFixed(2)}.`
  }
  return null
}

// Crea + confirma el pago en un solo acto. Retorna ActionResult para que el
// cliente muestre el error real sin enmascarado de Next.js.
//
// PAGOS-UX (2026-05-25): este es el ÚNICO camino para crear pagos desde el UI.
// El pago se inserta como 'borrador' transitorio y se confirma inmediatamente
// con fn_confirmar_pago (que mueve a 'pagado' + dispara OP). Si la
// confirmación falla, se hace rollback explícito del borrador para no dejar
// huérfanos visibles en la base.
export async function createPagoYConfirmar(
  data: PagoPayload
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = createClient()
    const auth = await supabase.auth.getUser()
    if (!auth.data?.user) return { ok: false, error: 'No autenticado' }

    const dupError = await detectarPagoDuplicadoReciente(supabase, data)
    if (dupError) return { ok: false, error: dupError }

    const { data: inserted, error: insertErr } = await supabase
      .from('pagos')
      .insert({ ...data, estado: 'borrador', created_by: auth.data.user.id })
      .select('id')
      .single()
    if (insertErr) {
      console.error('[createPagoYConfirmar] insert:', insertErr.message)
      return { ok: false, error: insertErr.message }
    }
    if (!inserted) return { ok: false, error: 'No se pudo crear el pago.' }

    const overError = await validarSaldoPendiente(supabase, inserted.id)
    if (overError) {
      await supabase.from('pagos').delete().eq('id', inserted.id)
      return { ok: false, error: overError }
    }

    const { error: confirmErr } = await supabase.rpc('fn_confirmar_pago', { p_pago_id: inserted.id })
    if (confirmErr) {
      console.error('[createPagoYConfirmar] confirm failed:', confirmErr.message)
      // FIN-FIX-2 (2026-05-24): atomicidad. Rollback explícito del INSERT
      // para no dejar pago huérfano en estado borrador. Cualquier fallo de
      // la RPC (saldo, RLS, validaciones SQL) deja el sistema limpio.
      const { error: rollbackErr } = await supabase.from('pagos').delete().eq('id', inserted.id)
      if (rollbackErr) {
        console.error('[createPagoYConfirmar] rollback FAILED — pago huérfano:', {
          pago_id: inserted.id,
          confirm_error: confirmErr.message,
          rollback_error: rollbackErr.message,
        })
        return {
          ok: false,
          error: `${cleanDbError(confirmErr.message)} · No se pudo limpiar el pago automáticamente; revisá la tabla de pagos.`,
        }
      }
      return { ok: false, error: cleanDbError(confirmErr.message) }
    }

    revalidatePath('/pagos')
    revalidatePath('/fondos')
    revalidatePath('/gastos')
    return { ok: true }
  } catch (err) {
    console.error('[createPagoYConfirmar] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

export async function anularPago(id: string) {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_anular_pago', { p_pago_id: id })
  if (error) throw new Error(cleanDbError(error.message))
  revalidatePath('/pagos')
  revalidatePath('/fondos')
}
