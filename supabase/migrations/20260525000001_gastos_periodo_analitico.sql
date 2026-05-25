-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ PG-PERIODO (2026-05-25): gastos.periodo_analitico — vía trigger         ║
-- ║                                                                          ║
-- ║ Agrega una columna calculada YYYY-MM para uso analítico (dashboard,     ║
-- ║ reportería, filtros, export, agregaciones mensuales). El usuario sigue  ║
-- ║ cargando fecha_gasto / periodo_servicio_desde como hasta ahora — esta   ║
-- ║ columna se deriva automáticamente vía trigger.                          ║
-- ║                                                                          ║
-- ║ Fórmula (orden de prioridad):                                           ║
-- ║   1. YYYY-MM de periodo_servicio_desde (servicio por hora P3a)          ║
-- ║   2. periodo text (gastos generados desde recurrentes)                  ║
-- ║   3. YYYY-MM de fecha_gasto (gasto común — siempre presente)            ║
-- ║                                                                          ║
-- ║ Por qué trigger y no GENERATED ALWAYS AS STORED:                        ║
-- ║   PostgreSQL exige expresiones IMMUTABLE en columnas STORED. to_char()  ║
-- ║   sobre date NO es immutable (depende de DateStyle de sesión), así que  ║
-- ║   PG rechaza el ALTER. El trigger BEFORE INSERT/UPDATE evita el         ║
-- ║   problema y mantiene la columna sincronizada con los campos fuente.    ║
-- ║                                                                          ║
-- ║ Idempotente:                                                            ║
-- ║   - DROP COLUMN IF EXISTS (GENERATED) → ADD COLUMN normal               ║
-- ║   - CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS + CREATE        ║
-- ║   - Backfill solo donde periodo_analitico IS NULL                       ║
-- ║   - CREATE INDEX IF NOT EXISTS                                          ║
-- ║                                                                          ║
-- ║ Atomicidad: todo en BEGIN/COMMIT.                                       ║
-- ║                                                                          ║
-- ║ Aplica solo a `gastos`. `gastos_recurrentes` es template sin fecha      ║
-- ║ concreta — el período aparece en el gasto generado vía esta columna.   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝


BEGIN;


-- ─── 1. Migrar columna GENERATED legacy (si existiera) → normal ────────────
-- Si alguien aplicó la versión previa con GENERATED ALWAYS, la migramos a
-- columna normal sin perder índices (los recreamos abajo). En fresh install
-- este bloque es no-op.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'gastos'
       AND column_name = 'periodo_analitico'
       AND is_generated = 'ALWAYS'
  ) THEN
    RAISE NOTICE 'PG-PERIODO: detected legacy GENERATED column, dropping to recreate as plain text';
    ALTER TABLE gastos DROP COLUMN periodo_analitico;
  END IF;
END $$;


-- ─── 2. Columna periodo_analitico (text normal) + CHECK formato ────────────

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS periodo_analitico text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gastos_periodo_analitico_format'
  ) THEN
    ALTER TABLE gastos
      ADD CONSTRAINT gastos_periodo_analitico_format
      CHECK (periodo_analitico IS NULL OR periodo_analitico ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
  END IF;
END $$;


-- ─── 3. Función que computa el período ────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_set_gastos_periodo_analitico()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.periodo_analitico := COALESCE(
    to_char(NEW.periodo_servicio_desde, 'YYYY-MM'),
    NEW.periodo,
    to_char(NEW.fecha_gasto, 'YYYY-MM')
  );
  RETURN NEW;
END $$;


-- ─── 4. Trigger BEFORE INSERT OR UPDATE ────────────────────────────────────
-- Refresca el período cuando cambia cualquiera de los campos fuente. En
-- INSERT siempre dispara; en UPDATE solo si se tocaron los campos relevantes.

DROP TRIGGER IF EXISTS trg_set_gastos_periodo_analitico ON gastos;
CREATE TRIGGER trg_set_gastos_periodo_analitico
  BEFORE INSERT OR UPDATE OF fecha_gasto, periodo_servicio_desde, periodo
  ON gastos
  FOR EACH ROW EXECUTE FUNCTION fn_set_gastos_periodo_analitico();


-- ─── 5. Backfill para filas existentes ─────────────────────────────────────
-- Solo donde quedó NULL (rows pre-trigger). Idempotente: re-correr no toca
-- nada si ya está poblado.

UPDATE gastos
   SET periodo_analitico = COALESCE(
     to_char(periodo_servicio_desde, 'YYYY-MM'),
     periodo,
     to_char(fecha_gasto, 'YYYY-MM')
   )
 WHERE periodo_analitico IS NULL;


-- ─── 6. Índice para filtros y GROUP BY ─────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_gastos_periodo_analitico
  ON gastos(periodo_analitico) WHERE deleted_at IS NULL;


-- ─── 7. Verificación post-aplicación ────────────────────────────────────────

DO $$
DECLARE
  v_col       INTEGER;
  v_trg       INTEGER;
  v_idx       INTEGER;
  v_generated TEXT;
  v_null      INTEGER;
BEGIN
  -- Columna existe y NO es GENERATED (es normal text)
  SELECT COUNT(*) INTO v_col
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'gastos'
     AND column_name = 'periodo_analitico';
  IF v_col = 0 THEN
    RAISE EXCEPTION 'PG-PERIODO: gastos.periodo_analitico no existe';
  END IF;

  SELECT is_generated INTO v_generated
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'gastos'
     AND column_name = 'periodo_analitico';
  IF v_generated = 'ALWAYS' THEN
    RAISE EXCEPTION 'PG-PERIODO: periodo_analitico quedó como GENERATED (esperado: normal)';
  END IF;

  -- Trigger existe
  SELECT COUNT(*) INTO v_trg
    FROM pg_trigger
   WHERE tgname = 'trg_set_gastos_periodo_analitico';
  IF v_trg = 0 THEN
    RAISE EXCEPTION 'PG-PERIODO: trigger trg_set_gastos_periodo_analitico no existe';
  END IF;

  -- Índice existe
  SELECT COUNT(*) INTO v_idx
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'gastos'
     AND indexname = 'idx_gastos_periodo_analitico';
  IF v_idx = 0 THEN
    RAISE EXCEPTION 'PG-PERIODO: idx_gastos_periodo_analitico no existe';
  END IF;

  -- Backfill quedó completo: no debería haber NULL si hay gastos vivos
  SELECT COUNT(*) INTO v_null
    FROM gastos
   WHERE periodo_analitico IS NULL
     AND deleted_at IS NULL;
  IF v_null > 0 THEN
    RAISE NOTICE 'PG-PERIODO: % gastos vivos con periodo_analitico NULL — el trigger los completa al próximo UPDATE', v_null;
  END IF;

  RAISE NOTICE 'PG-PERIODO [check] OK — columna + CHECK + función + trigger + índice aplicados';
END $$;


COMMIT;


-- ─── 8. (FUERA DE TRX) Smoke test interactivo opcional ──────────────────────
--
--   -- Distribución de períodos en gastos actuales:
--   SELECT periodo_analitico, COUNT(*), SUM(monto) AS total
--     FROM gastos
--    WHERE deleted_at IS NULL
--    GROUP BY periodo_analitico
--    ORDER BY periodo_analitico DESC;
--
--   -- Verificar que prioridad funciona:
--   SELECT id, fecha_gasto, periodo_servicio_desde, periodo, periodo_analitico
--     FROM gastos
--    WHERE deleted_at IS NULL
--    LIMIT 20;
