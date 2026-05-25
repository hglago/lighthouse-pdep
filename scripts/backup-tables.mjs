#!/usr/bin/env node
// scripts/backup-tables.mjs (2026-05-25)
// ETAPA1 — Backup CSV solo-lectura de tablas productivas.
// Reusa SUPABASE_SERVICE_ROLE_KEY de .env.local. NO modifica datos.
// NO imprime credenciales. NO ejecuta INSERT/UPDATE/DELETE/TRUNCATE/DROP/ALTER.

// Uso: node --env-file=.env.local scripts/backup-tables.mjs
// El flag --env-file lo carga Node 20+ nativamente.

import { createClient } from '@supabase/supabase-js'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const TABLES = [
  'gastos',
  'pagos',
  'ordenes_pago',
  'movimientos_fondo',
  'movimientos_financiacion',
  'aportes_fondo',
  'aporte_imputaciones',
  'gastos_recurrentes',
  'anticipos',
  'proveedores',
  'financiadores',
  'fondos',
  'socios',
  'tipos_gasto',
  'profiles',
]

const DEST_DIR = 'C:\\Backups\\GASTOS_PdeP\\2026-05-25_v0-productiva-inicial'

async function loadEnv() {
  try {
    const raw = await fs.readFile('.env.local', 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      if (line.trim().startsWith('#')) continue
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      let val = m[2]
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (!process.env[m[1]]) process.env[m[1]] = val
    }
  } catch (err) {
    console.error('No se pudo leer .env.local:', err.message)
    process.exit(1)
  }
}

function toCsvField(v) {
  if (v === null || v === undefined) return ''
  let s
  if (typeof v === 'object') s = JSON.stringify(v)
  else s = String(v)
  return '"' + s.replace(/"/g, '""') + '"'
}

function rowsToCsv(rows) {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const lines = [headers.map(toCsvField).join(',')]
  for (const r of rows) {
    lines.push(headers.map(h => toCsvField(r[h])).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

async function main() {
  await loadEnv()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local')
    process.exit(1)
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  await fs.mkdir(DEST_DIR, { recursive: true })

  const inventario = []
  for (let i = 0; i < TABLES.length; i++) {
    const table = TABLES[i]
    const prefix = String(i + 1).padStart(2, '0')
    const filename = `${prefix}_${table}.csv`
    const fullpath = path.join(DEST_DIR, filename)
    try {
      const { data, error } = await supabase.from(table).select('*').range(0, 99999)
      if (error) {
        console.log(`${table}: ERROR — ${error.message}`)
        inventario.push({ tabla: table, archivo: filename, filas: 0, ok: false, error: error.message })
        continue
      }
      const rows = data ?? []
      await fs.writeFile(fullpath, rowsToCsv(rows), 'utf8')
      console.log(`${table}: ${rows.length} filas OK -> ${filename}`)
      inventario.push({ tabla: table, archivo: filename, filas: rows.length, ok: true })
    } catch (err) {
      console.log(`${table}: ERROR — ${err.message}`)
      inventario.push({ tabla: table, archivo: filename, filas: 0, ok: false, error: err.message })
    }
  }

  const inventarioJson = {
    generado_en: new Date().toISOString(),
    destino: DEST_DIR,
    tablas: inventario,
    total_archivos_ok: inventario.filter(x => x.ok).length,
    total_filas: inventario.reduce((s, x) => s + (x.filas ?? 0), 0),
  }
  await fs.writeFile(
    path.join(DEST_DIR, '16_inventario_conteos.json'),
    JSON.stringify(inventarioJson, null, 2),
    'utf8'
  )

  const readme = `# Backup productivo inicial — 2026-05-25

Snapshot generado por \`scripts/backup-tables.mjs\` con Supabase service_role.
Commit del repo al momento del backup: \`447adf7\`.

## Archivos
${inventario.map(x => `- ${x.archivo} — ${x.ok ? `${x.filas} filas` : 'ERROR'}`).join('\n')}
- 16_inventario_conteos.json — metadata del backup

## Cómo se generó
\`\`\`
node scripts/backup-tables.mjs
\`\`\`

## Restauración
No automatizada. Orden FK sugerido:
1. Maestros: fondos, proveedores, socios, financiadores, tipos_gasto, profiles.
2. Templates: gastos_recurrentes.
3. Transaccional: gastos, aportes_fondo, aporte_imputaciones.
4. Pagos: pagos, ordenes_pago, anticipos.
5. Ledgers: movimientos_fondo, movimientos_financiacion.

Los CSV incluyen todas las columnas, incluida \`deleted_at\` y campos de anulación.
`
  await fs.writeFile(path.join(DEST_DIR, 'README.md'), readme, 'utf8')

  console.log('---')
  console.log(`Destino: ${DEST_DIR}`)
  console.log(`Archivos generados: ${inventario.length + 2} (CSVs + inventario + README)`)
  console.log(`Filas totales exportadas: ${inventarioJson.total_filas}`)
  const errores = inventario.filter(x => !x.ok)
  if (errores.length > 0) {
    console.log(`ERRORES: ${errores.length}`)
    for (const e of errores) console.log(`  - ${e.tabla}: ${e.error}`)
    process.exit(2)
  }
  console.log('Backup OK')
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
