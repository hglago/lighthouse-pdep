import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'

export function exportToExcel(
  rows: Record<string, unknown>[],
  filename: string,
  sheetName = 'Datos'
) {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  saveAs(new Blob([buf], { type: 'application/octet-stream' }), filename)
}

// UX-EXPORT-FONDOS (2026-05-25): export multi-hoja con un solo download.
// Cada item del array describe una hoja con su nombre y filas. Si rows está
// vacío, se genera la hoja vacía igual (con encabezados solo si headers viene).
export type WorkbookSheet = {
  name: string                              // ≤31 chars, Excel limita
  rows: Record<string, unknown>[]
  headers?: string[]                         // override del orden / set si rows está vacío
}

export function exportWorkbookToExcel(sheets: WorkbookSheet[], filename: string) {
  const wb = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const safeName = sheet.name.slice(0, 31)
    const ws = sheet.rows.length > 0
      ? XLSX.utils.json_to_sheet(sheet.rows, sheet.headers ? { header: sheet.headers } : undefined)
      : XLSX.utils.aoa_to_sheet(sheet.headers ? [sheet.headers] : [[]])
    XLSX.utils.book_append_sheet(wb, ws, safeName)
  }
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  saveAs(new Blob([buf], { type: 'application/octet-stream' }), filename)
}

export function todayForFile(): string {
  return new Date().toISOString().slice(0, 10)
}
