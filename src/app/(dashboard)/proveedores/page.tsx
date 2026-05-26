import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ProveedoresClient from './ProveedoresClient'
import type { Proveedor, UserRole } from '@/types'

export default async function ProveedoresPage() {
  const supabase = createClient()

  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) redirect('/login')

  {
    const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (p?.role === 'socio') redirect('/reportes')
  }

  // Query base con columnas que siempre existen (mismo patrón que el selector de
  // Gastos, que ya sabemos que funciona).
  const [profileResult, proveedoresResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single(),
    supabase
      .from('proveedores')
      .select('id, nombre, cuit, email, telefono, direccion, observaciones, activo, created_by, created_at, updated_at, deleted_at')
      .is('deleted_at', null)
      .order('nombre', { ascending: true }),
  ])

  // Intentamos enriquecer con columnas opcionales (uplift + servicios por hora)
  // en una query separada. Si las columnas todavía no existen en DB (ALTER
  // pendiente), simplemente ignoramos y hidratamos defaults — el listado
  // funciona igual.
  type ProveedorOpcional = {
    tiene_uplift: boolean
    porcentaje_uplift: number
    permite_horas_servicio: boolean
    valor_hora: number
    nombre_informe: string | null
  }
  const opcionalMap = new Map<string, ProveedorOpcional>()

  async function fetchOpcional(columnas: string) {
    return supabase
      .from('proveedores')
      .select('id, ' + columnas)
      .is('deleted_at', null)
  }

  if (proveedoresResult.data && proveedoresResult.data.length > 0) {
    // Intento 1: las 4 columnas opcionales (post-P1).
    let opcionalResult = await fetchOpcional('tiene_uplift, porcentaje_uplift, permite_horas_servicio, valor_hora, nombre_informe')
    // Intento 2 (fallback): solo uplift, por si P1 no se aplicó pero sí la migración uplift previa.
    if (opcionalResult.error?.code === '42703') {
      console.warn('[proveedores] columnas P1 no disponibles, fallback a solo uplift:', opcionalResult.error.message)
      opcionalResult = await fetchOpcional('tiene_uplift, porcentaje_uplift')
    }
    if (opcionalResult.error) {
      console.warn('[proveedores] columnas opcionales no disponibles:', opcionalResult.error.message)
    } else if (opcionalResult.data) {
      for (const u of opcionalResult.data as unknown as Array<{
        id: string
        tiene_uplift?: boolean | null
        porcentaje_uplift?: number | null
        permite_horas_servicio?: boolean | null
        valor_hora?: number | null
        nombre_informe?: string | null
      }>) {
        opcionalMap.set(u.id, {
          tiene_uplift: u.tiene_uplift === true,
          porcentaje_uplift: Number(u.porcentaje_uplift) || 0,
          permite_horas_servicio: u.permite_horas_servicio === true,
          valor_hora: Number(u.valor_hora) || 0,
          nombre_informe: u.nombre_informe ?? null,
        })
      }
    }
  }

  const role: UserRole = (profileResult.data?.role as UserRole) ?? 'visualizador'
  const proveedores: Proveedor[] = (proveedoresResult.data ?? []).map(p => {
    const opt = opcionalMap.get(p.id)
    return {
      ...p,
      tiene_uplift: opt?.tiene_uplift ?? false,
      porcentaje_uplift: opt?.porcentaje_uplift ?? 0,
      permite_horas_servicio: opt?.permite_horas_servicio ?? false,
      valor_hora: opt?.valor_hora ?? 0,
      nombre_informe: opt?.nombre_informe ?? null,
    } as Proveedor
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Proveedores</h1>
        <p className="mt-1 text-sm text-gray-500">
          Alta y gestión de proveedores.
        </p>
      </div>

      <ProveedoresClient proveedores={proveedores} role={role} />
    </div>
  )
}
