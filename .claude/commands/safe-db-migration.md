---
description: Plantilla de migración SQL segura, idempotente, con disable temporal de fn_pagos_hardening
---

# /safe-db-migration

Patrón para escribir SQL de migración seguro para este proyecto.

## Reglas

1. **Idempotente**: `IF NOT EXISTS`, `DROP IF EXISTS … CREATE`, `CREATE OR REPLACE`.
2. **Transaccional**: envolver en `BEGIN…COMMIT`. Rollback automático si algo falla.
3. **No destructivo por accidente**: backfill solo de columnas nuevas; nunca tocar `estado`, `monto`, `fecha`.
4. **Defensivo**: usar `to_regclass` antes de DELETE/UPDATE en tablas que pueden no existir.
5. **Validación al final**: query `SELECT` con conteos esperables.

## Disable temporal de `fn_pagos_hardening`

Si la migración toca `pagos` con UPDATE, el hardening trigger va a bloquear. Patrón:

```sql
BEGIN;

-- ... ALTER TABLE pagos ADD COLUMN ... (no requiere disable) ...

-- Disable solo si la migración hace UPDATE sobre rows existentes
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
    RAISE NOTICE 'Trigger hardening deshabilitado: %', v_trigger_name;
  END LOOP;
END $$;

-- ... aquí va el UPDATE / backfill ...
UPDATE pagos SET <columna_nueva> = <valor> WHERE <columna_nueva> IS NULL;

-- Re-enable ANTES del COMMIT
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

COMMIT;
```

**Importante**:
- DDL es transaccional en Postgres. Si COMMIT falla, ROLLBACK reactiva el trigger.
- El disable no se persiste fuera de la transacción si hay rollback.

## Verificación post-COMMIT

Siempre incluir un bloque de validación al final:

```sql
SELECT 'total_filas' AS check, COUNT(*) FROM <tabla>
UNION ALL
SELECT 'sin_columna_nueva', COUNT(*) FROM <tabla> WHERE <columna_nueva> IS NULL;
-- Esperar: sin_columna_nueva = 0
```

Y verificar que el trigger sigue habilitado:

```sql
SELECT t.tgname, CASE t.tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'DISABLED' END
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'pagos'::regclass
  AND p.proname = 'fn_pagos_hardening'
  AND NOT t.tgisinternal;
-- Debe ser 'enabled'
```

## Reset de datos operativos (no schema)

Cuando hay que limpiar gastos/pagos/fondos sin perder maestros:

```sql
BEGIN;

-- Disable hardening (mismo patrón que arriba)

-- DELETE en orden hijos → padres, con to_regclass defensivo
DO $$ BEGIN
  IF to_regclass('public.movimientos_entre_fondos') IS NOT NULL THEN
    DELETE FROM movimientos_entre_fondos;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.movimientos_fondo') IS NOT NULL THEN
    DELETE FROM movimientos_fondo;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.pagos') IS NOT NULL THEN
    DELETE FROM pagos;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.anticipos') IS NOT NULL THEN
    DELETE FROM anticipos;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.gastos') IS NOT NULL THEN
    DELETE FROM gastos;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.aportes_fondo') IS NOT NULL THEN
    DELETE FROM aportes_fondo;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.fondos') IS NOT NULL THEN
    DELETE FROM fondos;
  END IF;
END $$;

-- Re-enable hardening

-- Reset de secuencias de codigo
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'gastos_codigo_seq' AND relkind = 'S') THEN
    PERFORM setval('gastos_codigo_seq', 1, false);  -- próximo nextval = 1 = G000001
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'pagos_codigo_seq' AND relkind = 'S') THEN
    PERFORM setval('pagos_codigo_seq', 1, false);
  END IF;
END $$;

COMMIT;
```

**NO incluye**: proveedores, profiles, users, gastos_recurrentes (config), anticipos (revisar caso por caso). Si querés incluir alguno, agregalo explícito.

## Anti-patrones

- ❌ `DROP TABLE … CASCADE` — arrastra dependientes inesperados
- ❌ `TRUNCATE … CASCADE` — idem
- ❌ `DELETE FROM <padre>` antes de borrar hijos — viola FK
- ❌ Asumir que un trigger no afecta porque "el UPDATE es solo de una columna" — los triggers se disparan por row, no por columna específica
- ❌ Migrar en producción sin transacción
- ❌ Crear policies / triggers / funciones sin `CREATE OR REPLACE` o `DROP IF EXISTS`
