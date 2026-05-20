-- =============================================================================
-- Aportes de fondo + hardening financiero
--
-- PREREQUISITO: 20260520000000_fondos_hardening_unique.sql ya aplicado.
--
-- CAMBIOS:
--   1. trg_fondos_monto_inicial_inmutable  — bloquea cambios post-creación
--   2. trg_fondos_moneda_inmutable_si_tiene_movimientos — bloquea cambio de
--      moneda si ya existen movimientos financieros en el fondo
--   3. tabla aportes_fondo                 — registro operativo de ingresos
--   4. fn_registrar_aporte (RPC)           — operación atómica:
--        INSERT aportes_fondo
--        INSERT movimientos_fondo tipo='credito'  ← trigger actualiza saldo
--        UPDATE aportes_fondo.movimiento_id
--
-- LEDGER:
--   movimientos_fondo sigue siendo append-only. Soft-deletear un aporte NO
--   revierte el saldo. Para reversar el impacto financiero de un aporte se
--   debe registrar un nuevo aporte de tipo 'ajuste' con el monto equivalente
--   (decisión operativa explícita, nunca automática).
--
-- BACKWARD COMPATIBILITY:
--   updateFondo (server action): envía {nombre, descripcion, estado}.
--   NO incluye monto_inicial ni moneda en el SET → ninguno de los dos triggers
--   nuevos dispara en las operaciones normales de la app.
--   Supabase Studio o scripts directos que modifiquen monto_inicial o moneda
--   serán bloqueados por los triggers cuando aplique.
-- =============================================================================


-- ─── 1. monto_inicial inmutable ───────────────────────────────────────────────
-- Dispara solo cuando monto_inicial aparece en la cláusula SET del UPDATE.
-- El server action de editar fondo no incluye monto_inicial → no dispara.
-- Bloquea cambios desde Studio, scripts o futuros endpoints que lo incluyan.

CREATE OR REPLACE FUNCTION fn_fondos_monto_inicial_inmutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.monto_inicial IS DISTINCT FROM NEW.monto_inicial THEN
    RAISE EXCEPTION
      'El monto_inicial del fondo es inmutable después de su creación. '
      'Para ajustar el capital disponible registrá un aporte de tipo ''ajuste''.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fondos_monto_inicial_inmutable ON fondos;
CREATE TRIGGER trg_fondos_monto_inicial_inmutable
  BEFORE UPDATE OF monto_inicial ON fondos
  FOR EACH ROW EXECUTE FUNCTION fn_fondos_monto_inicial_inmutable();


-- ─── 2. moneda inmutable si el fondo tiene movimientos ────────────────────────
-- Dispara solo cuando moneda aparece en el SET.
-- El server action de editar fondo no incluye moneda → no dispara.
-- Bloquea cambios de moneda cuando ya existen movimientos:
--   cambiar moneda en ese punto rompería el ledger, la conciliación y reporting.
-- Si no hay movimientos, el cambio está permitido (fondo recién creado, sin uso).

CREATE OR REPLACE FUNCTION fn_fondos_moneda_inmutable_si_tiene_movimientos()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.moneda IS DISTINCT FROM NEW.moneda THEN
    IF EXISTS (
      SELECT 1 FROM movimientos_fondo WHERE fondo_id = OLD.id LIMIT 1
    ) THEN
      RAISE EXCEPTION
        'No se puede modificar la moneda de un fondo que ya posee movimientos '
        'financieros. Hacerlo rompería el ledger y la conciliación.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fondos_moneda_inmutable_si_tiene_movimientos ON fondos;
CREATE TRIGGER trg_fondos_moneda_inmutable_si_tiene_movimientos
  BEFORE UPDATE OF moneda ON fondos
  FOR EACH ROW EXECUTE FUNCTION fn_fondos_moneda_inmutable_si_tiene_movimientos();


-- ─── 3. Tabla aportes_fondo ───────────────────────────────────────────────────
--
-- SOFT DELETE — semántica crítica:
--   deleted_at NO revierte el saldo del fondo.
--   El movimiento_fondo tipo='credito' generado por el aporte permanece en el
--   ledger append-only. Para revertir el impacto financiero es necesario
--   registrar un aporte de tipo 'ajuste' de forma explícita.
--
-- NO existe DELETE policy en RLS: el DELETE físico está bloqueado para todos
-- los roles. La única forma de "eliminar" un aporte es el soft delete
-- (UPDATE deleted_at) desde la aplicación.

CREATE TABLE aportes_fondo (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  fondo_id        UUID          NOT NULL REFERENCES fondos(id),
  movimiento_id   UUID          REFERENCES movimientos_fondo(id),
  fecha_aporte    DATE          NOT NULL DEFAULT CURRENT_DATE,
  monto           NUMERIC(14,2) NOT NULL,
  moneda          TEXT          NOT NULL,
  tipo_aporte     TEXT          NOT NULL DEFAULT 'aporte_socios',
  aportante       TEXT,
  concepto        TEXT          NOT NULL,
  comprobante_url TEXT,
  observaciones   TEXT,
  created_by      UUID          NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,

  CONSTRAINT aportes_monto_positivo CHECK (monto > 0),
  CONSTRAINT aportes_moneda_valida  CHECK (moneda ~ '^[A-Z]{3}$'),
  CONSTRAINT aportes_tipo_valido    CHECK (
    tipo_aporte IN ('aporte_socios', 'transferencia', 'ajuste', 'reintegro', 'otro')
  )
);

CREATE INDEX aportes_fondo_id_idx   ON aportes_fondo(fondo_id);
CREATE INDEX aportes_fecha_idx      ON aportes_fondo(fecha_aporte);
CREATE INDEX aportes_tipo_idx       ON aportes_fondo(tipo_aporte);
CREATE INDEX aportes_created_at_idx ON aportes_fondo(created_at);
CREATE INDEX aportes_aportante_idx  ON aportes_fondo(aportante)
  WHERE aportante IS NOT NULL;


-- ─── 4. Trigger updated_at ────────────────────────────────────────────────────

CREATE TRIGGER trg_aportes_fondo_updated_at
  BEFORE UPDATE ON aportes_fondo
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ─── 5. Auditoría ─────────────────────────────────────────────────────────────

CREATE TRIGGER trg_audit_aportes_fondo
  AFTER INSERT OR UPDATE OR DELETE ON aportes_fondo
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();


-- ─── 6. RLS ───────────────────────────────────────────────────────────────────
-- Sin DELETE policy: el DELETE físico queda bloqueado por defecto (deny-all
-- cuando RLS está activo y no hay policy que lo permita).

ALTER TABLE aportes_fondo ENABLE ROW LEVEL SECURITY;

CREATE POLICY aportes_select ON aportes_fondo
  FOR SELECT USING (auth.uid() IS NOT NULL AND deleted_at IS NULL);

CREATE POLICY aportes_insert ON aportes_fondo
  FOR INSERT WITH CHECK (
    get_my_role() IN ('admin', 'contador')
    AND created_by = auth.uid()
  );

CREATE POLICY aportes_update ON aportes_fondo
  FOR UPDATE
  USING  (get_my_role() IN ('admin', 'contador') AND deleted_at IS NULL)
  WITH CHECK (get_my_role() IN ('admin', 'contador'));


-- ─── 7. RPC fn_registrar_aporte ───────────────────────────────────────────────
--
-- Operación atómica (único BEGIN/END PL/pgSQL):
--   1. Valida rol, tipo_aporte, monto, concepto
--   2. SELECT fondos FOR UPDATE → bloquea fila para evitar race condition
--   3. Valida fondo activo; toma moneda del fondo (no del frontend)
--   4. INSERT aportes_fondo (movimiento_id NULL todavía)
--   5. INSERT movimientos_fondo tipo='credito', pago_id=NULL
--        → dispara fn_aplicar_movimiento_fondo:
--             SELECT saldo_actual FOR UPDATE (misma txn → no-op de bloqueo)
--             saldo_anterior  = saldo_actual
--             saldo_resultante = saldo_actual + monto
--             UPDATE fondos SET saldo_actual = saldo_resultante
--   6. UPDATE aportes_fondo SET movimiento_id = <id generado>
--   7. RETURN aporte_id
--
-- Compatibilidad con índice movimientos_pago_unico:
--   WHERE pago_id IS NOT NULL → aportes con pago_id=NULL quedan excluidos,
--   múltiples créditos de aportes no colisionan. ✓

CREATE OR REPLACE FUNCTION fn_registrar_aporte(
  p_fondo_id        UUID,
  p_fecha_aporte    DATE,
  p_monto           NUMERIC,
  p_tipo_aporte     TEXT,
  p_aportante       TEXT,
  p_concepto        TEXT,
  p_comprobante_url TEXT,
  p_observaciones   TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_fondo         fondos%ROWTYPE;
  v_aporte_id     UUID;
  v_movimiento_id UUID;
BEGIN
  -- Permisos
  IF get_my_role() NOT IN ('admin', 'contador') THEN
    RAISE EXCEPTION 'Sin permiso para registrar aportes.';
  END IF;

  -- Validaciones de entrada
  IF p_tipo_aporte NOT IN ('aporte_socios', 'transferencia', 'ajuste', 'reintegro', 'otro') THEN
    RAISE EXCEPTION
      'tipo_aporte inválido: %. Valores permitidos: aporte_socios, transferencia, ajuste, reintegro, otro.',
      p_tipo_aporte;
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del aporte debe ser mayor a 0.';
  END IF;

  IF p_concepto IS NULL OR trim(p_concepto) = '' THEN
    RAISE EXCEPTION 'El concepto del aporte es requerido.';
  END IF;

  -- Bloquear fondo
  SELECT * INTO v_fondo
  FROM fondos WHERE id = p_fondo_id AND deleted_at IS NULL FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fondo no encontrado.';
  END IF;

  IF v_fondo.estado != 'activo' THEN
    RAISE EXCEPTION
      'Solo se pueden registrar aportes en fondos activos. Estado actual: %.', v_fondo.estado;
  END IF;

  -- Crear aporte (sin movimiento_id todavía)
  INSERT INTO aportes_fondo
    (fondo_id, fecha_aporte, monto, moneda, tipo_aporte,
     aportante, concepto, comprobante_url, observaciones, created_by)
  VALUES
    (p_fondo_id, p_fecha_aporte, p_monto, v_fondo.moneda, p_tipo_aporte,
     p_aportante, trim(p_concepto), p_comprobante_url, p_observaciones, auth.uid())
  RETURNING id INTO v_aporte_id;

  -- Insertar movimiento crédito; el trigger fn_aplicar_movimiento_fondo
  -- calcula saldo_anterior/saldo_resultante y actualiza fondos.saldo_actual
  INSERT INTO movimientos_fondo
    (fondo_id, pago_id, tipo, monto, saldo_anterior, saldo_resultante,
     concepto, fecha, created_by)
  VALUES
    (p_fondo_id, NULL, 'credito', p_monto, 0, 0,
     'Aporte: ' || trim(p_concepto), p_fecha_aporte, auth.uid())
  RETURNING id INTO v_movimiento_id;

  -- Vincular movimiento al aporte
  UPDATE aportes_fondo
  SET movimiento_id = v_movimiento_id
  WHERE id = v_aporte_id;

  RETURN v_aporte_id;
END;
$$;
