# DB.md

Esquema Supabase conocido. Solo lo confirmado tocando el código + migraciones aplicadas.

## Tablas operativas

### `fondos`
- `id uuid PK`
- `codigo text UNIQUE` (FON-### asignado por trigger `trg_set_fondo_codigo`) — **Etapa 1 aplicada**
- `nombre text NOT NULL`
- `descripcion text`
- `monto_inicial numeric`
- `saldo_actual numeric` (actualizado por movimientos_fondo). **Puede ser negativo** (constraint `fondos_saldo_no_negativo` eliminada en Etapa 1)
- `moneda text` (ARS, USD, EUR)
- `estado FondoEstado` ('activo' | 'cerrado' | 'suspendido')
- `responsable_id uuid`
- `created_by uuid`
- `created_at, updated_at`
- `deleted_at, deleted_by uuid, motivo_baja text` (agregadas en Etapa 1)

**Inicial**: `RISA` (`codigo='FON-001'`, saldo 0, ARS, activo) creada en Etapa 1.

### `proveedores`
- `id uuid PK`
- `nombre text`
- `cuit text` (UNIQUE parcial)
- `email, telefono, direccion, observaciones`
- `activo bool`
- `tiene_uplift bool` (post-migración uplift, default false)
- `porcentaje_uplift numeric(6,2)` (post-migración uplift) — CHECK `porcentaje_uplift >= 0`
- **`permite_horas_servicio boolean NOT NULL DEFAULT false`** — P1 (2026-05-23)
- **`valor_hora numeric(14,2) NOT NULL DEFAULT 0`** — P1. CHECK `valor_hora >= 0`
- `created_by, created_at, updated_at, deleted_at`

**Reglas de servicios por hora** (validación en UI + server action, no constraint cruzado en DB):
- Si `permite_horas_servicio = false`, `valor_hora` puede quedar en 0 (default).
- Si `permite_horas_servicio = true`, la UI exige `valor_hora >= 0` (típicamente > 0).
- D22: `tiene_uplift` + `porcentaje_uplift` son **informativos** (snapshot a gastos), no afectan importes operativos.

### `gastos`
- `id uuid PK`
- `codigo text` (post-migración codigo, G######, SQL pendiente)
- `fondo_id uuid → fondos(id)` (responsable económico legacy)
- **`forma_cancelacion text NOT NULL DEFAULT 'risa'`** CHECK IN ('risa', 'financiador') — Etapa 1
- **`financiador_id uuid REFERENCES financiadores(id)`** — Etapa 1
- CHECK: si `forma='risa'` → `financiador_id IS NULL`; si `forma='financiador'` → `financiador_id IS NOT NULL`
- `proveedor_id uuid → proveedores(id)` (nullable)
- `descripcion text NOT NULL` (importante: NOT NULL bloquea inserts vacíos)
- `monto numeric`, `moneda text`
- `estado GastoEstado` ('borrador' | 'enviado' | 'aprobado' | 'pagado_parcial' | 'pagado' | 'rechazado')
- `fecha_gasto DATE NOT NULL` — cuándo ocurrió el gasto
- `fecha_vencimiento DATE` — vencimiento documental/contractual (nullable, opcional)
- **`fecha_pago_prevista DATE NOT NULL`** — planificación operativa de pago. Base para necesidad semanal del Dashboard. Backfill: `COALESCE(fecha_vencimiento, fecha_gasto)` — DASH0.1
- `notas text`
- `tiene_anticipo bool`, `monto_anticipo`, `porcentaje_anticipo`
- `comprobante_path text` (Storage bucket `comprobantes`)
- `comprobante_nombre, comprobante_mime, comprobante_size_bytes, comprobante_uploaded_by, comprobante_subido_en`
- `recurrente_id uuid → gastos_recurrentes(id)` (nullable)
- `periodo text` (YYYY-MM para recurrentes)
- `prioridad_pago int`
- `created_by, aprobado_por, aprobado_en, rechazado_por, rechazado_en`
- `created_at, updated_at, deleted_at`

**Snapshot de servicio por hora** (P1, 2026-05-23):
- **`es_servicio_horas boolean NOT NULL DEFAULT false`** — discriminador
- **`descripcion_servicio text`** — descripción del servicio prestado (NOT NULL si `es_servicio_horas=true`)
- **`periodo_servicio_desde date`**, **`periodo_servicio_hasta date`** — período de prestación (NOT NULL + `desde <= hasta` si `es_servicio_horas=true`)
- **`horas_servicio numeric(10,2)`** — horas facturadas (NOT NULL > 0 si `es_servicio_horas=true`)
- **`valor_hora_aplicado numeric(14,2)`** — snapshot del `valor_hora` del proveedor al momento de crear/editar (NOT NULL >= 0 si `es_servicio_horas=true`)
- **`porcentaje_uplift_snapshot numeric(6,2) NOT NULL DEFAULT 0`** — snapshot del uplift del proveedor (informativo, ver D22)
- **`importe_base_servicio numeric(14,2)`** — `horas_servicio × valor_hora_aplicado` (NOT NULL >= 0 si `es_servicio_horas=true`)
- CHECK `gastos_servicio_horas_coherente`: si `es_servicio_horas=true`, todos los campos NOT NULL + `abs(importe_base_servicio - horas × valor_hora_aplicado) < 0.01` + `abs(monto - importe_base_servicio) < 0.01`
- D22: `porcentaje_uplift_snapshot` NO se suma al `monto`, NO afecta pago/fondo/deuda. Solo para futura liquidación a socios.

### `pagos`
- `id uuid PK`
- `codigo text` (post-migración codigo, P######, SQL pendiente)
- `nro_pago text` (legacy)
- `fondo_id uuid → fondos(id)`
- **`forma_cancelacion text NOT NULL DEFAULT 'risa'`** CHECK IN ('risa', 'financiador') — Etapa 1
- **`financiador_id uuid REFERENCES financiadores(id)`** — Etapa 1
- **`afecta_saldo_risa boolean NOT NULL DEFAULT true`** CHECK coherente con `forma_cancelacion` — Etapa 1
- **`movimiento_financiacion_id uuid REFERENCES movimientos_financiacion(id)`** — Etapa 1
- (legacy del modelo de cuenta corriente entre fondos, NO usar): `fondo_pagador_id`, `fondo_responsable_id`, `genera_deuda_interna`, `deuda_interna_id` — solo presentes si se aplicó la SQL del commit `f66325b`, que está **deprecada (D14)**
- `proveedor_id uuid → proveedores(id)`
- `gasto_id, anticipo_id, gasto_recurrente_id uuid` (nullable)
- `tipo PagoTipo` ('gasto' | 'anticipo' | 'saldo_anticipo' | 'recurrente' | 'directo')
- `concepto text`, `monto numeric`, `moneda text`
- `fecha_pago, comprobante_url`
- `estado PagoEstado` ('borrador' | 'pagado' | 'anulado')
- `notas text`
- `created_by, anulado_por, anulado_en, created_at, updated_at`

### `aportes_fondo`
- `id uuid PK`
- **`codigo text UNIQUE`** (APO-### asignado por trigger) — Etapa 1
- `fondo_id uuid → fondos(id)`
- `movimiento_id uuid → movimientos_fondo(id)` (nullable)
- `fecha_aporte date`
- `monto numeric`, `moneda text`
- `tipo_aporte TipoAporte` ('aporte_socios' | 'transferencia' | 'ajuste' | 'reintegro' | 'otro')
- `aportante text` (legacy, mantener como display name secundario)
- **`socio_id uuid REFERENCES socios(id)`** (nuevo FK principal) — Etapa 1
- **`destino_aporte text NOT NULL DEFAULT 'risa'`** CHECK IN ('risa', 'cancelacion_financiacion') — Etapa 1
- **`financiador_id uuid REFERENCES financiadores(id)`** — Etapa 1
- CHECK: si `destino='risa'` → `financiador_id IS NULL`; si `destino='cancelacion_financiacion'` → `financiador_id IS NOT NULL`
- `concepto text`
- `comprobante_url, observaciones`
- `created_by, created_at, updated_at, deleted_at`

### `movimientos_fondo`
Ledger de movimientos de saldo por fondo. Actualizado por `fn_confirmar_pago`, `fn_anular_pago`, `fn_registrar_aporte`, y `registrar_aporte_socio`. NO tocar directo.

- `id uuid PK`
- `fondo_id uuid → fondos(id)`
- `pago_id uuid → pagos(id)` (nullable)
- `aporte_id uuid → aportes_fondo(id)` (nullable) — **Etapa 2D**: trazabilidad mov → aporte. Permite mostrar N° transacción `APO-###` en cuenta corriente RISA via JOIN.
- `tipo MovimientoTipo` ('debito' | 'credito')
- `monto numeric`
- `saldo_anterior, saldo_resultante numeric` (puede ser negativo)
- `concepto text`, `fecha`
- `created_by, created_at`

### `movimientos_entre_fondos` (DEPRECADA — D14, NO USAR)
Existe en código tolerante de pagos/page.tsx pero no se aplica.

### `socios` — Etapa 1 (extendido en Etapa 2B)
Aportantes que pueden depositar en RISA o cancelar financiación.

- `id uuid PK`
- `codigo text UNIQUE NOT NULL` (SOC-### asignado por trigger `trg_set_socio_codigo`) — **Etapa 2B**
- `nombre text NOT NULL`
- `cuit, email, telefono, observaciones text`
- `deleted_at timestamptz` (soft-delete)
- `created_by uuid REFERENCES auth.users(id)`
- `created_at, updated_at timestamptz`

### `financiadores` — Etapa 1
Terceros externos que cancelan gastos por cuenta de RISA.

- `id uuid PK`
- `codigo text UNIQUE` (FIN-### asignado por trigger)
- `nombre text NOT NULL`
- `cuit, email, telefono, observaciones text`
- `deleted_at timestamptz` (soft-delete)
- `created_by uuid REFERENCES auth.users(id)`
- `created_at, updated_at timestamptz`

### `movimientos_financiacion` — Etapa 1
Ledger de deuda entre RISA y cada financiador.

- `id uuid PK`
- `fecha date NOT NULL DEFAULT CURRENT_DATE`
- `financiador_id uuid NOT NULL REFERENCES financiadores(id)`
- `tipo_movimiento text` CHECK IN ('deuda_generada', 'cancelacion_por_aporte', 'ajuste', 'reversa')
- `importe numeric(14,2)` CHECK > 0 (signo viene del tipo)
- `moneda text NOT NULL`
- `gasto_id uuid REFERENCES gastos(id)` (nullable)
- `pago_id uuid REFERENCES pagos(id)` (nullable)
- `aporte_id uuid REFERENCES aportes_fondo(id)` (nullable)
- `socio_id uuid REFERENCES socios(id)` (nullable)
- `descripcion text`
- `created_by uuid REFERENCES auth.users(id)`
- `created_at timestamptz`

Indexes: financiador_id, gasto_id, pago_id, aporte_id.

### `gastos_recurrentes`
Definiciones de gastos que se auto-generan mensualmente. NO se borran en reset.

- `id, fondo_id, proveedor_id, concepto, categoria, monto, moneda`
- `dia_vencimiento int` (1-31)
- `fecha_inicio, fecha_fin`
- `activo bool`, `prioridad_pago int`
- `observaciones, created_by`

**Snapshot de servicio por hora** (P1, 2026-05-23) — campos espejo de `gastos` sin período (D23):
- **`es_servicio_horas boolean NOT NULL DEFAULT false`**
- **`descripcion_servicio text`** — descripción base del servicio (NOT NULL si `es_servicio_horas=true`)
- **`horas_servicio numeric(10,2)`** — horas mensuales típicas (NOT NULL > 0 si `es_servicio_horas=true`)
- **`valor_hora_aplicado numeric(14,2)`** — snapshot del `valor_hora` al crear el template
- **`porcentaje_uplift_snapshot numeric(6,2) NOT NULL DEFAULT 0`** — snapshot del uplift (informativo)
- **`importe_base_servicio numeric(14,2)`** — `horas_servicio × valor_hora_aplicado`
- CHECK `gastos_recurrentes_servicio_horas_coherente`: idéntico al de `gastos` salvo que no exige período (se calcula al generar)
- D23: cuando `fn_generar_gastos_recurrentes()` genere el gasto del mes (P3 pendiente), debe copiar el snapshot completo + calcular `periodo_servicio_desde = primer día del mes`, `periodo_servicio_hasta = último día del mes`. NO leer en vivo del proveedor.

### `reportes_dypsa` — REP4.1
Cabecera de informes Dypsa generados (snapshot congelado).

- `id uuid PK`
- **`codigo text UNIQUE NOT NULL`** (`IDY-000001`, asignado por trigger `trg_set_reporte_dypsa_codigo`)
- `fecha_desde date NOT NULL`, `fecha_hasta date NOT NULL` — CHECK `fecha_hasta >= fecha_desde`
- `fecha_generacion timestamptz NOT NULL DEFAULT now()`
- `generado_por uuid REFERENCES auth.users(id)`
- `total_informado numeric(14,2) NOT NULL DEFAULT 0`
- `moneda text NOT NULL DEFAULT 'ARS'`
- `cantidad_items int NOT NULL DEFAULT 0`
- `estado text NOT NULL DEFAULT 'emitido'`
- `created_at timestamptz NOT NULL DEFAULT now()`

### `reportes_dypsa_items` — REP4.1
Items congelados del informe Dypsa. Un gasto = una fila (UNIQUE reporte_id+gasto_id).

- `id uuid PK`
- `reporte_id uuid NOT NULL → reportes_dypsa(id) ON DELETE CASCADE`
- `gasto_id uuid NOT NULL → gastos(id)`
- `pago_id uuid → pagos(id)` — primer pago confirmado dentro del rango (referencia de inclusión)
- `fecha_gasto date`, `fecha_pago date`
- `periodo text` — YYYY-MM congelado
- `proveedor_nombre text NOT NULL DEFAULT 'Sin proveedor'` — nombre_informe ?? nombre ?? fallback
- `tipo_gasto_nombre text NOT NULL DEFAULT 'Sin clasificar'`
- `descripcion text`
- `moneda text NOT NULL`
- `monto_final_informe numeric(14,2) NOT NULL` — ya con uplift aplicado, sin exponer porcentaje
- `comprobante_path text` — referencia congelada al Storage
- `tiene_comprobante boolean NOT NULL DEFAULT false`
- `created_at timestamptz NOT NULL DEFAULT now()`

**Política de pagos parciales**: un gasto se incluye si tiene al menos un pago confirmado cuya `fecha_pago` cae dentro del rango. Si tiene múltiples pagos, se genera una sola fila. El importe informado se calcula sobre `gasto.monto` (no sobre suma de pagos). `pago_id`/`fecha_pago` son del primer pago confirmado dentro del rango.

### `anticipos`
- `id, proveedor_id, fondo_id, concepto`
- `monto_total, porcentaje_anticipo, monto_anticipo, monto_saldo`
- `moneda, fecha_acuerdo, fecha_vencimiento_saldo`
- `estado AnticipoEstado` ('borrador' | 'aprobado' | 'anticipo_pagado' | 'completado' | 'cancelado')

### `profiles`
- `id uuid PK = auth.users(id)`
- `email text`, `usuario_login text`, `full_name text`
- `role UserRole` ('admin' | 'contador' | 'revisor' | 'visualizador')
- `activo bool`
- `puede_exportar, puede_aprobar_gastos, puede_confirmar_pagos` (booleans)
- `fondo_default_id`, `notas_admin`
- `created_at, updated_at, deleted_at`

## Triggers conocidos

| Trigger | Tabla | Evento | Función | Qué hace |
|---|---|---|---|---|
| `fn_pagos_hardening` (varios triggers) | pagos | UPDATE | bloquea cambios sobre pagos confirmados (excepto a 'anulado') |
| **`trg_set_fondo_codigo`** | fondos | BEFORE INSERT | `fn_set_fondo_codigo` | Asigna `FON-###` si NEW.codigo es NULL — Etapa 1 |
| **`trg_set_aporte_codigo`** | aportes_fondo | BEFORE INSERT | `fn_set_aporte_codigo` | Asigna `APO-###` — Etapa 1 |
| **`trg_set_financiador_codigo`** | financiadores | BEFORE INSERT | `fn_set_financiador_codigo` | Asigna `FIN-###` — Etapa 1 |
| **`trg_set_socio_codigo`** | socios | BEFORE INSERT | `fn_set_socio_codigo` | Asigna `SOC-###` — Etapa 2B |
| `trg_set_pago_codigo` (SQL pendiente) | pagos | BEFORE INSERT | Asigna `P######` |
| `trg_set_gasto_codigo` (SQL pendiente) | gastos | BEFORE INSERT | Asigna `G######` |
| **`trg_set_reporte_dypsa_codigo`** | reportes_dypsa | BEFORE INSERT | `fn_set_reporte_dypsa_codigo` | Asigna `IDY-######` si NEW.codigo es NULL — REP4.1 |
| `trg_set_pago_genera_deuda` (deprecada D14) | pagos | BEFORE INSERT OR UPDATE | Setea flag genera_deuda_interna |
| `fn_recalc_gasto_estado` | gastos | AFTER pagos changes | Recalcula estado del gasto a pagado_parcial/pagado |
| `updated_at` | varias | BEFORE UPDATE | Setea `updated_at = now()` |

## Secuencias

| Sequence | Formato | Trigger asociado | Próximo valor |
|---|---|---|---|
| **`fondos_codigo_seq`** | FON-### | `fn_set_fondo_codigo` | next = 2 (FON-001 ocupado por RISA) |
| **`aportes_codigo_seq`** | APO-### | `fn_set_aporte_codigo` | next = 1 (APO-001) |
| **`financiadores_codigo_seq`** | FIN-### | `fn_set_financiador_codigo` | next = 1 (FIN-001) |
| **`socios_codigo_seq`** | SOC-### | `fn_set_socio_codigo` | next depende del backfill (1 si la tabla estaba vacía) — Etapa 2B |
| `gastos_codigo_seq` (SQL pendiente) | G###### | — | — |
| `pagos_codigo_seq` (SQL pendiente) | P###### | — | — |
| **`reportes_dypsa_codigo_seq`** | IDY-###### | `fn_set_reporte_dypsa_codigo` | next = 1 — REP4.1 |

## Vistas

| View | Propósito |
|---|---|
| `v_obligaciones_pendientes` | 4-UNION sobre gastos aprobados sin pagar / con saldo. Calcula saldo = `GREATEST(0, monto - SUM(pagos confirmados))` |
| `v_cuenta_corriente_fondos` (deprecada D14) | Modelo viejo entre fondos, no aplicar |
| **`v_saldos_financiadores`** — Etapa 1 | Agrega `movimientos_financiacion` por (deudor=RISA implícito, acreedor=financiador, moneda). Expone: `financiador_id, financiador_codigo, financiador_nombre, financiador_deleted_at, moneda, total_deuda_generada, total_cancelado, total_ajustes, total_reversas, saldo_pendiente`. **Sin filtro `deleted_at IS NULL`** — la UI decide si filtra activos |

## Funciones SQL importantes

| Función | Qué hace |
|---|---|
| `fn_confirmar_pago(p_pago_id)` | Marca pago como pagado + INSERT movimiento_fondo + UPDATE saldo_actual + dispara recalc gasto |
| `fn_anular_pago(p_pago_id)` | Marca pago como anulado + INSERT movimiento reverso + UPDATE saldo_actual |
| `fn_registrar_aporte(...)` | INSERT aportes_fondo + INSERT movimiento_fondo + UPDATE saldo_actual (legacy, sin socio_id) |
| `fn_generar_gastos_recurrentes()` | Genera gastos pendientes desde recurrentes activos. Idempotente vía UNIQUE (recurrente_id, periodo) |
| `get_my_role()` | Devuelve role del usuario actual (`SELECT role FROM profiles WHERE id = auth.uid()`) |
| `fn_email_by_usuario_login(p_login)` | Login custom: devuelve email para signInWithPassword |
| `soft_delete_proveedor(uuid)` | SECURITY DEFINER. Soft-delete con validación auth.uid() |
| `soft_delete_fondo(uuid, text)` | SECURITY DEFINER. Soft-delete validando saldo=0. SQL pendiente, no aplicado en producción todavía |
| `fn_set_fondo_codigo()`, `fn_set_aporte_codigo()`, `fn_set_financiador_codigo()` | Generan codigos FON/APO/FIN — Etapa 1 |
| `fn_set_socio_codigo()` | Genera codigo SOC — Etapa 2B |
| **`fn_generar_reporte_dypsa(p_fecha_desde, p_fecha_hasta)`** | **SECURITY DEFINER. Returns reportes_dypsa row.** Crea cabecera + items snapshot con uplift aplicado. Filtra pagos confirmados dentro del rango. Rechaza si 0 items. — REP4.1 |
| **`registrar_aporte_socio(p_destino_aporte, p_fecha, p_financiador_id, p_importe, p_moneda, p_observaciones, p_socio_id)`** | **SECURITY DEFINER. Returns uuid (aporte_id).** Si `destino='risa'`: INSERT aporte + INSERT movimiento_fondo (credito) + UPDATE fondos.saldo_actual con FOR UPDATE. Si `destino='cancelacion_financiacion'`: valida saldo pendiente, INSERT aporte + INSERT movimientos_financiacion (`cancelacion_por_aporte`), NO toca saldo RISA. Etapa 2C aplicada. |

## Funciones SQL planeadas para etapas 2-4 (NO existen aún)

- `crear_socio(payload)` — SECURITY DEFINER opcional si RLS bloquea
- `crear_financiador(payload)` — idem
- `crear_aporte_socio_risa(payload)` — INSERT aporte + movimiento_fondo + UPDATE saldo
- `cancelar_financiacion_con_aporte(payload)` — INSERT aporte + movimiento_financiacion (tipo='cancelacion_por_aporte')
- `confirmar_pago_con_risa(p_pago_id)` — extiende `fn_confirmar_pago` para rama RISA
- `confirmar_pago_con_financiador(p_pago_id)` — INSERT movimiento_financiacion (tipo='deuda_generada') sin tocar saldo RISA
- `anular_pago_con_financiador(p_pago_id)` — reversa movimiento_financiacion

## Convenciones de naming

- Tablas: `singular_o_plural_snake_case` (ej: `gastos`, `aportes_fondo`)
- PKs: `id uuid` con `DEFAULT gen_random_uuid()`
- Soft delete: `deleted_at timestamptz NULL`
- Audit: `created_at, updated_at, created_by`
- Triggers: `trg_<accion>_<tabla>`
- Functions: `fn_<accion>` o `<accion>_<entidad>` (RPC públicas con nombre directo)
- Sequences: `<tabla>_<columna>_seq`
- Indices: `idx_<tabla>_<columna>`
- Codigos visibles: `<PREFIJO>-###` (3 dígitos con dash) para FON/APO/FIN/SOC; `<PREFIJO>######` (6 dígitos sin dash) para G/P

## Códigos funcionales consolidados (referencia rápida)

| Entidad | Tabla | Columna | Formato | Sequence | Trigger | Estado |
|---|---|---|---|---|---|---|
| Fondo | `fondos` | `codigo` | `FON-001`, `FON-002`, … | `fondos_codigo_seq` | `trg_set_fondo_codigo` | ✅ Etapa 1 aplicada |
| Aporte | `aportes_fondo` | `codigo` | `APO-001`, `APO-002`, … | `aportes_codigo_seq` | `trg_set_aporte_codigo` | ✅ Etapa 1 aplicada |
| Financiador | `financiadores` | `codigo` | `FIN-001`, `FIN-002`, … | `financiadores_codigo_seq` | `trg_set_financiador_codigo` | ✅ Etapa 1 aplicada |
| Socio | `socios` | `codigo` | `SOC-001`, `SOC-002`, … | `socios_codigo_seq` | `trg_set_socio_codigo` | ✅ Etapa 2B aplicada |
| Gasto | `gastos` | `codigo` | `G000001`, `G000002`, … | `gastos_codigo_seq` | `trg_set_gasto_codigo` | ⚠️ SQL pendiente (commit `9872748`) |
| Pago | `pagos` | `codigo` | `P000001`, `P000002`, … | `pagos_codigo_seq` | `trg_set_pago_codigo` | ⚠️ SQL pendiente (commit `9872748`) |
| Informe Dypsa | `reportes_dypsa` | `codigo` | `IDY-000001`, `IDY-000002`, … | `reportes_dypsa_codigo_seq` | `trg_set_reporte_dypsa_codigo` | ⚠️ REP4.1 pendiente de aplicar |

**Convención**:
- El codigo lo asigna el trigger BEFORE INSERT al ver `NEW.codigo IS NULL`. El frontend nunca lo calcula ni lo envía.
- El UUID interno (`id`) sigue siendo PK. El codigo es identificador funcional/visual, UNIQUE.
- Backfills crónológicos por `created_at, id` cuando se aplica el SQL retroactivo.
- `setval(seq, MAX+1, false)` mantiene la próxima asignación correcta.
