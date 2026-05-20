-- =============================================================================
-- Rediseño estados anticipos comerciales (v2 — corregida + idempotente)
--
-- Mapeo de valores:
--   comprometido        → aprobado
--   parcialmente_pagado → anticipo_pagado
--   pagado              → completado
--   borrador / cancelado: sin cambio
--
-- Estrategia (orden obligatorio):
--   1. DROP DEFAULT              → libera la referencia al enum viejo en la columna
--   2. TYPE TEXT                 → desacopla columna del enum (con guard idempotente)
--   3. RENAME enum viejo         → evita conflicto de nombre al crear el nuevo
--   4. CREATE nuevo enum         → con los estados comerciales correctos
--   5. Migrar datos              → mientras columna es TEXT (UPDATEs idempotentes)
--   6. Reconvertir a nuevo enum  → con CASE defensivo; guard idempotente
--   7. Restaurar DEFAULT         → 'borrador'::anticipo_estado (nuevo tipo)
--   8. fn_confirmar_pago         → CREATE OR REPLACE — siempre idempotente
--   9. DROP enum renombrado      → sin dependencias a esta altura
--
-- Todas las operaciones destructivas están guardadas por IF EXISTS / IF NOT EXISTS.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 1: DROP DEFAULT
--   El DEFAULT 'borrador'::anticipo_estado referencia el enum viejo.
--   Sin esto, ALTER COLUMN TYPE TEXT lanza:
--     "default for column cannot be cast automatically to type anticipo_estado"
--   DROP DEFAULT sobre una columna sin default es no-op → siempre seguro.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE anticipos ALTER COLUMN estado DROP DEFAULT;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 2: liberar columna del enum → TEXT
--   Guard: solo si data_type <> 'text' (evita error en re-ejecución).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (
    SELECT data_type
    FROM   information_schema.columns
    WHERE  table_schema = 'public'
      AND  table_name   = 'anticipos'
      AND  column_name  = 'estado'
  ) <> 'text' THEN
    ALTER TABLE anticipos ALTER COLUMN estado TYPE TEXT;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 3: renombrar enum viejo
--   Guard doble: anticipo_estado existe Y anticipo_estado_old NO existe todavía.
--   Si ya se renombró en un intento previo, el bloque es no-op.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF     EXISTS     (SELECT 1 FROM pg_type WHERE typname = 'anticipo_estado'     AND typtype = 'e')
    AND  NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'anticipo_estado_old' AND typtype = 'e')
  THEN
    ALTER TYPE anticipo_estado RENAME TO anticipo_estado_old;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 4: crear nuevo enum anticipo_estado
--   Guard: solo si no existe todavía.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'anticipo_estado' AND typtype = 'e') THEN
    CREATE TYPE anticipo_estado AS ENUM (
      'borrador',
      'aprobado',
      'anticipo_pagado',
      'completado',
      'cancelado'
    );
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 5: migrar datos mientras la columna es TEXT
--   Los WHERE solo afectan filas con el valor viejo → idempotentes.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE anticipos SET estado = 'aprobado'        WHERE estado = 'comprometido';
UPDATE anticipos SET estado = 'anticipo_pagado'  WHERE estado = 'parcialmente_pagado';
UPDATE anticipos SET estado = 'completado'       WHERE estado = 'pagado';


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 6: reconvertir columna al nuevo enum
--   Guard: solo si data_type = 'text' (columna aún no convertida).
--   CASE defensivo: valores inesperados caen a 'borrador' en lugar de romper.
--   Se usa EXECUTE para aislar la evaluación del USING del parser del DO block.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (
    SELECT data_type
    FROM   information_schema.columns
    WHERE  table_schema = 'public'
      AND  table_name   = 'anticipos'
      AND  column_name  = 'estado'
  ) = 'text' THEN
    EXECUTE $ddl$
      ALTER TABLE anticipos
        ALTER COLUMN estado TYPE anticipo_estado
        USING CASE
          WHEN estado IN ('borrador', 'aprobado', 'anticipo_pagado', 'completado', 'cancelado')
            THEN estado::anticipo_estado
          ELSE 'borrador'::anticipo_estado
        END
    $ddl$;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 7: restaurar DEFAULT con el nuevo enum
--   Siempre seguro de re-ejecutar (SET DEFAULT reemplaza el anterior).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE anticipos ALTER COLUMN estado SET DEFAULT 'borrador'::anticipo_estado;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 8: fn_confirmar_pago con nuevos estados
--   CREATE OR REPLACE → siempre idempotente.
--   Transiciones payment-driven:
--     tipo='anticipo'      : requiere anticipo.estado='aprobado'      → 'anticipo_pagado'
--     tipo='saldo_anticipo': requiere anticipo.estado='anticipo_pagado'→ 'completado'
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

  -- Validar moneda contra fondo
  SELECT moneda INTO v_fondo_moneda FROM fondos WHERE id = v_pago.fondo_id;
  IF v_pago.moneda != v_fondo_moneda THEN
    RAISE EXCEPTION
      'La moneda del pago (%) no coincide con la del fondo (%).',
      v_pago.moneda, v_fondo_moneda;
  END IF;

  -- Gasto: debe estar aprobado
  IF v_pago.tipo = 'gasto' THEN
    IF NOT EXISTS (
      SELECT 1 FROM gastos WHERE id = v_pago.gasto_id AND estado = 'aprobado'
    ) THEN
      RAISE EXCEPTION 'El gasto vinculado no está aprobado.';
    END IF;
  END IF;

  -- Pago de anticipo: anticipo debe estar en 'aprobado'
  IF v_pago.tipo = 'anticipo' THEN
    IF NOT EXISTS (
      SELECT 1 FROM anticipos WHERE id = v_pago.anticipo_id AND estado = 'aprobado'
    ) THEN
      RAISE EXCEPTION
        'El anticipo debe estar en estado aprobado para registrar el pago de anticipo.';
    END IF;
  END IF;

  -- Pago de saldo: anticipo debe estar en 'anticipo_pagado'
  IF v_pago.tipo = 'saldo_anticipo' THEN
    IF NOT EXISTS (
      SELECT 1 FROM anticipos WHERE id = v_pago.anticipo_id AND estado = 'anticipo_pagado'
    ) THEN
      RAISE EXCEPTION
        'El anticipo debe estar en estado anticipo_pagado para registrar el pago de saldo.';
    END IF;
  END IF;

  -- Pago directo: requiere justificación en notas
  IF v_pago.tipo = 'directo' THEN
    IF v_pago.notas IS NULL OR trim(v_pago.notas) = '' THEN
      RAISE EXCEPTION 'Los pagos directos requieren justificación en el campo notas.';
    END IF;
  END IF;

  -- Insertar movimiento débito (trigger actualiza saldo y valida negativo)
  INSERT INTO movimientos_fondo
    (fondo_id, pago_id, tipo, monto, saldo_anterior, saldo_resultante, concepto, fecha, created_by)
  VALUES
    (v_pago.fondo_id, v_pago.id, 'debito', v_pago.monto, 0, 0,
     v_pago.concepto, v_pago.fecha_pago, auth.uid());

  -- Confirmar pago
  UPDATE pagos SET estado = 'pagado', updated_at = now() WHERE id = p_pago_id;

  -- Avanzar estado del anticipo según tipo de pago (payment-driven transitions)
  IF v_pago.tipo = 'anticipo' THEN
    UPDATE anticipos
    SET estado = 'anticipo_pagado', updated_at = now()
    WHERE id = v_pago.anticipo_id;
  END IF;

  IF v_pago.tipo = 'saldo_anticipo' THEN
    UPDATE anticipos
    SET estado = 'completado', updated_at = now()
    WHERE id = v_pago.anticipo_id;
  END IF;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 9: eliminar enum viejo renombrado
--   A este punto no hay columnas ni funciones que lo referencien.
--   Guard: IF EXISTS → no-op si ya fue eliminado en intento previo.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'anticipo_estado_old' AND typtype = 'e') THEN
    DROP TYPE anticipo_estado_old;
  END IF;
END $$;
