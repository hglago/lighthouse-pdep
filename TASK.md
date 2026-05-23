# TASK.md

Tarea actual. Solo la activa. Cuando se cierre, reemplazar contenido.

## Tarea: Refactor Proveedores con servicios por hora + deprecar Honorarios — **P1 cerrada, P2 próxima**

Cambio de prioridad confirmado 2026-05-23: pausamos Etapa 3B Gastos (`forma_cancelacion`) — quedó en `stash@{0}` con mensaje "WIP Etapa 3B Gastos - forma_cancelacion" — para implementar primero el modelo unificado Proveedores/Gastos con servicio por hora y deprecar el módulo Honorarios.

### Decisiones funcionales cerradas (2026-05-23)

- Columna en proveedores: **`valor_hora`** (no `tarifa_hora`).
- Recurrentes **SÍ** soportan servicio por hora (campos espejo en `gastos_recurrentes`, sin período — se calcula al generar).
- Deprecación Honorarios = **Opción B**: sacar de sidebar, página con mensaje "Módulo deprecado — los honorarios ahora se cargan como Gasto con proveedor por horas. → Ir a Gastos". Middleware y permisos `honorarios:*` quedan inertes pero presentes (D21).
- Uplift **no modifica** importes operativos. Solo snapshot informativo para futura liquidación a socios (D22).
- Recurrentes con servicio por hora **copian snapshot** al gasto generado, no leen en vivo del proveedor (D23).
- Stash 3B (`forma_cancelacion`) se resuelve **después de P4** — no aplicar, no descartar.

### Estado de etapas del refactor activo

| Etapa | Scope | Estado |
|---|---|---|
| **P1** | SQL idempotente: proveedores (+permite_horas_servicio, +valor_hora) + gastos (+8 columnas snapshot + CHECK) + gastos_recurrentes (+6 columnas espejo + CHECK). NOTIFY pgrst. | ✅ **APLICADA Y VALIDADA 2026-05-23** (VAL-1..9 OK) |
| **P2** | UI Proveedores: types/database.ts + ProveedoresClient (checkbox + valor_hora en modal + columna "Servicio" en tabla) + actions tolerantes (extender `normalizeProveedor`, `stripCamposOpcionales`) + page.tsx tolerante. Sin tocar Gastos. | ⏸ **Próxima** — esperando confirmación |
| **P3** | UI Gastos + UI Gastos recurrentes con bloque `DetalleServicioBlock` reusable. Extender `GastoPayload` + page.tsx. **Plus**: SQL UPDATE de `fn_generar_gastos_recurrentes` para copiar snapshot + calcular período del mes (D23). | ⏸ Pendiente |
| **P4** | Quitar entry "Honorarios" del Sidebar. `/honorarios/page.tsx` → mensaje deprecado + link a `/gastos`. Documentar en RELEASES.md. | ⏸ Pendiente |
| **Post-P4** | `git stash pop stash@{0}` → resolver merge con código P3 → cerrar Etapa 3B Gastos `forma_cancelacion`. | ⏸ Pendiente, bloqueada por P4 |

### Estado de etapas previas (referencia)

| Etapa | Scope | Estado |
|---|---|---|
| 0–F1 + tag v0.2.0-risa-fondos | Modelo RISA + Socios + Financiadores + Aportes + DataTable global | ✅ Cerradas |
| 3B Gastos (`forma_cancelacion`) | UI RISA / Financiador en modal de gastos | ⏸ stasheado en `stash@{0}`, retoma post-P4 |
| 4 Pagos (rama RISA vs financiador) | UI Pagos | ⏸ Pendiente, post P3-P4 |
| 5 Anulaciones / reversas | — | ⏸ Pendiente |

### Próximo paso — P2 UI Proveedores

Scope objetivo (a confirmar antes de implementar):

- `src/types/database.ts`: extender interface `Proveedor` con `permite_horas_servicio: boolean` y `valor_hora: number`.
- `src/app/(dashboard)/proveedores/actions.ts`:
  - Extender `ProveedorPayload` con los dos campos.
  - Renombrar `normalizeUplift` → `normalizeProveedor` y normalizar ambos bloques (uplift + horas).
  - Renombrar `stripUplift` → `stripCamposOpcionales` y remover también los nuevos campos en el retry.
  - Extender `isUpliftColumnMissingError` para detectar `permite_horas_servicio`/`valor_hora`.
  - `createProveedorQuick` queda intacto (sigue creando proveedor común; el flag de horas se setea desde el modal completo).
- `src/app/(dashboard)/proveedores/page.tsx`: extender el SELECT enriquecido (segundo SELECT tolerante) con los dos campos nuevos, hidratar defaults (`false` / `0`).
- `src/app/(dashboard)/proveedores/ProveedoresClient.tsx`:
  - Nuevo bloque "Tipo de proveedor" en modal: checkbox "Permite cargar horas de servicio" + input `valor_hora` (visible solo si el checkbox está activo).
  - Validación cliente: si `permite_horas_servicio=true`, `valor_hora` debe ser numérico ≥ 0.
  - Nueva columna "Servicio" en tabla (entre Teléfono y Uplift), badge: "Por hora — $20.000" si aplica, "—" si no.
  - `searchKeys` no se extiende (no aporta filtrar por valor_hora).
- Validación: `npx tsc --noEmit` + `npm run build` (con dev server apagado, D6).

### Decisiones a confirmar antes de P2

1. ¿Aplicar P2 + commit + push antes de pasar a P3? (sí por default — etapas shippables D13/D20)
2. ¿Splitear P3 en P3a (UI Gastos) y P3b (UI Recurrentes + SQL `fn_generar_gastos_recurrentes`) para reducir scope por etapa?
3. Estilo del nuevo bloque "Tipo de proveedor": ¿caja indigo igual que uplift, o caja gris neutra?

### Restricciones que siguen vigentes

- NO tocar Pagos / Fondos / `registrar_aporte_socio` / `fn_pagos_hardening` durante P2.
- NO tocar `fn_generar_gastos_recurrentes` en P2. Su update entra en P3.
- NO aplicar migración vieja de cuenta corriente entre fondos (D14).
- NO usar service_role.
- NO desactivar RLS.
- NO usar palabra "Prestamista".
- NO recuperar `stash@{0}` hasta que se cierre P4.
- Cierre cada hito con tag si la magnitud lo justifica (D20).

### Volver al hito si algo se rompe

```bash
# Volver al tag estable previo:
git reset --hard v0.2.0-risa-fondos
# Si P1 ya se aplicó en DB, revertir manualmente (DROP COLUMN IF EXISTS) o aceptar el schema extendido.
```

Las columnas de P1 son aditivas con defaults `false` / `0` / `NULL`, por lo que no rompen flujos existentes — el código actual sigue funcionando sin ellas (SELECT tolerante de proveedores ya cubre el caso).
