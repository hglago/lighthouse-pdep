// Archivo auto-generado por scripts/write-version.mjs.
// Se regenera antes de `npm run dev` y `npm run build` (predev/prebuild).
// Para regenerar manualmente: `npm run version:write`.
// NO editar a mano — el script sobrescribe el contenido.

export const APP_VERSION = {
  tag: "v0.2.0-risa-fondos",
  commit: "6f2cee0",
  buildTime: "2026-05-26T21:19:17.936Z",
  env: process.env.NODE_ENV ?? 'development',
} as const

export type AppVersion = typeof APP_VERSION
