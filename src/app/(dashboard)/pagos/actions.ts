'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { PagoTipo } from '@/types'

export type PagoPayload = {
  fondo_id: string
  proveedor_id: string
  gasto_id: string | null
  anticipo_id: string | null
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

export async function createPago(data: PagoPayload) {
  const supabase = createClient()
  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) throw new Error('No autenticado')

  const { error } = await supabase.from('pagos').insert({
    ...data,
    estado: 'borrador',
    created_by: user.id,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/pagos')
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

export async function confirmarPago(id: string) {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_confirmar_pago', { p_pago_id: id })
  if (error) throw new Error(cleanDbError(error.message))
  revalidatePath('/pagos')
  revalidatePath('/fondos')
}

export async function anularPago(id: string) {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_anular_pago', { p_pago_id: id })
  if (error) throw new Error(cleanDbError(error.message))
  revalidatePath('/pagos')
  revalidatePath('/fondos')
}
