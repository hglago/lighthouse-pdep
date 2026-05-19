'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function createProveedor(data: {
  nombre: string
  cuit: string | null
  email: string | null
  telefono: string | null
  direccion: string | null
  observaciones: string | null
}) {
  const supabase = createClient()
  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) throw new Error('No autenticado')

  const { error } = await supabase.from('proveedores').insert({
    ...data,
    created_by: user.id,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/proveedores')
}

export async function updateProveedor(
  id: string,
  data: {
    nombre: string
    cuit: string | null
    email: string | null
    telefono: string | null
    direccion: string | null
    observaciones: string | null
  }
) {
  const supabase = createClient()
  const { error } = await supabase
    .from('proveedores')
    .update(data)
    .eq('id', id)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)
  revalidatePath('/proveedores')
}

export async function deleteProveedor(id: string) {
  const supabase = createClient()
  const { error } = await supabase
    .from('proveedores')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)
  revalidatePath('/proveedores')
}
