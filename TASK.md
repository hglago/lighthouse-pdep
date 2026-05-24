# TASK.md

Tarea actual. Solo la activa. Cuando se cierre, reemplazar contenido.

## Checkpoint de sesión — 2026-05-24

Refactor Pagos rama Medios Propios vs Tercero (Etapa 4) **en curso**. SQL P4b entregado y pendiente de aplicar por el usuario. Cambios de UI Gastos (G1 + F1-pre) están en working tree **sin commit**, esperando que P4b se aplique y se apague dev.

## Modelo financiero vigente (decisión 2026-05-24)

**Posición Global RISA (PG)** = **Medios Propios (MP)** + **Medios Terceros (MT)**

- **MP** = `fondos.saldo_actual` donde `codigo='FON-001'`. Fuente: `movimientos_fondo`.
- **MT** = `-SUM(v_saldos_financiadores.saldo_pendiente)`. Fuente: `movimientos_financiacion`.
- En UI hablamos de "Medios Propios RISA" y "Terceros (de la red)". Internamente la tabla sigue siendo `financiadores` y la columna `forma_cancelacion='financiador'` para back-compat. Nunca usar "Prestamista".

## Orden vigente al retomar (estricto)

### Paso A — Aplicar SQL P4b en Supabase

Vos. Bloque entregado en chat. Modifica in-place:
- `fn_confirmar_pago(p_pago_id uuid)` — branching por `gasto.forma_cancelacion`.
- `fn_anular_pago(p_pago_id uuid)` — branching por `pago.forma_cancelacion`.

Rama tercero: INSERT en `movimientos_financiacion` (`'deuda_generada'` al confirmar, `'reversa'` al anular). NO toca `movimientos_fondo` ni saldo RISA. Setea `pagos.forma_cancelacion='financiador'`, `financiador_id`, `afecta_saldo_risa=false`, `movimiento_financiacion_id`.

Rama RISA: histórico (movimientos_fondo + saldo). Setea `pagos.forma_cancelacion='risa'`, `afecta_saldo_risa=true`.

Rollback: cuerpos previos capturados en DIAG-1 y DIAG-2 del chat.

### Paso B — Validar P4b (VAL-1..3 + smoke RISA + smoke tercero)

- VAL-1: cuerpo de `fn_confirmar_pago` contiene `v_es_financiado` y bloque "Rama financiador".
- VAL-2: cuerpo de `fn_anular_pago` contiene `IF v_pago.forma_cancelacion = 'financiador'`.
- VAL-3: triggers en `pagos` siguen siendo 4 (`trg_audit_pagos`, `trg_pagos_hardening`, `trg_pagos_set_nro`, `trg_pagos_updated_at`).
- Smoke RISA: gasto risa, pagar parcial → 1 fila `movimientos_fondo` débito, saldo bajó; anular → 2 filas, saldo vuelve.
- Smoke tercero: gasto con `forma_cancelacion='financiador'` y `financiador_id=<FIN-X>`, pagar parcial → 1 fila `movimientos_financiacion` (`'deuda_generada'`, importe=monto pago), 0 filas en `movimientos_fondo`, RISA sin cambios, `v_saldos_financiadores` muestra `saldo_pendiente`; anular → 2 filas (`deuda_generada` + `reversa`), saldo vuelve a 0.

### Paso C — Build + commit + push de G1 + F1-pre

Después de P4b aplicado y validado + dev apagado:
- 5 archivos en working tree (G1 = ocultar fondo selector + auto-asignar RISA; F1-pre = nomenclatura "Canal de pago" / "Medios propios RISA" / "Tercero de la red" en modal de Gasto + badges tabla).
- `npx tsc --noEmit` (ya OK).
- `npm run build`.
- Commit + push.

### Paso D — Implementar P4c (modal Registrar pago)

Recién después del Paso C.

**Spec exhaustiva** (recibida 2026-05-24):

#### Regla central

Un pago NO es carga manual libre — es la **confirmación de una obligación pendiente** ya existente. Al seleccionar la obligación, los datos del gasto se heredan y bloquean.

#### Selector de obligación

Sí debe existir, con etiquetas claras:
- `[G000001] CARTEL — Leonardo Wilson — Medios propios RISA — Saldo pendiente $4.980`
- `[G000002] DISEÑO — PAI — Tercero NFSA — Saldo pendiente $10.000`

#### Eliminar del formulario editable

- Selector Fondo (input/select) ❌
- Selector Proveedor (input/select) ❌
- Input Concepto ❌
- Input Moneda ❌

#### Reemplazar por bloque "Resumen de obligación" (solo lectura)

- N° gasto
- Proveedor
- Concepto
- Fondo operativo: **RISA** (siempre)
- Canal de pago: `Medios propios RISA` o `Tercero de la red — FIN-### Nombre`
- Importe total del gasto
- Total ya pagado
- Saldo pendiente
- Moneda

#### Campos editables del pago

- Fecha de pago
- Tipo de pago: radio `Pago total` / `Pago parcial`
- Importe (solo si parcial)
- URL comprobante
- Notas

#### Default

`Pago total` seleccionado. Importe = saldo pendiente, readonly. Texto: _"Se pagará el saldo pendiente completo."_

#### Pago parcial

Importe editable. Debe ser `> 0` y `<= saldo pendiente`. Si supera: `"El importe a pagar no puede superar el saldo pendiente del gasto."`

#### Canal de pago (heredado del gasto, no editable)

Si `forma_cancelacion='risa'`:
- Línea: `"Canal de pago: Medios propios RISA"`
- Texto: _"Este pago afectará Medios Propios RISA."_

Si `forma_cancelacion='financiador'`:
- Línea: `"Canal de pago: Tercero de la red — FIN-### Nombre"`
- Texto: _"Este pago se registrará en la cuenta corriente del tercero. No afecta Medios Propios RISA."_

#### Concepto automático

`"Pago de G000001 — CARTEL"` o `"Pago parcial de G000001 — CARTEL"`. No editable.

#### Separar conceptos en UI

- **A. Parte de la obligación** (informativo, viene de la obligación): Gasto / Anticipo / Saldo / Recurrente.
- **B. Modalidad del pago** (decide el usuario): Pago total / Pago parcial.

Mapeo a enum `pagos.tipo`: gasto común → `'gasto'`; anticipo → `'anticipo'`; saldo → `'saldo_anticipo'`; recurrente → `'recurrente'`.

#### Tabla de pagos — columnas claras

- N° pago / `nro_pago`
- N° gasto
- Parte pagada: Gasto / Anticipo / Saldo / Pago parcial / Pago final
- Proveedor
- Concepto
- Importe pagado
- Canal: `Medios propios RISA` o `Tercero: FIN-### Nombre`
- Estado
- Fecha
- (sin UUID visible)

#### Validaciones manuales (9 casos)

1. Seleccionar obligación RISA → Fondo/Proveedor/Concepto/Moneda no editables; muestra canal Medios propios RISA; Pago total default; importe=saldo pendiente readonly.
2. Cambiar a Pago parcial → importe editable; bloquea importe > saldo.
3. Seleccionar obligación por tercero → muestra Tercero de la red; no permite cambiar tercero desde el pago; no permite cambiar fondo/proveedor/concepto.
4. Registrar pago total → pago creado por saldo pendiente.
5. Registrar pago parcial → pago creado por importe parcial; saldo pendiente queda correcto.
6. Confirmar que no aparece "Financiador" ni "Prestamista" en UI.
7. Confirmar que no se muestran UUID.
8. `npx tsc --noEmit`.
9. `npm run build`.

#### Restricciones P4c

- NO tocar Supabase.
- NO modificar `fn_confirmar_pago` ni `fn_anular_pago`.
- NO tocar Proveedores / Fondos / Honorarios.
- NO cambiar schema.
- NO usar service_role.
- NO desactivar RLS.
- Solo UI/UX y payload de Pagos.

### Paso E — P4d UI Fondos (Posición Global RISA + cuenta corriente terceros)

Después de P4c. Sin tocar SQL. Usar `v_saldos_financiadores` ya cargada en `/fondos/page.tsx` + vista nueva `v_posicion_global_risa` (planeada en F5).

## Estado del repo

| Commit | Qué cierra |
|---|---|
| `f1d91d5` | Checkpoint docs P4b pendiente (sesión 2026-05-23) |
| `1f347b7` | Versión visible en sidebar |
| `193f478` | P3a-fc forma_cancelacion en Gasto |
| `382684b` | P3a-fix opt-in + input Horas |
| `f63635c` | P3a UI Gastos servicio por hora |
| `ea13d07` | P2 UI Proveedores |
| `795137f` | Docs P1 servicios por hora + uplift snapshot |
| Tag estable | `v0.2.0-risa-fondos` (RISA + Socios + Financiadores + Aportes) |

## Pendientes técnicos

| Etapa | Estado |
|---|---|
| **P4b** SQL Pagos | ⏸ Entregado en chat, **no aplicado** en Supabase |
| **G1** ocultar fondo selector + auto-RISA | ⏸ Working tree, sin commit |
| **F1-pre** nomenclatura "Canal de pago" / "Medios propios RISA" / "Tercero de la red" en Gasto | ⏸ Working tree, sin commit |
| **P4c** UI modal Registrar pago | ⏸ Bloqueado por P4b + G1+F1-pre |
| **P4d** UI Fondos PG + cuenta corriente terceros | ⏸ Bloqueado por P4c |
| **F1 completo** (resto de UI: Proveedores, Fondos, Pagos) | ⏸ Bloqueado por P4c |
| **F2..F7** (aporte_imputaciones + RPC + vista PG + UI Aportes) | ⏸ Después de P4 entero |
| **stash@{0}** (3B forma_cancelacion radio buttons) | ⏸ Intacto como referencia; descartable post-P4 |

## Restricciones vigentes

- NO avanzar a P4c hasta que P4b esté aplicado y validado, **y** G1+F1-pre estén commiteados.
- NO acumular más cambios en working tree mientras P4b está pendiente.
- NO tocar Fondos / Proveedores / Honorarios fuera de scope.
- NO aplicar migración vieja `movimientos_entre_fondos` (D14).
- NO usar `service_role` en frontend.
- NO desactivar RLS.
- NO recuperar `stash@{0}` hasta cerrar P4.
- NO usar "Prestamista" en UI (D16). Usar "Tercero".
- NO mostrar UUID como identificador principal (D18).

## Decisiones funcionales clave activas (ver `DECISIONS.md`)

- **D16**: RISA único + financiadores externos.
- **D18**: Código / N° transacción en listados, no UUID.
- **D21**: Honorarios deprecado operativamente (cargado como Gasto).
- **D22**: Uplift solo informativo (snapshot para liquidación futura).
- **D23**: Recurrentes con servicio por hora copian snapshot al gasto generado.
- **2026-05-24** (informal, pendiente formalizar en `DECISIONS.md`): `fondos.saldo_actual` = Medios Propios RISA (MP), no Posición Global RISA. PG = MP + MT. Tabla `financiadores` se mantiene pero UI dice "Tercero".

## Volver al hito si algo se rompe

```bash
git reset --hard v0.2.0-risa-fondos
```

Para revertir P4b post-apply: pegar cuerpos originales (DIAG-1 / DIAG-2 del chat) como `CREATE OR REPLACE FUNCTION ...` y aplicar.
