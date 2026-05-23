# CONTEXT.md

Estado actual del proyecto. Lo que está hecho, lo que falta aplicar, dónde estamos.

## Decisión de modelo financiero (vigente)

**Un solo fondo operativo: RISA.** Puede tener saldo negativo. Los gastos se cancelan con RISA o con un financiador externo. Aportes de socios fondean RISA o cancelan financiación pendiente con financiadores.

El modelo anterior de "cuenta corriente entre fondos" (varios fondos internos con deudas entre sí, commit `f66325b`) **queda deprecado** — ver D14.

## Features funcionales

| Feature | Estado código | SQL pendiente |
|---|---|---|
| Login custom usuario/password | ✅ funcional | — |
| CRUD fondos + aportes | ✅ funcional | — |
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
| **Cuenta corriente entre fondos vieja** | ⚠️ código tolerante presente | ❌ **DEPRECADO — no aplicar (ver D14)** |
| Soft-delete Proveedores | ✅ funcional vía RPC SECURITY DEFINER | ✅ aplicado |
| Soft-delete Fondos | ✅ código | ⚠️ SQL pendiente (RPC + columnas) |
| **Nuevo modelo financiero RISA único** | 🟡 Etapa 1 SQL entregada (no aplicada) | 🟡 esperando revisión |

## Estado de datos

Reset operativo aplicado 2026-05-23. Borrados: fondos, gastos, pagos, movimientos_fondo, aportes_fondo, anticipos. Conservados: proveedores, profiles, gastos_recurrentes.

## SQL pendientes (en orden cronológico de creación)

| Commit | Migración | Acción recomendada |
|---|---|---|
| `2dd8f42` | Uplift proveedores | Aplicar cuando quieras editar uplift en UI |
| `9872748` | Codigo G/P | Aplicar cuando quieras visualizar G/P codes |
| `f66325b` | Cuenta corriente entre fondos vieja | **NO APLICAR** — deprecado (D14) |
| `62420fe` | Soft delete fondo | Aplicar para activar el guard de saldo |
| _Etapa 1 nuevo modelo_ | Sin commitear código — solo bloque SQL entregado en chat | **Revisar y aplicar como bloque principal del refactor** |

## Estado de tablas (después de Etapa 1 aplicada)

Nuevas:
- `socios` — aportantes
- `financiadores` — terceros que cancelan gastos
- `movimientos_financiacion` — ledger de deuda con financiadores
- View `v_saldos_financiadores` — saldo por financiador

Modificadas:
- `fondos.codigo` (FON-###)
- `aportes_fondo.codigo` (APO-###), `socio_id`, `destino_aporte`, `financiador_id` (mantiene `aportante` legacy)
- `gastos.forma_cancelacion`, `gastos.financiador_id`
- `pagos.forma_cancelacion`, `pagos.financiador_id`, `pagos.afecta_saldo_risa`, `pagos.movimiento_financiacion_id`

## Riesgos / debt

- `fn_pagos_hardening` bloquea UPDATE sobre pagos confirmados. Etapa 4 lo manejará con disable temporal.
- `fn_confirmar_pago` y `fn_anular_pago`: pueden tener validación de saldo. Etapa 4 revisará.
- Comprobantes en Storage no se limpian con reset operativo.
- Código tolerante de cuenta corriente vieja queda inerte (no estorba si no se aplica esa SQL).

## Convenciones aplicadas

- ActionResult en todas las actions destructivas
- SECURITY DEFINER RPC para soft-delete (Proveedores, Fondos)
- SELECTs tolerantes en pages con columnas pendientes de migrar
- Patrón de baja: "Dar de baja" (entidades sin estado) / "Anular" (con reverso financiero)
- Códigos: G/P (6 dígitos sin dash) para gastos/pagos; FON/APO/FIN (3 dígitos con dash) para fondos/aportes/financiadores
