# RELEASES.md

Hitos estables del proyecto. Cada entrada corresponde a un tag Git anotado.

Convención de versionado: `vMAJOR.MINOR.PATCH-<scope>` donde `<scope>` describe el dominio funcional cerrado.

---

## v0.2.0-risa-fondos

**Fecha**: 2026-05-23
**Tag**: `v0.2.0-risa-fondos`
**Commit base**: `e6195fd` (Etapa F1) — el tag se crea en este commit.

### Hito

**Modelo RISA + Socios + Financiadores + Aportes.**

Primer punto estable del refactor financiero. RISA queda operativa como único fondo, los socios pueden registrar aportes que afectan el saldo, y la infraestructura para deudas con financiadores externos está lista (pendiente de uso real desde Etapa 4).

### Incluido en esta versión

#### Base de datos (Etapa 1)
- Tabla `socios` con codigo `SOC-###` (trigger + sequence + UNIQUE)
- Tabla `financiadores` con codigo `FIN-###`
- Tabla `movimientos_financiacion` (ledger de deuda con financiadores externos)
- View `v_saldos_financiadores`
- Columna `fondos.codigo` (FON-###); RISA inicial como `FON-001`
- Columna `aportes_fondo.codigo` (APO-###) + `socio_id` + `destino_aporte` + `financiador_id`
- Columnas en `gastos`: `forma_cancelacion`, `financiador_id` (sin uso UI todavía)
- Columnas en `pagos`: `forma_cancelacion`, `financiador_id`, `afecta_saldo_risa`, `movimiento_financiacion_id` (sin uso UI todavía)
- Constraint `fondos_saldo_no_negativo` eliminada — RISA puede quedar con saldo negativo
- Columna `movimientos_fondo.aporte_id` (trazabilidad mov → aporte para mostrar N° transacción en cuenta corriente)
- RLS policies básicas en las 3 tablas nuevas (SELECT/INSERT/UPDATE para `authenticated`, sin DELETE)

#### RPC
- `registrar_aporte_socio(p_destino_aporte, p_fecha, p_financiador_id, p_importe, p_moneda, p_observaciones, p_socio_id)`:
  - SECURITY DEFINER, transaccional
  - Destino RISA: INSERT aporte + INSERT movimiento_fondo (credito con `aporte_id` para trazabilidad) + UPDATE saldo
  - Destino cancelación financiación: INSERT aporte + INSERT movimientos_financiacion (`cancelacion_por_aporte`), sin tocar saldo RISA. Bloquea si importe > saldo pendiente
- `soft_delete_proveedor`, `soft_delete_fondo` (ya existentes pre-RISA)
- Triggers BEFORE INSERT para codigos: FON / APO / FIN / SOC

#### UI Fondos (Etapa 2A → 2D + F1)
- Header rebrandeado: "Caja RISA y financiación"
- Card resumen RISA con `FON-001`, saldo (rojo si negativo), estado
- 3 botones operativos: "Nuevo aporte", "Nuevo socio", "Nuevo financiador"
- 3 modales con validaciones cliente
- 5 tablas read-write con `DataTable<T>`:
  - Aportes (con N° transacción APO-###)
  - Cuenta corriente RISA (con N° transacción derivado de aporte_id)
  - Socios (con código SOC-###)
  - Financiadores (con código FIN-###)
  - Financiación pendiente (vista `v_saldos_financiadores`)
- Cada tabla con: input de búsqueda, filtros por columna (text/number/date/enum), sort click-to-toggle, botón "Limpiar filtros", empty states diferenciados ("registrados" vs "que coincidan con filtros")
- Alert post-creación de aporte: `"Aporte APO-001 registrado correctamente."`
- Sin UUID visible como identificador principal

#### Documentación
- 8 docs operativos: `CLAUDE.md`, `CONTEXT.md`, `TASK.md`, `DECISIONS.md`, `DB.md`, `RLS_RPC.md`, `MODULES.md`, `TESTING.md`
- 4 slash commands en `.claude/commands/`
- Decisiones cerradas hasta D20:
  - D1–D13: convenciones generales (ActionResult, SELECT tolerante, soft-delete, etc.)
  - D14: Deprecación cuenta corriente vieja entre fondos
  - D15: `socio_id` como FK principal en `aportes_fondo`
  - D16: Modelo RISA único + financiadores externos
  - D17: (no asignado)
  - D18: Código vs N° transacción en todos los listados
  - D19: Búsqueda + filtros + sort obligatorios en todos los listados
  - D20: Versionado de hitos estables (esta misma)

### Pendiente para próximas versiones

- **Gastos** con campo "Forma de cancelación" (RISA / Financiador). Selector financiador con alta rápida. Columnas DB ya existen pero la UI no las usa.
- **Pagos** con rama RISA vs financiador. Generación de deuda al confirmar pago con financiador (poblará `movimientos_financiacion` tipo `'deuda_generada'`).
- **Cancelación real de financiación con aporte**: la rama del RPC ya existe pero requiere deuda generada en `movimientos_financiacion` para testearse end-to-end. Recién aparece deuda cuando se ejecute el flujo de pago con financiador.
- **Anulaciones / reversas**: revertir saldo RISA, reversar movimientos_financiacion, respetar `fn_pagos_hardening`.
- **Filtros globales en otros módulos**: Etapas F2 (Proveedores), F3 (Gastos), F4 (Pagos), F5 (Anticipos / Honorarios / Rendiciones si existen).
- **Migración vieja de cuenta corriente entre fondos** (`fondo_pagador_id` / `fondo_responsable_id` / `movimientos_entre_fondos`, commit `f66325b`): queda **deprecada** (D14). No aplicar.

### Cómo volver a este punto si algo se rompe

```bash
git checkout v0.2.0-risa-fondos    # detached HEAD, solo para inspección
# o para volver a tomar este punto como base:
git reset --hard v0.2.0-risa-fondos
```

Si se aplicaron SQL post-tag que rompen, hay que revertir esas migraciones manualmente — los tags Git no incluyen estado de DB.

### SQL aplicado al momento del tag

| Migración | Estado |
|---|---|
| Etapa 1 nuevo modelo financiero | ✅ aplicada |
| `socios.codigo` (Etapa 2B SQL) | ✅ aplicada |
| RPC `registrar_aporte_socio` v1 (Etapa 2C SQL) | ✅ aplicada y reemplazada por v2 |
| `movimientos_fondo.aporte_id` + RPC v2 (Etapa 2D SQL) | ✅ aplicada |
| Uplift proveedores (commit `2dd8f42`) | ⚠️ código tolerante; SQL no aplicado |
| Codigo G/P (commit `9872748`) | ⚠️ código tolerante; SQL no aplicado |
| Cuenta corriente vieja entre fondos (commit `f66325b`) | ❌ deprecada — NO aplicar |
| Soft-delete fondo (commit `62420fe`) | ⚠️ RPC no aplicada; columnas sí (entraron en Etapa 1) |
