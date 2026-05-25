'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertRole } from '@/lib/auth/guards'
import type { UserRole } from '@/types'

// Fase 2C.2a (2026-05-25) — listas de roles permitidos por categoría.
// Incluyen roles nuevos (admin/supervisor/operador/user) y legacy
// (contador/revisor/visualizador) por compatibilidad transitoria.
// USER puede crear/editar sus propios gastos: el filtro de ownership va en
// Fase 2D (server-side por created_by). Mientras tanto el role check evita
// que roles sin autorización ejecuten estas actions.
const ROLES_ESCRITURA_GASTOS: UserRole[] = [
  'admin', 'supervisor', 'operador', 'user',
  'contador', 'revisor', 'visualizador',
]
const ROLES_APROBAR_GASTOS: UserRole[] = [
  'admin', 'supervisor',
  'revisor', 'contador', // legacy
]
const ROLES_DELETE_GASTOS: UserRole[] = [
  'admin',
  'contador', // legacy con permisos full históricos
]
const ROLES_CONFIG_GASTOS: UserRole[] = [
  'admin', 'supervisor',
  'revisor', 'contador', // legacy
]
const ROLES_RECURRENTES: UserRole[] = [
  'admin', 'supervisor',
  'revisor', // legacy
]

export type GastoPayload = {
  fondo_id: string
  proveedor_id: string
  // TIPOS-GASTO: clasificación analítica. Null → trigger DB asigna OTRO.
  tipo_gasto_id: string | null
  descripcion: string
  monto: number
  moneda: string
  fecha_gasto: string
  notas: string | null
  tiene_anticipo: boolean
  monto_anticipo: number | null
  porcentaje_anticipo: number | null
  fecha_prevista_pago_anticipo: string | null
  fecha_comprometida_pago_saldo: string | null
  condiciones_pago_notas: string | null
  fecha_vencimiento: string | null
  prioridad_pago: number
  // P3a: snapshot servicio por hora. Si es_servicio_horas=false, los campos quedan null/0.
  // D22/D23: porcentaje_uplift_snapshot es informativo, no modifica monto.
  es_servicio_horas: boolean
  descripcion_servicio: string | null
  periodo_servicio_desde: string | null
  periodo_servicio_hasta: string | null
  horas_servicio: number | null
  valor_hora_aplicado: number | null
  porcentaje_uplift_snapshot: number
  importe_base_servicio: number | null
  // P3a-fc: forma de cancelación del gasto (RISA o financiador externo).
  // CHECK en DB: forma='risa' ⇒ financiador_id IS NULL; forma='financiador' ⇒ financiador_id NOT NULL.
  // Solo define cómo se cancelará. NO genera deuda ni movimientos — eso es Pagos.
  forma_cancelacion: 'risa' | 'financiador'
  financiador_id: string | null
}

// Normaliza el payload del gasto:
// - Si es_servicio_horas=false: limpia los campos snapshot.
// - Si forma_cancelacion='risa': fuerza financiador_id=null.
// - Si forma_cancelacion='financiador': exige financiador_id (devuelve error si falta).
// Validación cliente + CHECK DB garantizan coherencia.
function normalizeGasto(data: GastoPayload): GastoPayload | { error: string } {
  let cleaned: GastoPayload = data.es_servicio_horas === true
    ? data
    : {
        ...data,
        es_servicio_horas: false,
        descripcion_servicio: null,
        periodo_servicio_desde: null,
        periodo_servicio_hasta: null,
        horas_servicio: null,
        valor_hora_aplicado: null,
        porcentaje_uplift_snapshot: 0,
        importe_base_servicio: null,
      }

  if (cleaned.forma_cancelacion === 'risa') {
    cleaned = { ...cleaned, financiador_id: null }
  } else if (cleaned.forma_cancelacion === 'financiador') {
    if (!cleaned.financiador_id) {
      return { error: 'Cuando el gasto se afronta con un tercero de la red, seleccioná el tercero.' }
    }
  } else {
    return { error: `forma_cancelacion inválida: ${cleaned.forma_cancelacion}` }
  }

  return cleaned
}

// Detecta error 42703 sobre columnas snapshot servicio (P1), forma_cancelacion
// (Etapa 1) o tipo_gasto_id (TIPOS-GASTO).
function isOptionalColumnMissingError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  if (err.code !== '42703') return false
  const msg = (err.message ?? '').toLowerCase()
  return (
    msg.includes('es_servicio_horas') ||
    msg.includes('descripcion_servicio') ||
    msg.includes('periodo_servicio') ||
    msg.includes('horas_servicio') ||
    msg.includes('valor_hora_aplicado') ||
    msg.includes('porcentaje_uplift_snapshot') ||
    msg.includes('importe_base_servicio') ||
    msg.includes('forma_cancelacion') ||
    msg.includes('financiador_id') ||
    msg.includes('tipo_gasto_id')
  )
}

// Quita las columnas opcionales del payload para retry si las migraciones no se aplicaron.
function stripCamposOpcionales<T extends Record<string, unknown>>(p: T): Record<string, unknown> {
  const {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    es_servicio_horas, descripcion_servicio, periodo_servicio_desde, periodo_servicio_hasta,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    horas_servicio, valor_hora_aplicado, porcentaje_uplift_snapshot, importe_base_servicio,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    forma_cancelacion, financiador_id,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    tipo_gasto_id,
    ...rest
  } = p
  return rest
}

// G1 (2026-05-24): todos los gastos pertenecen al fondo operativo RISA.
// El selector visible se eliminó del modal; este helper resuelve el id real.
async function getRisaFondoId(
  supabase: ReturnType<typeof createClient>
): Promise<string> {
  const { data, error } = await supabase
    .from('fondos')
    .select('id')
    .eq('codigo', 'FON-001')
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`Error al buscar fondo RISA: ${error.message}`)
  if (!data) throw new Error('No se encontró el fondo operativo RISA.')
  return data.id
}

export async function createGasto(
  data: GastoPayload,
  options?: { id?: string; comprobante?: { path: string; mime: string; nombre: string; size: number } }
) {
  // Fase 2C.2a: guard server-side. USER puede crear sus propios; ownership en Fase 2D.
  const guard = await assertRole(ROLES_ESCRITURA_GASTOS)
  if (!guard.ok) throw new Error(guard.error)

  const supabase = createClient()
  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) throw new Error('No autenticado')

  const normalized = normalizeGasto(data)
  if ('error' in normalized) {
    throw new Error(normalized.error)
  }
  // G1: forzar fondo_id = RISA, ignorando lo que venga del payload.
  const risaId = await getRisaFondoId(supabase)
  const insert: Record<string, unknown> = {
    ...normalized,
    fondo_id: risaId,
    proveedor_id: normalized.proveedor_id || null,
    estado: 'enviado',  // alta directa a pendiente de aprobación (sin paso por borrador)
    created_by: user.id,
  }
  if (options?.id) {
    insert.id = options.id
  }
  if (options?.comprobante) {
    insert.comprobante_path = options.comprobante.path
    insert.comprobante_nombre = options.comprobante.nombre
    insert.comprobante_mime = options.comprobante.mime
    insert.comprobante_size_bytes = options.comprobante.size
    insert.comprobante_uploaded_by = user.id
    insert.comprobante_subido_en = new Date().toISOString()
  }

  const { error } = await supabase.from('gastos').insert(insert)
  if (!error) {
    revalidatePath('/gastos')
    return
  }

  // Retry sin columnas opcionales (snapshot servicio P1 o forma_cancelacion/financiador_id de Etapa 1).
  if (isOptionalColumnMissingError(error)) {
    console.warn('[createGasto] columnas opcionales no disponibles, reintentando sin ellas')
    const retry = await supabase.from('gastos').insert(stripCamposOpcionales(insert))
    if (retry.error) throw new Error(retry.error.message)
    revalidatePath('/gastos')
    return
  }

  throw new Error(error.message)
}

// GASTOS-UX: cuenta pagos del gasto, distinguiendo "activos" (no anulados)
// de "total" (cualquier estado, incluso anulados). Usado para decidir si un
// gasto puede editarse, cambiar de estado o eliminarse físicamente.
async function getPagosCount(
  supabase: ReturnType<typeof createClient>,
  gastoId: string,
): Promise<{ activos: number; total: number }> {
  const [activos, total] = await Promise.all([
    supabase.from('pagos').select('id', { count: 'exact', head: true })
      .eq('gasto_id', gastoId).neq('estado', 'anulado'),
    supabase.from('pagos').select('id', { count: 'exact', head: true })
      .eq('gasto_id', gastoId),
  ])
  return { activos: activos.count ?? 0, total: total.count ?? 0 }
}

export async function updateGasto(id: string, data: GastoPayload) {
  // Fase 2C.2a: guard server-side. Ownership USER va en Fase 2D.
  const guard = await assertRole(ROLES_ESCRITURA_GASTOS)
  if (!guard.ok) throw new Error(guard.error)

  const supabase = createClient()
  const normalized = normalizeGasto(data)
  if ('error' in normalized) {
    throw new Error(normalized.error)
  }

  // GASTOS-UX: permitir editar también gastos aprobados, pero SOLO si no
  // tienen pagos activos (borrador o pagado). Los pagos anulados no cuentan.
  const { activos } = await getPagosCount(supabase, id)
  if (activos > 0) {
    throw new Error('Este gasto tiene pagos activos. Anulalos antes de editar.')
  }

  // G1: el fondo no es editable desde UI. Removemos del payload para conservar
  // el fondo_id existente del gasto.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { fondo_id: _ignoredFondoId, ...rest } = normalized
  const update: Record<string, unknown> = {
    ...rest,
    proveedor_id: normalized.proveedor_id || null,
  }

  const result = await supabase
    .from('gastos')
    .update(update)
    .eq('id', id)
    .in('estado', ['borrador', 'enviado', 'aprobado'])
    .is('deleted_at', null)
    .select('id')

  if (!result.error) {
    if (!result.data || result.data.length === 0)
      throw new Error('Sin permiso para editar este gasto o ya fue pagado/rechazado.')
    revalidatePath('/gastos')
    return
  }

  if (isOptionalColumnMissingError(result.error)) {
    console.warn('[updateGasto] columnas opcionales no disponibles, reintentando sin ellas')
    const retry = await supabase
      .from('gastos')
      .update(stripCamposOpcionales(update))
      .eq('id', id)
      .in('estado', ['borrador', 'enviado', 'aprobado'])
      .is('deleted_at', null)
      .select('id')
    if (retry.error) throw new Error(retry.error.message)
    if (!retry.data || retry.data.length === 0)
      throw new Error('Sin permiso para editar este gasto o ya fue pagado/rechazado.')
    revalidatePath('/gastos')
    return
  }

  throw new Error(result.error.message)
}

export async function deleteGasto(id: string) {
  // Fase 2C.2a: solo admin (+ contador legacy). Lógica interna ya bloquea
  // si el gasto tiene pagos asociados.
  const guard = await assertRole(ROLES_DELETE_GASTOS)
  if (!guard.ok) throw new Error(guard.error)

  const supabase = createClient()

  // GASTOS-UX: bloquear si el gasto tiene cualquier pago asociado (vivo o anulado),
  // para no dejar pagos huérfanos apuntando a un gasto borrado.
  const { total } = await getPagosCount(supabase, id)
  if (total > 0) {
    throw new Error(`Este gasto tiene ${total} pago${total !== 1 ? 's' : ''} asociado${total !== 1 ? 's' : ''}. Anulalos primero.`)
  }

  const result = await supabase
    .from('gastos')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')

  if (result.error) throw new Error(result.error.message)
  if (!result.data || result.data.length === 0)
    throw new Error('Sin permiso para eliminar este gasto.')
  revalidatePath('/gastos')
}

// ─── Gastos recurrentes ───────────────────────────────────────────────────────

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

export type RecurrenteActionResult = { ok: true } | { ok: false; error: string }

export async function createGastoRecurrente(data: GastoRecurrentePayload): Promise<RecurrenteActionResult> {
  try {
    // Fase 2C.2a: recurrentes = configuración. Solo admin + supervisor (+ revisor legacy).
    const guard = await assertRole(ROLES_RECURRENTES)
    if (!guard.ok) return guard

    const supabase = createClient()
    const authResult = await supabase.auth.getUser()
    const user = authResult.data?.user
    if (!user) return { ok: false, error: 'No autenticado' }

    // G1: el recurrente también opera siempre contra RISA.
    const risaId = await getRisaFondoId(supabase).catch(err => ({ error: err.message }))
    if (typeof risaId === 'object') {
      return { ok: false, error: risaId.error }
    }

    const insertPayload = {
      ...data,
      fondo_id: risaId,
      proveedor_id: data.proveedor_id || null,
      created_by: user.id,
    }
    console.error('[createGastoRecurrente] payload:', JSON.stringify(insertPayload))

    const { error } = await supabase.from('gastos_recurrentes').insert(insertPayload)
    if (error) {
      console.error('[createGastoRecurrente] supabase error:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      })
      return { ok: false, error: `${error.message}${error.details ? ' — ' + error.details : ''}${error.hint ? ' (' + error.hint + ')' : ''}` }
    }

    revalidatePath('/gastos')
    return { ok: true }
  } catch (err) {
    console.error('[createGastoRecurrente] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

export async function updateGastoRecurrente(id: string, data: GastoRecurrentePayload): Promise<RecurrenteActionResult> {
  try {
    // Fase 2C.2a: solo admin + supervisor (+ revisor legacy).
    const guard = await assertRole(ROLES_RECURRENTES)
    if (!guard.ok) return guard

    const supabase = createClient()
    // G1: el fondo no es editable. Quitar del update para conservar el existente.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { fondo_id: _ignoredFondoId, ...rest } = data
    const updatePayload = { ...rest, proveedor_id: data.proveedor_id || null }
    console.error('[updateGastoRecurrente] id:', id, 'payload:', JSON.stringify(updatePayload))

    const { data: rows, error } = await supabase
      .from('gastos_recurrentes')
      .update(updatePayload)
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
    if (error) {
      console.error('[updateGastoRecurrente] supabase error:', {
        code: error.code, message: error.message, details: error.details, hint: error.hint,
      })
      return { ok: false, error: `${error.message}${error.details ? ' — ' + error.details : ''}${error.hint ? ' (' + error.hint + ')' : ''}` }
    }
    if (!rows || rows.length === 0) {
      return { ok: false, error: 'Sin permiso para editar este gasto recurrente.' }
    }

    revalidatePath('/gastos')
    return { ok: true }
  } catch (err) {
    console.error('[updateGastoRecurrente] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

export async function deleteGastoRecurrente(id: string): Promise<RecurrenteActionResult> {
  try {
    // Fase 2C.2a: solo admin + supervisor (+ revisor legacy).
    const guard = await assertRole(ROLES_RECURRENTES)
    if (!guard.ok) return guard

    const supabase = createClient()
    const { data: rows, error } = await supabase
      .from('gastos_recurrentes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
    if (error) {
      console.error('[deleteGastoRecurrente] supabase error:', {
        code: error.code, message: error.message, details: error.details, hint: error.hint,
      })
      return { ok: false, error: error.message }
    }
    if (!rows || rows.length === 0) {
      return { ok: false, error: 'Sin permiso para eliminar este gasto recurrente.' }
    }
    revalidatePath('/gastos')
    return { ok: true }
  } catch (err) {
    console.error('[deleteGastoRecurrente] unhandled:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

// Genera gastos pendientes desde recurrentes activos hasta el mes actual.
// Idempotente vía UNIQUE INDEX (recurrente_id, periodo).
// Se invoca desde /gastos page.tsx al cargar el módulo (dev).
// En producción se puede mover a pg_cron diario sin cambios.
export async function generarGastosRecurrentes(): Promise<{ created: number; error: string | null }> {
  // Fase 2C.2a: SIN guard de role. Esta función se invoca automáticamente al
  // cargar /gastos (todos los roles autenticados). Es idempotente vía UNIQUE
  // INDEX (recurrente_id, periodo), por lo que no representa riesgo. Si más
  // adelante se decide restringir, agregar assertRole acá.
  try {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('fn_generar_gastos_recurrentes')
    if (error) {
      console.error('[generarGastosRecurrentes] rpc error:', error.message)
      return { created: 0, error: error.message }
    }
    return { created: (data as number) ?? 0, error: null }
  } catch (err) {
    console.error('[generarGastosRecurrentes] unhandled:', err)
    return { created: 0, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

export async function cambiarEstadoGasto(
  id: string,
  nuevoEstado: 'enviado' | 'aprobado' | 'rechazado'
) {
  // Fase 2C.2a: aprobar/rechazar/cancelar requiere admin o supervisor
  // (+ revisor, contador legacy).
  const guard = await assertRole(ROLES_APROBAR_GASTOS)
  if (!guard.ok) throw new Error(guard.error)

  const supabase = createClient()

  // GASTOS-UX: salir de 'aprobado' (volver a pendiente o rechazar) requiere
  // que no haya pagos activos. Aprobar/enviar desde otros estados no necesita
  // este guard (no debería ocurrir, pero igual no es destructivo).
  if (nuevoEstado === 'enviado' || nuevoEstado === 'rechazado') {
    const { activos } = await getPagosCount(supabase, id)
    if (activos > 0) {
      throw new Error('Este gasto tiene pagos activos. Anulalos primero.')
    }
  }

  const result = await supabase
    .from('gastos')
    .update({ estado: nuevoEstado })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
  if (result.error) throw new Error(result.error.message)
  if (!result.data || result.data.length === 0)
    throw new Error('Sin permiso para cambiar el estado de este gasto.')
  revalidatePath('/gastos')
  revalidatePath('/pagos')
}

// ─── Bulk actions sobre gastos seleccionados ─────────────────────────────────

export type BulkGastoResult = {
  procesados: string[]
  errores: { id: string; descripcion?: string; error: string }[]
}

// Cambia estado a 'aprobado' solo para gastos en 'borrador'/'enviado'.
// Los que ya están aprobados/pagados/rechazados se omiten con error explicativo.
export async function bulkAprobarGastos(ids: string[]): Promise<BulkGastoResult> {
  // Fase 2C.2a: aprobación = admin/supervisor (+ revisor, contador legacy).
  // Si el guard falla, rechazar todos los ids con el mismo error.
  const guard = await assertRole(ROLES_APROBAR_GASTOS)
  if (!guard.ok) {
    return { procesados: [], errores: ids.map(id => ({ id, error: guard.error })) }
  }

  const supabase = createClient()
  const procesados: string[] = []
  const errores: BulkGastoResult['errores'] = []

  for (const id of ids) {
    const { data: rows, error } = await supabase
      .from('gastos')
      .update({ estado: 'aprobado' })
      .eq('id', id)
      .in('estado', ['borrador', 'enviado'])
      .is('deleted_at', null)
      .select('id, descripcion')
    if (error) {
      errores.push({ id, error: error.message })
    } else if (!rows || rows.length === 0) {
      // Buscar la descripción para el mensaje
      const { data: g } = await supabase
        .from('gastos').select('descripcion, estado').eq('id', id).maybeSingle()
      errores.push({
        id,
        descripcion: g?.descripcion,
        error: g ? `Estado actual "${g.estado}" no permite aprobar.` : 'No encontrado.',
      })
    } else {
      procesados.push(id)
    }
  }
  if (procesados.length > 0) {
    revalidatePath('/gastos')
    revalidatePath('/pagos')
  }
  return { procesados, errores }
}

// Cancela (= rechaza) gastos. Bloquea si tienen pagos activos (no anulados);
// el resultado parcial vuelve con los errores explicativos por gasto.
export async function bulkRechazarGastos(ids: string[]): Promise<BulkGastoResult> {
  // Fase 2C.2a: cancelación = admin/supervisor (+ revisor, contador legacy).
  const guard = await assertRole(ROLES_APROBAR_GASTOS)
  if (!guard.ok) {
    return { procesados: [], errores: ids.map(id => ({ id, error: guard.error })) }
  }

  const supabase = createClient()
  const procesados: string[] = []
  const errores: BulkGastoResult['errores'] = []

  for (const id of ids) {
    // GASTOS-UX: si tiene pagos activos, no cancelar. Hay que anular primero.
    const { activos } = await getPagosCount(supabase, id)
    if (activos > 0) {
      const { data: g } = await supabase
        .from('gastos').select('descripcion').eq('id', id).maybeSingle()
      errores.push({
        id,
        descripcion: g?.descripcion,
        error: `Tiene ${activos} pago${activos !== 1 ? 's' : ''} activo${activos !== 1 ? 's' : ''}. Anulalos primero.`,
      })
      continue
    }

    const { data: rows, error } = await supabase
      .from('gastos')
      .update({ estado: 'rechazado' })
      .eq('id', id)
      .in('estado', ['borrador', 'enviado', 'aprobado'])
      .is('deleted_at', null)
      .select('id')
    if (error) {
      errores.push({ id, error: error.message })
    } else if (!rows || rows.length === 0) {
      const { data: g } = await supabase
        .from('gastos').select('descripcion, estado').eq('id', id).maybeSingle()
      errores.push({
        id,
        descripcion: g?.descripcion,
        error: g
          ? `No se puede cancelar un gasto en estado "${g.estado}".`
          : 'No encontrado.',
      })
    } else {
      procesados.push(id)
    }
  }
  if (procesados.length > 0) {
    revalidatePath('/gastos')
    revalidatePath('/pagos')
  }
  return { procesados, errores }
}

// Soft-delete. Bloquea si el gasto tiene CUALQUIER pago asociado (cualquier estado),
// para evitar dejar pagos huérfanos apuntando a un gasto borrado.
export async function bulkDeleteGastos(ids: string[]): Promise<BulkGastoResult> {
  // Fase 2C.2a: borrado masivo solo admin (+ contador legacy).
  const guard = await assertRole(ROLES_DELETE_GASTOS)
  if (!guard.ok) {
    return { procesados: [], errores: ids.map(id => ({ id, error: guard.error })) }
  }

  const supabase = createClient()
  const procesados: string[] = []
  const errores: BulkGastoResult['errores'] = []

  for (const id of ids) {
    const { count, error: countErr } = await supabase
      .from('pagos')
      .select('id', { count: 'exact', head: true })
      .eq('gasto_id', id)
    if (countErr) {
      errores.push({ id, error: countErr.message })
      continue
    }
    if ((count ?? 0) > 0) {
      const { data: g } = await supabase
        .from('gastos').select('descripcion').eq('id', id).maybeSingle()
      errores.push({
        id,
        descripcion: g?.descripcion,
        error: `Tiene ${count} pago${count !== 1 ? 's' : ''} asociado${count !== 1 ? 's' : ''}. Anulalos primero.`,
      })
      continue
    }

    const { data: rows, error } = await supabase
      .from('gastos')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
    if (error) {
      errores.push({ id, error: error.message })
    } else if (!rows || rows.length === 0) {
      errores.push({ id, error: 'Sin permiso o gasto no encontrado.' })
    } else {
      procesados.push(id)
    }
  }
  if (procesados.length > 0) revalidatePath('/gastos')
  return { procesados, errores }
}

// ─── Comprobantes ─────────────────────────────────────────────────────────────

export type ComprobantePayload = {
  path: string
  mime: string
  nombre: string
  size: number
}

export async function setComprobanteGasto(id: string, data: ComprobantePayload) {
  // Fase 2C.2a: comprobante = operativa amplia (incluye USER para propios).
  // Ownership USER va en Fase 2D.
  const guard = await assertRole(ROLES_ESCRITURA_GASTOS)
  if (!guard.ok) throw new Error(guard.error)

  const supabase = createClient()
  const authResult = await supabase.auth.getUser()
  const user = authResult.data?.user
  if (!user) throw new Error('No autenticado')

  const { data: rows, error } = await supabase
    .from('gastos')
    .update({
      comprobante_path: data.path,
      comprobante_nombre: data.nombre,
      comprobante_mime: data.mime,
      comprobante_size_bytes: data.size,
      comprobante_uploaded_by: user.id,
      comprobante_subido_en: new Date().toISOString(),
    })
    .eq('id', id)
    .in('estado', ['borrador', 'enviado', 'aprobado', 'pagado_parcial'])
    .is('deleted_at', null)
    .select('id')
  if (error) throw new Error(error.message)
  if (!rows || rows.length === 0)
    throw new Error('Sin permiso o el gasto ya está cerrado (pagado/rechazado).')
  revalidatePath('/gastos')
}

export async function removeComprobanteGasto(id: string) {
  // Fase 2C.2a: comprobante = operativa amplia. Ownership USER va en Fase 2D.
  const guard = await assertRole(ROLES_ESCRITURA_GASTOS)
  if (!guard.ok) throw new Error(guard.error)

  const supabase = createClient()

  const { data: gasto, error: fetchErr } = await supabase
    .from('gastos')
    .select('comprobante_path')
    .eq('id', id)
    .in('estado', ['borrador', 'enviado', 'aprobado', 'pagado_parcial'])
    .is('deleted_at', null)
    .maybeSingle()
  if (fetchErr) throw new Error(fetchErr.message)
  if (!gasto) throw new Error('Gasto ya cerrado (pagado/rechazado) o no existe.')
  if (!gasto.comprobante_path) throw new Error('Este gasto no tiene comprobante.')

  const { error: rmErr } = await supabase.storage
    .from('comprobantes')
    .remove([gasto.comprobante_path])
  if (rmErr) console.error('[removeComprobanteGasto] storage warning:', rmErr.message)

  const { data: rows, error: updErr } = await supabase
    .from('gastos')
    .update({
      comprobante_path: null,
      comprobante_nombre: null,
      comprobante_mime: null,
      comprobante_size_bytes: null,
      comprobante_uploaded_by: null,
      comprobante_subido_en: null,
    })
    .eq('id', id)
    .in('estado', ['borrador', 'enviado', 'aprobado', 'pagado_parcial'])
    .is('deleted_at', null)
    .select('id')
  if (updErr) throw new Error(updErr.message)
  if (!rows || rows.length === 0)
    throw new Error('Sin permiso para limpiar comprobante.')
  revalidatePath('/gastos')
}

// ─── TIPOS-GASTO (2026-05-25) ─────────────────────────────────────────────────

export type TipoGastoQuickPayload = {
  codigo: string                 // ya viene trim + upper desde la UI
  nombre: string                 // ya viene trim desde la UI
  descripcion: string | null
}

export type TipoGastoQuickResult =
  | { ok: true; id: string; codigo: string; nombre: string }
  | { ok: false; error: string }

export async function crearTipoGasto(data: TipoGastoQuickPayload): Promise<TipoGastoQuickResult> {
  try {
    // Fase 2C.2a: tipos de gasto = configuración. Admin/supervisor + legacy.
    const guard = await assertRole(ROLES_CONFIG_GASTOS)
    if (!guard.ok) return guard

    const supabase = createClient()
    const authResult = await supabase.auth.getUser()
    const user = authResult.data?.user
    if (!user) return { ok: false, error: 'No autenticado.' }

    const codigo = data.codigo.trim().toUpperCase()
    const nombre = data.nombre.trim()
    const descripcion = data.descripcion?.trim() || null

    // Validaciones inline (la UI ya valida; defensa adicional aquí).
    if (!codigo) return { ok: false, error: 'El código es requerido.' }
    if (!nombre) return { ok: false, error: 'El nombre es requerido.' }
    if (codigo.length < 2 || codigo.length > 12) {
      return { ok: false, error: 'El código debe tener entre 2 y 12 caracteres.' }
    }
    if (/\s/.test(codigo)) return { ok: false, error: 'El código no puede tener espacios.' }

    const { data: row, error } = await supabase
      .from('tipos_gasto')
      .insert({ codigo, nombre, descripcion, created_by: user.id })
      .select('id, codigo, nombre')
      .single()

    if (error) {
      // 23505 = unique violation (codigo duplicado).
      if (error.code === '23505') {
        return { ok: false, error: `Ya existe un tipo de gasto con código "${codigo}".` }
      }
      // 42P01 = tabla no existe (migración no aplicada).
      if (error.code === '42P01') {
        return { ok: false, error: 'La tabla tipos_gasto no está disponible. Aplicá la migración TIPOS-GASTO primero.' }
      }
      return { ok: false, error: error.message }
    }
    if (!row) return { ok: false, error: 'Insert sin retorno.' }

    revalidatePath('/gastos')
    revalidatePath('/gastos-recurrentes')
    return { ok: true, id: row.id, codigo: row.codigo, nombre: row.nombre }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido.' }
  }
}
