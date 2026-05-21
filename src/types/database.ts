export type UserRole = 'admin' | 'contador' | 'revisor' | 'visualizador'
export type FondoEstado = 'activo' | 'cerrado' | 'suspendido'
export type GastoEstado = 'borrador' | 'enviado' | 'aprobado' | 'pagado' | 'rechazado'
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
  nombre: string
  descripcion: string | null
  monto_inicial: number
  saldo_actual: number
  moneda: string
  estado: FondoEstado
  responsable_id: string | null
  created_by: string
  created_at: string
  updated_at: string
  deleted_at: string | null
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
  created_by: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Gasto {
  id: string
  fondo_id: string
  proveedor_id: string | null
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

export type ObligacionTipo = 'gasto_total' | 'anticipo' | 'saldo_anticipo' | 'recurrente'

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
  fondo_id: string
  movimiento_id: string | null
  fecha_aporte: string
  monto: number
  moneda: string
  tipo_aporte: TipoAporte
  aportante: string | null
  concepto: string
  comprobante_url: string | null
  observaciones: string | null
  created_by: string
  created_at: string
  updated_at: string
  deleted_at: string | null
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
