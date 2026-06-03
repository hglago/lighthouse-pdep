# TASK.md

Tarea actual. Solo la activa. Cuando se cierre, reemplazar contenido.

## Sin tarea activa — 2026-06-03 (cierre)

No hay tarea en curso. `main` en `HEAD a306e4a`, working tree limpio, sincronizado con `origin/main`, **producción Vercel verificada en `a306e4a`**.

Último trabajo de la sesión: compactar la tabla "Pagos registrados" para que entre sin scroll horizontal (props `dense`/`rowActionsLabel` en DataTable, botón de fila solo-ojo vía `buttonLabel=''` en RowActionMenu, Concepto/Proveedor más angostos). Ver `CONTEXT.md`. Incidente menor resuelto: el dev server llevaba ~5 días arriba con HMR muerto → reinicio limpio (kill node + rm .next + npm run dev).

> Nota de reconciliación: el contenido anterior de este archivo describía la
> **Etapa 4 Pagos RISA vs Tercero (P4b/P4c/P4d)** como en curso. Esa etapa ya
> está **cerrada y en `main`** (P4b SQL aplicada en la tanda 2026-05-25, UI
> Pagos/Fondos implementada). Ver `CONTEXT.md` para el estado real consolidado.
> Lo viejo se archivó en git history; acá queda solo el estado vigente.

## Estado del repo (top)

| Commit | Qué cierra |
|---|---|
| `669bcdd` | README descriptivo |
| `468ebb7` | Fix comprobantes + build reportes (jsPDF) |
| `e939d7f` | Comprobantes de gasto → ActionResult |
| `167ca42` | L&F /fondos + detalle operativo de terceros |
| `38f4c70` | Identidad Lighthouse + dashboard ejecutivo |
| Tag estable | `v0.2.0-risa-fondos` |

## Pendientes técnicos (no bloqueantes)

| Item | Estado |
|---|---|
| Verificar redeploy Vercel + smoke test producción (comprobantes en `/gastos`) | ⏸ del handoff 2026-05-29 |
| Aplicar `sql/REP1_REP2_migration.sql` (`proveedores.nombre_informe`) | ⏸ no aplicado; SELECT tolerante |
| Migrar server actions `throw` → `ActionResult` en `gastos/actions.ts` (createGasto, updateGasto, deleteGasto, cambiarEstadoGasto, …) | ⏸ deuda |
| Bump `@types/jspdf` para quitar cast `getNumberOfPages` | ⏸ deuda |
| `pagado_parcial` fallback `22P02` en `pagos/page.tsx:65` | ⏸ ensucia log; esperar migración enum |
| Lote E2E formal | ⏸ pendiente desde 2026-05-24 |

## Restricciones vigentes (siempre)

- Server actions devuelven `ActionResult`, **nunca throw** (rompe el layout en Next 14).
- SQL **se entrega, no se aplica** — lo corre el usuario en Supabase. Siempre idempotente.
- NO `npm run build` con `npm run dev` activo (corrompe `.next/`).
- NO tocar RLS sin pedido explícito (primero `/diagnose-rls`).
- NO `service_role` en frontend.
- NO DELETE físico de entidades operativas (baja lógica vía RPC SECURITY DEFINER).
- NO aplicar migración vieja `movimientos_entre_fondos` (D14).
- NO usar "Prestamista" en UI (D16) → "Tercero".
- NO mostrar UUID como identificador principal (D18).

## Volver al hito si algo se rompe

```bash
git reset --hard v0.2.0-risa-fondos
```
