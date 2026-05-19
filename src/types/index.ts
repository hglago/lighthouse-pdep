export type UserRole = 'admin' | 'contador' | 'revisor' | 'visualizador'

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  contador: 'Contador',
  revisor: 'Revisor',
  visualizador: 'Visualizador',
}

export interface MockUser {
  id: string
  email: string
  name: string
  role: UserRole
}

export interface NavItem {
  label: string
  href: string
}
