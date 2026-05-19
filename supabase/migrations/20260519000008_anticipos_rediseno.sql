-- =============================================================================
-- ETAPA 5A REDISEÑO: Reemplazar tabla anticipos con modelo de anticipos
--                    comerciales a proveedores.
-- Seguro de ejecutar: DROP IF EXISTS antes de todo.
-- =============================================================================

-- 1. Eliminar tabla y enum anteriores
DROP TABLE IF EXISTS anticipos;
DROP TYPE  IF EXISTS anticipo_estado;

-- 2. Nuevo enum
CREATE TYPE anticipo_estado AS ENUM (
  'borrador',
  'comprometido',
  'parcialmente_pagado',
  'pagado',
  'cancelado'
);

-- 3. Nueva tabla
CREATE TABLE anticipos (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id            UUID          NOT NULL REFERENCES proveedores(id),
  fondo_id                UUID          NOT NULL REFERENCES fondos(id),
  concepto                TEXT          NOT NULL,
  monto_total             NUMERIC(12,2) NOT NULL,
  porcentaje_anticipo     NUMERIC(5,2)  NOT NULL,
  monto_anticipo          NUMERIC(12,2) NOT NULL,
  monto_saldo             NUMERIC(12,2) GENERATED ALWAYS AS (monto_total - monto_anticipo) STORED,
  moneda                  TEXT          NOT NULL,
  fecha_acuerdo           DATE          NOT NULL,
  fecha_vencimiento_saldo DATE,
  estado                  anticipo_estado NOT NULL DEFAULT 'borrador',
  observaciones           TEXT,
  created_by              UUID          NOT NULL REFERENCES auth.users(id),
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at              TIMESTAMPTZ,

  CONSTRAINT anticipos_monto_positivo    CHECK (monto_total > 0),
  CONSTRAINT anticipos_anticipo_valido   CHECK (monto_anticipo > 0 AND monto_anticipo <= monto_total),
  CONSTRAINT anticipos_porcentaje_valido CHECK (porcentaje_anticipo > 0 AND porcentaje_anticipo <= 100)
);

-- 4. Índices
CREATE INDEX anticipos_proveedor_id_idx  ON anticipos(proveedor_id);
CREATE INDEX anticipos_fondo_id_idx      ON anticipos(fondo_id);
CREATE INDEX anticipos_deleted_at_idx    ON anticipos(deleted_at);

-- 5. Trigger updated_at (reutiliza fn_set_updated_at del schema base)
CREATE TRIGGER trg_anticipos_updated_at
  BEFORE UPDATE ON anticipos
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 6. RLS
ALTER TABLE anticipos ENABLE ROW LEVEL SECURITY;

-- Todos los autenticados ven anticipos activos
CREATE POLICY anticipos_select ON anticipos
  FOR SELECT USING (
    deleted_at IS NULL
    AND auth.uid() IS NOT NULL
  );

-- Solo admin/contador crean
CREATE POLICY anticipos_insert ON anticipos
  FOR INSERT WITH CHECK (
    get_my_role() IN ('admin', 'contador')
    AND created_by = auth.uid()
  );

-- Solo admin/contador editan/cambian estado
-- WITH CHECK sin deleted_at IS NULL para permitir soft-delete futuro
CREATE POLICY anticipos_update ON anticipos
  FOR UPDATE
  USING  (get_my_role() IN ('admin', 'contador') AND deleted_at IS NULL)
  WITH CHECK (get_my_role() IN ('admin', 'contador'));

-- Solo admin puede borrar (hard delete)
CREATE POLICY anticipos_delete ON anticipos
  FOR DELETE USING (get_my_role() = 'admin');
