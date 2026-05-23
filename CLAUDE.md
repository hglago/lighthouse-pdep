# CLAUDE.md

Project: **lighthouse-pdep** — Next.js 14 (App Router) + Supabase. Fund / expense / payment management.

This file is the entry point. Keep it short. Detalles van en archivos separados.

## Conventions críticas (no romper)

1. **`'use server'` actions devuelven `ActionResult`**, no throw.
   `type ActionResult = { ok: true } | { ok: false; error: string }`
   Throw escapa al cliente y rompe el layout en Next 14.

2. **SELECTs tolerantes**. Si una columna nueva podría no estar en DB (migración pendiente), retry sin esa columna en lugar de crashear el listado. Ver `proveedores/page.tsx` y `pagos/page.tsx` para el patrón.

3. **Baja lógica, nunca DELETE físico** de entidades operativas. Soft-delete vía RPC SECURITY DEFINER cuando RLS rechaza el camino directo. Ver `RLS_RPC.md`.

4. **No `npm run build` mientras `npm run dev` está corriendo**. Corrompe `.next/`. Causa: chunks 404 → CSS no carga → UI plana con íconos gigantes. Si pasa: `taskkill /F /IM node.exe`, `rm -rf .next`, `npm run dev`.

5. **No service_role en frontend.** Nunca. La key existe en `.env.local` solo para scripts admin.

6. **No tocar RLS sin pedido explícito.** Si una policy bloquea, primero diagnostic SQL (`/diagnose-rls`); después fix mínimo o RPC SECURITY DEFINER.

7. **SQL siempre idempotente.** `CREATE OR REPLACE`, `ADD COLUMN IF NOT EXISTS`, `DROP IF EXISTS … CREATE`. Envolver mutaciones en `BEGIN…COMMIT`.

8. **Validar tipos sin tocar `.next/`**: `npx tsc --noEmit`. Solo `npm run build` cuando el dev server esté apagado y el usuario lo pida explícito.

## Patrón de delivery

Para features grandes: **etapas**. Cada etapa shippable independiente. Confirmar con `AskUserQuestion` antes de meter mano si scope > 2 archivos.

Para SQL: **se entrega**, no se aplica. El usuario corre en Supabase SQL Editor. Validar idempotencia siempre.

Para hot-reload: el dev server reflejaba los cambios automáticamente. No reiniciar salvo problema.

## Archivos de contexto operativo

| Archivo | Para qué |
|---|---|
| `CONTEXT.md` | Estado actual del proyecto. Qué está hecho, qué SQL falta aplicar. |
| `TASK.md` | Tarea actual en curso. Solo la activa. |
| `DECISIONS.md` | Decisiones funcionales cerradas. Por qué se eligió cada patrón. |
| `DB.md` | Tablas, triggers, secuencias, relaciones. |
| `RLS_RPC.md` | Policies + RPCs + patrón SECURITY DEFINER. |
| `MODULES.md` | Cada módulo (UI + actions). |
| `TESTING.md` | Comandos y pruebas manuales mínimas. |

Slash commands disponibles en `.claude/commands/`:

- `/diagnose-rls` — recipe SQL para diagnosticar bloqueos RLS
- `/safe-db-migration` — patrón de migración idempotente con disable temporal de hardening
- `/implement-feature` — flujo de delivery por etapas
- `/cleanup-logs` — remover console.log temporales después de confirmar fix

## Stack

- Next.js 14.2.35 App Router
- React 18
- Supabase (Postgres + Auth + Storage + RLS)
- TypeScript estricto
- Tailwind 3 + PostCSS
- Sin librerías UI externas (Tailwind puro)

## Cliente Supabase

- Server actions: `import { createClient } from '@/lib/supabase/server'` — usa cookies de Next.
- Client components: `import { createClient } from '@/lib/supabase/client'` — usa anon key + localStorage del browser.
- Admin scripts: `@/lib/supabase/admin` (service_role) — solo si específicamente autorizado.

## Auth

- Login custom: usuario_login + password vía RPC `fn_email_by_usuario_login` → `signInWithPassword`.
- Logout: `/auth/signout` route handler (Server Components no pueden limpiar cookies).
- Middleware: redirige a `/login` si no hay sesión.

## Estructura de carpetas relevante

```
src/
  app/
    (auth)/login/
    (dashboard)/
      gastos/        — listado, CRUD, recurrentes, bulk actions
      pagos/         — listado, obligaciones pendientes, anular
      fondos/        — listado, aportes
      proveedores/   — listado, alta/baja lógica
      ...
  components/
    DataTable.tsx    — tabla reusable con sort + filter + selection
    SortableHeader.tsx
    layout/{Sidebar,Header,DashboardShell}.tsx
  lib/
    supabase/{client,server,admin}.ts
    useSortable.ts
    uplift.ts
    excel.ts
  types/database.ts  — interfaces para todas las tablas
```

## Anti-patrones (NO HACER)

- ❌ `throw new Error(...)` en server actions
- ❌ `router.refresh()` después de `revalidatePath()`
- ❌ Múltiples `revalidatePath` en cascada (causan CSS 404 storm)
- ❌ `npm run build` con dev server activo
- ❌ Service_role en frontend
- ❌ Desactivar RLS para "que funcione"
- ❌ DELETE físico de entidades operativas
- ❌ Hardcodear nombres de triggers o policies (usar discovery dinámico)
- ❌ Asumir que el SQL se aplicó — los SELECTs tolerantes lo manejan
- ❌ Refactor agresivo cuando la consigna dice "mínima modificación"

## Cómo arrancar este proyecto desde 0

1. `.env.local` con `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
2. `npm install`
3. `npm run dev` → `http://localhost:3000`
4. Login con usuario/password definidos en Supabase auth.users + profiles

## Cuando algo se rompa visualmente

Antes de tocar código: revisar log del dev server. Si hay `404 /_next/static/...` → `.next` corrupto, sigue el procedimiento del punto 4 arriba.
