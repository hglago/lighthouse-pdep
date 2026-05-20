-- =============================================================================
-- ETAPA 6B: Endurecimiento financiero y auditoría
-- =============================================================================

-- ─── 1. Numeración documental pagos ──────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS seq_pagos_nro START 1;

ALTER TABLE pagos ADD COLUMN IF NOT EXISTS nro_pago TEXT;

-- No sobreescribe si ya tiene valor (seguro para retries)
CREATE OR REPLACE FUNCTION fn_pagos_set_nro()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.nro_pago IS NULL THEN
    NEW.nro_pago := 'PAG-' || to_char(now(), 'YYYY') || '-'
                    || lpad(nextval('seq_pagos_nro')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pagos_set_nro ON pagos;
CREATE TRIGGER trg_pagos_set_nro
  BEFORE INSERT ON pagos
  FOR EACH ROW EXECUTE FUNCTION fn_pagos_set_nro();

-- Backfill para pagos existentes (asigna números en orden de creación)
UPDATE pagos
SET nro_pago = 'PAG-' || to_char(created_at, 'YYYY') || '-'
               || lpad(nextval('seq_pagos_nro')::text, 5, '0')
WHERE nro_pago IS NULL;

ALTER TABLE pagos ALTER COLUMN nro_pago SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pagos_nro_pago_unico'
  ) THEN
    ALTER TABLE pagos ADD CONSTRAINT pagos_nro_pago_unico UNIQUE (nro_pago);
  END IF;
END $$;

-- ─── 2. Tabla auditoria_eventos (append-only) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS auditoria_eventos (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entidad          TEXT        NOT NULL,
  entidad_id       UUID        NOT NULL,
  accion           TEXT        NOT NULL,
  usuario_id       UUID,
  payload_anterior JSONB,
  payload_nuevo    JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auditoria_entidad_idx    ON auditoria_eventos(entidad, entidad_id);
CREATE INDEX IF NOT EXISTS auditoria_usuario_idx    ON auditoria_eventos(usuario_id);
CREATE INDEX IF NOT EXISTS auditoria_created_at_idx ON auditoria_eventos(created_at);

-- ─── 3. Función genérica de auditoría ────────────────────────────────────────
-- SECURITY DEFINER: bypasea RLS para garantizar que siempre registra.
-- AFTER trigger: registra estado ya comprometido, no el intento.
-- RETURN OLD en DELETE, RETURN NEW en INSERT/UPDATE (aunque AFTER los ignora,
-- es la convención correcta y protege si algún día el trigger se cambia a BEFORE).

CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO auditoria_eventos
    (entidad, entidad_id, accion, usuario_id, payload_anterior, payload_nuevo)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    auth.uid(),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_pagos ON pagos;
CREATE TRIGGER trg_audit_pagos
  AFTER INSERT OR UPDATE OR DELETE ON pagos
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_audit_anticipos ON anticipos;
CREATE TRIGGER trg_audit_anticipos
  AFTER INSERT OR UPDATE OR DELETE ON anticipos
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_audit_gastos ON gastos;
CREATE TRIGGER trg_audit_gastos
  AFTER INSERT OR UPDATE OR DELETE ON gastos
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_audit_fondos ON fondos;
CREATE TRIGGER trg_audit_fondos
  AFTER INSERT OR UPDATE OR DELETE ON fondos
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ─── 4. Trigger de hardening en pagos (BEFORE UPDATE) ────────────────────────
-- Compatibilidad verificada:
--   fn_confirmar_pago: OLD.estado='borrador' → bloque pagado no aplica ✓
--   fn_anular_pago:    OLD.estado='pagado', NEW.estado='anulado' → permitido ✓
--                      solo cambia estado/anulado_por/anulado_en/updated_at ✓

CREATE OR REPLACE FUNCTION fn_pagos_hardening()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Pago anulado: ninguna modificación permitida
  IF OLD.estado = 'anulado' THEN
    RAISE EXCEPTION 'Un pago anulado no puede ser modificado.';
  END IF;

  -- Pago confirmado: solo se permite la transición a anulado
  IF OLD.estado = 'pagado' THEN
    IF NEW.estado != 'anulado' THEN
      RAISE EXCEPTION
        'Un pago confirmado solo puede ser anulado, no revertido a %.', NEW.estado;
    END IF;
    -- Campos operativos inmutables (IS DISTINCT FROM maneja NULLs correctamente)
    IF (OLD.monto        IS DISTINCT FROM NEW.monto)
    OR (OLD.fondo_id     IS DISTINCT FROM NEW.fondo_id)
    OR (OLD.proveedor_id IS DISTINCT FROM NEW.proveedor_id)
    OR (OLD.moneda       IS DISTINCT FROM NEW.moneda)
    OR (OLD.concepto     IS DISTINCT FROM NEW.concepto)
    OR (OLD.notas        IS DISTINCT FROM NEW.notas)
    OR (OLD.fecha_pago   IS DISTINCT FROM NEW.fecha_pago)
    OR (OLD.tipo         IS DISTINCT FROM NEW.tipo)
    OR (OLD.gasto_id     IS DISTINCT FROM NEW.gasto_id)
    OR (OLD.anticipo_id  IS DISTINCT FROM NEW.anticipo_id)
    THEN
      RAISE EXCEPTION
        'No se pueden modificar campos operativos de un pago confirmado.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pagos_hardening ON pagos;
CREATE TRIGGER trg_pagos_hardening
  BEFORE UPDATE ON pagos
  FOR EACH ROW EXECUTE FUNCTION fn_pagos_hardening();

-- ─── 5. fn_confirmar_pago: validaciones cruzadas refinadas ───────────────────

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

  -- Anticipo: debe estar comprometido
  IF v_pago.tipo = 'anticipo' THEN
    IF NOT EXISTS (
      SELECT 1 FROM anticipos WHERE id = v_pago.anticipo_id AND estado = 'comprometido'
    ) THEN
      RAISE EXCEPTION
        'El anticipo debe estar en estado comprometido para registrar el anticipo.';
    END IF;
  END IF;

  -- Saldo anticipo: debe estar parcialmente_pagado
  IF v_pago.tipo = 'saldo_anticipo' THEN
    IF NOT EXISTS (
      SELECT 1 FROM anticipos WHERE id = v_pago.anticipo_id AND estado = 'parcialmente_pagado'
    ) THEN
      RAISE EXCEPTION
        'El anticipo debe estar en estado parcialmente_pagado para registrar el saldo.';
    END IF;
  END IF;

  -- Pago directo: requiere justificación en notas
  IF v_pago.tipo = 'directo' THEN
    IF v_pago.notas IS NULL OR trim(v_pago.notas) = '' THEN
      RAISE EXCEPTION
        'Los pagos directos requieren justificación en el campo notas.';
    END IF;
  END IF;

  -- Insertar movimiento débito (trigger actualiza saldo y valida negativo)
  INSERT INTO movimientos_fondo
    (fondo_id, pago_id, tipo, monto, saldo_anterior, saldo_resultante, concepto, fecha, created_by)
  VALUES
    (v_pago.fondo_id, v_pago.id, 'debito', v_pago.monto, 0, 0,
     v_pago.concepto, v_pago.fecha_pago, auth.uid());

  UPDATE pagos SET estado = 'pagado', updated_at = now() WHERE id = p_pago_id;
END;
$$;

-- ─── 6. Índice único: previene doble movimiento por retry ────────────────────
-- Un pago puede tener como máximo un débito y un crédito en el ledger.

CREATE UNIQUE INDEX IF NOT EXISTS movimientos_pago_unico
  ON movimientos_fondo(pago_id, tipo)
  WHERE pago_id IS NOT NULL;

-- ─── 7. View de fondos con discrepancia ──────────────────────────────────────

CREATE OR REPLACE VIEW v_fondos_con_discrepancia AS
SELECT * FROM v_reconciliacion_fondos
WHERE diferencia != 0;

-- ─── 8. RLS: auditoria_eventos ───────────────────────────────────────────────
-- Solo admin/contador pueden leer.
-- INSERT solo vía fn_audit_log (SECURITY DEFINER, bypasea RLS).
-- Nadie puede UPDATE ni DELETE.

ALTER TABLE auditoria_eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY auditoria_select ON auditoria_eventos
  FOR SELECT USING (get_my_role() IN ('admin', 'contador'));

CREATE POLICY auditoria_no_insert ON auditoria_eventos
  FOR INSERT WITH CHECK (FALSE);

CREATE POLICY auditoria_no_update ON auditoria_eventos
  FOR UPDATE USING (FALSE);

CREATE POLICY auditoria_no_delete ON auditoria_eventos
  FOR DELETE USING (FALSE);
