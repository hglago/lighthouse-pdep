'use client'

/**
 * Bloque "Detalle del servicio" para gastos y recurrentes con proveedor por horas.
 *
 * Snapshot vivo:
 *  - valor_hora_aplicado: snapshot del valor_hora del proveedor al momento de cargar/editar.
 *  - porcentaje_uplift_snapshot: idem porcentaje_uplift. D22: solo informativo.
 *
 * Cálculo: importe_base_servicio = horas_servicio × valor_hora_aplicado.
 * El monto operativo del gasto/recurrente debe igualar este importe (validación cliente).
 *
 * Modo:
 *  - 'gasto': muestra período desde/hasta (obligatorio en DB CHECK gastos_servicio_horas_coherente).
 *  - 'recurrente': sin período — D23: la función generadora calculará primer/último día del mes.
 */
interface Props {
  mode: 'gasto' | 'recurrente'
  // Snapshot del proveedor (readonly desde el form padre)
  valorHoraProveedor: number
  porcentajeUpliftProveedor: number  // 0 si proveedor no tiene uplift activo
  // Form fields controlados desde el padre
  descripcion: string
  horas: string                       // se mantiene string en el form (consistencia con el resto)
  periodoDesde?: string               // YYYY-MM-DD, solo mode='gasto'
  periodoHasta?: string               // YYYY-MM-DD, solo mode='gasto'
  onChange: (partial: {
    descripcion?: string
    horas?: string
    periodoDesde?: string
    periodoHasta?: string
  }) => void
  disabled?: boolean
}

function formatMoneda(valor: number, moneda: string = 'ARS'): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: moneda === 'USD' ? 'USD' : 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valor)
}

export default function DetalleServicioBlock({
  mode,
  valorHoraProveedor,
  porcentajeUpliftProveedor,
  descripcion,
  horas,
  periodoDesde,
  periodoHasta,
  onChange,
  disabled = false,
}: Props) {
  // Calcular importe base en vivo
  const horasNum = parseFloat(horas.replace(',', '.'))
  const horasValidas = Number.isFinite(horasNum) && horasNum > 0
  const importeBase = horasValidas ? horasNum * valorHoraProveedor : 0
  const importeLiquidacion = porcentajeUpliftProveedor > 0
    ? importeBase * (1 + porcentajeUpliftProveedor / 100)
    : importeBase

  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:bg-gray-50 disabled:text-gray-500'
  const readonlyCls = 'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm tabular-nums text-gray-700 cursor-default'

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-3">
      <p className="text-sm font-semibold text-gray-800">Detalle del servicio</p>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Descripción del servicio <span className="text-red-500">*</span>
        </label>
        <textarea
          value={descripcion}
          onChange={e => onChange({ descripcion: e.target.value })}
          disabled={disabled}
          rows={2}
          className={`${inputCls} resize-none`}
          placeholder="Detalle del servicio prestado"
        />
      </div>

      {mode === 'gasto' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Período desde <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={periodoDesde ?? ''}
              onChange={e => onChange({ periodoDesde: e.target.value })}
              disabled={disabled}
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Período hasta <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={periodoHasta ?? ''}
              onChange={e => onChange({ periodoHasta: e.target.value })}
              disabled={disabled}
              className={inputCls}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Horas <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            min="0.01"
            step="0.25"
            value={horas}
            onChange={e => onChange({ horas: e.target.value })}
            disabled={disabled}
            className={inputCls}
            placeholder="0"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Valor hora aplicado
          </label>
          <input
            type="text"
            value={formatMoneda(valorHoraProveedor)}
            readOnly
            tabIndex={-1}
            className={readonlyCls}
          />
          <p className="mt-0.5 text-xs text-gray-400">Snapshot del proveedor — no se modifica</p>
        </div>
      </div>

      <div className="rounded-md bg-white border border-amber-100 p-2.5 space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-700">Importe base del gasto</span>
          <span className="font-semibold tabular-nums text-gray-900">
            {formatMoneda(importeBase)}
          </span>
        </div>
        {porcentajeUpliftProveedor > 0 && (
          <>
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>Uplift snapshot ({porcentajeUpliftProveedor.toFixed(2)}%) — solo informativo</span>
              <span className="tabular-nums">
                {formatMoneda(importeLiquidacion)}
              </span>
            </div>
            <p className="text-xs text-gray-400 pt-1 border-t border-amber-100">
              El uplift no modifica el gasto ni el pago. Se usará solo para futuras
              liquidaciones a socios.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
