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

export function todayForFile(): string {
  return new Date().toISOString().slice(0, 10)
}
