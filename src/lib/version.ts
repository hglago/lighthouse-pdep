// Archivo auto-generado por scripts/write-version.mjs.
// Se regenera antes de `npm run dev` y `npm run build` (predev/prebuild).
// Para regenerar manualmente: `npm run version:write`.
// NO editar a mano — el script sobrescribe el contenido.

export const APP_VERSION = {
  tag: "v0.2.0-risa-fondos",
  commit: "f3c5e34",
  buildTime: "2026-05-24T23:13:23.698Z",
  env: process.env.NODE_ENV ?? 'development',
} as const

export type AppVersion = typeof APP_VERSION
