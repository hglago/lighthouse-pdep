// scripts/write-version.mjs
// ----------------------------------------------------------------------------
// Genera src/lib/version.ts con tag git + commit corto + buildTime.
// Se invoca automáticamente vía predev y prebuild en package.json. También
// puede correrse manualmente con `npm run version:write`.
//
// Tolerante: si no hay tags (`git describe` falla) muestra "sin tag"; si no
// estamos en un repo git (`git rev-parse` falla) muestra "dev".
// ----------------------------------------------------------------------------

import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

function safeExec(cmd, fallback) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return fallback
  }
}

const tag = safeExec('git describe --tags --abbrev=0', 'sin tag')
const commit = safeExec('git rev-parse --short HEAD', 'dev')
const buildTime = new Date().toISOString()

const content = `// Archivo auto-generado por scripts/write-version.mjs.
// Se regenera antes de \`npm run dev\` y \`npm run build\` (predev/prebuild).
// Para regenerar manualmente: \`npm run version:write\`.
// NO editar a mano — el script sobrescribe el contenido.

export const APP_VERSION = {
  tag: ${JSON.stringify(tag)},
  commit: ${JSON.stringify(commit)},
  buildTime: ${JSON.stringify(buildTime)},
  env: process.env.NODE_ENV ?? 'development',
} as const

export type AppVersion = typeof APP_VERSION
`

const out = 'src/lib/version.ts'
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, content, 'utf8')
console.log(`[write-version] ${tag} · ${commit} · ${buildTime} → ${out}`)
