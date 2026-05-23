# RLS_RPC.md

Policies, RPCs, patrón SECURITY DEFINER. Comportamientos no obvios.

## Reglas generales

- **RLS está activo** en todas las tablas operativas (incluyendo las 3 nuevas de Etapa 1: `socios`, `financiadores`, `movimientos_financiacion`).
- **`anon` no tiene policies**. Solo `authenticated`.
- **Service_role bypasea RLS** (no usar en frontend nunca).
- Las policies estándar suelen ser permisivas para `authenticated`; cuando una operación falla por RLS y la policy parece correcta, el problema casi siempre es un **trigger** o una **policy RESTRICTIVE oculta**.

## Policies aplicadas en Etapa 1 (sobre tablas nuevas)

Mismo patrón usado en el resto del proyecto: SELECT abierto a authenticated, INSERT con `created_by = auth.uid()`, UPDATE para soft-delete sin restricción de creador. **Sin policy DELETE** (soft-delete por convención).

| Tabla | Policy | Comando | USING | WITH CHECK |
|---|---|---|---|---|
| `socios` | `socios_select` | SELECT | true | — |
| `socios` | `socios_insert` | INSERT | — | `created_by = auth.uid()` |
| `socios` | `socios_update` | UPDATE | true | true |
| `financiadores` | `financiadores_select` | SELECT | true | — |
| `financiadores` | `financiadores_insert` | INSERT | — | `created_by = auth.uid()` |
| `financiadores` | `financiadores_update` | UPDATE | true | true |
| `movimientos_financiacion` | `movimientos_financiacion_select` | SELECT | true | — |
| `movimientos_financiacion` | `movimientos_financiacion_insert` | INSERT | — | `created_by = auth.uid()` |

Total: 8 policies. **No hay policies DELETE** — los movimientos no se borran físicamente; cualquier corrección va vía nuevo movimiento tipo `'reversa'` o `'ajuste'`.

## Constraints eliminadas en Etapa 1

- **`fondos.fondos_saldo_no_negativo`**: CHECK `(saldo_actual >= 0)` — eliminada. RISA puede quedar en saldo negativo cuando se paga sin fondos suficientes. La validación de "negative budget" pasa a ser puramente informativa en UI; el DB no bloquea.

## Patrón cuando RLS falla "inexplicablemente"

1. Confirmar con código que session llega bien (auth.uid() del JS lado).
2. Confirmar SQL session via `SELECT * FROM profiles WHERE id = auth.uid()` (debe devolver fila).
3. Listar policies: `SELECT * FROM pg_policies WHERE tablename = '<x>'`.
4. Listar triggers: ver `/diagnose-rls`.
5. Si todo lo anterior es OK y el error persiste → **migrar la operación a RPC SECURITY DEFINER**.

## RPCs conocidas (SECURITY DEFINER)

### `soft_delete_proveedor(proveedor_id uuid)`
Aplicado en producción. Marca `deleted_at = now()` con validación `auth.uid() IS NOT NULL`. Sin chequeo de dependencias (el client las cuenta antes).

### `soft_delete_fondo(fondo_id uuid, motivo text DEFAULT NULL)`
**SQL pendiente de aplicar**. Validates auth.uid() + saldo_actual = 0 + UPDATE deleted_at/deleted_by/motivo_baja.

```sql
CREATE OR REPLACE FUNCTION public.soft_delete_fondo(fondo_id uuid, motivo text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_saldo numeric; v_nombre text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT nombre, saldo_actual INTO v_nombre, v_saldo
  FROM public.fondos WHERE id = fondo_id AND deleted_at IS NULL;

  IF NOT FOUND THEN RAISE EXCEPTION 'Fondo no encontrado o ya dado de baja'; END IF;
  IF ABS(v_saldo) > 0.001 THEN
    RAISE EXCEPTION 'No se puede dar de baja "%": saldo actual = %', v_nombre, v_saldo;
  END IF;

  UPDATE public.fondos
  SET deleted_at = now(), deleted_by = auth.uid(), motivo_baja = motivo
  WHERE id = fondo_id;
END $$;

REVOKE ALL ON FUNCTION public.soft_delete_fondo(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_fondo(uuid, text) TO authenticated;
```

### Plantilla para nuevas RPCs SECURITY DEFINER

```sql
CREATE OR REPLACE FUNCTION public.<accion>_<entidad>(<args>)
RETURNS <tipo>
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public      -- crítico: previene search_path attacks
AS $$
DECLARE v_caller uuid;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- validaciones de negocio
  -- ...

  -- mutación
  -- ...
END $$;

REVOKE ALL ON FUNCTION public.<accion>_<entidad>(<arg_types>) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.<accion>_<entidad>(<arg_types>) TO authenticated;
```

**Importante**:
- `SECURITY DEFINER` corre con privilegios del owner (típicamente `postgres`). Bypassea RLS.
- `SET search_path = public` previene que un atacante manipule el search path para suplantar funciones.
- `REVOKE FROM PUBLIC` luego `GRANT TO authenticated`: explícito sobre quién puede ejecutar.
- Validar `auth.uid()` adentro para no perder el principio de "solo usuarios logueados pueden".

## Otras RPCs no-SECURITY DEFINER

- `get_my_role()` — devuelve role del user actual. Útil para diagnóstico.
- `fn_email_by_usuario_login(p_login)` — login custom. Lee de profiles.
- `fn_confirmar_pago(p_pago_id)` — marca pago + actualiza saldo + dispara recalc.
- `fn_anular_pago(p_pago_id)` — anula + genera reverso de movimiento.
- `fn_registrar_aporte(...)` — aporte + movimiento + saldo (legacy, sin socio_id).
- `fn_generar_gastos_recurrentes()` — auto-gen mensual.
- `fn_set_fondo_codigo()`, `fn_set_aporte_codigo()`, `fn_set_financiador_codigo()` — triggers BEFORE INSERT que asignan codigos FON/APO/FIN si vienen NULL (Etapa 1).

## RPCs planeadas para Etapas 2-4 (NO existen aún)

Solo plan. Se crean cuando arranquen las etapas correspondientes. Patrón: SECURITY DEFINER si RLS bloquea.

- `crear_socio(payload)` — INSERT en socios (puede usar policy directa si no bloquea)
- `crear_financiador(payload)` — INSERT en financiadores
- `crear_aporte_socio_risa(payload)` — INSERT aporte + INSERT movimiento_fondo + UPDATE fondos.saldo_actual (transaccional)
- `cancelar_financiacion_con_aporte(payload)` — INSERT aporte (destino='cancelacion_financiacion') + INSERT movimientos_financiacion (tipo='cancelacion_por_aporte'). Validar importe ≤ saldo_pendiente_financiador.
- `confirmar_pago_con_risa(p_pago_id)` — extiende `fn_confirmar_pago` para rama RISA (genera movimiento_fondo).
- `confirmar_pago_con_financiador(p_pago_id)` — INSERT movimiento_financiacion (tipo='deuda_generada') sin tocar saldo RISA. Update pago.estado = 'pagado'.
- `anular_pago_con_financiador(p_pago_id)` — INSERT movimiento_financiacion (tipo='reversa') + update pago.estado = 'anulado'.

## Trigger `fn_pagos_hardening`

**Comportamiento**: bloquea UPDATE sobre `pagos.estado = 'pagado'` excepto que la transición sea hacia 'anulado'. Mensaje:
> Un pago confirmado solo puede ser anulado, no revertido a pagado.

**Disable temporal para migraciones**:

```sql
-- Inside BEGIN ... COMMIT
DO $$
DECLARE v_trigger_name text;
BEGIN
  FOR v_trigger_name IN
    SELECT t.tgname FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'pagos'::regclass
      AND p.proname = 'fn_pagos_hardening'
      AND NOT t.tgisinternal
  LOOP
    EXECUTE format('ALTER TABLE pagos DISABLE TRIGGER %I', v_trigger_name);
  END LOOP;
END $$;

-- ... migration UPDATE here ...

-- Re-enable
DO $$
DECLARE v_trigger_name text;
BEGIN
  FOR v_trigger_name IN
    SELECT t.tgname FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'pagos'::regclass
      AND p.proname = 'fn_pagos_hardening'
      AND NOT t.tgisinternal
  LOOP
    EXECUTE format('ALTER TABLE pagos ENABLE TRIGGER %I', v_trigger_name);
  END LOOP;
END $$;
```

Si la transacción falla entre disable y enable, ROLLBACK reactiva el trigger automáticamente. Si todo OK, COMMIT mantiene el trigger habilitado.

## Cuando RPC SECURITY DEFINER NO es la respuesta

- Si auth.uid() devuelve null SQL-side → arreglar cliente Supabase, no usar RPC.
- Si la falla es por columna inexistente (42703) → aplicar migración o usar SELECT tolerante.
- Si es 23505 unique violation → respetar la constraint, no bypasear.
- Si es 23503 FK violation → respetar la cardinalidad.

## Notificación de schema reload

Después de cambios en RPCs/policies, opcionalmente:
```sql
NOTIFY pgrst, 'reload schema';
```

PostgREST cachea schemas; esto fuerza el reload sin reiniciar Supabase.
