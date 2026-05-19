export type UserRole = 'admin' | 'contador' | 'revisor' | 'visualizador'
export type FondoEstado = 'activo' | 'cerrado' | 'suspendido'
export type GastoEstado = 'borrador' | 'enviado' | 'aprobado' | 'pagado' | 'rechazado'
export type AnticipoEstado = 'borrador' | 'comprometido' | 'parcialmente_pagado' | 'pagado' | 'cancelado'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  activo: boolean
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
export type PagoTipo   = 'gasto' | 'anticipo' | 'saldo_anticipo' | 'directo'

export interface Pago {
  id: string
  fondo_id: string
  proveedor_id: string
  gasto_id: string | null
  anticipo_id: string | null
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
