# CONTEXT.md

Estado actual del proyecto. Lo que está hecho, lo que falta aplicar, dónde estamos.

> Actualizado 2026-06-05 a `HEAD 3e45c28`. (La reconciliación grande del atraso
> de CONTEXT/TASK fue el 2026-06-03; ver git history para el detalle.)

## Dónde estamos

- **Branch**: `main` · **HEAD**: `3e45c28` · **Working tree**: limpio · sincronizado con `origin/main` · **producción Vercel verificada en `3e45c28`**.
- **Tag estable**: `v0.2.0-risa-fondos` (2026-05-23). Para volver al hito: `git reset --hard v0.2.0-risa-fondos`.
- **Remoto**: `https://github.com/hglago/lighthouse-pdep.git`.

Últimos commits:
```
3e45c28 feat: refinar dashboard ejecutivo y detalle de aportes por socio
8610908 fix: compactar tabla de Gastos y boton de accion solo-ojo
a306e4a fix: boton de accion solo-ojo en Pagos registrados y restaurar header Accion
27a743b fix: rowActionsLabel configurable en DataTable
a9cb223 fix: compactar tabla de Pagos registrados (dense + columnas angostas)
```

### UI: tablas compactas sin scroll horizontal (2026-06-03/05)
Patrón aplicado en **Pagos registrados** y **Gastos**. Piezas reutilizables:
- `DataTable`: prop opcional `dense` (padding `px-2 py-2`) y `rowActionsLabel` (texto del header de acciones; `''` → sr-only). Default sin cambios → otras tablas intactas.
- `RowActionMenu`: con `buttonLabel=''` el botón queda **icon-only** (solo el ojo), `aria-label` por accesibilidad. Default `'Acción'`.
- Columnas de texto (Concepto/Proveedor) con `max-w` + `truncate` + `title`.
- El header de la columna sigue diciendo "Acción" (el usuario quiere el texto en el header, NO en el botón).

### Dashboard ejecutivo refinado (2026-06-05, commit 3e45c28)
- Card duplicada de uplift eliminada (queda "Uplift informado" en fila Financieros, ojo → modal por proveedor).
- Tipografía de cards ~20% más chica (un escalón Tailwind) — look minimalista.
- "Financiación pendiente": lista cada tercero con su importe **incluso $0** (page.tsx completa los financiadores activos sin movimientos, ya que `v_saldos_financiadores` solo trae los que tienen) + fila **Total en negrita** por moneda.
- Grid resumen a 4 columnas (`xl:grid-cols-4`); card "Aportes por aportante" → **"Aportes por socio"**.
- Modal "Detalle de aportes" agrupado por socio (subtotal en negrita; columnas Fecha/Código/Moneda/Monto).
- **Deep-link de aporte**: el código APO-### en el modal linkea a `/fondos?aporte=APO-###`, que abre el modal de detalle (nuevo: `fondos/page.tsx` acepta `searchParams.aporte` → prop `aporteInicial` de `FondosClient`).

## Decisión de modelo financiero (vigente)

**Un solo fondo operativo: RISA** (`FON-001`). Puede tener saldo negativo. Los gastos se
cancelan con RISA (Medios Propios) o con un **financiador externo** (en UI: **"Tercero de la red"**).

**Posición Global RISA (PG) = Medios Propios (MP) + Medios Terceros (MT)**
- **MP** = `fondos.saldo_actual` de `FON-001`. Fuente: `movimientos_fondo`.
- **MT** = `-SUM(v_saldos_financiadores.saldo_pendiente)`. Fuente: `movimientos_financiacion`.
- En UI: "Medios Propios RISA" y "Terceros (de la red)". Internamente la tabla sigue siendo
  `financiadores` y `forma_cancelacion='financiador'` por back-compat. **Nunca usar "Prestamista"** (D16).

El modelo viejo de "cuenta corriente entre fondos" (commit `f66325b`) está **deprecado (D14) — no aplicar**.

## Lo que se cerró desde el último checkpoint de CONTEXT (post 2026-05-24)

| Bloque | Estado |
|---|---|
| **Etapa 4 Pagos RISA vs Tercero (P4b/P4c/P4d)** | ✅ cerrada. `fn_confirmar_pago`/`fn_anular_pago` con branching; UI Pagos sin borrador con resumen de obligación; UI Fondos con PG + cuenta corriente terceros. |
| **FIN2** aportes con imputaciones (split MP/Terceros) + anular con reversa + `v_posicion_global_risa` | ✅ código + SQL aplicado (migraciones 20260524*). |
| **TIPOS-GASTO** clasificación analítica con alta inline | ✅ migración 20260525000000. |
| **PG-PERIODO** `gastos.periodo_analitico` (vía trigger) | ✅ migración 20260525000001. |
| **Órdenes de Pago** (`ordenes_pago` + `fn_crear_orden_pago_desde_pago` + vista `/ordenes-pago/[codigo]`) | ✅ migración 20260525000002. |
| **Identidad Lighthouse + Dashboard ejecutivo** | ✅ `38f4c70`. |
| **Reportes Dypsa** dinámico (REP3) + congelado/snapshot numerado | ✅ `d3b7b81`/`277f175`/`f02956f`; migración 20260527000000. |
| **`gastos.fecha_pago_prevista` + proveedor obligatorio** | ✅ `3d91231`; migración 20260527000001. |
| **L&F /fondos + modal cuenta corriente de tercero (11 cols, export Excel)** | ✅ `167ca42`. |
| **Fix comprobantes de gasto** (`setComprobanteGasto`/`removeComprobanteGasto` → `ActionResult`, 10 throws removidos) | ✅ `e939d7f`/`468ebb7`. |
| **Fix build jsPDF** (cast `getNumberOfPages` en 2 reportes) | ✅ `468ebb7`. |
| **Fix enum `pagado_parcial`** removido de `.in('estado',...)` en gastos | ✅ `468ebb7`. |

## RBAC / Seguridad (Fase 2C–2E, 2026-05-25)

- **7 roles vigentes**: `admin`, `supervisor`, `operador`, `user`, `socio` + legacy `contador`/`revisor`/`visualizador`. Labels en `src/types/index.ts` (`ROLE_LABELS`).
- **`assertRole(allowed)`** en `src/lib/auth/guards.ts` — SELECT de `profiles` para resolver role; devuelve `ActionResult` (no throw). Convención: incluir `admin` en TODAS las listas.
- Guards server-side aplicados en server actions de **gastos, gastos-recurrentes, pagos, fondos/maestros, proveedores** (`fd51ac6`…`b3bc536`).
- **Dashboard restringido a `admin`** (expone PG + métricas sensibles) — `22ea447`.
- **`user` ve y opera solo sus propios gastos** vía `gastos.created_by` (ownership) — `04a1468`.
- **Rol `socio`**: bloqueado de módulos operativos, redirect a `/reportes`. Sidebar migrado a `allowedRoles` — `6f2cee0`/`58b51f2`.
- **Login Google con lista blanca**: `OAUTH_GOOGLE_ENABLED=true`. `src/app/auth/callback/route.ts` → `fn_apply_google_whitelist_self`; si no autorizado, `signOut()` + `/login?error=not_authorized`. Tabla `google_allowed_users` + CRUD en `/usuarios` — `3d3cf97`.

## SQL — migraciones en `supabase/migrations/`

Aplicadas y validadas según handoffs (hasta 2026-05-29). Última en disco: `20260527000001`.

```
20260524000000  fin_fix_1_saldo_mp_negativo
20260524000001  gastos_volver_a_pendiente
20260524000002  aporte_imputaciones
20260524000003  registrar_aporte_socio_v2
20260524000004  anular_aporte_socio
20260524000005  v_posicion_global_risa
20260525000000  tipos_gasto
20260525000001  gastos_periodo_analitico (trigger; la versión GENERATED falló)
20260525000002  ordenes_pago (+ OP-fix nro_pago vía CREATE OR REPLACE)
20260527000000  reportes_dypsa_snapshot
20260527000001  gastos_fecha_pago_prevista
```

### SQL pendiente de aplicar
| Archivo | Qué | Decisión |
|---|---|---|
| `sql/REP1_REP2_migration.sql` | `proveedores.nombre_informe` (REP2) | ⏸ **NO aplicado**. El SELECT es tolerante. Aplicar cuando se quiera editar nombre de informe por proveedor. |
| `2dd8f42` uplift proveedores | columna uplift | ⏸ aplicar si se edita uplift en UI (D22: solo informativo). |
| `9872748` códigos G/P | secuencias `gastos_codigo_seq`/`pagos_codigo_seq` | ⏸ aplicar si se quieren ver códigos G######/P######. |
| `f66325b` cuenta corriente entre fondos | — | ❌ **NO APLICAR** (deprecado, D14). |

## Riesgos / deuda técnica vigente

- **Server actions con `throw` en `gastos/actions.ts`** (`createGasto`, `updateGasto`, `deleteGasto`, `cambiarEstadoGasto`, etc.) siguen sin migrar a `ActionResult` — mismo bug latente que tenían los comprobantes antes del fix. Migrar cuando aparezca caso visible. Ver `feedback_server_actions_action_result`.
- **`@types/jspdf` desactualizado** (`^1.3.3` para `jspdf@^4.x`). El cast `getNumberOfPages` es workaround en `InformeDypsaClient.tsx:239` y `InformeDypsaCongelado.tsx:251`.
- **`pagado_parcial`** no existe en el enum SQL `gasto_estado`. Queda código muerto inerte en `GastosClient.tsx` y un fallback `22P02` en `pagos/page.tsx:65` que ensucia el log.
- `fn_pagos_hardening` bloquea UPDATE sobre pagos confirmados (relevante si se vuelve a tocar pagos).
- Comprobantes en Storage no se limpian con reset operativo.

## Convenciones aplicadas (decisiones activas)

- **ActionResult** en server actions destructivas (nunca throw). `assertRole()` devuelve ActionResult.
- **SECURITY DEFINER RPC** para soft-delete (Proveedores, Fondos).
- **SELECTs tolerantes** en pages con columnas pendientes de migrar.
- Patrón de baja: "Dar de baja" (sin reverso) / "Anular" (con reverso financiero).
- Códigos: `G######`/`P######` (gastos/pagos, legacy pendiente); `FON-###`/`APO-###`/`FIN-###`/`SOC-###` (3 dígitos con dash) para fondos/aportes/financiadores/socios.
- **D14**: cuenta corriente entre fondos deprecada.
- **D16**: RISA único + terceros externos. UI dice "Tercero", nunca "Prestamista".
- **D18**: listados muestran Código o N° transacción, nunca UUID como identificador visible.
- **D19**: listados con búsqueda + filtros por columna + sort + "Limpiar filtros" + empty states (`DataTable`).
- **D21**: Honorarios deprecado operativamente (se carga como Gasto con `permite_horas_servicio`).
- **D22**: Uplift es solo informativo (snapshot para liquidación futura, no afecta importes).
- **D23**: Recurrentes con servicio por hora copian snapshot al gasto generado.
- **Versión en UI**: sidebar muestra `tag · commit · env`. Lo genera `scripts/write-version.mjs` → `src/lib/version.ts` vía hooks predev/prebuild. Manual: `npm run version:write`. (Ese archivo se regenera solo; al cierre suele revertirse con `git checkout -- src/lib/version.ts` para dejar el árbol limpio.)

## Pendiente al retomar (del handoff 2026-05-29)

1. Verificar **redeploy de Vercel** con HEAD actual.
2. Probar en **producción** (no localhost): `/gastos` → modal "Comprobante de gasto" → adjuntar/quitar en `G000014`; confirmar sin overlay Next ni error `pagado_parcial`.
3. **Build Vercel OK** (el fix de jsPDF era el unblocker).

## Próximos frentes propuestos (el usuario elige)

- Aplicar `sql/REP1_REP2_migration.sql` (nombre_informe por proveedor).
- Migrar el resto de server actions de `gastos/actions.ts` a `ActionResult`.
- Lote E2E formal (sigue pendiente desde el handoff 2026-05-24).
- Bump `@types/jspdf` para quitar el cast workaround.
