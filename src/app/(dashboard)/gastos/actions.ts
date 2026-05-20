'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type GastoPayload = {
  fondo_id: string
  proveedor_id: string
  descripcion: string
  monto: number
  moneda: string
  fecha_gasto: string
  notas: string | null
  tiene_anticipo: boolean
  monto_anticipo: number | null
  porcentaje_anticipo: number | null
  fecha_prevista_pago_anticipo: string | null
  fecha_comprometida_pago_saldo: string | null
  condiciones_pago_notas: string | null
  fecha_vencimiento: string | null
  prioridad_pago: number
}

export async function createGasto(data: GastoPayload) {
  const supabase = createClient()
  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) throw new Error('No autenticado')

  const { error } = await supabase.from('gastos').insert({
    ...data,
    proveedor_id: data.proveedor_id || null,
    estado: 'borrador',
    created_by: user.id,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/gastos')
}

export async function updateGasto(id: string, data: GastoPayload) {
  const supabase = createClient()
  const result = await supabase
    .from('gastos')
    .update({ ...data, proveedor_id: data.proveedor_id || null })
    .eq('id', id)
    .eq('estado', 'borrador')
    .is('deleted_at', null)
    .select('id')
  if (result.error) throw new Error(result.error.message)
  if (!result.data || result.data.length === 0)
    throw new Error('Sin permiso para editar este gasto o ya no está en borrador.')
  revalidatePath('/gastos')
}

export async function deleteGasto(id: string) {
  const supabase = createClient()

  // 1. rol del usuario según get_my_role()
  const roleResult = await supabase.rpc('get_my_role')
  console.error('[deleteGasto] get_my_role:', roleResult.data, '| rpcError:', roleResult.error?.message)

  // 2. id del usuario autenticado
  const authResult = await supabase.auth.getUser()
  console.error('[deleteGasto] auth.uid:', authResult.data.user?.id)

  // 3. estado actual del gasto antes del update
  const gastoActual = await supabase
    .from('gastos')
    .select('id, created_by, estado, deleted_at')
    .eq('id', id)
    .maybeSingle()
  console.error('[deleteGasto] gasto actual:', JSON.stringify(gastoActual.data), '| selectError:', gastoActual.error?.message)

  // 4. payload exacto
  const payload = { deleted_at: new Date().toISOString() }
  console.error('[deleteGasto] payload:', JSON.stringify(payload))

  // 5. resultado del update
  const result = await supabase
    .from('gastos')
    .update(payload)
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
  console.error('[deleteGasto] result data:', JSON.stringify(result.data), '| error:', result.error?.message, '| code:', result.error?.code, '| status:', result.status)

  if (result.error) throw new Error(result.error.message)
  if (!result.data || result.data.length === 0)
    throw new Error('Sin permiso para eliminar este gasto.')
  revalidatePath('/gastos')
}

export async function cambiarEstadoGasto(
  id: string,
  nuevoEstado: 'enviado' | 'aprobado' | 'rechazado'
) {
  const supabase = createClient()
  const result = await supabase
    .from('gastos')
    .update({ estado: nuevoEstado })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
  if (result.error) throw new Error(result.error.message)
  if (!result.data || result.data.length === 0)
    throw new Error('Sin permiso para cambiar el estado de este gasto.')
  revalidatePath('/gastos')
}
