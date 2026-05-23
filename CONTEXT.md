# CONTEXT.md

Estado actual del proyecto. Lo que está hecho, lo que falta aplicar, dónde estamos.

## Decisión de modelo financiero (vigente)

**Un solo fondo operativo: RISA.** Puede tener saldo negativo. Los gastos se cancelan con RISA o con un financiador externo. Aportes de socios fondean RISA o cancelan financiación pendiente con financiadores.

El modelo anterior de "cuenta corriente entre fondos" (varios fondos internos con deudas entre sí, commit `f66325b`) **queda deprecado** — ver D14.

## Features funcionales

| Feature | Estado código | Estado DB |
|---|---|---|
| Login custom usuario/password | ✅ funcional | — |
| CRUD fondos + aportes (legacy) | ✅ funcional | — |
| CRUD proveedores (con uplift) | ✅ funcional | ⚠️ ALTER uplift (tolerante si no aplicado) |
| CRUD gastos (alta directa `enviado`) | ✅ funcional | — |
| Aprobación de gastos | ✅ funcional | — |
| Bulk actions gastos | ✅ funcional | — |
| Pagos atómicos (create+confirm) | ✅ funcional | — |
| Anular pago | ✅ funcional vía `fn_anular_pago` | — |
| Obligaciones pendientes | ✅ vista `v_obligaciones_pendientes` | — |
| Anti-overpayment | ✅ funcional | — |
| Recurrentes auto-gen mensual | ✅ funcional | — |
| Comprobantes en Storage | ✅ funcional | — |
| Excel export gastos | ✅ funcional | — |
| Códigos G/P | ✅ código tolerante | ⚠️ SQL pendiente |
| Cuenta corriente entre fondos vieja | ⚠️ código tolerante presente | ❌ **DEPRECADO — no aplicar (D14)** |
| Soft-delete Proveedores | ✅ funcional vía RPC SECURITY DEFINER | ✅ aplicado |
| Soft-delete Fondos | ✅ código | ⚠️ SQL pendiente (RPC + columnas) ¹ |
| **Nuevo modelo financiero RISA único — schema** | — | ✅ **Etapa 1 APLICADA Y VALIDADA** |
| **UI Fondos rediseñada read-only (resumen RISA, aportes, financiadores)** | ✅ Etapa 2A implementada | — |
| **socios.codigo + sequence + trigger + UNIQUE** | — | ✅ **Etapa 2B-SQL APLICADA** |
| **UI Fondos: 3 botones (Nuevo aporte / socio / financiador) + 3 modales** | ✅ Etapa 2B+2C implementada | — |
| **Crear socio con codigo SOC-### desde UI** | ✅ funcional | ✅ aplicado |
| **Crear financiador con codigo FIN-### desde UI** | ✅ funcional | ✅ aplicado |
| **Registrar aporte de socio (RPC `registrar_aporte_socio`)** | ✅ funcional | ✅ **aplicada y validada** (destino RISA confirmado; destino cancelar pendiente de testeo real) |
| **`forma_cancelacion` en UI Gastos** | ❌ no implementada | — (Etapa 3 pendiente) |
| **UI Pagos con rama RISA vs financiador** | ❌ no implementada | — (Etapa 4 pendiente) |

¹ Las columnas `deleted_at`/`deleted_by`/`motivo_baja` en fondos fueron agregadas dentro de Etapa 1. La RPC `soft_delete_fondo` SQL antigua sigue pendiente de aplicar (no es crítica para Etapa 2).

## Estado de datos

Reset operativo aplicado 2026-05-23. Borrados: fondos, gastos, pagos, movimientos_fondo, aportes_fondo, anticipos. Conservados: proveedores, profiles, gastos_recurrentes.

**Post-Etapa 1**: `RISA` insertado como `FON-001`, saldo 0, moneda ARS, estado activo.

## SQL aplicado y validado (orden cronológico)

| Etapa / commit | Migración | Estado |
|---|---|---|
| Soft-delete Proveedores | RPC SECURITY DEFINER `soft_delete_proveedor` | ✅ aplicado |
| **Etapa 1 nuevo modelo** | Tablas nuevas + columnas + sequences + triggers + RLS policies + RISA inicial + drop constraint saldo>=0 | ✅ **APLICADA 2026-05-23** |
| **Etapa 2B SQL** | `socios.codigo` + `socios_codigo_seq` + `fn_set_socio_codigo` + `trg_set_socio_codigo` + backfill + UNIQUE + NOT NULL | ✅ **APLICADA** |
| **Etapa 2C SQL** | RPC `registrar_aporte_socio` SECURITY DEFINER (transaccional para destino RISA o financiación) | ✅ **APLICADA Y VALIDADA** (destino RISA confirmado funcional; rama cancelar financiación pendiente de testeo con deuda real) |

## SQL pendientes (decisión deferida)

| Commit | Migración | Decisión |
|---|---|---|
| `2dd8f42` | Uplift proveedores | Aplicar cuando quieras editar uplift en UI |
| `9872748` | Codigo G/P | Aplicar cuando quieras visualizar G/P codes |
| `f66325b` | Cuenta corriente entre fondos vieja | **NO APLICAR** — deprecado (D14) |
| `62420fe` | Soft delete fondo (RPC y columnas extra) | Las columnas ya entraron en Etapa 1. La RPC `soft_delete_fondo` puede aplicarse aparte si querés volver a habilitar el flow "Dar de baja fondo" |

## Estado de tablas post-Etapa 1

### Nuevas
- `socios` — aportantes (RLS activo: SELECT/INSERT/UPDATE para authenticated)
- `financiadores` — terceros que cancelan gastos (RLS activo, mismo patrón). Codigo FIN-### auto
- `movimientos_financiacion` — ledger de deuda con financiadores (RLS activo: SELECT/INSERT authenticated)

### Modificadas
- `fondos`: + `codigo` (FON-###), + `deleted_at`, + `deleted_by`, + `motivo_baja`
- `aportes_fondo`: + `codigo` (APO-###), + `socio_id`, + `destino_aporte`, + `financiador_id` (mantiene `aportante` text legacy)
- `gastos`: + `forma_cancelacion` (`'risa'`/`'financiador'`), + `financiador_id`
- `pagos`: + `forma_cancelacion`, + `financiador_id`, + `afecta_saldo_risa` (boolean), + `movimiento_financiacion_id`

### Constraints eliminadas
- `fondos.fondos_saldo_no_negativo` (CHECK saldo_actual >= 0) — eliminada permanentemente. RISA puede quedar en saldo negativo

### View
- `v_saldos_financiadores`: agrega por (financiador_id, moneda). Incluye `financiador_deleted_at` para que la UI decida si filtra. Hoy retorna 0 filas (sin movimientos aún)

## Sequences + Triggers activos

| Sequence | Trigger | Formato | Estado |
|---|---|---|---|
| `fondos_codigo_seq` | `trg_set_fondo_codigo` BEFORE INSERT | `FON-###` | next = `FON-002` (RISA ya es `FON-001`) |
| `aportes_codigo_seq` | `trg_set_aporte_codigo` BEFORE INSERT | `APO-###` | next = `APO-001` |
| `financiadores_codigo_seq` | `trg_set_financiador_codigo` BEFORE INSERT | `FIN-###` | next = `FIN-001` |
| `gastos_codigo_seq` (legacy) | `trg_set_gasto_codigo` | `G######` | SQL pendiente, no aplicado todavía |
| `pagos_codigo_seq` (legacy) | `trg_set_pago_codigo` | `P######` | SQL pendiente |

## Riesgos / debt vigente

- `fn_pagos_hardening` bloquea UPDATE sobre pagos confirmados. Etapa 4 lo manejará con disable temporal o RPC.
- `fn_confirmar_pago` y `fn_anular_pago`: pueden necesitar revisión cuando se implementen las ramas RISA vs Financiador en Etapa 4.
- Comprobantes en Storage no se limpian con reset operativo.
- Código tolerante de cuenta corriente vieja queda inerte en `pagos/page.tsx`. No estorba si no se aplica esa SQL.
- **Etapa 2 todavía no implementada**: la UI de Fondos actual no expone codigo, ni socios, ni financiadores, ni cuentas corrientes.

## Convenciones aplicadas

- ActionResult en todas las actions destructivas
- SECURITY DEFINER RPC para soft-delete (Proveedores, Fondos)
- SELECTs tolerantes en pages con columnas pendientes de migrar
- Patrón de baja: "Dar de baja" (sin estado) / "Anular" (con reverso financiero)
- Códigos: G/P (6 dígitos sin dash) para gastos/pagos; FON/APO/FIN/SOC (3 dígitos con dash) para fondos/aportes/financiadores/socios
- Triggers BEFORE INSERT asignan codigo automáticamente; setval sincroniza para que el próximo INSERT empiece desde MAX+1
- **D18**: Todo listado muestra "Código" (entidades maestras) o "N° transacción" (operaciones). Nunca UUID como identificador visible principal. Ver `DECISIONS.md` para detalle.

## Notas para Etapa 2

La UI tiene que mostrar `fondos.codigo` (especialmente RISA como `FON-001`) en cualquier listado de fondos y en el card de resumen. Ver `TASK.md` para el layout target completo.
