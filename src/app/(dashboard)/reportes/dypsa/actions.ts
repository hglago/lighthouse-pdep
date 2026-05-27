'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type GenerarResult =
  | { ok: true; codigo: string; id: string }
  | { ok: false; error: string }

export async function generarInformeDypsa(fechaDesde: string, fechaHasta: string): Promise<GenerarResult> {
  try {
    if (!fechaDesde || !fechaHasta) {
      return { ok: false, error: 'Fechas desde y hasta son requeridas.' }
    }

    const supabase = createClient()
    const auth = await supabase.auth.getUser()
    if (!auth.data?.user) return { ok: false, error: 'No autenticado' }

    const { data, error } = await supabase.rpc('fn_generar_reporte_dypsa', {
      p_fecha_desde: fechaDesde,
      p_fecha_hasta: fechaHasta,
    })

    if (error) {
      const msg = error.message ?? ''
      if (msg.includes('No hay gastos pagados')) {
        return { ok: false, error: 'No hay gastos pagados para el período seleccionado.' }
      }
      return { ok: false, error: msg || 'Error al generar el informe.' }
    }

    revalidatePath('/reportes/dypsa')

    const row = data as { id: string; codigo: string } | null
    if (!row) return { ok: false, error: 'No se pudo obtener el informe generado.' }

    return { ok: true, codigo: row.codigo, id: row.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido.' }
  }
}

export type InformeResumen = {
  id: string
  codigo: string
  fecha_desde: string
  fecha_hasta: string
  fecha_generacion: string
  total_informado: number
  moneda: string
  cantidad_items: number
  estado: string
}

export async function listarInformesDypsa(): Promise<InformeResumen[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('reportes_dypsa')
    .select('id, codigo, fecha_desde, fecha_hasta, fecha_generacion, total_informado, moneda, cantidad_items, estado')
    .order('fecha_generacion', { ascending: false })

  return (data ?? []) as InformeResumen[]
}

export type InformeDetalle = {
  cabecera: InformeResumen
  items: InformeItem[]
}

export type InformeItem = {
  id: string
  fecha_gasto: string
  fecha_pago: string | null
  periodo: string
  proveedor_nombre: string
  tipo_gasto_nombre: string
  descripcion: string
  moneda: string
  monto_final_informe: number
  comprobante_path: string | null
  tiene_comprobante: boolean
}

export async function obtenerInformeDypsa(reporteId: string): Promise<InformeDetalle | null> {
  const supabase = createClient()

  const [cabResult, itemsResult] = await Promise.all([
    supabase
      .from('reportes_dypsa')
      .select('id, codigo, fecha_desde, fecha_hasta, fecha_generacion, total_informado, moneda, cantidad_items, estado')
      .eq('id', reporteId)
      .single(),
    supabase
      .from('reportes_dypsa_items')
      .select('id, fecha_gasto, fecha_pago, periodo, proveedor_nombre, tipo_gasto_nombre, descripcion, moneda, monto_final_informe, comprobante_path, tiene_comprobante')
      .eq('reporte_id', reporteId)
      .order('fecha_gasto', { ascending: false }),
  ])

  if (cabResult.error || !cabResult.data) return null

  return {
    cabecera: cabResult.data as InformeResumen,
    items: (itemsResult.data ?? []) as InformeItem[],
  }
}
