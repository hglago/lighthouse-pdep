'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type GastoRecurrentePayload = {
  fondo_id: string
  proveedor_id: string | null
  concepto: string
  categoria: string | null
  monto: number
  moneda: string
  dia_vencimiento: number
  fecha_inicio: string
  fecha_fin: string | null
  activo: boolean
  prioridad_pago: number
  observaciones: string | null
}

export async function createGastoRecurrente(data: GastoRecurrentePayload) {
  const supabase = createClient()
  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) throw new Error('No autenticado')

  const { error } = await supabase.from('gastos_recurrentes').insert({
    ...data,
    proveedor_id: data.proveedor_id || null,
    created_by: user.id,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/gastos-recurrentes')
}

export async function updateGastoRecurrente(id: string, data: GastoRecurrentePayload) {
  const supabase = createClient()
  const { data: rows, error } = await supabase
    .from('gastos_recurrentes')
    .update({ ...data, proveedor_id: data.proveedor_id || null })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
  if (error) throw new Error(error.message)
  if (!rows || rows.length === 0)
    throw new Error('Sin permiso para editar este gasto recurrente.')
  revalidatePath('/gastos-recurrentes')
}

export async function deleteGastoRecurrente(id: string) {
  const supabase = createClient()
  const { data: rows, error } = await supabase
    .from('gastos_recurrentes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
  if (error) throw new Error(error.message)
  if (!rows || rows.length === 0)
    throw new Error('Sin permiso para eliminar este gasto recurrente.')
  revalidatePath('/gastos-recurrentes')
}
