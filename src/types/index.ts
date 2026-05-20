export type { UserRole, FondoEstado, GastoEstado, AnticipoEstado, PagoEstado, PagoTipo, MovimientoTipo, TipoAporte, Profile, Fondo, Proveedor, Gasto, Anticipo, Pago, MovimientoFondo, AporteFondo, SessionUser, GastoRecurrente, ObligacionPendiente, ObligacionTipo } from './database'

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
