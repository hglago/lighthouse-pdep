import type { UserRole } from '@/types'

// Permisos por rol — estructura preparada para la integración con Supabase RLS.
// Fase 2A (2026-05-25): tipo cambiado a Partial<> porque los roles nuevos
// (supervisor / operador / user) todavía no tienen permisos asignados acá.
// Se completan en Fase 2C cuando se introduzcan los guards server-side.
// Sin permisos definidos → hasPermission devuelve false (default seguro).
export const ROLE_PERMISSIONS: Partial<Record<UserRole, string[]>> = {
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
  const perms = ROLE_PERMISSIONS[role] ?? []
  return perms.includes('*') || perms.includes(permission)
}
