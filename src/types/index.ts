export type { UserRole, FondoEstado, GastoEstado, Profile, Fondo, Proveedor, Gasto, SessionUser } from './database'

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  contador: 'Contador',
  revisor: 'Revisor',
  visualizador: 'Visualizador',
}

export interface NavItem {
  label: string
  href: string
}
