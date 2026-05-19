import type { UserRole } from '@/types'

// Permisos por rol — estructura preparada para la integración con Supabase RLS
export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  admin: ['*'],
  contador: [
    'fondos:read',
    'gastos:write',
    'pagos:write',
    'anticipos:write',
    'proveedores:write',
    'honorarios:write',
    'rendiciones:write',
  ],
  revisor: [
    'fondos:read',
    'gastos:read',
    'pagos:read',
    'anticipos:read',
    'rendiciones:read',
    'rendiciones:approve',
  ],
  visualizador: [
    'fondos:read',
    'gastos:read',
    'pagos:read',
    'anticipos:read',
    'proveedores:read',
    'honorarios:read',
    'rendiciones:read',
  ],
}

export function hasPermission(role: UserRole, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role]
  return perms.includes('*') || perms.includes(permission)
}
