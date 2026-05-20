'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { AnticipoEstado } from '@/types'

export type AnticipoPayload = {
  proveedor_id: string
  fondo_id: string
  concepto: string
  monto_total: number
  porcentaje_anticipo: number
  monto_anticipo: number
  moneda: string
  fecha_acuerdo: string
  fecha_vencimiento_saldo: string | null
  observaciones: string | null
}

export async function createAnticipo(data: AnticipoPayload) {
  const supabase = createClient()
  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) throw new Error('No autenticado')

  const { error } = await supabase.from('anticipos').insert({
    ...data,
    estado: 'borrador',
    created_by: user.id,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/anticipos')
}

export async function updateAnticipo(id: string, data: AnticipoPayload) {
  const supabase = createClient()
  const result = await supabase
    .from('anticipos')
    .update(data)
    .eq('id', id)
    .eq('estado', 'borrador')
    .is('deleted_at', null)
    .select('id')
  if (result.error) throw new Error(result.error.message)
  if (!result.data || result.data.length === 0)
    throw new Error('Sin permiso para editar este anticipo o ya no está en borrador.')
  revalidatePath('/anticipos')
}

// Solo transiciones manuales. Las payment-driven (anticipo_pagado, completado)
// las ejecuta fn_confirmar_pago en el módulo de pagos.
export async function cambiarEstadoAnticipo(
  id: string,
  nuevoEstado: 'aprobado' | 'cancelado'
) {
  const supabase = createClient()

  if (nuevoEstado === 'cancelado') {
    const roleResult = await supabase.rpc('get_my_role')
    if (roleResult.data !== 'admin')
      throw new Error('Solo admin puede cancelar anticipos.')
  }

  const base = supabase
    .from('anticipos')
    .update({ estado: nuevoEstado })
    .eq('id', id)
    .is('deleted_at', null)

  const result = await (
    nuevoEstado === 'aprobado'
      ? base.eq('estado', 'borrador')
      : base.neq('estado', 'completado').neq('estado', 'cancelado')
  ).select('id')

  if (result.error) throw new Error(result.error.message)
  if (!result.data || result.data.length === 0)
    throw new Error('No se puede cambiar el estado. Verificá el estado actual y tus permisos.')
  revalidatePath('/anticipos')
}
