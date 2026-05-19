-- =============================================================================
-- ETAPA 6A: Pagos reales y movimientos de fondo
-- =============================================================================

-- 1. Enums
CREATE TYPE pago_estado     AS ENUM ('borrador', 'pagado', 'anulado');
CREATE TYPE pago_tipo       AS ENUM ('gasto', 'anticipo', 'saldo_anticipo', 'directo');
CREATE TYPE movimiento_tipo AS ENUM ('debito', 'credito');

-- 2. Tabla pagos
CREATE TABLE pagos (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  fondo_id        UUID          NOT NULL REFERENCES fondos(id),
  proveedor_id    UUID          NOT NULL REFERENCES proveedores(id),
  gasto_id        UUID          REFERENCES gastos(id),
  anticipo_id     UUID          REFERENCES anticipos(id),
  tipo            pago_tipo     NOT NULL,
  concepto        TEXT          NOT NULL,
  monto           NUMERIC(12,2) NOT NULL,
  moneda          TEXT          NOT NULL,
  fecha_pago      DATE          NOT NULL,
  comprobante_url TEXT,
  estado          pago_estado   NOT NULL DEFAULT 'borrador',
  notas           TEXT,
  created_by      UUID          NOT NULL REFERENCES auth.users(id),
  anulado_por     UUID          REFERENCES auth.users(id),
  anulado_en      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT pagos_monto_positivo
    CHECK (monto > 0),
  CONSTRAINT pagos_moneda_valida
    CHECK (moneda ~ '^[A-Z]{3}$'),
  CONSTRAINT pagos_gasto_requiere_tipo
    CHECK (gasto_id    IS NULL OR tipo = 'gasto'),
  CONSTRAINT pagos_tipo_gasto_requiere_id
    CHECK (tipo != 'gasto' OR gasto_id IS NOT NULL),
  CONSTRAINT pagos_anticipo_requiere_tipo
    CHECK (anticipo_id IS NULL OR tipo IN ('anticipo', 'saldo_anticipo')),
  CONSTRAINT pagos_tipo_anticipo_requiere_id
    CHECK (tipo NOT IN ('anticipo', 'saldo_anticipo') OR anticipo_id IS NOT NULL)
);

-- Un gasto solo puede pagarse una vez (excluye anulados)
-- NO hay unique sobre anticipo_id: se permiten pagos parciales múltiples futuros
CREATE UNIQUE INDEX pagos_gasto_unico
  ON pagos(gasto_id)
  WHERE gasto_id IS NOT NULL AND estado != 'anulado';

CREATE INDEX pagos_fondo_id_idx     ON pagos(fondo_id);
CREATE INDEX pagos_proveedor_id_idx ON pagos(proveedor_id);
CREATE INDEX pagos_anticipo_id_idx  ON pagos(anticipo_id);
CREATE INDEX pagos_gasto_id_idx     ON pagos(gasto_id);
CREATE INDEX pagos_estado_idx       ON pagos(estado);
CREATE INDEX pagos_fecha_pago_idx   ON pagos(fecha_pago);

CREATE TRIGGER trg_pagos_updated_at
  BEFORE UPDATE ON pagos
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 3. Tabla movimientos_fondo (ledger inmutable, append-only)
--    saldo_anterior y saldo_resultante los completa el trigger BEFORE INSERT;
--    el INSERT usa placeholders 0/0 — no se agrega CHECK de consistencia aquí.
CREATE TABLE movimientos_fondo (
  id               UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  fondo_id         UUID            NOT NULL REFERENCES fondos(id),
  pago_id          UUID            REFERENCES pagos(id),
  tipo             movimiento_tipo NOT NULL,
  monto            NUMERIC(12,2)   NOT NULL,
  saldo_anterior   NUMERIC(12,2)   NOT NULL,
  saldo_resultante NUMERIC(12,2)   NOT NULL,
  concepto         TEXT            NOT NULL,
  fecha            DATE            NOT NULL,
  created_by       UUID            NOT NULL REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ     NOT NULL DEFAULT now(),

  CONSTRAINT movimientos_monto_positivo CHECK (monto > 0)
);

CREATE INDEX movimientos_fondo_id_idx  ON movimientos_fondo(fondo_id);
CREATE INDEX movimientos_pago_id_idx   ON movimientos_fondo(pago_id);
CREATE INDEX movimientos_fecha_idx     ON movimientos_fondo(fecha);
CREATE INDEX movimientos_created_at_idx ON movimientos_fondo(created_at);

-- 4. Trigger BEFORE INSERT: calcula saldo_anterior/saldo_resultante,
--    bloquea saldo negativo, actualiza fondos.saldo_actual (cache operacional)
CREATE OR REPLACE FUNCTION fn_aplicar_movimiento_fondo()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_saldo NUMERIC(12,2);
BEGIN
  SELECT saldo_actual INTO v_saldo
  FROM fondos WHERE id = NEW.fondo_id FOR UPDATE;

  NEW.saldo_anterior := v_saldo;

  IF NEW.tipo = 'debito' THEN
    IF v_saldo < NEW.monto THEN
      RAISE EXCEPTION
        'Saldo insuficiente en el fondo. Disponible: %, Requerido: %',
        v_saldo, NEW.monto;
    END IF;
    NEW.saldo_resultante := v_saldo - NEW.monto;
  ELSE
    NEW.saldo_resultante := v_saldo + NEW.monto;
  END IF;

  UPDATE fondos
  SET saldo_actual = NEW.saldo_resultante, updated_at = now()
  WHERE id = NEW.fondo_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_movimientos_aplicar_saldo
  BEFORE INSERT ON movimientos_fondo
  FOR EACH ROW EXECUTE FUNCTION fn_aplicar_movimiento_fondo();

-- 5. View de reconciliación (ledger como fuente de verdad)
--    diferencia = 0 cuando el sistema está íntegro
CREATE VIEW v_reconciliacion_fondos AS
SELECT
  f.id,
  f.nombre,
  f.moneda,
  f.monto_inicial,
  f.saldo_actual                                                        AS saldo_cache,
  f.monto_inicial
    + COALESCE(SUM(CASE WHEN m.tipo = 'credito' THEN m.monto ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN m.tipo = 'debito'  THEN m.monto ELSE 0 END), 0)
                                                                        AS saldo_ledger,
  f.saldo_actual - (
    f.monto_inicial
    + COALESCE(SUM(CASE WHEN m.tipo = 'credito' THEN m.monto ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN m.tipo = 'debito'  THEN m.monto ELSE 0 END), 0)
  )                                                                     AS diferencia
FROM fondos f
LEFT JOIN movimientos_fondo m ON m.fondo_id = f.id
GROUP BY f.id, f.nombre, f.moneda, f.monto_inicial, f.saldo_actual;

-- 6. RPC fn_confirmar_pago: atómica, valida moneda contra fondo
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

  IF v_pago.gasto_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM gastos WHERE id = v_pago.gasto_id AND estado = 'aprobado'
    ) THEN
      RAISE EXCEPTION 'El gasto vinculado no está aprobado.';
    END IF;
  END IF;

  IF v_pago.anticipo_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM anticipos WHERE id = v_pago.anticipo_id AND estado != 'cancelado'
    ) THEN
      RAISE EXCEPTION 'El anticipo vinculado está cancelado.';
    END IF;
  END IF;

  -- saldo_anterior/saldo_resultante los completa el trigger; 0/0 son placeholders
  INSERT INTO movimientos_fondo
    (fondo_id, pago_id, tipo, monto, saldo_anterior, saldo_resultante, concepto, fecha, created_by)
  VALUES
    (v_pago.fondo_id, v_pago.id, 'debito', v_pago.monto, 0, 0,
     v_pago.concepto, v_pago.fecha_pago, auth.uid());

  UPDATE pagos
  SET estado = 'pagado', updated_at = now()
  WHERE id = p_pago_id;
END;
$$;

-- 7. RPC fn_anular_pago: solo admin
CREATE OR REPLACE FUNCTION fn_anular_pago(p_pago_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pago pagos%ROWTYPE;
BEGIN
  IF get_my_role() != 'admin' THEN
    RAISE EXCEPTION 'Solo admin puede anular pagos.';
  END IF;

  SELECT * INTO v_pago FROM pagos WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pago no encontrado.';
  END IF;
  IF v_pago.estado != 'pagado' THEN
    RAISE EXCEPTION 'Solo se pueden anular pagos confirmados.';
  END IF;

  INSERT INTO movimientos_fondo
    (fondo_id, pago_id, tipo, monto, saldo_anterior, saldo_resultante, concepto, fecha, created_by)
  VALUES
    (v_pago.fondo_id, v_pago.id, 'credito', v_pago.monto, 0, 0,
     'Anulación: ' || v_pago.concepto, CURRENT_DATE, auth.uid());

  UPDATE pagos
  SET estado      = 'anulado',
      anulado_por = auth.uid(),
      anulado_en  = now(),
      updated_at  = now()
  WHERE id = p_pago_id;
END;
$$;

-- 8. RLS: pagos
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;

CREATE POLICY pagos_select ON pagos
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY pagos_insert ON pagos
  FOR INSERT WITH CHECK (
    get_my_role() IN ('admin', 'contador')
    AND created_by = auth.uid()
  );

-- Solo pagos en borrador son editables directamente;
-- confirmar y anular van por RPC SECURITY DEFINER
CREATE POLICY pagos_update ON pagos
  FOR UPDATE
  USING  (get_my_role() IN ('admin', 'contador') AND estado = 'borrador')
  WITH CHECK (get_my_role() IN ('admin', 'contador'));

CREATE POLICY pagos_no_delete ON pagos
  FOR DELETE USING (FALSE);

-- 9. RLS: movimientos_fondo
--    Lectura para todos los autenticados.
--    Escritura exclusivamente vía fn_confirmar_pago / fn_anular_pago (SECURITY DEFINER).
ALTER TABLE movimientos_fondo ENABLE ROW LEVEL SECURITY;

CREATE POLICY movimientos_select ON movimientos_fondo
  FOR SELECT USING (auth.uid() IS NOT NULL);
