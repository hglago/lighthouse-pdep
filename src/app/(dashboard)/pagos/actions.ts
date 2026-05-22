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

// Verifica que no exista ya otro pago en borrador IDÉNTICO (mismo gasto, tipo, monto)
// para evitar borradores duplicados silenciosos.
async function detectarBorradorDuplicado(
  supabase: ReturnType<typeof createClient>,
  data: PagoPayload
): Promise<string | null> {
  if (!data.gasto_id) return null
  const { data: dups } = await supabase
    .from('pagos')
    .select('id, nro_pago')
    .eq('estado', 'borrador')
    .eq('gasto_id', data.gasto_id)
    .eq('tipo', data.tipo)
    .eq('monto', data.monto)
  if (dups && dups.length > 0) {
    return `Ya existe un pago en borrador para este gasto con el mismo tipo y monto (${dups[0].nro_pago}). Confirmá o eliminá ese pago antes de crear otro.`
  }
  return null
}

export async function createPago(data: PagoPayload) {
  const supabase = createClient()
  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) throw new Error('No autenticado')

  const dupError = await detectarBorradorDuplicado(supabase, data)
  if (dupError) throw new Error(dupError)

  const { error } = await supabase.from('pagos').insert({
    ...data,
    estado: 'borrador',
    created_by: user.id,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/pagos')
}

// Crea + confirma el pago en un solo acto. Retorna ActionResult para que el cliente
// muestre el error real sin enmascarado de Next.js.
export async function createPagoYConfirmar(
  data: PagoPayload
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = createClient()
    const auth = await supabase.auth.getUser()
    if (!auth.data?.user) return { ok: false, error: 'No autenticado' }

    const dupError = await detectarBorradorDuplicado(supabase, data)
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
      // Rollback: borrar el borrador recién creado para no dejar huérfano
      await supabase.from('pagos').delete().eq('id', inserted.id)
      return { ok: false, error: overError }
    }

    const { error: confirmErr } = await supabase.rpc('fn_confirmar_pago', { p_pago_id: inserted.id })
    if (confirmErr) {
      console.error('[createPagoYConfirmar] confirm:', confirmErr.message)
      return { ok: false, error: `Pago creado pero falló la confirmación: ${cleanDbError(confirmErr.message)}` }
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

export async function updatePago(id: string, data: PagoPayload) {
  const supabase = createClient()
  const { data: rows, error } = await supabase
    .from('pagos')
    .update(data)
    .eq('id', id)
    .eq('estado', 'borrador')
    .select('id')
  if (error) throw new Error(error.message)
  if (!rows || rows.length === 0)
    throw new Error('Sin permiso para editar este pago o ya no está en borrador.')
  revalidatePath('/pagos')
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
  if (!pago || !pago.gasto_id) return null  // sin gasto vinculado, no hay saldo que validar
  if (pago.estado === 'pagado') return null  // ya confirmado, no revalidar

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

export async function confirmarPago(id: string) {
  const supabase = createClient()
  const overError = await validarSaldoPendiente(supabase, id)
  if (overError) throw new Error(overError)

  const { error } = await supabase.rpc('fn_confirmar_pago', { p_pago_id: id })
  if (error) throw new Error(cleanDbError(error.message))
  revalidatePath('/pagos')
  revalidatePath('/fondos')
  revalidatePath('/gastos')
}

export async function anularPago(id: string) {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_anular_pago', { p_pago_id: id })
  if (error) throw new Error(cleanDbError(error.message))
  revalidatePath('/pagos')
  revalidatePath('/fondos')
}

export async function confirmarPagosBulk(
  ids: string[]
): Promise<{ confirmados: string[]; errores: { id: string; error: string }[] }> {
  const supabase = createClient()
  const confirmados: string[] = []
  const errores: { id: string; error: string }[] = []

  for (const id of ids) {
    const overError = await validarSaldoPendiente(supabase, id)
    if (overError) {
      console.error('[confirmarPagosBulk]', { id, error: overError })
      errores.push({ id, error: overError })
      continue
    }
    const { error } = await supabase.rpc('fn_confirmar_pago', { p_pago_id: id })
    if (error) {
      const msg = cleanDbError(error.message)
      console.error('[confirmarPagosBulk]', { id, error: msg })
      errores.push({ id, error: msg })
    } else {
      confirmados.push(id)
    }
  }

  if (confirmados.length > 0) {
    revalidatePath('/pagos')
    revalidatePath('/fondos')
    revalidatePath('/gastos')
  }

  return { confirmados, errores }
}
