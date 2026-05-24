export type UserRole = 'admin' | 'contador' | 'revisor' | 'visualizador'
export type FondoEstado = 'activo' | 'cerrado' | 'suspendido'
export type GastoEstado = 'borrador' | 'enviado' | 'aprobado' | 'pagado_parcial' | 'pagado' | 'rechazado'
export type AnticipoEstado = 'borrador' | 'aprobado' | 'anticipo_pagado' | 'completado' | 'cancelado'

export interface Profile {
  id: string
  email: string
  usuario_login: string | null
  full_name: string | null
  role: UserRole
  activo: boolean
  puede_exportar: boolean
  puede_aprobar_gastos: boolean
  puede_confirmar_pagos: boolean
  fondo_default_id: string | null
  notas_admin: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Fondo {
  id: string
  codigo: string | null  // FON-### (Etapa 1). Null si la migración no se aplicó.
  nombre: string
  descripcion: string | null
  monto_inicial: number
  saldo_actual: number  // puede ser negativo (constraint fondos_saldo_no_negativo eliminada en Etapa 1)
  moneda: string
  estado: FondoEstado
  responsable_id: string | null
  created_by: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  deleted_by: string | null   // Etapa 1
  motivo_baja: string | null  // Etapa 1
}

export interface Proveedor {
  id: string
  nombre: string
  cuit: string | null
  email: string | null
  telefono: string | null
  direccion: string | null
  observaciones: string | null
  activo: boolean
  tiene_uplift: boolean
  porcentaje_uplift: number
  // P1 (2026-05-23): proveedor con horas de servicio.
  // false = proveedor común; true = factura por horas, ver D22/D23.
  permite_horas_servicio: boolean
  valor_hora: number
  created_by: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

// P3a-fc (2026-05-23): cómo se cancela el gasto.
// 'risa' = sale del saldo de RISA (default).
// 'financiador' = lo paga un financiador externo, queda pendiente de reintegro.
// Genera deuda/movimientos solo cuando se carga el Pago — no acá.
export type FormaCancelacion = 'risa' | 'financiador'

export interface Gasto {
  id: string
  codigo: string | null  // G000001, G000002... generado por trigger DB. Null hasta aplicar migración.
  fondo_id: string
  proveedor_id: string | null
  // P3a-fc: forma de cancelación + financiador (FK opcional).
  // CHECK en DB: si forma='risa' → financiador_id IS NULL; si forma='financiador' → financiador_id IS NOT NULL.
  forma_cancelacion: FormaCancelacion
  financiador_id: string | null
  descripcion: string
  monto: number
  moneda: string
  estado: GastoEstado
  fecha_gasto: string
  comprobante_url: string | null
  notas: string | null
  tiene_anticipo: boolean
  monto_anticipo: number | null
  porcentaje_anticipo: number | null
  fecha_prevista_pago_anticipo: string | null
  fecha_comprometida_pago_saldo: string | null
  condiciones_pago_notas: string | null
  fecha_vencimiento: string | null
  prioridad_pago: number
  // P1/P3a (2026-05-23): snapshot de servicio por hora. NULL en gastos comunes.
  // Coherencia exigida por CHECK gastos_servicio_horas_coherente (ver DB.md).
  // D22: porcentaje_uplift_snapshot es informativo, no modifica monto/pago/fondo.
  es_servicio_horas: boolean
  descripcion_servicio: string | null
  periodo_servicio_desde: string | null
  periodo_servicio_hasta: string | null
  horas_servicio: number | null
  valor_hora_aplicado: number | null
  porcentaje_uplift_snapshot: number
  importe_base_servicio: number | null
  created_by: string
  aprobado_por: string | null
  aprobado_en: string | null
  rechazado_por: string | null
  rechazado_en: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Anticipo {
  id: string
  proveedor_id: string
  fondo_id: string
  concepto: string
  monto_total: number
  porcentaje_anticipo: number
  monto_anticipo: number
  monto_saldo: number
  moneda: string
  fecha_acuerdo: string
  fecha_vencimiento_saldo: string | null
  estado: AnticipoEstado
  observaciones: string | null
  created_by: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type PagoEstado = 'borrador' | 'pagado' | 'anulado'
export type PagoTipo   = 'gasto' | 'anticipo' | 'saldo_anticipo' | 'recurrente' | 'directo'

export interface Pago {
  id: string
  codigo: string | null  // P000001, P000002... generado por trigger DB. Null hasta aplicar migración.
  nro_pago: string
  fondo_id: string
  proveedor_id: string
  gasto_id: string | null
  anticipo_id: string | null
  gasto_recurrente_id: string | null
  tipo: PagoTipo
  concepto: string
  monto: number
  moneda: string
  fecha_pago: string
  comprobante_url: string | null
  estado: PagoEstado
  notas: string | null
  created_by: string
  anulado_por: string | null
  anulado_en: string | null
  created_at: string
  updated_at: string
}

// Cuenta corriente entre fondos
export type MovimientoEntreFondosTipo = 'deuda_generada' | 'cancelacion' | 'ajuste'
export type MovimientoEntreFondosEstado = 'pendiente' | 'parcial' | 'cancelado'

export interface MovimientoEntreFondos {
  id: string
  fecha: string
  fondo_acreedor_id: string
  fondo_deudor_id: string
  pago_origen_id: string | null
  tipo_movimiento: MovimientoEntreFondosTipo
  importe: number
  moneda: string
  descripcion: string | null
  estado: MovimientoEntreFondosEstado
  created_at: string
  created_by: string | null
}

// Fila agregada de v_cuenta_corriente_fondos
export interface CuentaCorrienteFondoRow {
  fondo_deudor_id: string
  fondo_deudor_nombre: string
  fondo_acreedor_id: string
  fondo_acreedor_nombre: string
  moneda: string
  total_deuda_generada: number
  total_cancelado: number
  total_ajustes: number
  saldo_pendiente: number
}

export interface GastoRecurrente {
  id: string
  fondo_id: string
  proveedor_id: string | null
  concepto: string
  categoria: string | null
  monto: number
  moneda: string
  dia_vencimiento: number
  fecha_inicio: string
  fecha_fin: string | null
  activo: boolean
  prioridad_pago: number
  observaciones: string | null
  created_by: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

// Valores devueltos por v_obligaciones_pendientes en columna tipo_obligacion.
// Antes incluía 'saldo_anticipo' — renombrado a 'saldo' para alinear con UI "Pagar saldo".
// El enum PagoTipo de la tabla pagos sigue teniendo 'saldo_anticipo' (sin migrar).
export type ObligacionTipo = 'gasto_total' | 'anticipo' | 'saldo' | 'recurrente'

export interface ObligacionPendiente {
  obligacion_id: string
  tipo_obligacion: ObligacionTipo
  gasto_id: string | null
  gasto_recurrente_id: string | null
  fondo_id: string
  proveedor_id: string | null
  concepto: string
  monto_pendiente: number
  moneda: string
  fecha_vencimiento: string | null
  prioridad_pago: number
  fecha_gasto: string | null
  fondo_nombre: string
  fondo_saldo_actual: number
  proveedor_nombre: string | null
}

export type TipoAporte =
  | 'aporte_socios'
  | 'transferencia'
  | 'ajuste'
  | 'reintegro'
  | 'otro'

export interface AporteFondo {
  id: string
  codigo: string | null            // APO-### (Etapa 1)
  fondo_id: string
  movimiento_id: string | null
  fecha_aporte: string
  monto: number
  moneda: string
  tipo_aporte: TipoAporte
  aportante: string | null         // legacy: nombre libre
  socio_id: string | null          // Etapa 1 (FK nueva, principal)
  destino_aporte: DestinoAporte    // Etapa 1: 'risa' | 'cancelacion_financiacion'
  financiador_id: string | null    // Etapa 1: required cuando destino = 'cancelacion_financiacion'
  concepto: string
  comprobante_url: string | null
  observaciones: string | null
  created_by: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

// ── Etapa 1: Socios, Financiadores, Movimientos de financiación ───────────────

export interface Socio {
  id: string
  codigo: string | null  // SOC-### (Etapa 2B). Null si la migración no se aplicó.
  nombre: string
  cuit: string | null
  email: string | null
  telefono: string | null
  observaciones: string | null
  deleted_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Financiador {
  id: string
  codigo: string | null  // FIN-### (Etapa 1)
  nombre: string
  cuit: string | null
  email: string | null
  telefono: string | null
  observaciones: string | null
  deleted_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type DestinoAporte = 'risa' | 'cancelacion_financiacion'

export type TipoMovimientoFinanciacion =
  | 'deuda_generada'
  | 'cancelacion_por_aporte'
  | 'ajuste'
  | 'reversa'

export interface MovimientoFinanciacion {
  id: string
  fecha: string
  financiador_id: string
  tipo_movimiento: TipoMovimientoFinanciacion
  importe: number
  moneda: string
  gasto_id: string | null
  pago_id: string | null
  aporte_id: string | null
  socio_id: string | null
  descripcion: string | null
  created_by: string | null
  created_at: string
}

// Fila agregada de v_saldos_financiadores (Etapa 1)
export interface SaldoFinanciadorRow {
  financiador_id: string
  financiador_codigo: string | null
  financiador_nombre: string
  financiador_deleted_at: string | null
  moneda: string
  total_deuda_generada: number
  total_cancelado: number
  total_ajustes: number
  total_reversas: number
  saldo_pendiente: number
}

export interface GoogleAllowedUser {
  id: string
  email: string
  activo: boolean
  role: UserRole
  usuario_login: string | null
  full_name: string | null
  notas_admin: string | null
  created_at: string
  created_by: string | null
}

export type MovimientoTipo = 'debito' | 'credito'

export interface MovimientoFondo {
  id: string
  fondo_id: string
  pago_id: string | null
  aporte_id: string | null  // Etapa 2D: trazabilidad mov → aporte (referencia FK a aportes_fondo)
  tipo: MovimientoTipo
  monto: number
  saldo_anterior: number
  saldo_resultante: number
  concepto: string
  fecha: string
  created_by: string
  created_at: string
}

export interface SessionUser {
  id: string
  email: string
  full_name: string | null
  role: UserRole
}
