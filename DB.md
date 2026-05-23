# DB.md

Esquema Supabase conocido. Solo lo que se confirmó tocando el código + migraciones aplicadas.

## Tablas operativas

### `fondos`
- `id uuid PK`
- `nombre text NOT NULL`
- `descripcion text`
- `monto_inicial numeric`
- `saldo_actual numeric` (actualizado por movimientos_fondo)
- `moneda text` (ARS, USD, EUR)
- `estado FondoEstado` ('activo' | 'cerrado' | 'suspendido')
- `responsable_id uuid`
- `created_by uuid`
- `created_at, updated_at, deleted_at`
- `deleted_by uuid` (post-migración soft-delete fondo)
- `motivo_baja text` (post-migración soft-delete fondo)

### `proveedores`
- `id uuid PK`
- `nombre text`
- `cuit text` (UNIQUE parcial)
- `email, telefono, direccion, observaciones`
- `activo bool`
- `tiene_uplift bool` (post-migración uplift, default false)
- `porcentaje_uplift numeric(6,2)` (post-migración uplift)
- `created_by, created_at, updated_at, deleted_at`

### `gastos`
- `id uuid PK`
- `codigo text` (post-migración codigo, G000001…)
- `fondo_id uuid → fondos(id)` (responsable económico)
- `proveedor_id uuid → proveedores(id)` (nullable)
- `descripcion text NOT NULL` (importante: NOT NULL bloquea inserts vacíos)
- `monto numeric`, `moneda text`
- `estado GastoEstado` ('borrador' | 'enviado' | 'aprobado' | 'pagado_parcial' | 'pagado' | 'rechazado')
- `fecha_gasto, fecha_vencimiento`
- `notas text`
- `tiene_anticipo bool`, `monto_anticipo`, `porcentaje_anticipo`
- `comprobante_path text` (Storage bucket `comprobantes`)
- `comprobante_nombre, comprobante_mime, comprobante_size_bytes, comprobante_uploaded_by, comprobante_subido_en`
- `recurrente_id uuid → gastos_recurrentes(id)` (nullable)
- `periodo text` (YYYY-MM para recurrentes)
- `prioridad_pago int`
- `created_by, aprobado_por, aprobado_en, rechazado_por, rechazado_en`
- `created_at, updated_at, deleted_at`

### `pagos`
- `id uuid PK`
- `codigo text` (post-migración codigo, P000001…)
- `nro_pago text` (legacy, NO confundir con codigo)
- `fondo_id uuid → fondos(id)`
- `fondo_pagador_id uuid → fondos(id)` (post-cuenta-corriente etapa 1)
- `fondo_responsable_id uuid → fondos(id)` (post-cuenta-corriente etapa 1)
- `genera_deuda_interna bool` (default false; trigger lo setea)
- `deuda_interna_id uuid → movimientos_entre_fondos(id)` (nullable)
- `proveedor_id uuid → proveedores(id)`
- `gasto_id uuid → gastos(id)` (nullable)
- `anticipo_id uuid → anticipos(id)` (nullable)
- `gasto_recurrente_id uuid → gastos_recurrentes(id)` (nullable)
- `tipo PagoTipo` ('gasto' | 'anticipo' | 'saldo_anticipo' | 'recurrente' | 'directo')
- `concepto text`, `monto numeric`, `moneda text`
- `fecha_pago, comprobante_url`
- `estado PagoEstado` ('borrador' | 'pagado' | 'anulado')
- `notas text`
- `created_by, anulado_por, anulado_en, created_at, updated_at`

### `aportes_fondo`
- `id uuid PK`
- `fondo_id uuid → fondos(id)`
- `movimiento_id uuid → movimientos_fondo(id)` (nullable)
- `fecha_aporte date`
- `monto numeric`, `moneda text`
- `tipo_aporte TipoAporte` ('aporte_socios' | 'transferencia' | 'ajuste' | 'reintegro' | 'otro')
- `aportante text`, `concepto text`
- `comprobante_url, observaciones`
- `created_by, created_at, updated_at, deleted_at`

### `movimientos_fondo`
Ledger de movimientos de saldo por fondo. Actualizado por `fn_confirmar_pago` y `fn_registrar_aporte`. NO tocar directo.

- `id uuid PK`
- `fondo_id uuid → fondos(id)`
- `pago_id uuid → pagos(id)` (nullable)
- `tipo MovimientoTipo` ('debito' | 'credito')
- `monto numeric`
- `saldo_anterior, saldo_resultante numeric`
- `concepto text`, `fecha`
- `created_by, created_at`

### `movimientos_entre_fondos` (post-cuenta-corriente etapa 1)
- `id uuid PK`
- `fecha date`
- `fondo_acreedor_id, fondo_deudor_id uuid → fondos(id)`
- `pago_origen_id uuid → pagos(id)` (nullable)
- `tipo_movimiento text` ('deuda_generada' | 'cancelacion' | 'ajuste')
- `importe numeric(14,2)`, `moneda text`
- `descripcion text`, `estado text` ('pendiente' | 'parcial' | 'cancelado')
- `created_at, created_by`

### `gastos_recurrentes`
Definiciones de gastos que se auto-generan mensualmente. NO se borran en reset.

- `id, fondo_id, proveedor_id, concepto, categoria, monto, moneda`
- `dia_vencimiento int` (1-31)
- `fecha_inicio, fecha_fin`
- `activo bool`, `prioridad_pago int`
- `observaciones, created_by`

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

- **`fn_pagos_hardening`** sobre `pagos`. Bloquea UPDATE de estado en pagos confirmados.
  Hay que **DESACTIVAR temporalmente** en cualquier migración que toque pagos (incluyendo backfill de columnas nuevas). Ver `/safe-db-migration`.
- **`trg_set_pago_codigo`** BEFORE INSERT en pagos. Asigna codigo si NULL.
- **`trg_set_gasto_codigo`** BEFORE INSERT en gastos. Asigna codigo si NULL.
- **`trg_set_pago_genera_deuda`** BEFORE INSERT OR UPDATE en pagos. Setea flag genera_deuda_interna.
- **`fn_recalc_gasto_estado`** sobre gastos (trigger AFTER pagos cambian). Recalcula estado del gasto a pagado_parcial/pagado.
- **`updated_at`** trigger en varias tablas. Genérico, no requiere atención especial.

## Secuencias

- `gastos_codigo_seq` → siguiente G######
- `pagos_codigo_seq` → siguiente P######

## Vistas

- **`v_obligaciones_pendientes`**: 4-UNION sobre gastos aprobados sin pagar / con saldo. Calcula saldo como `GREATEST(0, monto - SUM(pagos confirmados))`.
- **`v_cuenta_corriente_fondos`** (post-etapa-1): agrega `movimientos_entre_fondos` por (deudor, acreedor, moneda).

## Funciones SQL importantes

| Función | Qué hace |
|---|---|
| `fn_confirmar_pago(p_pago_id)` | Marca pago como pagado + INSERT movimiento_fondo + UPDATE saldo_actual + dispara recalc gasto |
| `fn_anular_pago(p_pago_id)` | Marca pago como anulado + INSERT movimiento reverso + UPDATE saldo_actual |
| `fn_registrar_aporte(...)` | INSERT aportes_fondo + INSERT movimiento_fondo + UPDATE saldo_actual |
| `fn_generar_gastos_recurrentes()` | Genera gastos pendientes desde recurrentes activos. Idempotente vía UNIQUE (recurrente_id, periodo) |
| `get_my_role()` | Devuelve role del usuario actual (`SELECT role FROM profiles WHERE id = auth.uid()`) |
| `fn_email_by_usuario_login(p_login)` | Login custom: devuelve email para signInWithPassword |
| `soft_delete_proveedor(uuid)` | SECURITY DEFINER. Soft-delete con validación auth.uid() |
| `soft_delete_fondo(uuid, text)` | SECURITY DEFINER. Soft-delete validando saldo=0 |

## Convenciones de naming

- Tablas: `singular_o_plural_snake_case` (ej: `gastos`, `aportes_fondo`)
- PKs: `id uuid` con `DEFAULT gen_random_uuid()`
- Soft delete: `deleted_at timestamptz NULL`
- Audit: `created_at, updated_at, created_by`
- Triggers: `trg_<accion>_<tabla>` o `<tabla>_<accion>_trigger`
- Functions: `fn_<accion>` o `<accion>_<entidad>` (RPC públicas con nombre directo)
- Sequences: `<tabla>_<columna>_seq`
- Indices: `idx_<tabla>_<columna>`
