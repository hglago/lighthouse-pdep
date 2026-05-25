// GASTOS-UX (2026-05-25): helpers para inputs de importe en formato es-AR.
//
// - parseMoneyInput acepta cualquier mezcla razonable de separadores y devuelve
//   un number JS limpio listo para enviar a DB. Tolera vacío, signos, espacios.
// - formatMoneyInput formatea un number con punto de miles y coma decimal,
//   sin símbolo de moneda (para inputs editables).
//
// Reglas de parseo (orden de prioridad):
//   1. Vacío / inválido → NaN (el caller decide qué hacer).
//   2. Si tiene tanto "." como ",": el último (más a la derecha) es el decimal.
//      Ej: "1.000.000,50" → 1000000.50; "1,000,000.50" → 1000000.50.
//   3. Si tiene solo ",": es decimal. "1234,56" → 1234.56.
//   4. Si tiene solo ".": ambigüedad — si hay solo UN punto con 1-2 dígitos
//      después, decimal estilo EN; si no, miles. "1.5" → 1.5; "1.000" → 1000;
//      "1.234.567" → 1234567.
//   5. Si no tiene separadores: parseFloat directo.

export function parseMoneyInput(input: string | null | undefined): number {
  if (input == null) return NaN
  const raw = String(input).trim()
  if (!raw) return NaN

  // Quitar espacios internos (ej. "1 000 000,50")
  const cleaned = raw.replace(/\s+/g, '')

  const hasDot   = cleaned.includes('.')
  const hasComma = cleaned.includes(',')

  let normalized: string

  if (hasDot && hasComma) {
    // Último separador es decimal.
    const lastDot   = cleaned.lastIndexOf('.')
    const lastComma = cleaned.lastIndexOf(',')
    if (lastComma > lastDot) {
      // es-AR: 1.000.000,50
      normalized = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      // en-US: 1,000,000.50
      normalized = cleaned.replace(/,/g, '')
    }
  } else if (hasComma) {
    // Solo coma: decimal es-AR
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (hasDot) {
    // Solo punto: ambiguo
    const lastDot = cleaned.lastIndexOf('.')
    const decimalsAfter = cleaned.length - lastDot - 1
    const dotCount = (cleaned.match(/\./g) ?? []).length
    if (dotCount === 1 && decimalsAfter >= 1 && decimalsAfter <= 2) {
      // Asumir decimal estilo EN: "1.5", "12.34"
      normalized = cleaned
    } else {
      // Asumir separador de miles: "1.000", "1.234.567"
      normalized = cleaned.replace(/\./g, '')
    }
  } else {
    normalized = cleaned
  }

  const n = parseFloat(normalized)
  return Number.isFinite(n) ? n : NaN
}

const moneyFormatter = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function formatMoneyInput(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return ''
  return moneyFormatter.format(value)
}

// Conveniencia: reformatea un string parseable a formato es-AR. Si no parsea,
// devuelve el original tal cual (no pisar lo que el user está escribiendo).
export function reformatMoneyInput(input: string): string {
  const n = parseMoneyInput(input)
  if (!Number.isFinite(n)) return input
  return formatMoneyInput(n)
}
