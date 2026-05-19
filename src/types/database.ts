export type UserRole = 'admin' | 'contador' | 'revisor' | 'visualizador'
export type FondoEstado = 'activo' | 'cerrado' | 'suspendido'
export type GastoEstado = 'borrador' | 'enviado' | 'aprobado' | 'pagado' | 'rechazado'

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

export interface SessionUser {
  id: string
  email: string
  full_name: string | null
  role: UserRole
}
