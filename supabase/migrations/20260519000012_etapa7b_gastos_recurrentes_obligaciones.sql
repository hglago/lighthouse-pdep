-- =============================================================================
-- ETAPA 7B: Gastos con condición de pago, gastos recurrentes,
--            view de obligaciones pendientes, fn_confirmar_pago unificado
--
-- PREREQUISITO OBLIGATORIO: migración 000011 (anticipos_estados_v2) debe estar
-- aplicada antes. Esta migración asume que anticipos.estado usa los nuevos
-- valores ('aprobado', 'anticipo_pagado', 'completado').
--
-- ESTRATEGIA:
-- - Cambios aditivos a gastos y pagos (ADD COLUMN, no DROP COLUMN)
-- - DROP solo de constraints que se amplían (pagos_gasto_requiere_tipo,
--   pagos_tipo_anticipo_requiere_id) y del índice pagos_gasto_unico
-- - Backward compatible: pagos históricos con anticipo_id siguen siendo válidos
-- - Idempotente: IF NOT EXISTS / IF EXISTS en todas las operaciones destructivas
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 1: ALTER TABLE gastos — condición de pago + clasificación
--
-- Columnas nuevas, todas con DEFAULT seguros:
--   tiene_anticipo               BOOLEAN NOT NULL DEFAULT FALSE
--   monto_anticipo               NUMERIC nullable (requerido si tiene_anticipo)
--   porcentaje_anticipo          NUMERIC nullable (opcional)
--   fecha_prevista_pago_anticipo DATE nullable
--   fecha_comprometida_pago_saldo DATE nullable
--   condiciones_pago_notas       TEXT nullable
--   fecha_vencimiento            DATE nullable (obligatorio conceptualmente,
--                                  nullable en migración para datos existentes)
--   prioridad_pago               SMALLINT NOT NULL DEFAULT 3 (1=crítica..4=baja)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS tiene_anticipo               BOOLEAN       NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS monto_anticipo               NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS porcentaje_anticipo          NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS fecha_prevista_pago_anticipo  DATE,
  ADD COLUMN IF NOT EXISTS fecha_comprometida_pago_saldo DATE,
  ADD COLUMN IF NOT EXISTS condiciones_pago_notas        TEXT,
  ADD COLUMN IF NOT EXISTS fecha_vencimiento             DATE,
  ADD COLUMN IF NOT EXISTS prioridad_pago                SMALLINT      NOT NULL DEFAULT 3;

COMMENT ON COLUMN gastos.prioridad_pago IS
  '1=crítica, 2=alta, 3=normal (default), 4=baja — determina orden en vista de obligaciones pendientes';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gastos_prioridad_valida') THEN
    ALTER TABLE gastos ADD CONSTRAINT gastos_prioridad_valida
      CHECK (prioridad_pago BETWEEN 1 AND 4);
  END IF;

  -- monto_anticipo requerido si tiene_anticipo = TRUE
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gastos_anticipo_monto_requerido') THEN
    ALTER TABLE gastos ADD CONSTRAINT gastos_anticipo_monto_requerido
      CHECK (NOT tiene_anticipo OR monto_anticipo IS NOT NULL);
  END IF;

  -- monto_anticipo no puede superar el monto total del gasto
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gastos_anticipo_monto_valido') THEN
    ALTER TABLE gastos ADD CONSTRAINT gastos_anticipo_monto_valido
      CHECK (monto_anticipo IS NULL OR (monto_anticipo > 0 AND monto_anticipo <= monto));
  END IF;

  -- porcentaje_anticipo opcional, pero si está debe ser 0-100
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gastos_porcentaje_anticipo_valido') THEN
    ALTER TABLE gastos ADD CONSTRAINT gastos_porcentaje_anticipo_valido
      CHECK (porcentaje_anticipo IS NULL OR (porcentaje_anticipo > 0 AND porcentaje_anticipo <= 100));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gastos_vencimiento
  ON gastos(fecha_vencimiento)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_gastos_prioridad
  ON gastos(prioridad_pago)
  WHERE deleted_at IS NULL;

-- Índice parcial: solo filas con anticipo, para queries de obligaciones
CREATE INDEX IF NOT EXISTS idx_gastos_anticipo
  ON gastos(id)
  WHERE deleted_at IS NULL AND tiene_anticipo = TRUE;

-- Índice compuesto para la query principal de v_obligaciones_pendientes
-- (filtra por estado='aprobado' + ordena por fecha_vencimiento)
CREATE INDEX IF NOT EXISTS idx_gastos_obligaciones
  ON gastos(estado, fecha_vencimiento)
  WHERE deleted_at IS NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 2: CREATE TABLE gastos_recurrentes
--
-- Plantilla mensual. No genera cuotas ni cron.
-- Obligación del mes se deriva en v_obligaciones_pendientes.
-- dia_vencimiento 1-28 (todos los meses tienen al menos 28 días).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gastos_recurrentes (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  fondo_id        UUID          NOT NULL REFERENCES fondos(id),
  proveedor_id    UUID          REFERENCES proveedores(id) ON DELETE SET NULL,
  concepto        TEXT          NOT NULL,
  categoria       TEXT,
  monto           NUMERIC(12,2) NOT NULL,
  moneda          TEXT          NOT NULL DEFAULT 'ARS',
  dia_vencimiento SMALLINT      NOT NULL,
  fecha_inicio    DATE          NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin       DATE,
  activo          BOOLEAN       NOT NULL DEFAULT TRUE,
  prioridad_pago  SMALLINT      NOT NULL DEFAULT 3,
  observaciones   TEXT,
  created_by      UUID          NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,

  CONSTRAINT recurrentes_monto_positivo   CHECK (monto > 0),
  CONSTRAINT recurrentes_dia_valido       CHECK (dia_vencimiento BETWEEN 1 AND 28),
  CONSTRAINT recurrentes_moneda_valida    CHECK (moneda ~ '^[A-Z]{3}$'),
  CONSTRAINT recurrentes_prioridad_valida CHECK (prioridad_pago BETWEEN 1 AND 4),
  CONSTRAINT recurrentes_fecha_orden      CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
);

COMMENT ON COLUMN gastos_recurrentes.prioridad_pago IS
  '1=crítica, 2=alta, 3=normal (default), 4=baja — determina orden en vista de obligaciones pendientes';

CREATE INDEX IF NOT EXISTS idx_recurrentes_fondo
  ON gastos_recurrentes(fondo_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_recurrentes_activo
  ON gastos_recurrentes(activo)
  WHERE deleted_at IS NULL AND activo = TRUE;

CREATE INDEX IF NOT EXISTS idx_recurrentes_proveedor
  ON gastos_recurrentes(proveedor_id)
  WHERE deleted_at IS NULL;

-- Índice para la query de v_obligaciones_pendientes (filtra activo + ordena por dia)
CREATE INDEX IF NOT EXISTS idx_recurrentes_vencimiento
  ON gastos_recurrentes(dia_vencimiento, activo)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_recurrentes_updated_at ON gastos_recurrentes;
CREATE TRIGGER trg_recurrentes_updated_at
  BEFORE UPDATE ON gastos_recurrentes
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_audit_recurrentes ON gastos_recurrentes;
CREATE TRIGGER trg_audit_recurrentes
  AFTER INSERT OR UPDATE OR DELETE ON gastos_recurrentes
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- RLS
ALTER TABLE gastos_recurrentes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recurrentes_select ON gastos_recurrentes;
CREATE POLICY recurrentes_select ON gastos_recurrentes
  FOR SELECT USING (deleted_at IS NULL AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS recurrentes_insert ON gastos_recurrentes;
CREATE POLICY recurrentes_insert ON gastos_recurrentes
  FOR INSERT WITH CHECK (
    get_my_role() IN ('admin', 'contador')
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS recurrentes_update ON gastos_recurrentes;
CREATE POLICY recurrentes_update ON gastos_recurrentes
  FOR UPDATE
  USING  (get_my_role() IN ('admin', 'contador') AND deleted_at IS NULL)
  WITH CHECK (get_my_role() IN ('admin', 'contador'));

DROP POLICY IF EXISTS recurrentes_delete ON gastos_recurrentes;
CREATE POLICY recurrentes_delete ON gastos_recurrentes
  FOR DELETE USING (get_my_role() = 'admin');


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 3: ALTER TABLE pagos — tipo recurrente + FK a gastos_recurrentes
--          + ajuste de constraints para nuevo modelo dual
--
-- CAMBIOS DE CONSTRAINTS:
--
-- DROP pagos_gasto_requiere_tipo:
--   OLD: gasto_id IS NULL OR tipo = 'gasto'
--   → demasiado estricto: nuevo modelo usa gasto_id para anticipo/saldo_anticipo
--   NEW: gasto_id IS NULL OR tipo IN ('gasto', 'anticipo', 'saldo_anticipo')
--   (por pagos_gasto_id_tipos_validos)
--
-- DROP pagos_tipo_anticipo_requiere_id:
--   OLD: tipo NOT IN ('anticipo', 'saldo_anticipo') OR anticipo_id IS NOT NULL
--   → nuevo modelo usa gasto_id en lugar de anticipo_id para anticipo/saldo
--   NEW: tipo NOT IN ('anticipo', 'saldo_anticipo') OR
--        gasto_id IS NOT NULL OR anticipo_id IS NOT NULL
--   (por pagos_anticipo_tipo_requiere_ref)
--
-- MANTIENEN sin cambio: pagos_anticipo_requiere_tipo, pagos_tipo_gasto_requiere_id
--
-- DROP pagos_gasto_unico:
--   Índice unique en (gasto_id) no permite anticipo + saldo para el mismo gasto.
--   Se elimina. No se reemplaza por unique index: pagos parciales futuros
--   y el par anticipo/saldo del mismo gasto requieren flexibilidad.
--   La integridad se garantiza por la lógica de fn_confirmar_pago y la view.
-- ─────────────────────────────────────────────────────────────────────────────

-- 3a. Nuevo valor al enum (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'recurrente'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'pago_tipo')
  ) THEN
    ALTER TYPE pago_tipo ADD VALUE 'recurrente';
  END IF;
END $$;

-- 3b. FK a gastos_recurrentes
ALTER TABLE pagos
  ADD COLUMN IF NOT EXISTS gasto_recurrente_id UUID REFERENCES gastos_recurrentes(id);

CREATE INDEX IF NOT EXISTS pagos_recurrente_id_idx ON pagos(gasto_recurrente_id);

-- 3c. Ajuste de constraints (DROP los que se amplían, ADD los nuevos)
ALTER TABLE pagos DROP CONSTRAINT IF EXISTS pagos_gasto_requiere_tipo;
ALTER TABLE pagos DROP CONSTRAINT IF EXISTS pagos_tipo_anticipo_requiere_id;

DO $$
BEGIN
  -- gasto_id puede usarse en gasto / anticipo / saldo_anticipo (no directo, no recurrente)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pagos_gasto_id_tipos_validos') THEN
    ALTER TABLE pagos ADD CONSTRAINT pagos_gasto_id_tipos_validos
      CHECK (gasto_id IS NULL OR tipo IN ('gasto', 'anticipo', 'saldo_anticipo'));
  END IF;

  -- anticipo / saldo_anticipo: requiere gasto_id (nuevo modelo) O anticipo_id (histórico)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pagos_anticipo_tipo_requiere_ref') THEN
    ALTER TABLE pagos ADD CONSTRAINT pagos_anticipo_tipo_requiere_ref
      CHECK (
        tipo NOT IN ('anticipo', 'saldo_anticipo')
        OR gasto_id    IS NOT NULL
        OR anticipo_id IS NOT NULL
      );
  END IF;

  -- gasto_recurrente_id válido solo para tipo='recurrente'
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pagos_recurrente_id_tipo_valido') THEN
    ALTER TABLE pagos ADD CONSTRAINT pagos_recurrente_id_tipo_valido
      CHECK (gasto_recurrente_id IS NULL OR tipo = 'recurrente');
  END IF;

  -- tipo='recurrente' requiere gasto_recurrente_id
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pagos_tipo_recurrente_requiere_id') THEN
    ALTER TABLE pagos ADD CONSTRAINT pagos_tipo_recurrente_requiere_id
      CHECK (tipo != 'recurrente' OR gasto_recurrente_id IS NOT NULL);
  END IF;
END $$;

-- 3d. Eliminar unique index en gasto_id (no permite anticipo + saldo para el mismo gasto)
DROP INDEX IF EXISTS pagos_gasto_unico;

-- 3e. fn_pagos_hardening: agregar gasto_recurrente_id a campos inmutables
CREATE OR REPLACE FUNCTION fn_pagos_hardening()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = 'anulado' THEN
    RAISE EXCEPTION 'Un pago anulado no puede ser modificado.';
  END IF;

  IF OLD.estado = 'pagado' THEN
    IF NEW.estado != 'anulado' THEN
      RAISE EXCEPTION
        'Un pago confirmado solo puede ser anulado, no revertido a %.', NEW.estado;
    END IF;
    IF (OLD.monto               IS DISTINCT FROM NEW.monto)
    OR (OLD.fondo_id            IS DISTINCT FROM NEW.fondo_id)
    OR (OLD.proveedor_id        IS DISTINCT FROM NEW.proveedor_id)
    OR (OLD.moneda              IS DISTINCT FROM NEW.moneda)
    OR (OLD.concepto            IS DISTINCT FROM NEW.concepto)
    OR (OLD.notas               IS DISTINCT FROM NEW.notas)
    OR (OLD.fecha_pago          IS DISTINCT FROM NEW.fecha_pago)
    OR (OLD.tipo                IS DISTINCT FROM NEW.tipo)
    OR (OLD.gasto_id            IS DISTINCT FROM NEW.gasto_id)
    OR (OLD.anticipo_id         IS DISTINCT FROM NEW.anticipo_id)
    OR (OLD.gasto_recurrente_id IS DISTINCT FROM NEW.gasto_recurrente_id)
    THEN
      RAISE EXCEPTION 'No se pueden modificar campos operativos de un pago confirmado.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 4: CREATE VIEW v_obligaciones_pendientes
--
-- Fuentes:
--   a) gastos aprobados sin anticipo → obligación pago total
--   b) gastos aprobados con anticipo, sin pago de anticipo → obligación anticipo
--   c) gastos aprobados con anticipo, anticipo pagado, sin saldo → obligación saldo
--   d) gastos_recurrentes activos, sin pago este mes → obligación recurrente
--
-- obligacion_id: clave operativa/UI ÚNICAMENTE
--   formato: 'g_{id}_{total|anticipo|saldo}' | 'r_{id}_{YYYYMM}'
--   NO persiste, NO es FK, NO se usa en auditoría ni en accounting
--
-- Permisos: hereda RLS de las tablas subyacentes (security_invoker por defecto).
-- fondo_saldo_actual: incluido para que el modal muestre saldo disponible.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_obligaciones_pendientes AS

-- a) Gasto simple: pago único total
SELECT
  'g_' || g.id::text || '_total'   AS obligacion_id,
  'gasto_total'::text               AS tipo_obligacion,
  g.id                              AS gasto_id,
  NULL::UUID                        AS gasto_recurrente_id,
  g.fondo_id,
  g.proveedor_id,
  g.descripcion                     AS concepto,
  g.monto                           AS monto_pendiente,
  g.moneda,
  g.fecha_vencimiento,
  g.prioridad_pago,
  g.fecha_gasto,
  f.nombre                          AS fondo_nombre,
  f.saldo_actual                    AS fondo_saldo_actual,
  pr.nombre                         AS proveedor_nombre
FROM gastos g
JOIN  fondos      f  ON f.id  = g.fondo_id
LEFT JOIN proveedores pr ON pr.id = g.proveedor_id
WHERE g.estado      = 'aprobado'
  AND g.deleted_at IS NULL
  AND (g.tiene_anticipo = FALSE OR g.tiene_anticipo IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM pagos p
    WHERE p.gasto_id = g.id
      AND p.tipo     = 'gasto'
      AND p.estado   = 'pagado'
  )

UNION ALL

-- b) Anticipo: primer desembolso de gasto con condición de anticipo
SELECT
  'g_' || g.id::text || '_anticipo' AS obligacion_id,
  'anticipo'::text                   AS tipo_obligacion,
  g.id                               AS gasto_id,
  NULL::UUID                         AS gasto_recurrente_id,
  g.fondo_id,
  g.proveedor_id,
  'Anticipo: ' || g.descripcion     AS concepto,
  g.monto_anticipo                   AS monto_pendiente,
  g.moneda,
  g.fecha_prevista_pago_anticipo     AS fecha_vencimiento,
  g.prioridad_pago,
  g.fecha_gasto,
  f.nombre                           AS fondo_nombre,
  f.saldo_actual                     AS fondo_saldo_actual,
  pr.nombre                          AS proveedor_nombre
FROM gastos g
JOIN  fondos      f  ON f.id  = g.fondo_id
LEFT JOIN proveedores pr ON pr.id = g.proveedor_id
WHERE g.estado         = 'aprobado'
  AND g.deleted_at    IS NULL
  AND g.tiene_anticipo = TRUE
  AND g.monto_anticipo IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM pagos p
    WHERE p.gasto_id = g.id
      AND p.tipo     = 'anticipo'
      AND p.estado   = 'pagado'
  )

UNION ALL

-- c) Saldo: segundo desembolso, solo si anticipo ya está pagado
SELECT
  'g_' || g.id::text || '_saldo'   AS obligacion_id,
  'saldo_anticipo'::text            AS tipo_obligacion,
  g.id                              AS gasto_id,
  NULL::UUID                        AS gasto_recurrente_id,
  g.fondo_id,
  g.proveedor_id,
  'Saldo: ' || g.descripcion       AS concepto,
  (g.monto - g.monto_anticipo)     AS monto_pendiente,
  g.moneda,
  g.fecha_comprometida_pago_saldo  AS fecha_vencimiento,
  g.prioridad_pago,
  g.fecha_gasto,
  f.nombre                          AS fondo_nombre,
  f.saldo_actual                    AS fondo_saldo_actual,
  pr.nombre                         AS proveedor_nombre
FROM gastos g
JOIN  fondos      f  ON f.id  = g.fondo_id
LEFT JOIN proveedores pr ON pr.id = g.proveedor_id
WHERE g.estado         = 'aprobado'
  AND g.deleted_at    IS NULL
  AND g.tiene_anticipo = TRUE
  AND g.monto_anticipo IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM pagos p
    WHERE p.gasto_id = g.id
      AND p.tipo     = 'anticipo'
      AND p.estado   = 'pagado'
  )
  AND NOT EXISTS (
    SELECT 1 FROM pagos p
    WHERE p.gasto_id = g.id
      AND p.tipo     = 'saldo_anticipo'
      AND p.estado   = 'pagado'
  )

UNION ALL

-- d) Recurrente: obligación del mes en curso sin pago confirmado
--    make_date(year, month, dia_vencimiento): siempre válido porque dia_vencimiento <= 28
SELECT
  'r_' || gr.id::text || '_' || to_char(CURRENT_DATE, 'YYYYMM') AS obligacion_id,
  'recurrente'::text               AS tipo_obligacion,
  NULL::UUID                       AS gasto_id,
  gr.id                            AS gasto_recurrente_id,
  gr.fondo_id,
  gr.proveedor_id,
  gr.concepto,
  gr.monto                         AS monto_pendiente,
  gr.moneda,
  make_date(
    EXTRACT(YEAR  FROM CURRENT_DATE)::INT,
    EXTRACT(MONTH FROM CURRENT_DATE)::INT,
    gr.dia_vencimiento
  )                                AS fecha_vencimiento,
  gr.prioridad_pago,
  CURRENT_DATE                     AS fecha_gasto,
  f.nombre                         AS fondo_nombre,
  f.saldo_actual                   AS fondo_saldo_actual,
  pr.nombre                        AS proveedor_nombre
FROM gastos_recurrentes gr
JOIN  fondos      f  ON f.id  = gr.fondo_id
LEFT JOIN proveedores pr ON pr.id = gr.proveedor_id
WHERE gr.activo      = TRUE
  AND gr.deleted_at IS NULL
  AND gr.fecha_inicio <= CURRENT_DATE
  AND (gr.fecha_fin IS NULL
       OR gr.fecha_fin >= date_trunc('month', CURRENT_DATE)::DATE)
  AND NOT EXISTS (
    SELECT 1 FROM pagos p
    WHERE p.gasto_recurrente_id = gr.id
      AND p.tipo                = 'recurrente'
      AND p.estado              = 'pagado'
      AND date_trunc('month', p.fecha_pago) = date_trunc('month', CURRENT_DATE)
  );

GRANT SELECT ON v_obligaciones_pendientes TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 5: fn_confirmar_pago — modelo dual + tipo recurrente
--
-- Lógica de validación por tipo:
--   'gasto'          → gasto.estado = 'aprobado'
--   'anticipo'       → si gasto_id: gasto aprobado con tiene_anticipo=TRUE
--                      si anticipo_id: anticipo.estado='aprobado' (histórico)
--                        → avanza anticipo a 'anticipo_pagado'
--   'saldo_anticipo' → si gasto_id: gasto aprobado + pago anticipo previo pagado
--                      si anticipo_id: anticipo.estado='anticipo_pagado' (histórico)
--                        → avanza anticipo a 'completado'
--   'recurrente'     → gastos_recurrentes activo
--   'directo'        → notas requeridas
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_confirmar_pago(p_pago_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pago         pagos%ROWTYPE;
  v_fondo_moneda TEXT;
BEGIN
  IF get_my_role() NOT IN ('admin', 'contador') THEN
    RAISE EXCEPTION 'Sin permiso para confirmar pagos.';
  END IF;

  SELECT * INTO v_pago FROM pagos WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pago no encontrado.';
  END IF;
  IF v_pago.estado != 'borrador' THEN
    RAISE EXCEPTION 'Solo se pueden confirmar pagos en borrador.';
  END IF;

  SELECT moneda INTO v_fondo_moneda FROM fondos WHERE id = v_pago.fondo_id;
  IF v_pago.moneda != v_fondo_moneda THEN
    RAISE EXCEPTION
      'La moneda del pago (%) no coincide con la del fondo (%).',
      v_pago.moneda, v_fondo_moneda;
  END IF;

  -- ── 'gasto': gasto aprobado ───────────────────────────────────────────────
  IF v_pago.tipo = 'gasto' THEN
    IF NOT EXISTS (
      SELECT 1 FROM gastos
      WHERE id = v_pago.gasto_id AND estado = 'aprobado'
    ) THEN
      RAISE EXCEPTION 'El gasto vinculado no está aprobado.';
    END IF;
  END IF;

  -- ── 'anticipo' vía nuevo modelo (gasto con tiene_anticipo) ───────────────
  IF v_pago.tipo = 'anticipo' AND v_pago.gasto_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM gastos
      WHERE id = v_pago.gasto_id
        AND estado         = 'aprobado'
        AND tiene_anticipo = TRUE
        AND monto_anticipo IS NOT NULL
    ) THEN
      RAISE EXCEPTION
        'El gasto debe estar aprobado y tener condición de anticipo configurada.';
    END IF;
  END IF;

  -- ── 'anticipo' vía modelo histórico (tabla anticipos) ────────────────────
  IF v_pago.tipo = 'anticipo' AND v_pago.anticipo_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM anticipos
      WHERE id = v_pago.anticipo_id AND estado = 'aprobado'
    ) THEN
      RAISE EXCEPTION
        'El anticipo debe estar en estado aprobado para registrar el pago de anticipo.';
    END IF;
    UPDATE anticipos
    SET estado = 'anticipo_pagado', updated_at = now()
    WHERE id = v_pago.anticipo_id;
  END IF;

  -- ── 'saldo_anticipo' vía nuevo modelo ────────────────────────────────────
  IF v_pago.tipo = 'saldo_anticipo' AND v_pago.gasto_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM gastos
      WHERE id = v_pago.gasto_id
        AND estado         = 'aprobado'
        AND tiene_anticipo = TRUE
    ) THEN
      RAISE EXCEPTION
        'El gasto vinculado debe estar aprobado y tener condición de anticipo.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pagos
      WHERE gasto_id = v_pago.gasto_id
        AND tipo     = 'anticipo'
        AND estado   = 'pagado'
    ) THEN
      RAISE EXCEPTION
        'El anticipo del gasto aún no fue pagado. Registrá primero el pago de anticipo.';
    END IF;
  END IF;

  -- ── 'saldo_anticipo' vía modelo histórico ────────────────────────────────
  IF v_pago.tipo = 'saldo_anticipo' AND v_pago.anticipo_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM anticipos
      WHERE id = v_pago.anticipo_id AND estado = 'anticipo_pagado'
    ) THEN
      RAISE EXCEPTION
        'El anticipo debe estar en estado anticipo_pagado para registrar el pago de saldo.';
    END IF;
    UPDATE anticipos
    SET estado = 'completado', updated_at = now()
    WHERE id = v_pago.anticipo_id;
  END IF;

  -- ── 'recurrente': gastos_recurrentes activo ───────────────────────────────
  IF v_pago.tipo = 'recurrente' THEN
    IF NOT EXISTS (
      SELECT 1 FROM gastos_recurrentes
      WHERE id        = v_pago.gasto_recurrente_id
        AND activo    = TRUE
        AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'El gasto recurrente referenciado no está activo.';
    END IF;
  END IF;

  -- ── 'directo': notas requeridas ───────────────────────────────────────────
  IF v_pago.tipo = 'directo' THEN
    IF v_pago.notas IS NULL OR trim(v_pago.notas) = '' THEN
      RAISE EXCEPTION 'Los pagos directos requieren justificación en el campo notas.';
    END IF;
  END IF;

  -- Insertar movimiento débito (trigger calcula saldo_anterior/saldo_resultante
  -- y bloquea saldo negativo)
  INSERT INTO movimientos_fondo
    (fondo_id, pago_id, tipo, monto, saldo_anterior, saldo_resultante,
     concepto, fecha, created_by)
  VALUES
    (v_pago.fondo_id, v_pago.id, 'debito', v_pago.monto, 0, 0,
     v_pago.concepto, v_pago.fecha_pago, auth.uid());

  UPDATE pagos
  SET estado = 'pagado', updated_at = now()
  WHERE id = p_pago_id;
END;
$$;
