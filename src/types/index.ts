export type {
  UserRole, FondoEstado, GastoEstado, AnticipoEstado, PagoEstado, PagoTipo,
  MovimientoTipo, TipoAporte, Profile, Fondo, Proveedor, Gasto, Anticipo, Pago,
  MovimientoFondo, AporteFondo, SessionUser, GastoRecurrente,
  ObligacionPendiente, ObligacionTipo, GoogleAllowedUser,
  // Etapa 1: nuevo modelo financiero
  Socio, Financiador, MovimientoFinanciacion, SaldoFinanciadorRow,
  DestinoAporte, TipoMovimientoFinanciacion,
  // P3a-fc: forma de cancelación del gasto
  FormaCancelacion,
} from './database'

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  contador: 'Supervisor',
  revisor: 'Supervisor',
  visualizador: 'Usuario',
}

export interface NavItem {
  label: string
  href: string
}
