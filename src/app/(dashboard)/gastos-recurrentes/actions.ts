'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertRole } from '@/lib/auth/guards'
import type { UserRole } from '@/types'

// Fase 2C.2a (2026-05-25): recurrentes = configuración estructural.
// Admin + supervisor + legacy revisor.
const ROLES_RECURRENTES: UserRole[] = ['admin', 'supervisor', 'revisor']

export type GastoRecurrentePayload = {
  fondo_id: string
  proveedor_id: string | null
  concepto: string
  // categoria (legacy): DEPRECADO en UI desde TIPOS-GASTO (2026-05-25). Se
  // sigue aceptando en el payload por compatibilidad, pero la UI no la setea.
  categoria: string | null
  // TIPOS-GASTO: clasificación analítica. Null → trigger DB asigna OTRO.
  tipo_gasto_id: string | null
  monto: number
  moneda: string
  dia_vencimiento: number
  fecha_inicio: string
  fecha_fin: string | null
  activo: boolean
  prioridad_pago: number
  observaciones: string | null
}

// TIPOS-GASTO: si la columna tipo_gasto_id aún no se aplicó (42703), retry sin ella.
function isTipoGastoMissing(err: { code?: string; message?: string } | null | undefined): boolean {
  return err?.code === '42703' && (err.message ?? '').toLowerCase().includes('tipo_gasto_id')
}
function stripTipoGasto<T extends Record<string, unknown>>(p: T): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tipo_gasto_id, ...rest } = p
  return rest
}

export async function createGastoRecurrente(data: GastoRecurrentePayload) {
  // Fase 2C.2a: guard server-side.
  const guard = await assertRole(ROLES_RECURRENTES)
  if (!guard.ok) throw new Error(guard.error)

  const supabase = createClient()
  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) throw new Error('No autenticado')

  const payload = {
    ...data,
    proveedor_id: data.proveedor_id || null,
    created_by: user.id,
  }
  const { error } = await supabase.from('gastos_recurrentes').insert(payload)
  if (error) {
    if (isTipoGastoMissing(error)) {
      const retry = await supabase.from('gastos_recurrentes').insert(stripTipoGasto(payload))
      if (retry.error) throw new Error(retry.error.message)
    } else {
      throw new Error(error.message)
    }
  }
  revalidatePath('/gastos-recurrentes')
}

export async function updateGastoRecurrente(id: string, data: GastoRecurrentePayload) {
  // Fase 2C.2a: guard server-side.
  const guard = await assertRole(ROLES_RECURRENTES)
  if (!guard.ok) throw new Error(guard.error)

  const supabase = createClient()
  // @supabase/ssr: hidratar la sesión con getUser() antes de escribir, si no
  // el UPDATE sale sin auth → auth.uid() NULL → RLS rechaza.
  const { data: { user: _u } } = await supabase.auth.getUser()
  if (!_u) throw new Error('No autenticado')

  const payload = { ...data, proveedor_id: data.proveedor_id || null }
  const { data: rows, error } = await supabase
    .from('gastos_recurrentes')
    .update(payload)
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
  if (error) {
    if (isTipoGastoMissing(error)) {
      const retry = await supabase
        .from('gastos_recurrentes')
        .update(stripTipoGasto(payload))
        .eq('id', id)
        .is('deleted_at', null)
        .select('id')
      if (retry.error) throw new Error(retry.error.message)
      if (!retry.data || retry.data.length === 0)
        throw new Error('Sin permiso para editar este gasto recurrente.')
    } else {
      throw new Error(error.message)
    }
  } else if (!rows || rows.length === 0) {
    throw new Error('Sin permiso para editar este gasto recurrente.')
  }
  revalidatePath('/gastos-recurrentes')
}

export async function deleteGastoRecurrente(id: string) {
  // Fase 2C.2a: guard server-side.
  const guard = await assertRole(ROLES_RECURRENTES)
  if (!guard.ok) throw new Error(guard.error)

  const supabase = createClient()
  // @supabase/ssr: hidratar la sesión con getUser() para que auth.uid() esté
  // disponible dentro del RPC.
  const { data: { user: _u } } = await supabase.auth.getUser()
  if (!_u) throw new Error('No autenticado')

  // Baja lógica vía RPC SECURITY DEFINER (el UPDATE directo de deleted_at lo
  // rechaza el hardening, igual que Proveedores/Fondos).
  const { error } = await supabase.rpc('soft_delete_gasto_recurrente', { recurrente_id: id })
  if (error) throw new Error(error.message)
  revalidatePath('/gastos-recurrentes')
}
