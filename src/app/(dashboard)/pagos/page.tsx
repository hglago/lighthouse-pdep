import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PagosClient, { type PagoRow } from './PagosClient'
import type { UserRole } from '@/types'
import { createPago, updatePago, confirmarPago, anularPago } from './actions'

export default async function PagosPage() {
  const supabase = createClient()

  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) redirect('/login')

  const [
    profileResult,
    pagosResult,
    fondosResult,
    proveedoresResult,
    gastosResult,
    anticiposResult,
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single(),
    supabase
      .from('pagos')
      .select(
        'id, nro_pago, fondo_id, proveedor_id, gasto_id, anticipo_id, tipo, concepto, monto, moneda, fecha_pago, comprobante_url, estado, notas, created_by, anulado_por, anulado_en, created_at, fondos(nombre, moneda), proveedores(nombre), gastos(descripcion), anticipos(concepto)'
      )
      .order('fecha_pago', { ascending: false }),
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
    supabase
      .from('gastos')
      .select('id, descripcion, fondo_id, monto, proveedor_id')
      .eq('estado', 'aprobado')
      .is('deleted_at', null)
      .order('fecha_gasto', { ascending: false }),
    supabase
      .from('anticipos')
      .select('id, concepto, fondo_id')
      .in('estado', ['aprobado', 'anticipo_pagado'])
      .is('deleted_at', null)
      .order('fecha_acuerdo', { ascending: false }),
  ])

  const role: UserRole = (profileResult.data?.role as UserRole) ?? 'visualizador'
  const pagos = (pagosResult.data ?? []) as unknown as PagoRow[]
  const fondos = (fondosResult.data ?? []) as { id: string; nombre: string; moneda: string }[]
  const proveedores = (proveedoresResult.data ?? []) as { id: string; nombre: string }[]

  // Excluir gastos que ya tienen un pago confirmado
  // Nota: gasto_id en pagosResult es columna plana (UUID string), no el join anidado gastos(...)
  const gastoIdsPagados = new Set(
    pagos
      .filter(p => p.estado === 'pagado' && typeof p.gasto_id === 'string' && p.gasto_id !== '')
      .map(p => p.gasto_id as string)
  )
  const gastosAprobados = (gastosResult.data ?? [])
    .filter(g => !gastoIdsPagados.has(g.id)) as {
      id: string
      descripcion: string
      fondo_id: string
      monto: number
      proveedor_id: string | null
    }[]

  const anticiposActivos = (anticiposResult.data ?? []) as { id: string; concepto: string; fondo_id: string }[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Pagos</h1>
        <p className="mt-1 text-sm text-gray-500">
          Pagos reales a proveedores con impacto en fondos.
        </p>
      </div>

      <PagosClient
        pagos={pagos}
        fondos={fondos}
        proveedores={proveedores}
        gastosAprobados={gastosAprobados}
        anticiposActivos={anticiposActivos}
        role={role}
        onCreatePago={createPago}
        onUpdatePago={updatePago}
        onConfirmarPago={confirmarPago}
        onAnularPago={anularPago}
      />
    </div>
  )
}
