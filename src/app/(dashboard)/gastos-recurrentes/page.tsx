import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import GastosRecurrentesClient, { type GastoRecurrenteRow } from './GastosRecurrentesClient'
import type { Fondo, Proveedor, UserRole, TipoGasto } from '@/types'
import { createGastoRecurrente, updateGastoRecurrente, deleteGastoRecurrente } from './actions'

export default async function GastosRecurrentesPage() {
  const supabase = createClient()

  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) redirect('/login')

  {
    const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (p?.role === 'socio') redirect('/reportes')
  }

  const [profileResult, recurrentesResult, fondosResult, proveedoresResult, tiposGastoResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single(),
    supabase
      .from('gastos_recurrentes')
      .select('id, fondo_id, proveedor_id, concepto, categoria, tipo_gasto_id, monto, moneda, dia_vencimiento, fecha_inicio, fecha_fin, activo, prioridad_pago, observaciones, created_by, created_at, fondos(nombre, moneda), proveedores(nombre), tipos_gasto:tipo_gasto_id(id, codigo, nombre)')
      .is('deleted_at', null)
      .order('concepto', { ascending: true }),
    supabase
      .from('fondos')
      .select('id, nombre, moneda')
      .is('deleted_at', null)
      .eq('estado', 'activo')
      .order('nombre'),
    supabase
      .from('proveedores')
      .select('id, nombre')
      .is('deleted_at', null)
      .eq('activo', true)
      .order('nombre'),
    // TIPOS-GASTO: tipos activos para el select del modal recurrente.
    supabase
      .from('tipos_gasto')
      .select('id, codigo, nombre, descripcion, activo, created_at, updated_at, created_by')
      .eq('activo', true)
      .order('nombre'),
  ])

  // TIPOS-GASTO: tolerancia D4 — si tipo_gasto_id no se aplicó, retry sin él.
  let recurrentesData = recurrentesResult.data
  if (
    recurrentesResult.error?.code === '42703' &&
    /tipo_gasto_id/.test(recurrentesResult.error.message ?? '')
  ) {
    console.warn('[gastos-recurrentes] tipo_gasto_id no disponible; retry base.')
    const fb = await supabase
      .from('gastos_recurrentes')
      .select('id, fondo_id, proveedor_id, concepto, categoria, monto, moneda, dia_vencimiento, fecha_inicio, fecha_fin, activo, prioridad_pago, observaciones, created_by, created_at, fondos(nombre, moneda), proveedores(nombre)')
      .is('deleted_at', null)
      .order('concepto', { ascending: true })
    recurrentesData = (fb.data ?? []).map(r => ({ ...r, tipo_gasto_id: null, tipos_gasto: null })) as unknown as typeof recurrentesResult.data
  }
  if (tiposGastoResult.error) {
    console.warn('[gastos-recurrentes] tipos_gasto no disponible:',
      tiposGastoResult.error.code, tiposGastoResult.error.message)
  }

  const role: UserRole = (profileResult.data?.role as UserRole) ?? 'visualizador'
  const recurrentes = (recurrentesData ?? []) as unknown as GastoRecurrenteRow[]
  const fondos = (fondosResult.data ?? []) as Pick<Fondo, 'id' | 'nombre' | 'moneda'>[]
  const proveedores = (proveedoresResult.data ?? []) as Pick<Proveedor, 'id' | 'nombre'>[]
  const tiposGasto: TipoGasto[] = (tiposGastoResult.data ?? []) as TipoGasto[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Gastos recurrentes</h1>
        <p className="mt-1 text-sm text-gray-500">
          Obligaciones de pago periódicas con día de vencimiento mensual.
        </p>
      </div>

      <GastosRecurrentesClient
        recurrentes={recurrentes}
        fondos={fondos}
        proveedores={proveedores}
        tiposGasto={tiposGasto}
        role={role}
        onCreateRecurrente={createGastoRecurrente}
        onUpdateRecurrente={updateGastoRecurrente}
        onDeleteRecurrente={deleteGastoRecurrente}
      />
    </div>
  )
}
