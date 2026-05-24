-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ FIN2.3 (2026-05-24): RPC registrar_aporte_socio_v2 con imputaciones    ║
-- ║                       múltiples (split MP + Terceros).                  ║
-- ║                                                                          ║
-- ║ Reemplaza FUNCIONALMENTE a registrar_aporte_socio (que sigue intacta    ║
-- ║ por compatibilidad). El frontend usará v2 desde FIN2.4 en adelante.    ║
-- ║                                                                          ║
-- ║ Operación atómica (SECURITY DEFINER):                                   ║
-- ║   1. Valida rol, payload, socio activo, fondo activo, moneda.          ║
-- ║   2. Valida que SUM(items.monto) == payload.monto_total (±0.01).       ║
-- ║   3. INSERT aportes_fondo (cabecera). Campos legacy destino_aporte/     ║
-- ║      financiador_id quedan en 'risa'/NULL (split real vive en          ║
-- ║      aporte_imputaciones). movimiento_id = NULL.                        ║
-- ║   4. Por cada item:                                                      ║
-- ║      a) destino_tipo='medios_propios':                                  ║
-- ║           INSERT movimientos_fondo crédito                              ║
-- ║             → trigger fn_aplicar_movimiento_fondo actualiza saldo       ║
-- ║           INSERT aporte_imputaciones con movimiento_fondo_id            ║
-- ║      b) destino_tipo='tercero':                                         ║
-- ║           Valida item.monto ≤ v_saldos_financiadores.saldo_pendiente    ║
-- ║             para (financiador_id, moneda) AT THAT POINT (secuencial).   ║
-- ║           INSERT movimientos_financiacion 'cancelacion_por_aporte'      ║
-- ║             → v_saldos_financiadores se actualiza implícitamente        ║
-- ║           INSERT aporte_imputaciones con movimiento_financiacion_id     ║
-- ║   5. Return jsonb { aporte_id, codigo }.                                ║
-- ║                                                                          ║
-- ║ Atomicidad: todo dentro del bloque PL/pgSQL es una transacción          ║
-- ║ implícita. RAISE EXCEPTION revierte cualquier INSERT previo.            ║
-- ║                                                                          ║
-- ║ Idempotente vía CREATE OR REPLACE FUNCTION.                              ║
-- ║                                                                          ║
-- ║ Tests funcionales: se hacen vía UI / llamada directa desde la app       ║
-- ║ porque el guard get_my_role() requiere un user con role en profiles    ║
-- ║ (service_role de SQL Editor no tiene perfil; tests inline lanzarían    ║
-- ║ 'Sin permiso para registrar aportes').                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION registrar_aporte_socio_v2(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_role               user_role;
  v_user_id            UUID;
  v_socio_id           UUID;
  v_socio              socios%ROWTYPE;
  v_fondo_id           UUID;
  v_fondo              fondos%ROWTYPE;
  v_fecha              DATE;
  v_moneda             TEXT;
  v_monto_total        NUMERIC(14,2);
  v_observaciones      TEXT;
  v_concepto           TEXT;
  v_items              jsonb;
  v_item               jsonb;
  v_sum_items          NUMERIC(14,2) := 0;
  v_aporte_id          UUID;
  v_aporte_codigo      TEXT;
  v_destino_tipo       TEXT;
  v_item_monto         NUMERIC(14,2);
  v_item_fondo_id      UUID;
  v_item_financiador_id UUID;
  v_item_moneda        TEXT;
  v_deuda_tercero      NUMERIC(14,2);
  v_mov_fondo_id       UUID;
  v_mov_fin_id         UUID;
BEGIN
  -- ── Permisos ──────────────────────────────────────────────────────────────
  v_role := get_my_role();
  IF v_role NOT IN ('admin','contador') THEN
    RAISE EXCEPTION 'Sin permiso para registrar aportes.';
  END IF;
  v_user_id := auth.uid();

  -- ── Parseo de cabecera ────────────────────────────────────────────────────
  v_socio_id      := (payload->>'socio_id')::UUID;
  v_fondo_id      := (payload->>'fondo_id')::UUID;
  v_fecha         := COALESCE((payload->>'fecha')::DATE, CURRENT_DATE);
  v_moneda        := payload->>'moneda';
  v_monto_total   := (payload->>'monto_total')::NUMERIC(14,2);
  v_observaciones := payload->>'observaciones';
  v_items         := payload->'items';

  -- ── Validaciones de cabecera ──────────────────────────────────────────────
  IF v_socio_id IS NULL THEN
    RAISE EXCEPTION 'socio_id es requerido.';
  END IF;
  IF v_fondo_id IS NULL THEN
    RAISE EXCEPTION 'fondo_id de cabecera es requerido (típicamente RISA).';
  END IF;
  IF v_moneda IS NULL OR v_moneda !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'moneda inválida (esperado 3 letras ISO, ej. ARS).';
  END IF;
  IF v_monto_total IS NULL OR v_monto_total <= 0 THEN
    RAISE EXCEPTION 'monto_total debe ser mayor a 0.';
  END IF;
  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items debe ser un array no vacío.';
  END IF;

  -- Socio activo
  SELECT * INTO v_socio
    FROM socios WHERE id = v_socio_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Socio no encontrado o dado de baja.';
  END IF;

  -- Fondo activo + lock + coherencia moneda
  SELECT * INTO v_fondo
    FROM fondos WHERE id = v_fondo_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fondo no encontrado o dado de baja.';
  END IF;
  IF v_fondo.estado <> 'activo' THEN
    RAISE EXCEPTION 'Solo se pueden registrar aportes en fondos activos. Estado: %.', v_fondo.estado;
  END IF;
  IF v_fondo.moneda <> v_moneda THEN
    RAISE EXCEPTION
      'Moneda del aporte (%) no coincide con la del fondo (%).',
      v_moneda, v_fondo.moneda;
  END IF;

  -- Pre-validación: cada item tiene monto > 0 y la suma cuadra
  FOR v_item IN SELECT jsonb_array_elements(v_items) LOOP
    v_item_monto := (v_item->>'monto')::NUMERIC(14,2);
    IF v_item_monto IS NULL OR v_item_monto <= 0 THEN
      RAISE EXCEPTION 'Cada item debe tener monto > 0.';
    END IF;
    v_sum_items := v_sum_items + v_item_monto;
  END LOOP;
  IF ABS(v_sum_items - v_monto_total) > 0.01 THEN
    RAISE EXCEPTION
      'La suma de los items (%) no coincide con monto_total (%).',
      v_sum_items, v_monto_total;
  END IF;

  -- ── Cabecera ──────────────────────────────────────────────────────────────
  -- Concepto auto desde socio. Si el payload trae uno, prevalece.
  v_concepto := COALESCE(
    NULLIF(trim(payload->>'concepto'), ''),
    'Aporte ' || COALESCE(v_socio.codigo, 'SOC-?') || ' — ' || v_socio.nombre
  );

  -- destino_aporte legacy queda 'risa' por compatibilidad (el split real
  -- vive en aporte_imputaciones). movimiento_id legacy queda NULL.
  INSERT INTO aportes_fondo
    (fondo_id, fecha_aporte, monto, moneda, tipo_aporte, socio_id,
     destino_aporte, financiador_id, concepto, observaciones, created_by)
  VALUES
    (v_fondo_id, v_fecha, v_monto_total, v_moneda, 'aporte_socios', v_socio_id,
     'risa', NULL, v_concepto, v_observaciones, v_user_id)
  RETURNING id, codigo INTO v_aporte_id, v_aporte_codigo;

  -- ── Procesar cada item secuencialmente ────────────────────────────────────
  FOR v_item IN SELECT jsonb_array_elements(v_items) LOOP
    v_destino_tipo := v_item->>'destino_tipo';
    v_item_monto   := (v_item->>'monto')::NUMERIC(14,2);
    v_item_moneda  := COALESCE(v_item->>'moneda', v_moneda);

    IF v_destino_tipo = 'medios_propios' THEN
      v_item_fondo_id := COALESCE((v_item->>'fondo_id')::UUID, v_fondo_id);

      -- INSERT crédito en movimientos_fondo. El trigger
      -- fn_aplicar_movimiento_fondo actualiza fondos.saldo_actual y calcula
      -- saldo_anterior/resultante (placeholders 0/0).
      INSERT INTO movimientos_fondo
        (fondo_id, pago_id, tipo, monto, saldo_anterior, saldo_resultante,
         concepto, fecha, created_by)
      VALUES
        (v_item_fondo_id, NULL, 'credito', v_item_monto, 0, 0,
         'Aporte ' || COALESCE(v_aporte_codigo, '?') || ' — MP',
         v_fecha, v_user_id)
      RETURNING id INTO v_mov_fondo_id;

      INSERT INTO aporte_imputaciones
        (aporte_id, destino_tipo, fondo_id, monto, moneda, movimiento_fondo_id)
      VALUES
        (v_aporte_id, 'medios_propios', v_item_fondo_id, v_item_monto, v_item_moneda, v_mov_fondo_id);

    ELSIF v_destino_tipo = 'tercero' THEN
      v_item_financiador_id := (v_item->>'financiador_id')::UUID;
      IF v_item_financiador_id IS NULL THEN
        RAISE EXCEPTION 'item destino=tercero requiere financiador_id.';
      END IF;

      -- Validar deuda viva al instante (v_saldos_financiadores se recalcula
      -- en cada SELECT, así que items consecutivos contra el mismo tercero
      -- ven el saldo ya reducido por el item anterior).
      SELECT COALESCE(SUM(saldo_pendiente), 0)
        INTO v_deuda_tercero
        FROM v_saldos_financiadores
       WHERE financiador_id = v_item_financiador_id
         AND moneda = v_item_moneda;
      IF v_item_monto > v_deuda_tercero + 0.01 THEN
        RAISE EXCEPTION
          'Imputación a tercero supera la deuda pendiente (intento %, disponible %).',
          v_item_monto, v_deuda_tercero;
      END IF;

      -- Registrar movimiento de cancelación. Reduce v_saldos_financiadores.
      INSERT INTO movimientos_financiacion
        (financiador_id, tipo_movimiento, importe, moneda, gasto_id, pago_id,
         aporte_id, socio_id, descripcion, created_by)
      VALUES
        (v_item_financiador_id, 'cancelacion_por_aporte', v_item_monto, v_item_moneda,
         NULL, NULL, v_aporte_id, v_socio_id,
         'Cancelación por aporte ' || COALESCE(v_aporte_codigo, '?'), v_user_id)
      RETURNING id INTO v_mov_fin_id;

      INSERT INTO aporte_imputaciones
        (aporte_id, destino_tipo, financiador_id, monto, moneda, movimiento_financiacion_id)
      VALUES
        (v_aporte_id, 'tercero', v_item_financiador_id, v_item_monto, v_item_moneda, v_mov_fin_id);

    ELSE
      RAISE EXCEPTION 'destino_tipo inválido: %. Permitidos: medios_propios, tercero.', v_destino_tipo;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('aporte_id', v_aporte_id, 'codigo', v_aporte_codigo);
END;
$$;

-- Verificación post-creación: la función existe y tiene el cuerpo esperado.
DO $$
DECLARE
  v_body TEXT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_body
    FROM pg_proc WHERE proname = 'registrar_aporte_socio_v2';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'FIN2.3: registrar_aporte_socio_v2 NO está presente';
  END IF;
  IF v_body NOT LIKE '%aporte_imputaciones%' THEN
    RAISE EXCEPTION 'FIN2.3: la función no referencia aporte_imputaciones';
  END IF;
  RAISE NOTICE 'FIN2.3 [check] OK — registrar_aporte_socio_v2 creada';
END $$;
