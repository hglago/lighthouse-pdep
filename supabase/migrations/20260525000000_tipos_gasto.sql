-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ TIPOS-GASTO (2026-05-25): clasificación analítica de gastos             ║
-- ║                                                                          ║
-- ║ Agrega una clasificación analítica (tipo_gasto) ortogonal al codigo      ║
-- ║ operativo (G######). Aplica a gastos y gastos_recurrentes.              ║
-- ║                                                                          ║
-- ║ Decisiones funcionales:                                                  ║
-- ║   - El tipo pertenece al gasto, no al proveedor.                        ║
-- ║   - Soft-delete vía activo=false (no se borra si está en uso).          ║
-- ║   - Default OTRO en INSERT sin tipo (trigger BEFORE INSERT).            ║
-- ║   - gastos_recurrentes.categoria queda en DB (legacy) pero sale de UI.  ║
-- ║                                                                          ║
-- ║ Idempotente: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,      ║
-- ║ ON CONFLICT DO NOTHING, CREATE OR REPLACE FUNCTION, DROP TRIGGER IF      ║
-- ║ EXISTS + CREATE TRIGGER.                                                 ║
-- ║                                                                          ║
-- ║ Atomicidad: todo en BEGIN/COMMIT.                                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝


BEGIN;


-- ─── 1. Tabla tipos_gasto ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tipos_gasto (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo       text         NOT NULL UNIQUE,
  nombre       text         NOT NULL,
  descripcion  text         NULL,
  activo       boolean      NOT NULL DEFAULT true,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   uuid         NULL REFERENCES profiles(id)
);

-- CHECK: codigo en mayúsculas + sin espacios + 2..12 chars (UI sugerirá 3..8).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tipos_gasto_codigo_format'
  ) THEN
    ALTER TABLE tipos_gasto
      ADD CONSTRAINT tipos_gasto_codigo_format
      CHECK (codigo = upper(codigo) AND codigo !~ '\s' AND char_length(codigo) BETWEEN 2 AND 12);
  END IF;
END $$;

-- Índice parcial: lookups frecuentes filtran activos.
CREATE INDEX IF NOT EXISTS idx_tipos_gasto_activo
  ON tipos_gasto(activo) WHERE activo = true;

-- updated_at automático
CREATE OR REPLACE FUNCTION fn_tipos_gasto_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tipos_gasto_updated_at ON tipos_gasto;
CREATE TRIGGER trg_tipos_gasto_updated_at
  BEFORE UPDATE ON tipos_gasto
  FOR EACH ROW EXECUTE FUNCTION fn_tipos_gasto_set_updated_at();


-- ─── 2. Seed inicial (idempotente vía ON CONFLICT) ──────────────────────────

INSERT INTO tipos_gasto (codigo, nombre, descripcion) VALUES
  ('INFRA', 'Infraestructura',        'Infraestructura, hosting, herramientas técnicas'),
  ('MKTG',  'Marketing',              'Marketing, publicidad, comunicación'),
  ('RRHH',  'Recursos Humanos',       'Sueldos, beneficios, contrataciones'),
  ('VIAT',  'Viáticos',               'Pasajes, alojamiento, comidas de trabajo'),
  ('ADM',   'Administración',         'Gastos administrativos generales'),
  ('SERV',  'Servicios profesionales','Honorarios profesionales, consultoría'),
  ('OTRO',  'Otros',                  'Default — usar si ningún tipo aplica')
ON CONFLICT (codigo) DO NOTHING;


-- ─── 3. Columnas tipo_gasto_id en gastos y gastos_recurrentes ──────────────

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS tipo_gasto_id uuid NULL REFERENCES tipos_gasto(id);

ALTER TABLE gastos_recurrentes
  ADD COLUMN IF NOT EXISTS tipo_gasto_id uuid NULL REFERENCES tipos_gasto(id);

CREATE INDEX IF NOT EXISTS idx_gastos_tipo_gasto_id
  ON gastos(tipo_gasto_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_gastos_recurrentes_tipo_gasto_id
  ON gastos_recurrentes(tipo_gasto_id) WHERE deleted_at IS NULL;


-- ─── 4. Trigger: default OTRO si tipo_gasto_id viene NULL ──────────────────
-- Defensa en profundidad. UI también pre-selecciona OTRO al abrir modal nuevo,
-- pero este trigger atrapa cualquier INSERT (RPCs futuras, retries D4, scripts
-- ad-hoc) que omita el campo.

CREATE OR REPLACE FUNCTION fn_default_tipo_gasto_otro()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_otro_id uuid;
BEGIN
  IF NEW.tipo_gasto_id IS NULL THEN
    SELECT id INTO v_otro_id FROM tipos_gasto
     WHERE codigo = 'OTRO' AND activo = true
     LIMIT 1;
    IF v_otro_id IS NULL THEN
      -- OTRO desactivado o eliminado: fail-safe, no rompemos el INSERT.
      -- Logueamos y devolvemos NEW sin asignar — DB queda con NULL.
      RAISE NOTICE 'fn_default_tipo_gasto_otro: tipo OTRO no encontrado/activo';
      RETURN NEW;
    END IF;
    NEW.tipo_gasto_id := v_otro_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gastos_default_tipo_gasto ON gastos;
CREATE TRIGGER trg_gastos_default_tipo_gasto
  BEFORE INSERT ON gastos
  FOR EACH ROW EXECUTE FUNCTION fn_default_tipo_gasto_otro();

DROP TRIGGER IF EXISTS trg_gastos_recurrentes_default_tipo_gasto ON gastos_recurrentes;
CREATE TRIGGER trg_gastos_recurrentes_default_tipo_gasto
  BEFORE INSERT ON gastos_recurrentes
  FOR EACH ROW EXECUTE FUNCTION fn_default_tipo_gasto_otro();


-- ─── 5. RLS para tipos_gasto ────────────────────────────────────────────────

ALTER TABLE tipos_gasto ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier authenticated puede listar (UI necesita los tipos para el select).
DROP POLICY IF EXISTS tipos_gasto_select_auth ON tipos_gasto;
CREATE POLICY tipos_gasto_select_auth ON tipos_gasto
  FOR SELECT TO authenticated USING (true);

-- INSERT: admin o contador (mismo criterio que financiadores/socios).
DROP POLICY IF EXISTS tipos_gasto_insert_admin ON tipos_gasto;
CREATE POLICY tipos_gasto_insert_admin ON tipos_gasto
  FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('admin','contador'));

-- UPDATE: solo admin puede editar (nombre, descripcion, activo).
DROP POLICY IF EXISTS tipos_gasto_update_admin ON tipos_gasto;
CREATE POLICY tipos_gasto_update_admin ON tipos_gasto
  FOR UPDATE TO authenticated
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

-- DELETE: nadie. Se desactiva con activo=false (regla 5 del scope).


-- ─── 6. Verificación post-aplicación ────────────────────────────────────────

DO $$
DECLARE
  v_tipos_count    INTEGER;
  v_otro_id        uuid;
  v_gastos_col     INTEGER;
  v_recurrentes_col INTEGER;
  v_trg_count      INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_tipos_count FROM tipos_gasto;
  IF v_tipos_count < 7 THEN
    RAISE EXCEPTION 'TIPOS-GASTO: seed incompleto (esperados 7, hay %)', v_tipos_count;
  END IF;

  SELECT id INTO v_otro_id FROM tipos_gasto WHERE codigo = 'OTRO';
  IF v_otro_id IS NULL THEN
    RAISE EXCEPTION 'TIPOS-GASTO: tipo OTRO no fue insertado';
  END IF;

  SELECT COUNT(*) INTO v_gastos_col
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'gastos' AND column_name = 'tipo_gasto_id';
  IF v_gastos_col = 0 THEN
    RAISE EXCEPTION 'TIPOS-GASTO: gastos.tipo_gasto_id no existe';
  END IF;

  SELECT COUNT(*) INTO v_recurrentes_col
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'gastos_recurrentes' AND column_name = 'tipo_gasto_id';
  IF v_recurrentes_col = 0 THEN
    RAISE EXCEPTION 'TIPOS-GASTO: gastos_recurrentes.tipo_gasto_id no existe';
  END IF;

  SELECT COUNT(*) INTO v_trg_count
    FROM pg_trigger
   WHERE tgname IN ('trg_gastos_default_tipo_gasto', 'trg_gastos_recurrentes_default_tipo_gasto');
  IF v_trg_count < 2 THEN
    RAISE EXCEPTION 'TIPOS-GASTO: triggers default OTRO no fueron creados (esperados 2, hay %)', v_trg_count;
  END IF;

  RAISE NOTICE 'TIPOS-GASTO [check] OK — tabla creada, 7 tipos seed, columnas + triggers + RLS aplicados';
END $$;


COMMIT;
