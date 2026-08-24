// Helper compartido para exportar transacciones de pago a Excel.
// La lógica (modalidad Total/Parcial, canal RISA/Tercero, labels) es un
// PORT FIEL de la que vive inline en pagos/PagosClient.tsx (handleExportPagos +
// modalidadPorPagoId). Se extrajo acá para reusarla desde el export de /fondos
// sin duplicarla ni tocar el flujo de /pagos. Si se cambia una, mantener la otra
// en sync (idealmente migrar PagosClient a este helper en un refactor futuro).

import type { PagoTipo, PagoEstado } from '@/types'

// Modalidad inferida del histórico del gasto (UX-1, 2026-05-24):
//   total = el pago saldó exactamente el saldo pendiente al momento de pagarse.
//   parcial = el pago fue menor al saldo pendiente al momento.
//   desconocida = sin gasto vinculado o datos insuficientes.
export type Modalidad = 'total' | 'parcial' | 'anticipo' | 'desconocida'

export const TIPO_LABELS: Record<PagoTipo, string> = {
  directo: 'Directo',
  gasto: 'Gasto',
  anticipo: 'Anticipo',
  saldo_anticipo: 'Saldo',
  recurrente: 'Recurrente',
}

export const ESTADO_LABELS: Record<PagoEstado, string> = {
  borrador: 'Borrador',
  pagado: 'Pagado',
  anulado: 'Anulado',
}

export const MODALIDAD_LABELS: Record<Modalidad, string> = {
  total: 'Total',
  parcial: 'Parcial',
  anticipo: '—',
  desconocida: '—',
}

// Shape mínimo que necesita el export desde una fila de pago (subset de PagoRow).
export interface PagoExportInput {
  id: string
  nro_pago: string
  tipo: PagoTipo
  concepto: string
  monto: number
  moneda: string
  fecha_pago: string
  estado: PagoEstado
  created_at: string
  gasto_id: string | null
  proveedores: { nombre: string } | null
  gastos: {
    monto: number
    forma_cancelacion: 'risa' | 'financiador'
    financiadores: { codigo: string | null; nombre: string } | null
  } | null
}

export interface OrdenPagoLite {
  id: string
  codigo: string
  pago_id: string
}

// Port fiel de modalidadPorPagoId (PagosClient.tsx). Deriva Total/Parcial por
// keywords del concepto y, en su defecto, por el histórico acumulado por gasto.
export function computeModalidadPorPagoId(pagos: PagoExportInput[]): Map<string, Modalidad> {
  const histPorPagoId = new Map<string, Modalidad>()
  const porGasto = new Map<string, PagoExportInput[]>()
  for (const p of pagos) {
    if (p.gasto_id) {
      const arr = porGasto.get(p.gasto_id)
      if (arr) arr.push(p); else porGasto.set(p.gasto_id, [p])
    }
  }
  for (const lista of Array.from(porGasto.values())) {
    const sorted = [...lista].sort((a, b) => a.created_at.localeCompare(b.created_at))
    let pagadoPrevio = 0
    for (const p of sorted) {
      const gastoMonto = Number(p.gastos?.monto ?? 0)
      const monto = Number(p.monto)
      if (Number.isFinite(gastoMonto) && gastoMonto > 0) {
        const saldoPre = gastoMonto - pagadoPrevio
        if (saldoPre > 0) {
          if (Math.abs(monto - saldoPre) < 0.01) histPorPagoId.set(p.id, 'total')
          else if (monto < saldoPre) histPorPagoId.set(p.id, 'parcial')
        }
      }
      if (p.estado === 'pagado') pagadoPrevio += monto
    }
  }

  const map = new Map<string, Modalidad>()
  for (const p of pagos) {
    const concepto = (p.concepto ?? '').toLowerCase()
    // 'parcial' antes que 'total' porque "Pago parcial recurrente" contiene ambos.
    if (concepto.includes('parcial')) { map.set(p.id, 'parcial'); continue }
    if (
      concepto.includes('saldo final') ||
      concepto.includes('pago total') ||
      concepto.includes('pago recurrente')
    ) { map.set(p.id, 'total'); continue }
    const hist = histPorPagoId.get(p.id)
    if (hist) { map.set(p.id, hist); continue }
    map.set(p.id, 'desconocida')
  }
  return map
}

function canalPagoDePago(p: PagoExportInput): string {
  const f = p.gastos?.forma_cancelacion ?? null
  if (f === 'financiador') return 'Tercero de la red'
  // G1: todo pasa por RISA; default RISA cuando no hay gasto vinculado.
  return 'Medios propios RISA'
}

function terceroDePago(p: PagoExportInput): string {
  return p.gastos?.financiadores
    ? `${p.gastos.financiadores.codigo ?? ''} ${p.gastos.financiadores.nombre}`.trim()
    : ''
}

// Arma las filas de transacciones (solo pagos registrados: pagado + anulado).
// Excluye borradores por las dudas, aunque el SELECT ya los filtra.
// Columnas: nro_pago, nro_op, proveedor, tipo, concepto, canal, tercero, fecha,
// pago (modalidad Total/Parcial/—), monto, moneda, estado.
// Devuelve Record<string, unknown>[] para encajar con WorkbookSheet.rows.
export function buildPagoTransaccionRows(
  pagos: PagoExportInput[],
  ordenesPago: OrdenPagoLite[],
): Record<string, unknown>[] {
  const opPorPagoId = new Map<string, OrdenPagoLite>()
  for (const op of ordenesPago) opPorPagoId.set(op.pago_id, op)
  const modalidad = computeModalidadPorPagoId(pagos)

  return pagos
    .filter(p => p.estado !== 'borrador')
    .map(p => ({
      nro_pago: p.nro_pago,
      nro_op: opPorPagoId.get(p.id)?.codigo ?? '',
      proveedor: p.proveedores?.nombre ?? '',
      tipo: TIPO_LABELS[p.tipo] ?? p.tipo,
      concepto: p.concepto,
      canal: canalPagoDePago(p),
      tercero: terceroDePago(p),
      fecha: p.fecha_pago,
      pago: MODALIDAD_LABELS[modalidad.get(p.id) ?? 'desconocida'],
      monto: Number(p.monto),
      moneda: p.moneda,
      estado: ESTADO_LABELS[p.estado] ?? p.estado,
    }))
}
