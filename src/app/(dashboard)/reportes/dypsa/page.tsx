import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/types'
import InformeDypsaClient, { type DypsaGastoRow } from '../InformeDypsaClient'

const ROLES_REPORTES: UserRole[] = ['admin', 'supervisor', 'socio']

export default async function InformeDypsaPage() {
  const supabase = createClient()

  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = (profile?.role as UserRole) ?? 'visualizador'
  if (!ROLES_REPORTES.includes(role)) redirect('/gastos')

  // Paso 1: gasto_ids con al menos un pago confirmado.
  const pagosResult = await supabase
    .from('pagos')
    .select('gasto_id')
    .eq('estado', 'pagado')
    .not('gasto_id', 'is', null)

  const gastoIds = Array.from(
    new Set(
      (pagosResult.data ?? [])
        .map(p => p.gasto_id as string)
        .filter(Boolean)
    )
  )

  if (gastoIds.length === 0) {
    return <InformeDypsaClient rows={[]} />
  }

  // Paso 2: gastos por ids, sin nombre_informe en el join.
  const gastosResult = await supabase
    .from('gastos')
    .select('id, proveedor_id, descripcion, monto, moneda, fecha_gasto, periodo_analitico, porcentaje_uplift_snapshot, comprobante_path, proveedores:proveedor_id(nombre), tipos_gasto:tipo_gasto_id(nombre)')
    .is('deleted_at', null)
    .in('id', gastoIds)
    .order('fecha_gasto', { ascending: false })

  let gastosData = gastosResult.data

  if (gastosResult.error?.code === '42703') {
    const fallback = await supabase
      .from('gastos')
      .select('id, proveedor_id, descripcion, monto, moneda, fecha_gasto, porcentaje_uplift_snapshot, comprobante_path, proveedores:proveedor_id(nombre), tipos_gasto:tipo_gasto_id(nombre)')
      .is('deleted_at', null)
      .in('id', gastoIds)
      .order('fecha_gasto', { ascending: false })

    if (fallback.error?.code === '42703') {
      const base = await supabase
        .from('gastos')
        .select('id, proveedor_id, descripcion, monto, moneda, fecha_gasto, comprobante_path, proveedores:proveedor_id(nombre), tipos_gasto:tipo_gasto_id(nombre)')
        .is('deleted_at', null)
        .in('id', gastoIds)
        .order('fecha_gasto', { ascending: false })
      gastosData = (base.data ?? []).map(g => ({
        ...g,
        periodo_analitico: null as string | null,
        porcentaje_uplift_snapshot: 0,
      })) as typeof gastosData
    } else {
      gastosData = (fallback.data ?? []).map(g => ({
        ...g,
        periodo_analitico: null as string | null,
      })) as typeof gastosData
    }
  }

  // Paso 3: fetch de proveedores — nombre_informe + uplift (fallback si snapshot=0).
  // Tolerante: si nombre_informe o tiene_uplift no existen, retry sin ellas.
  const provIds = Array.from(new Set(
    (gastosData ?? [])
      .map(g => (g as { proveedor_id?: string | null }).proveedor_id)
      .filter((id): id is string => !!id)
  ))

  type ProvInfo = { nombre_informe: string | null; tiene_uplift: boolean; porcentaje_uplift: number }
  const provInfoMap = new Map<string, ProvInfo>()

  if (provIds.length > 0) {
    type ProvRow = { id: string; nombre_informe?: string | null; tiene_uplift?: boolean | null; porcentaje_uplift?: number | null }
    let provData: ProvRow[] = []

    const prov1 = await supabase
      .from('proveedores')
      .select('id, nombre_informe, tiene_uplift, porcentaje_uplift')
      .in('id', provIds)

    if (prov1.error?.code === '42703') {
      const prov2 = await supabase
        .from('proveedores')
        .select('id, tiene_uplift, porcentaje_uplift')
        .in('id', provIds)
      if (!prov2.error && prov2.data) provData = prov2.data as ProvRow[]
    } else if (!prov1.error && prov1.data) {
      provData = prov1.data as ProvRow[]
    }

    if (provData.length > 0) {
      for (const p of provData as Array<{
        id: string
        nombre_informe?: string | null
        tiene_uplift?: boolean | null
        porcentaje_uplift?: number | null
      }>) {
        provInfoMap.set(p.id, {
          nombre_informe: p.nombre_informe ?? null,
          tiene_uplift: p.tiene_uplift === true,
          porcentaje_uplift: Number(p.porcentaje_uplift) || 0,
        })
      }
    }
  }

  // Paso 4: mapear a DypsaGastoRow.
  // Uplift: usar snapshot del gasto; si es 0 y el proveedor tiene uplift, fallback al proveedor.
  const rows: DypsaGastoRow[] = (gastosData ?? []).map((g) => {
    const prov = g.proveedores as { nombre?: string } | null
    const tipo = g.tipos_gasto as { nombre?: string } | null
    const fechaStr = (g.fecha_gasto as string) ?? ''
    const periodoRaw = (g as { periodo_analitico?: string | null }).periodo_analitico
    const provId = (g as { proveedor_id?: string | null }).proveedor_id

    const provInfo = provId ? provInfoMap.get(provId) : undefined
    const nombreVisible = provInfo?.nombre_informe || prov?.nombre || 'Sin proveedor'

    let upliftPct = Number((g as { porcentaje_uplift_snapshot?: number }).porcentaje_uplift_snapshot) || 0
    if (upliftPct <= 0 && provInfo?.tiene_uplift && provInfo.porcentaje_uplift > 0) {
      upliftPct = provInfo.porcentaje_uplift
    }

    return {
      id: g.id as string,
      fecha_gasto: fechaStr,
      periodo: periodoRaw ?? (fechaStr ? fechaStr.slice(0, 7) : ''),
      proveedor: nombreVisible,
      tipo_gasto: tipo?.nombre ?? 'Sin clasificar',
      descripcion: g.descripcion as string,
      moneda: g.moneda as string,
      monto: Number(g.monto) || 0,
      porcentaje_uplift_snapshot: upliftPct,
      tiene_comprobante: !!(g.comprobante_path),
    }
  })

  return <InformeDypsaClient rows={rows} />
}
