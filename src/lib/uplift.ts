// Cálculo de uplift para rendición. NO mutar importes originales — esto solo
// debe usarse para informes/visualización.
//
// importe_rendido = importe_original * (1 + porcentaje_uplift / 100)
//   solo si tiene_uplift === true y porcentaje_uplift > 0.
// Caso contrario: importe_rendido = importe_original.

export interface UpliftConfig {
  tiene_uplift: boolean
  porcentaje_uplift: number
}

export function aplicarUplift(importeOriginal: number, config: UpliftConfig | null | undefined): number {
  if (!config || !config.tiene_uplift) return importeOriginal
  const pct = Number(config.porcentaje_uplift)
  if (!Number.isFinite(pct) || pct <= 0) return importeOriginal
  return importeOriginal * (1 + pct / 100)
}

// Devuelve la 3-upla útil para mostrar en informes:
//   { original, porcentaje, con_uplift }
// Si no aplica uplift, porcentaje = 0 y con_uplift === original.
export function desglosarUplift(
  importeOriginal: number,
  config: UpliftConfig | null | undefined
): { original: number; porcentaje: number; con_uplift: number } {
  const aplica = !!config?.tiene_uplift && Number.isFinite(config.porcentaje_uplift) && config.porcentaje_uplift > 0
  const porcentaje = aplica ? Number(config!.porcentaje_uplift) : 0
  return {
    original: importeOriginal,
    porcentaje,
    con_uplift: aplica ? importeOriginal * (1 + porcentaje / 100) : importeOriginal,
  }
}
