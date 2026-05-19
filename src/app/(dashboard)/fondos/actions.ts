'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

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
  if (error) throw new Error(error.message)
  revalidatePath('/fondos')
}

export async function updateFondo(
  id: string,
  data: { nombre: string; moneda: string; descripcion: string | null }
) {
  const supabase = createClient()
  const { error } = await supabase
    .from('fondos')
    .update({ nombre: data.nombre, moneda: data.moneda, descripcion: data.descripcion })
    .eq('id', id)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)
  revalidatePath('/fondos')
}

export async function deleteFondo(id: string) {
  const supabase = createClient()
  const { error } = await supabase
    .from('fondos')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)
  revalidatePath('/fondos')
}
