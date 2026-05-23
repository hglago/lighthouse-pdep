# TASK.md

Tarea actual. Solo la activa. Cuando se cierre, reemplazar contenido.

## Checkpoint de sesión — 2026-05-23

Refactor Pagos rama RISA vs Financiador (Etapa 4) **en curso**. SQL P4b entregado y pendiente de aplicar por el usuario. Resto de etapas P3 (servicio por hora) cerradas.

## Próximos pasos al retomar (en orden)

### Paso A — Aplicar SQL P4b en Supabase

El bloque idempotente ya está entregado en el chat previo. Modifica in-place:

- `fn_confirmar_pago(p_pago_id uuid)` — branching por `gasto.forma_cancelacion`.
- `fn_anular_pago(p_pago_id uuid)` — branching por `pago.forma_cancelacion`.

Rama financiador: INSERT en `movimientos_financiacion` (tipo `'deuda_generada'` al confirmar, `'reversa'` al anular). NO toca `movimientos_fondo` ni saldo RISA. Setea `pagos.forma_cancelacion`, `financiador_id`, `afecta_saldo_risa=false`, `movimiento_financiacion_id`.

Rama RISA: comportamiento histórico (movimientos_fondo + saldo). Setea `pagos.forma_cancelacion='risa'`, `afecta_saldo_risa=true`.

Rollback disponible: los cuerpos previos están capturados en DIAG-1 y DIAG-2 del chat.

### Paso B — Validar VAL-1..3 post-aplicación

- VAL-1: cuerpo de `fn_confirmar_pago` contiene `v_es_financiado` y bloque "Rama financiador".
- VAL-2: cuerpo de `fn_anular_pago` contiene `IF v_pago.forma_cancelacion = 'financiador'`.
- VAL-3: triggers en `pagos` siguen siendo 4 (`trg_audit_pagos`, `trg_pagos_hardening`, `trg_pagos_set_nro`, `trg_pagos_updated_at`).

### Paso C — Smoke test gasto RISA (regresión)

Crear gasto con `forma_cancelacion='risa'`, aprobar, pagar parcial. Verificar:
- 1 fila en `movimientos_fondo` (débito).
- Saldo RISA bajó.
- Al anular: 2 filas (débito + crédito), saldo vuelve.
- 0 filas en `movimientos_financiacion`.

### Paso D — Smoke test gasto financiado (cambio funcional)

Crear gasto con `forma_cancelacion='financiador'` + `financiador_id=<FIN-X>`, aprobar, pagar parcial. Verificar:
- 1 fila en `movimientos_financiacion` con `tipo='deuda_generada'`, importe = monto del pago.
- 0 filas en `movimientos_fondo` para ese pago.
- Saldo RISA sin cambios.
- `v_saldos_financiadores` muestra `saldo_pendiente` = importe del pago.
- `pagos.estado='pagado'`, `forma_cancelacion='financiador'`, `afecta_saldo_risa=false`, `movimiento_financiacion_id` poblado.
- Al anular: 2 filas (`deuda_generada` + `reversa`), saldo_pendiente vuelve a 0.

### Paso E — Si P4b OK, avanzar a P4c

**P4c — UI Pagos** (próxima etapa de código, bloqueada por P4b):
- Limpiar código zombie D14 (`fondo_pagador_id`, `fondo_responsable_id`, `genera_deuda_interna`, `deuda_interna_id`) de `pagos/page.tsx` SELECT y `PagosClient.PagoRow`.
- Extender SELECT con join a gastos para traer `forma_cancelacion`, `financiador_id`, `financiadores(codigo, nombre)`.
- Badge en tabla y modal: "Se cancelará con RISA" o "Se cancelará con financiador FIN-### Nombre".
- Si financiado, mostrar texto "Este pago generará deuda pendiente con el financiador."
- UX toggle "Pago total" / "Pago parcial". Pago total = saldo pendiente del gasto. Pago parcial = input editable con cap por saldo.
- Validación cliente reutiliza `validarSaldoPendiente`.

### Paso F — Después de P4c, P4d

**P4d — UI Fondos cuenta corriente financiadores**:
- Auditar `FondosClient.tsx` para decidir sección vs tab.
- Resumen via `v_saldos_financiadores` (ya cargada en `/fondos/page.tsx`).
- Detalle expandible por financiador desde `movimientos_financiacion`.

## Etapas cerradas en esta sesión

| Etapa | Commit | Resultado |
|---|---|---|
| **P1** (SQL servicios por hora + snapshot uplift) | `795137f` (docs) | ✅ Aplicada y validada en Supabase |
| **P2** (UI Proveedores) | `ea13d07` | ✅ Validada manualmente por usuario |
| **P3a** (UI Gastos servicio por hora) | `f63635c` | ✅ Validado por usuario |
| **P3a-fix** (input Horas + checkbox opt-in) | `382684b` | ✅ Validado por usuario |
| **P3a-fc** (forma_cancelacion en Gasto, sin generar deuda) | `193f478` | ✅ Funcional |
| **Versión visible en UI** | `1f347b7` | ✅ Sidebar muestra tag · commit · env |

## En curso

| Etapa | Estado |
|---|---|
| **P4a** (DIAG SQL) | ✅ Diagnóstico completo. Confirmado bug en `fn_confirmar_pago` + `fn_anular_pago`. |
| **P4b** (SQL update RPC pagos) | ⏸ SQL entregado, **pendiente de aplicar por el usuario en Supabase** |
| **P4c** (UI Pagos) | ⏸ Bloqueada por P4b |
| **P4d** (UI Fondos CC financiadores) | ⏸ Bloqueada por P4c |
| **Post-P4** (recuperar stash 3B) | ⏸ `stash@{0}` intacto como referencia |

## Restricciones vigentes

- NO avanzar a P4c sin que P4b esté aplicado y validado.
- NO tocar Fondos / Proveedores / Honorarios fuera del scope P4d.
- NO aplicar migración vieja `movimientos_entre_fondos` (D14).
- NO usar service_role en frontend.
- NO desactivar RLS.
- NO recuperar `stash@{0}` (sigue como referencia hasta cerrar P4).
- NO usar palabra "Prestamista" en UI (D16).
- NO mostrar UUID como identificador principal (D18).

## Decisiones funcionales clave activas (chequear `DECISIONS.md`)

- **D16**: RISA único + financiadores externos.
- **D18**: Código / N° transacción en listados.
- **D21**: Honorarios deprecado operativamente (P4d implementará UI).
- **D22**: Uplift solo informativo.
- **D23**: Recurrentes con servicio por hora copian snapshot.

## Volver al hito si algo se rompe

```bash
# Tag estable v0.2.0-risa-fondos:
git reset --hard v0.2.0-risa-fondos
```

Para revertir P4b (si se aplica y rompe): los cuerpos originales de `fn_confirmar_pago` y `fn_anular_pago` están en DIAG-1 / DIAG-2 del chat — pegarlos como `CREATE OR REPLACE FUNCTION ...` y aplicar.

Las columnas P1 son aditivas con defaults (`false` / `0` / `NULL`), no rompen flujos existentes.
