# CONTEXT.md

Estado actual del proyecto. Lo que está hecho, lo que falta aplicar, dónde estamos.

## Features funcionales

| Feature | Estado código | SQL pendiente |
|---|---|---|
| Login custom usuario/password | ✅ funcional | — |
| CRUD fondos + aportes | ✅ funcional | — |
| CRUD proveedores (con uplift) | ✅ funcional | ⚠️ ALTER de columnas uplift (tolerante si no aplicado) |
| CRUD gastos (alta directa `enviado`, sin borrador) | ✅ funcional | — |
| Aprobación de gastos (admin/revisor) | ✅ funcional | — |
| Bulk actions gastos (autorizar/cancelar/eliminar) | ✅ funcional | — |
| Pagos atómicos (create+confirm) | ✅ funcional | — |
| Anular pago (genera reversa de movimiento) | ✅ funcional vía `fn_anular_pago` | — |
| Obligaciones pendientes con saldo | ✅ vista `v_obligaciones_pendientes` | — |
| Anti-overpayment | ✅ funcional | — |
| Recurrentes (auto-gen mensual) | ✅ funcional | — |
| Comprobantes en Storage | ✅ funcional | — |
| Excel export gastos | ✅ funcional | — |
| Códigos funcionales G000001/P000001 | ✅ código tolerante | ⚠️ SQL pendiente (sequence + trigger) |
| Cuenta corriente entre fondos (Etapa 1) | ✅ código read-only | ⚠️ SQL pendiente (columnas + tabla + view) |
| Cuenta corriente Etapa 2 (UI dual selector) | ❌ no implementado | — |
| Cuenta corriente Etapa 3 (UI reintegros) | ❌ no implementado | — |
| Soft-delete Proveedores (RPC SECURITY DEFINER) | ✅ funcional | ✅ aplicado |
| Soft-delete Fondos (con guarda de saldo) | ✅ código | ⚠️ SQL pendiente (RPC + columnas) |
| Anular Gastos (Etapa B) | ❌ no implementado | — |
| Anular Pagos refinado (Etapa C) | ❌ no implementado | — |

## Estado de tablas

Datos: limpios. Se hizo reset el 2026-05-23 borrando fondos, gastos, pagos, movimientos, aportes, anticipos. Recurrentes y proveedores conservados.

## Stack visible

- Frontend hot-reloadea OK
- Dev server background ID actual: `bo4lhegmn` (verificar antes de matar)
- Build status: tsc clean. `npm run build` no se corre durante dev.

## Convenciones aplicadas

- ActionResult en todas las actions destructivas (delete, anular).
- SECURITY DEFINER RPC para soft-delete de Proveedores y Fondos.
- SELECTs tolerantes en pages que pueden tener columnas DB no migradas.
- Patrón de baja: "Dar de baja" para entidades sin estado de anulación; "Anular" cuando hay reverso financiero.

## Migraciones SQL pendientes (en orden recomendado de aplicación)

1. **Uplift en proveedores** (commit `2dd8f42`): `tiene_uplift`, `porcentaje_uplift`. Bloquea: edit con uplift. Sin esto el listado anda (tolerante).
2. **Codigo en gastos/pagos** (commit `9872748`): columnas `codigo` + secuencias + triggers. Bloquea: visualización de G/P codes. Sin esto los nuevos registros no reciben codigo.
3. **Cuenta corriente etapa 1** (commit `f66325b`): 4 columnas en pagos + tabla `movimientos_entre_fondos` + view `v_cuenta_corriente_fondos` + trigger flag. Versión v2 con disable temporal de fn_pagos_hardening.
4. **Soft delete fondo** (commit `62420fe`): RPC + columnas opcionales `deleted_by`, `motivo_baja`. Sin esto, `deleteFondo` falla (la action invoca el RPC y devuelve ActionResult error).

## Riesgos conocidos / debt

- `fn_pagos_hardening` bloquea cualquier UPDATE sobre `pagos.estado='pagado'`. Las migraciones que tocan `pagos` deben desactivarlo temporalmente (ver `/safe-db-migration`).
- Comprobantes en Supabase Storage no se limpian cuando se borra gasto vía bulk. Quedan huérfanos. Solución manual o script separado.
- `gastos_recurrentes` no se limpia con el reset operativo; las definiciones siguen ahí y generan gastos en cada `GET /gastos`.
