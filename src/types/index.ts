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
  // FIN2.2: detalle de imputaciones del aporte (split MP + Terceros)
  AporteImputacion, DestinoImputacion,
  // FIN2.7: imputación con joins resueltos para detalle inline en /fondos
  AporteImputacionDetalleRow,
  // FIN2.6: vista única de Posición Global RISA multi-moneda
  PosicionGlobalRisaRow, PosicionGlobalDetalleFondo, PosicionGlobalDetalleTercero,
  // TIPOS-GASTO (2026-05-25): clasificación analítica de gastos
  TipoGasto,
  // OP (2026-05-25): Orden de Pago — snapshot al confirmar
  OrdenPago, OrdenPagoEstado, OrdenPagoModalidad, OrdenPagoCanal,
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
