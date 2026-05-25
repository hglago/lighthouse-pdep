-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ OP (2026-05-25): Ordenes de Pago                                        ║
-- ║                                                                          ║
-- ║ Genera automáticamente una Orden de Pago cada vez que un pago queda     ║
-- ║ confirmado (pagado). 1 pago = 1 OP. Si el pago se anula, la OP queda    ║
-- ║ con estado='anulada' (NO se elimina).                                   ║
-- ║                                                                          ║
-- ║ Características:                                                         ║
-- ║   - Numeración con reset anual: OP-2026-00001, OP-2027-00001, …         ║
-- ║   - Snapshot completo al momento de emisión (proveedor_nombre, nro_op,  ║
-- ║     tercero, tipo_gasto, periodo_analitico, saldo_pendiente, etc.).     ║
-- ║   - Idempotencia: UNIQUE(pago_id) + ON CONFLICT DO NOTHING / SKIP.      ║
-- ║   - Generación atómica desde fn_confirmar_pago (PERFORM final).         ║
-- ║   - Anulación atómica desde fn_anular_pago (UPDATE final).              ║
-- ║   - Backfill para pagos confirmados pre-OP.                             ║
-- ║                                                                          ║
-- ║ Preserva 100% la lógica P4b vigente (RISA / Tercero, financiador_id,    ║
-- ║ afecta_saldo_risa, movimiento_financiacion_id, validaciones por tipo).  ║
-- ║                                                                          ║
-- ║ Atomicidad: todo en BEGIN/COMMIT. Si algo falla, no queda parcial.      ║
-- ║                                                                          ║
-- ║ Idempotente: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,    ║
-- ║ DROP TRIGGER IF EXISTS + CREATE TRIGGER, backfill con NOT EXISTS.       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝


BEGIN;


-- ─── 1. Tabla ordenes_pago ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ordenes_pago (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo             text NOT NULL UNIQUE,                          -- OP-YYYY-NNNNN
  pago_id            uuid NOT NULL UNIQUE REFERENCES pagos(id) ON DELETE CASCADE,
  gasto_id           uuid NULL,                                     -- snapshot (sin FK fuerte)
  proveedor_id       uuid NULL,
  fecha_emision      timestamptz NOT NULL DEFAULT now(),
  fecha_pago         date NOT NULL,
  moneda             text NOT NULL,
  importe            numeric(14,2) NOT NULL,
  estado             text NOT NULL DEFAULT 'emitida'
                       CHECK (estado IN ('emitida','anulada')),
  modalidad          text NOT NULL DEFAULT 'no_aplica'
                       CHECK (modalidad IN ('total','parcial','no_aplica')),
  canal_pago         text NOT NULL
                       CHECK (canal_pago IN ('risa','tercero')),
  tercero_codigo     text NULL,                                     -- snapshot FIN-### si tercero
  tercero_nombre     text NULL,                                     -- snapshot nombre tercero
  concepto           text NULL,                                     -- snapshot del pago
  proveedor_nombre   text NULL,                                     -- snapshot
  nro_gasto          text NULL,                                     -- snapshot gasto.codigo
  nro_pago           text NULL,                                     -- snapshot pagos.codigo o nro_pago
  tipo_gasto_codigo  text NULL,                                     -- snapshot TIPOS-GASTO
  tipo_gasto_nombre  text NULL,
  periodo_analitico  text NULL,                                     -- snapshot YYYY-MM
  saldo_pendiente    numeric(14,2) NULL,                            -- gasto.monto − Σ pagos pagados (post este pago)
  observaciones      text NULL,                                     -- snapshot pagos.notas
  created_by         uuid NULL REFERENCES profiles(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  anulada_en         timestamptz NULL,
  anulada_por        uuid NULL REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_ordenes_pago_pago_id        ON ordenes_pago(pago_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_pago_estado         ON ordenes_pago(estado);
CREATE INDEX IF NOT EXISTS idx_ordenes_pago_fecha_emision  ON ordenes_pago(fecha_emision DESC);
CREATE INDEX IF NOT EXISTS idx_ordenes_pago_periodo        ON ordenes_pago(periodo_analitico);
CREATE INDEX IF NOT EXISTS idx_ordenes_pago_proveedor      ON ordenes_pago(proveedor_id);


-- ─── 2. Trigger BEFORE INSERT que asigna codigo OP-YYYY-NNNNN ──────────────
-- Reset anual: el siguiente número se calcula como MAX existente del año + 1.
-- Advisory lock por año evita race en INSERTs concurrentes.

CREATE OR REPLACE FUNCTION fn_set_orden_pago_codigo()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_year   integer;
  v_prefix text;
  v_next   integer;
BEGIN
  IF NEW.codigo IS NOT NULL THEN
    RETURN NEW;
  END IF;
  v_year := EXTRACT(YEAR FROM COALESCE(NEW.fecha_emision, now()))::integer;
  v_prefix := 'OP-' || v_year || '-';

  -- Lock por año dentro de la transacción (libera al COMMIT/ROLLBACK)
  PERFORM pg_advisory_xact_lock(hashtext('ordenes_pago_codigo_' || v_year));

  SELECT COALESCE(
    MAX(SUBSTRING(codigo FROM ('^OP-' || v_year || '-(\d+)$'))::integer),
    0
  ) + 1
    INTO v_next
    FROM ordenes_pago
   WHERE codigo LIKE v_prefix || '%';

  NEW.codigo := v_prefix || lpad(v_next::text, 5, '0');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_orden_pago_codigo ON ordenes_pago;
CREATE TRIGGER trg_set_orden_pago_codigo
  BEFORE INSERT ON ordenes_pago
  FOR EACH ROW EXECUTE FUNCTION fn_set_orden_pago_codigo();


-- ─── 3. RPC fn_crear_orden_pago_desde_pago(p_pago_id) ───────────────────────
-- Idempotente vía UNIQUE(pago_id): si ya existe OP para el pago, devuelve su id
-- sin crear otra. Calcula modalidad y saldo_pendiente al momento de emisión.

CREATE OR REPLACE FUNCTION fn_crear_orden_pago_desde_pago(p_pago_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pago          pagos%ROWTYPE;
  v_gasto         gastos%ROWTYPE;
  v_total_pagado  numeric(14,2) := 0;
  v_modalidad     text;
  v_saldo         numeric(14,2);
  v_canal         text;
  v_tercero_cod   text;
  v_tercero_nom   text;
  v_prov_nom      text;
  v_tipo_cod      text;
  v_tipo_nom      text;
  v_periodo       text;
  v_nro_gasto     text;
  v_op_id         uuid;
BEGIN
  -- Idempotencia: si ya existe OP para el pago, devolver su id.
  SELECT id INTO v_op_id FROM ordenes_pago WHERE pago_id = p_pago_id;
  IF FOUND THEN
    RETURN v_op_id;
  END IF;

  -- Lookup pago
  SELECT * INTO v_pago FROM pagos WHERE id = p_pago_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pago no encontrado para OP: %', p_pago_id;
  END IF;

  -- Lookup gasto (si aplica)
  IF v_pago.gasto_id IS NOT NULL THEN
    SELECT * INTO v_gasto FROM gastos WHERE id = v_pago.gasto_id;
    v_nro_gasto := v_gasto.codigo;
    v_periodo   := v_gasto.periodo_analitico;
    IF v_gasto.tipo_gasto_id IS NOT NULL THEN
      SELECT codigo, nombre INTO v_tipo_cod, v_tipo_nom
        FROM tipos_gasto WHERE id = v_gasto.tipo_gasto_id;
    END IF;
  END IF;

  -- Modalidad: 'total', 'parcial', 'no_aplica'
  IF v_pago.tipo IN ('directo', 'anticipo') OR v_pago.gasto_id IS NULL THEN
    v_modalidad := 'no_aplica';
  ELSE
    SELECT COALESCE(SUM(monto), 0)
      INTO v_total_pagado
      FROM pagos
     WHERE gasto_id = v_pago.gasto_id
       AND estado   = 'pagado';
    IF v_total_pagado >= v_gasto.monto - 0.01 THEN
      v_modalidad := 'total';
    ELSE
      v_modalidad := 'parcial';
    END IF;
  END IF;

  -- Saldo pendiente post-pago (NULL si no aplica)
  IF v_pago.gasto_id IS NULL THEN
    v_saldo := NULL;
  ELSE
    v_saldo := GREATEST(0, v_gasto.monto - v_total_pagado);
  END IF;

  -- Canal de pago según forma_cancelacion del pago (ya seteada por fn_confirmar_pago)
  v_canal := CASE WHEN v_pago.forma_cancelacion = 'financiador' THEN 'tercero' ELSE 'risa' END;

  -- Snapshot tercero (si aplica)
  IF v_pago.financiador_id IS NOT NULL THEN
    SELECT codigo, nombre INTO v_tercero_cod, v_tercero_nom
      FROM financiadores WHERE id = v_pago.financiador_id;
  END IF;

  -- Snapshot proveedor
  IF v_pago.proveedor_id IS NOT NULL THEN
    SELECT nombre INTO v_prov_nom
      FROM proveedores WHERE id = v_pago.proveedor_id;
  END IF;

  -- INSERT OP (trigger asigna codigo OP-YYYY-NNNNN)
  INSERT INTO ordenes_pago (
    pago_id, gasto_id, proveedor_id,
    fecha_pago, moneda, importe,
    estado, modalidad, canal_pago,
    tercero_codigo, tercero_nombre,
    concepto, proveedor_nombre,
    nro_gasto, nro_pago,
    tipo_gasto_codigo, tipo_gasto_nombre,
    periodo_analitico, saldo_pendiente,
    observaciones, created_by
  )
  VALUES (
    v_pago.id, v_pago.gasto_id, v_pago.proveedor_id,
    v_pago.fecha_pago, v_pago.moneda, v_pago.monto,
    CASE WHEN v_pago.estado = 'anulado' THEN 'anulada' ELSE 'emitida' END,
    v_modalidad, v_canal,
    v_tercero_cod, v_tercero_nom,
    v_pago.concepto, v_prov_nom,
    v_nro_gasto, v_pago.nro_pago,
    v_tipo_cod, v_tipo_nom,
    v_periodo, v_saldo,
    v_pago.notas, COALESCE(v_pago.created_by, auth.uid())
  )
  RETURNING id INTO v_op_id;

  -- Si el pago llegó anulado (backfill de un pago histórico anulado pre-OP),
  -- reflejar metadatos de anulación.
  IF v_pago.estado = 'anulado' THEN
    UPDATE ordenes_pago
       SET anulada_en  = COALESCE(v_pago.anulado_en, now()),
           anulada_por = v_pago.anulado_por
     WHERE id = v_op_id;
  END IF;

  RETURN v_op_id;
END $$;


-- ─── 4. RLS para ordenes_pago ──────────────────────────────────────────────
-- Append-only desde RPC. Solo SELECT desde authenticated. INSERT/UPDATE/DELETE
-- no exponen policy de usuario; el flujo va siempre por SECURITY DEFINER.

ALTER TABLE ordenes_pago ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ordenes_pago_select_auth ON ordenes_pago;
CREATE POLICY ordenes_pago_select_auth ON ordenes_pago
  FOR SELECT TO authenticated USING (true);

-- (sin policy de INSERT/UPDATE/DELETE: solo se accede vía RPCs SECURITY DEFINER)


-- ─── 5. CREATE OR REPLACE fn_confirmar_pago (P4b + hook OP) ────────────────
-- VERBATIM de la versión vigente entregada por el user, con un PERFORM al
-- final que dispara la creación idempotente de la OP. La lógica P4b
-- (RISA / Tercero, validaciones, ramas) se preserva sin cambios.

CREATE OR REPLACE FUNCTION public.fn_confirmar_pago(p_pago_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pago          pagos%ROWTYPE;
  v_fondo_moneda  text;
  v_gasto         gastos%ROWTYPE;
  v_es_financiado boolean := false;
  v_mov_fin_id    uuid;
BEGIN
  IF get_my_role() NOT IN ('admin', 'contador') THEN
    RAISE EXCEPTION 'Sin permiso para confirmar pagos.';
  END IF;

  SELECT *
  INTO v_pago
  FROM pagos
  WHERE id = p_pago_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pago no encontrado.';
  END IF;

  IF v_pago.estado != 'borrador' THEN
    RAISE EXCEPTION 'Solo se pueden confirmar pagos en borrador.';
  END IF;

  SELECT moneda
  INTO v_fondo_moneda
  FROM fondos
  WHERE id = v_pago.fondo_id;

  IF v_pago.moneda != v_fondo_moneda THEN
    RAISE EXCEPTION
      'La moneda del pago (%) no coincide con la del fondo (%).',
      v_pago.moneda,
      v_fondo_moneda;
  END IF;

  IF v_pago.tipo = 'gasto' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM gastos
      WHERE id = v_pago.gasto_id
        AND estado = 'aprobado'
    ) THEN
      RAISE EXCEPTION 'El gasto vinculado no está aprobado.';
    END IF;
  END IF;

  IF v_pago.tipo = 'anticipo' AND v_pago.gasto_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM gastos
      WHERE id = v_pago.gasto_id
        AND estado = 'aprobado'
        AND tiene_anticipo = TRUE
        AND monto_anticipo IS NOT NULL
    ) THEN
      RAISE EXCEPTION
        'El gasto debe estar aprobado y tener condición de anticipo configurada.';
    END IF;
  END IF;

  IF v_pago.tipo = 'anticipo' AND v_pago.anticipo_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM anticipos
      WHERE id = v_pago.anticipo_id
        AND estado = 'aprobado'
    ) THEN
      RAISE EXCEPTION
        'El anticipo debe estar en estado aprobado para registrar el pago de anticipo.';
    END IF;

    UPDATE anticipos
    SET estado = 'anticipo_pagado',
        updated_at = now()
    WHERE id = v_pago.anticipo_id;
  END IF;

  IF v_pago.tipo = 'saldo_anticipo' AND v_pago.gasto_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM gastos
      WHERE id = v_pago.gasto_id
        AND estado = 'aprobado'
        AND tiene_anticipo = TRUE
    ) THEN
      RAISE EXCEPTION
        'El gasto vinculado debe estar aprobado y tener condición de anticipo.';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pagos
      WHERE gasto_id = v_pago.gasto_id
        AND tipo = 'anticipo'
        AND estado = 'pagado'
    ) THEN
      RAISE EXCEPTION
        'El anticipo del gasto aún no fue pagado. Registrá primero el pago de anticipo.';
    END IF;
  END IF;

  IF v_pago.tipo = 'saldo_anticipo' AND v_pago.anticipo_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM anticipos
      WHERE id = v_pago.anticipo_id
        AND estado = 'anticipo_pagado'
    ) THEN
      RAISE EXCEPTION
        'El anticipo debe estar en estado anticipo_pagado para registrar el pago de saldo.';
    END IF;

    UPDATE anticipos
    SET estado = 'completado',
        updated_at = now()
    WHERE id = v_pago.anticipo_id;
  END IF;

  IF v_pago.tipo = 'recurrente' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM gastos_recurrentes
      WHERE id = v_pago.gasto_recurrente_id
        AND activo = TRUE
        AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'El gasto recurrente referenciado no está activo.';
    END IF;
  END IF;

  IF v_pago.tipo = 'directo' THEN
    IF v_pago.notas IS NULL OR trim(v_pago.notas) = '' THEN
      RAISE EXCEPTION 'Los pagos directos requieren justificación en el campo notas.';
    END IF;
  END IF;

  IF v_pago.gasto_id IS NOT NULL THEN
    SELECT *
    INTO v_gasto
    FROM gastos
    WHERE id = v_pago.gasto_id;

    IF v_gasto.forma_cancelacion = 'financiador' THEN
      IF v_gasto.financiador_id IS NULL THEN
        RAISE EXCEPTION
          'El gasto está marcado como financiado pero no tiene financiador asignado.';
      END IF;

      v_es_financiado := true;
    END IF;
  END IF;

  IF v_es_financiado THEN
    INSERT INTO movimientos_financiacion (
      fecha,
      financiador_id,
      tipo_movimiento,
      importe,
      moneda,
      gasto_id,
      pago_id,
      descripcion,
      created_by
    )
    VALUES (
      v_pago.fecha_pago,
      v_gasto.financiador_id,
      'deuda_generada',
      v_pago.monto,
      v_pago.moneda,
      v_pago.gasto_id,
      v_pago.id,
      'Pago ' || v_pago.nro_pago || ' — ' || v_pago.concepto,
      auth.uid()
    )
    RETURNING id INTO v_mov_fin_id;

    UPDATE pagos
    SET estado = 'pagado',
        forma_cancelacion = 'financiador',
        financiador_id = v_gasto.financiador_id,
        afecta_saldo_risa = false,
        movimiento_financiacion_id = v_mov_fin_id,
        updated_at = now()
    WHERE id = p_pago_id;

  ELSE
    INSERT INTO movimientos_fondo (
      fondo_id,
      pago_id,
      tipo,
      monto,
      saldo_anterior,
      saldo_resultante,
      concepto,
      fecha,
      created_by
    )
    VALUES (
      v_pago.fondo_id,
      v_pago.id,
      'debito',
      v_pago.monto,
      0,
      0,
      v_pago.concepto,
      v_pago.fecha_pago,
      auth.uid()
    );

    UPDATE pagos
    SET estado = 'pagado',
        forma_cancelacion = 'risa',
        afecta_saldo_risa = true,
        updated_at = now()
    WHERE id = p_pago_id;
  END IF;

  -- ── OP (2026-05-25): generar Orden de Pago idempotente ─────────────────────
  -- Se llama al final, cuando el pago ya tiene estado='pagado' + forma_cancelacion
  -- + (eventualmente) financiador_id + movimiento_financiacion_id definidos.
  -- Si ya existe OP para este pago (re-confirm imposible hoy, pero defensa),
  -- la RPC devuelve el id existente sin crear duplicado.
  PERFORM fn_crear_orden_pago_desde_pago(p_pago_id);
END;
$function$;


-- ─── 6. CREATE OR REPLACE fn_anular_pago (P4b + hook OP) ───────────────────
-- VERBATIM de la versión vigente entregada por el user, con un UPDATE final
-- que marca la OP correspondiente como 'anulada'. Si no hay OP (pagos pre-OP),
-- el UPDATE simplemente no afecta filas.

CREATE OR REPLACE FUNCTION public.fn_anular_pago(p_pago_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pago pagos%ROWTYPE;
BEGIN
  IF get_my_role() != 'admin' THEN
    RAISE EXCEPTION 'Solo admin puede anular pagos.';
  END IF;

  SELECT *
  INTO v_pago
  FROM pagos
  WHERE id = p_pago_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pago no encontrado.';
  END IF;

  IF v_pago.estado != 'pagado' THEN
    RAISE EXCEPTION 'Solo se pueden anular pagos confirmados.';
  END IF;

  IF v_pago.forma_cancelacion = 'financiador' THEN
    -- ── Rama tercero: reversa en movimientos_financiacion ───────────────────
    IF v_pago.financiador_id IS NULL THEN
      RAISE EXCEPTION
        'El pago está marcado como financiado pero no tiene financiador asociado.';
    END IF;

    INSERT INTO movimientos_financiacion (
      fecha,
      financiador_id,
      tipo_movimiento,
      importe,
      moneda,
      gasto_id,
      pago_id,
      descripcion,
      created_by
    )
    VALUES (
      CURRENT_DATE,
      v_pago.financiador_id,
      'reversa',
      v_pago.monto,
      v_pago.moneda,
      v_pago.gasto_id,
      v_pago.id,
      'Anulación pago ' || v_pago.nro_pago || ' — ' || v_pago.concepto,
      auth.uid()
    );

  ELSE
    -- ── Rama Medios Propios RISA: flujo histórico con reversa en movimientos_fondo ──
    INSERT INTO movimientos_fondo (
      fondo_id,
      pago_id,
      tipo,
      monto,
      saldo_anterior,
      saldo_resultante,
      concepto,
      fecha,
      created_by
    )
    VALUES (
      v_pago.fondo_id,
      v_pago.id,
      'credito',
      v_pago.monto,
      0,
      0,
      'Anulación: ' || v_pago.concepto,
      CURRENT_DATE,
      auth.uid()
    );
  END IF;

  UPDATE pagos
  SET estado = 'anulado',
      anulado_por = auth.uid(),
      anulado_en = now(),
      updated_at = now()
  WHERE id = p_pago_id;

  -- ── OP (2026-05-25): marcar OP correspondiente como anulada ────────────────
  -- Si el pago tiene OP (todos los confirmados post-aplicación), pasa a 'anulada'.
  -- Si no existe OP (pago pre-aplicación), el UPDATE no afecta filas.
  UPDATE ordenes_pago
     SET estado      = 'anulada',
         anulada_en  = now(),
         anulada_por = auth.uid()
   WHERE pago_id = p_pago_id
     AND estado  = 'emitida';
END;
$function$;


-- ─── 7. Backfill de pagos confirmados pre-OP ────────────────────────────────
-- Recorre pagos en estado='pagado' que aún no tienen OP y les crea una.
-- Tras el reset de datos (2026-05-24) este loop es no-op pero queda por si
-- alguien aplica la migración en una DB con historial.

DO $$
DECLARE
  v_pago_id uuid;
  v_count   integer := 0;
BEGIN
  FOR v_pago_id IN
    SELECT p.id
      FROM pagos p
     WHERE p.estado = 'pagado'
       AND NOT EXISTS (SELECT 1 FROM ordenes_pago op WHERE op.pago_id = p.id)
     ORDER BY p.fecha_pago, p.created_at
  LOOP
    PERFORM fn_crear_orden_pago_desde_pago(v_pago_id);
    v_count := v_count + 1;
  END LOOP;
  IF v_count > 0 THEN
    RAISE NOTICE 'OP backfill: % OPs históricas creadas', v_count;
  END IF;
END $$;


-- ─── 8. Verificación post-aplicación ────────────────────────────────────────

DO $$
DECLARE
  v_tabla  integer;
  v_fn_op  integer;
  v_fn_cp  integer;
  v_fn_ap  integer;
  v_trg    integer;
  v_orph   integer;
BEGIN
  -- Tabla existe
  SELECT COUNT(*) INTO v_tabla
    FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'ordenes_pago';
  IF v_tabla = 0 THEN
    RAISE EXCEPTION 'OP: tabla ordenes_pago no existe';
  END IF;

  -- Functions existen
  SELECT COUNT(*) INTO v_fn_op
    FROM pg_proc WHERE proname = 'fn_crear_orden_pago_desde_pago';
  IF v_fn_op = 0 THEN
    RAISE EXCEPTION 'OP: fn_crear_orden_pago_desde_pago no existe';
  END IF;

  SELECT COUNT(*) INTO v_fn_cp
    FROM pg_proc WHERE proname = 'fn_confirmar_pago';
  IF v_fn_cp = 0 THEN
    RAISE EXCEPTION 'OP: fn_confirmar_pago no existe';
  END IF;
  -- Sanity: el cuerpo nuevo contiene el PERFORM
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'fn_confirmar_pago'
       AND pg_get_functiondef(oid) LIKE '%fn_crear_orden_pago_desde_pago%'
  ) THEN
    RAISE EXCEPTION 'OP: fn_confirmar_pago no llama a fn_crear_orden_pago_desde_pago';
  END IF;

  SELECT COUNT(*) INTO v_fn_ap
    FROM pg_proc WHERE proname = 'fn_anular_pago';
  IF v_fn_ap = 0 THEN
    RAISE EXCEPTION 'OP: fn_anular_pago no existe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'fn_anular_pago'
       AND pg_get_functiondef(oid) LIKE '%UPDATE ordenes_pago%'
  ) THEN
    RAISE EXCEPTION 'OP: fn_anular_pago no actualiza ordenes_pago';
  END IF;

  -- Trigger codigo existe
  SELECT COUNT(*) INTO v_trg
    FROM pg_trigger WHERE tgname = 'trg_set_orden_pago_codigo';
  IF v_trg = 0 THEN
    RAISE EXCEPTION 'OP: trigger trg_set_orden_pago_codigo no existe';
  END IF;

  -- Backfill consistente: no debería haber pagos pagados sin OP
  SELECT COUNT(*) INTO v_orph
    FROM pagos p
   WHERE p.estado = 'pagado'
     AND NOT EXISTS (SELECT 1 FROM ordenes_pago op WHERE op.pago_id = p.id);
  IF v_orph > 0 THEN
    RAISE EXCEPTION 'OP: quedaron % pagos pagados sin OP', v_orph;
  END IF;

  RAISE NOTICE 'OP [check] OK — tabla, RPC, triggers, fn_confirmar/anular extendidos, backfill consistente';
END $$;


COMMIT;


-- ─── 9. (FUERA DE TRX) Smoke test interactivo ───────────────────────────────
--
--   -- Listar OPs (debería estar vacío tras reset)
--   SELECT codigo, estado, modalidad, canal_pago, fecha_emision, importe, moneda,
--          proveedor_nombre, nro_gasto, tipo_gasto_codigo, periodo_analitico
--     FROM ordenes_pago
--    ORDER BY fecha_emision DESC LIMIT 50;
--
--   -- Verificar que la próxima OP del año arranca en 00001
--   SELECT 'OP-' || EXTRACT(YEAR FROM now())::int || '-00001' AS proxima_op;
