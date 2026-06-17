# TASK.md

Tarea actual. Solo la activa. Cuando se cierre, reemplazar contenido.

## Fix sesión SSR en server actions de escritura — 2026-06-17

**Síntoma**: en producción (Vercel), Eliminar/Editar/Desactivar un gasto recurrente
fallaba con `new row violates row-level security policy for table gastos_recurrentes`,
incluso siendo `admin`. Crear (INSERT) funcionaba.

**Causa raíz**: con `@supabase/ssr`, el cliente de servidor no adjunta el access
token a las queries hasta que la sesión se hidrata con `getUser()`/`getSession()`.
Las actions que escribían **sin** llamar `getUser()` primero mandaban el UPDATE/DELETE
sin auth → `auth.uid()` NULL → `get_my_role()` NULL → el `WITH CHECK` de la RLS
rechaza. Las que sí llamaban `getUser()` (createGasto, createGastoRecurrente,
setComprobanteGasto, crearTipoGasto) andaban — ese fue el indicio.

**Fix (código, pendiente de deploy)**: agregado `getUser()` + guard "No autenticado"
antes de escribir, respetando el contrato de cada función (throw / ActionResult /
BulkGastoResult), en `gastos/actions.ts`:
`updateGasto`, `deleteGasto`, `cambiarEstadoGasto`, `bulkAprobarGastos`,
`bulkRechazarGastos`, `bulkDeleteGastos`, `removeComprobanteGasto`,
`updateGastoRecurrente`, `deleteGastoRecurrente`; y en la copia standalone
`gastos-recurrentes/actions.ts` (update/delete).

**Hallazgo posterior**: con el fix de `getUser()` deployado, Desactivar/Editar
(UPDATE de columnas comunes) pasaron a andar, pero **Eliminar** seguía fallando.
Causa: el UPDATE directo de `deleted_at` lo rechaza un trigger/policy de hardening
(falso "new row violates RLS"), igual que en Proveedores/Fondos. El delete de
recurrentes era el único soft-delete que quedaba por UPDATE directo.

**Cura del delete**: RPC `SECURITY DEFINER` `soft_delete_gasto_recurrente(uuid)`
(migración `20260617000001_soft_delete_gasto_recurrente.sql`, APLICADA), invocado
desde `deleteGastoRecurrente` (mismo patrón que `soft_delete_proveedor`).

**Migraciones aplicadas**:
- `20260617000000_recurrentes_rls_rbac_align.sql` — alinea policies al guard (no era la cura, pero hacía falta).
- `20260617000001_soft_delete_gasto_recurrente.sql` — RPC de baja lógica.

**`gastos` tenía el mismo hardening** (confirmado: eliminar un gasto borrador daba
el overlay genérico de Next, porque `deleteGasto` hace `throw`). Cura: RPC
`SECURITY DEFINER` `soft_delete_gasto(uuid)` (migración `20260617000002_soft_delete_gasto.sql`,
APLICADA), invocado desde `deleteGasto` y `bulkDeleteGastos`.

**Migraciones aplicadas (tanda 2026-06-17)**:
- `20260617000000_recurrentes_rls_rbac_align.sql`
- `20260617000001_soft_delete_gasto_recurrente.sql`
- `20260617000002_soft_delete_gasto.sql`

**Deuda restante**: `deleteGasto` sigue con `throw` (estilo mínimo elegido). Con el
RPC el happy-path ya no lanza, pero para eliminar el overlay en casos borde habría
que migrarlo a `ActionResult` (toca el call site en `GastosClient`). Pendiente.

## Sin tarea activa — 2026-06-05 (cierre anterior)

`main` en `HEAD 3e45c28`, working tree limpio, sincronizado con `origin/main`, **producción Vercel verificada en `3e45c28`**.

Último trabajo: (1) tabla Gastos compactada sin scroll + botón solo-ojo (`8610908`); (2) dashboard refinado: card uplift duplicada eliminada, tipografía -20%, Financiación pendiente con terceros a $0 y Total en negrita, grid 4 columnas, "Aportes por socio", detalle de aportes agrupado por socio con deep-link APO → `/fondos?aporte=` (`3e45c28`). Ver `CONTEXT.md`.

Recordatorio operativo: si "no se ven los cambios" en localhost, primero revisar la antigüedad del dev server (HMR muere tras días/suspensión) — reinicio limpio antes de tocar código.

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
