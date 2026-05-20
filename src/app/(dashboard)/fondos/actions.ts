'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { FondoEstado, TipoAporte } from '@/types'

function cleanDbError(msg: string): string {
  return msg.replace(/^ERROR:\s*/i, '').replace(/\s*CONTEXT:[\s\S]*$/i, '').trim()
}

export async function createFondo(data: {
  nombre: string
  moneda: string
  monto_inicial: number
  descripcion: string | null
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')

  const { error } = await supabase.from('fondos').insert({
    nombre: data.nombre,
    moneda: data.moneda,
    monto_inicial: data.monto_inicial,
    descripcion: data.descripcion,
    created_by: user.id,
  })
  if (error) throw new Error(cleanDbError(error.message))
  revalidatePath('/fondos')
}

export async function updateFondo(
  id: string,
  data: { nombre: string; descripcion: string | null; estado: FondoEstado }
) {
  const supabase = createClient()
  const { error } = await supabase
    .from('fondos')
    .update({ nombre: data.nombre, descripcion: data.descripcion, estado: data.estado })
    .eq('id', id)
    .is('deleted_at', null)
  if (error) throw new Error(cleanDbError(error.message))
  revalidatePath('/fondos')
}

export async function deleteFondo(id: string) {
  const supabase = createClient()
  const { error } = await supabase
    .from('fondos')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
  if (error) throw new Error(cleanDbError(error.message))
  revalidatePath('/fondos')
}

export type AportePayload = {
  fondo_id: string
  fecha_aporte: string
  monto: number
  tipo_aporte: TipoAporte
  aportante: string | null
  concepto: string
  comprobante_url: string | null
  observaciones: string | null
}

export async function registrarAporte(data: AportePayload) {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_registrar_aporte', {
    p_fondo_id:        data.fondo_id,
    p_fecha_aporte:    data.fecha_aporte,
    p_monto:           data.monto,
    p_tipo_aporte:     data.tipo_aporte,
    p_aportante:       data.aportante,
    p_concepto:        data.concepto,
    p_comprobante_url: data.comprobante_url,
    p_observaciones:   data.observaciones,
  })
  if (error) throw new Error(cleanDbError(error.message))
  revalidatePath('/fondos')
}
