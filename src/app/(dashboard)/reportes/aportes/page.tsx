import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/types'
import AportesReportClient, { type AporteReportRow } from './AportesReportClient'

const ROLES_REPORTES: UserRole[] = ['admin', 'supervisor', 'socio']

// Fila cruda de aportes_fondo con joins PostgREST (forma tolerante).
type AporteRaw = {
  id: string
  codigo: string | null
  fecha_aporte: string
  monto: number
  moneda: string
  destino_aporte: string | null
  socio_id: string | null
  aportante: string | null
  concepto: string | null
  observaciones: string | null
  socios: { codigo: string | null; nombre: string } | null
  financiadores: { codigo: string | null; nombre: string } | null
}

type ImputacionRaw = {
  aporte_id: string
  destino_tipo: string
  financiadores: { codigo: string | null; nombre: string } | null
}

export default async function InformeAportesPage() {
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

  // ── Aportes activos (solo vivos: deleted_at IS NULL) con socio + tercero.
  // SELECT tolerante: si socios.codigo aún no existe (migración 2B pendiente),
  // retry sin codigo hidratando null.
  const SELECT_FULL =
    'id, codigo, fecha_aporte, monto, moneda, destino_aporte, socio_id, aportante, concepto, observaciones, socios(codigo, nombre), financiadores(codigo, nombre)'
  const SELECT_NO_CODIGO =
    'id, codigo, fecha_aporte, monto, moneda, destino_aporte, socio_id, aportante, concepto, observaciones, socios(nombre), financiadores(nombre)'

  let aportesData: AporteRaw[] = []
  const aportesResult = await supabase
    .from('aportes_fondo')
    .select(SELECT_FULL)
    .is('deleted_at', null)
    .order('fecha_aporte', { ascending: false })

  if (aportesResult.error?.code === '42703') {
    const fb = await supabase
      .from('aportes_fondo')
      .select(SELECT_NO_CODIGO)
      .is('deleted_at', null)
      .order('fecha_aporte', { ascending: false })
    aportesData = ((fb.data ?? []) as unknown as AporteRaw[]).map(a => ({
      ...a,
      socios: a.socios ? { ...a.socios, codigo: a.socios.codigo ?? null } : null,
      financiadores: a.financiadores ? { ...a.financiadores, codigo: a.financiadores.codigo ?? null } : null,
    }))
  } else {
    aportesData = (aportesResult.data ?? []) as unknown as AporteRaw[]
  }

  // ── Imputaciones para derivar destino (RISA / Tercero / Mixto). Tolerante:
  // si aporte_imputaciones aún no existe, cae a destino_aporte de la cabecera.
  const impByAporte = new Map<string, ImputacionRaw[]>()
  const impResult = await supabase
    .from('aporte_imputaciones')
    .select('aporte_id, destino_tipo, financiadores(codigo, nombre)')

  if (!impResult.error) {
    for (const i of (impResult.data ?? []) as unknown as ImputacionRaw[]) {
      const arr = impByAporte.get(i.aporte_id) ?? []
      arr.push(i)
      impByAporte.set(i.aporte_id, arr)
    }
  }

  function derivarDestino(a: AporteRaw): string {
    const imps = impByAporte.get(a.id) ?? []
    if (imps.length === 0) {
      return a.destino_aporte === 'risa' ? 'RISA' : 'Tercero de la red'
    }
    if (imps.length === 1) {
      const i = imps[0]
      if (i.destino_tipo === 'medios_propios') return 'RISA'
      const nom = i.financiadores?.nombre ?? a.financiadores?.nombre ?? 'Tercero'
      const cod = i.financiadores?.codigo ?? a.financiadores?.codigo ?? null
      return cod ? `${cod} · ${nom}` : nom
    }
    return 'Mixto'
  }

  const rows: AporteReportRow[] = aportesData.map(a => ({
    id: a.id,
    codigo: a.codigo ?? null,
    fecha_aporte: a.fecha_aporte,
    socio_id: a.socio_id,
    socio_codigo: a.socios?.codigo ?? null,
    socio_nombre: a.socios?.nombre ?? null,
    aportante: a.aportante ?? null,
    monto: Number(a.monto) || 0,
    moneda: a.moneda,
    destino: derivarDestino(a),
    concepto: a.concepto ?? '',
    observaciones: a.observaciones ?? null,
  }))

  return <AportesReportClient rows={rows} />
}
