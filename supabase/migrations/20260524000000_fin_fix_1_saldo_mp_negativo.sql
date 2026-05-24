-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ FIN-FIX-1 (2026-05-24): permitir saldo MP negativo en fondos.           ║
-- ║                                                                          ║
-- ║ Modelo financiero vigente: PG = MP + MT                                  ║
-- ║   MP = fondos.saldo_actual (Medios Propios, agregado por moneda)        ║
-- ║   MT = -SUM(v_saldos_financiadores.saldo_pendiente) (Medios Terceros)   ║
-- ║                                                                          ║
-- ║ Cambio: el trigger BEFORE INSERT sobre movimientos_fondo abortaba con   ║
-- ║ "Saldo insuficiente en el fondo" cuando un débito superaba el saldo.    ║
-- ║ Esa validación es legacy del modelo viejo (fondos = caja física). En    ║
-- ║ el modelo PG=MP+MT, RISA puede tener MP < 0 porque financia gastos con  ║
-- ║ recursos futuros o vía Terceros. La constraint fondos_saldo_no_negativo ║
-- ║ ya fue eliminada en Etapa 1; este fix remueve el último bloqueo         ║
-- ║ procedural.                                                              ║
-- ║                                                                          ║
-- ║ Idempotente vía CREATE OR REPLACE FUNCTION. Sin DDL destructivo.        ║
-- ║                                                                          ║
-- ║ Lo que NO cambia:                                                        ║
-- ║   - cálculo de saldo_anterior / saldo_resultante                        ║
-- ║   - update de fondos.saldo_actual (cache operacional)                   ║
-- ║   - FOR UPDATE row lock sobre fondos                                    ║
-- ║   - validaciones de fn_confirmar_pago (rol, estado, moneda, gasto FK)   ║
-- ║   - fn_anular_pago (sigue insertando crédito reverso)                   ║
-- ║   - movimientos_financiacion (Tercero, ledger aparte, no pasa por acá)  ║
-- ║   - RLS, triggers de updated_at, secuencias, vistas                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ── PARTE 1: aplicar el fix ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_aplicar_movimiento_fondo()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_saldo NUMERIC(12,2);
BEGIN
  SELECT saldo_actual INTO v_saldo
  FROM fondos WHERE id = NEW.fondo_id FOR UPDATE;

  NEW.saldo_anterior := v_saldo;

  IF NEW.tipo = 'debito' THEN
    -- FIN-FIX-1: MP puede ser negativo (PG = MP + MT). Sin chequeo de suficiencia.
    NEW.saldo_resultante := v_saldo - NEW.monto;
  ELSE
    NEW.saldo_resultante := v_saldo + NEW.monto;
  END IF;

  UPDATE fondos
  SET saldo_actual = NEW.saldo_resultante,
      updated_at   = now()
  WHERE id = NEW.fondo_id;

  RETURN NEW;
END;
$$;

-- ── PARTE 2: verificar que el cuerpo ya no contiene el bloqueo ──────────────
-- Resultado esperado: 'OK — saldo negativo permitido'.

DO $$
DECLARE
  v_body TEXT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_body
    FROM pg_proc WHERE proname = 'fn_aplicar_movimiento_fondo';
  IF v_body LIKE '%Saldo insuficiente%' THEN
    RAISE EXCEPTION 'FIN-FIX-1: bloqueo aún presente en fn_aplicar_movimiento_fondo';
  END IF;
  RAISE NOTICE 'FIN-FIX-1 [check] OK — saldo negativo permitido';
END $$;

-- ── PARTE 3: tests inline mínimos con cleanup ───────────────────────────────
-- Crea fondo + financiador descartables, ejecuta 3 escenarios, valida y limpia.
-- Si alguno falla, RAISE EXCEPTION revierte toda esta sección (atomic block).

DO $$
DECLARE
  v_user_id        UUID;
  v_fondo_id       UUID;
  v_financiador_id UUID;
  v_saldo_final    NUMERIC(12,2);
  v_mov_fondo_count INT;
BEGIN
  -- Tomar cualquier user válido para los created_by. Usamos profiles porque
  -- fondos.created_by FK apunta a profiles(id), no a auth.users(id) directo.
  -- profiles.id == auth.users.id, así que el mismo UUID sirve para las demás
  -- FKs (financiadores.created_by, movimientos_fondo.created_by, etc.).
  SELECT id
    INTO v_user_id
    FROM profiles
   ORDER BY created_at NULLS LAST
   LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'FIN-FIX-1 [tests] FAIL: no hay profiles disponibles para created_by';
  END IF;

  -- Setup: fondo de test con saldo 0.
  INSERT INTO fondos (nombre, moneda, monto_inicial, saldo_actual, estado, created_by)
  VALUES ('__test_fin_fix_1__', 'ARS', 0, 0, 'activo', v_user_id)
  RETURNING id INTO v_fondo_id;

  -- Setup: financiador de test para el test 3.
  INSERT INTO financiadores (nombre, created_by)
  VALUES ('__test_fin_fix_1__', v_user_id)
  RETURNING id INTO v_financiador_id;

  -- ── TEST 1: saldo 0 + débito MP 100 → saldo -100 ────────────────────────
  INSERT INTO movimientos_fondo
    (fondo_id, tipo, monto, saldo_anterior, saldo_resultante, concepto, fecha, created_by)
  VALUES
    (v_fondo_id, 'debito', 100, 0, 0, '__test 1 debito__', CURRENT_DATE, v_user_id);

  SELECT saldo_actual INTO v_saldo_final FROM fondos WHERE id = v_fondo_id;
  IF v_saldo_final <> -100 THEN
    RAISE EXCEPTION 'FIN-FIX-1 [test 1] FAIL: esperado saldo -100, obtenido %', v_saldo_final;
  END IF;
  RAISE NOTICE 'FIN-FIX-1 [test 1] OK: saldo 0 + débito 100 → %', v_saldo_final;

  -- ── TEST 2: anulación (crédito reverso 100) → saldo 0 ────────────────────
  INSERT INTO movimientos_fondo
    (fondo_id, tipo, monto, saldo_anterior, saldo_resultante, concepto, fecha, created_by)
  VALUES
    (v_fondo_id, 'credito', 100, 0, 0, '__test 2 anulacion__', CURRENT_DATE, v_user_id);

  SELECT saldo_actual INTO v_saldo_final FROM fondos WHERE id = v_fondo_id;
  IF v_saldo_final <> 0 THEN
    RAISE EXCEPTION 'FIN-FIX-1 [test 2] FAIL: esperado saldo 0, obtenido %', v_saldo_final;
  END IF;
  RAISE NOTICE 'FIN-FIX-1 [test 2] OK: anulación → %', v_saldo_final;

  -- ── TEST 3: pago Tercero (movimientos_financiacion) NO afecta MP ─────────
  -- Captura cantidad de movimientos del fondo antes del insert externo.
  SELECT COUNT(*) INTO v_mov_fondo_count
    FROM movimientos_fondo WHERE fondo_id = v_fondo_id;

  INSERT INTO movimientos_financiacion
    (financiador_id, tipo_movimiento, importe, moneda, descripcion, created_by)
  VALUES
    (v_financiador_id, 'deuda_generada', 500, 'ARS', '__test 3 tercero__', v_user_id);

  SELECT saldo_actual INTO v_saldo_final FROM fondos WHERE id = v_fondo_id;
  IF v_saldo_final <> 0 THEN
    RAISE EXCEPTION 'FIN-FIX-1 [test 3] FAIL: pago Tercero alteró MP. saldo = %', v_saldo_final;
  END IF;

  -- Tampoco debe haberse insertado un movimiento_fondo nuevo.
  IF (SELECT COUNT(*) FROM movimientos_fondo WHERE fondo_id = v_fondo_id) <> v_mov_fondo_count THEN
    RAISE EXCEPTION 'FIN-FIX-1 [test 3] FAIL: pago Tercero creó movimiento_fondo';
  END IF;
  RAISE NOTICE 'FIN-FIX-1 [test 3] OK: pago Tercero no afectó MP';

  -- ── Cleanup: borrar en orden FK-safe ─────────────────────────────────────
  DELETE FROM movimientos_financiacion WHERE financiador_id = v_financiador_id;
  DELETE FROM movimientos_fondo        WHERE fondo_id = v_fondo_id;
  DELETE FROM financiadores            WHERE id = v_financiador_id;
  DELETE FROM fondos                   WHERE id = v_fondo_id;

  RAISE NOTICE 'FIN-FIX-1 [tests] TODOS OK';
END $$;
