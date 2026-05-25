-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ PG-PERIODO (2026-05-25): gastos.periodo_analitico — columna derivada    ║
-- ║                                                                          ║
-- ║ Agrega una columna calculada YYYY-MM para uso analítico (dashboard,     ║
-- ║ reportería, filtros, export, agregaciones mensuales). El usuario sigue  ║
-- ║ cargando fecha_gasto / periodo_servicio_desde como hasta ahora — esta   ║
-- ║ columna se deriva automáticamente.                                      ║
-- ║                                                                          ║
-- ║ Fórmula (orden de prioridad):                                           ║
-- ║   1. YYYY-MM de periodo_servicio_desde (servicio por hora P3a)          ║
-- ║   2. periodo text (gastos generados desde recurrentes)                  ║
-- ║   3. YYYY-MM de fecha_gasto (gasto común — siempre presente)            ║
-- ║                                                                          ║
-- ║ STORED: el valor se persiste y se recalcula automáticamente cuando      ║
-- ║ alguno de los campos fuente cambia (PG lo gestiona vía rewrite-on-      ║
-- ║ update). Habilita índice → filtros y GROUP BY rápidos.                  ║
-- ║                                                                          ║
-- ║ Idempotente: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.     ║
-- ║                                                                          ║
-- ║ Aplica solo a `gastos`. `gastos_recurrentes` es template sin fecha      ║
-- ║ concreta — el período aparece en el gasto generado vía esta columna.   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝


BEGIN;


-- ─── 1. Columna periodo_analitico (GENERATED ALWAYS AS STORED) ─────────────

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS periodo_analitico text
    GENERATED ALWAYS AS (
      COALESCE(
        to_char(periodo_servicio_desde, 'YYYY-MM'),
        periodo,
        to_char(fecha_gasto, 'YYYY-MM')
      )
    ) STORED;


-- ─── 2. Índice para filtros y GROUP BY ─────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_gastos_periodo_analitico
  ON gastos(periodo_analitico) WHERE deleted_at IS NULL;


-- ─── 3. Verificación post-aplicación ────────────────────────────────────────

DO $$
DECLARE
  v_col       INTEGER;
  v_idx       INTEGER;
  v_generated TEXT;
BEGIN
  -- Columna existe y es GENERATED
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
  IF v_generated != 'ALWAYS' THEN
    RAISE EXCEPTION 'PG-PERIODO: periodo_analitico no es GENERATED ALWAYS (is_generated=%)', v_generated;
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

  RAISE NOTICE 'PG-PERIODO [check] OK — columna GENERATED + índice aplicados';
END $$;


COMMIT;


-- ─── 4. (FUERA DE TRX) Smoke test interactivo opcional ──────────────────────
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
