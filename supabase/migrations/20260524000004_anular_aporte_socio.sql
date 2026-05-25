-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ FIN2.5 (2026-05-24): RPC anular_aporte_socio + columnas de trazabilidad ║
-- ║                                                                          ║
-- ║ Anula un aporte registrado por registrar_aporte_socio_v2 (FIN2.3),      ║
-- ║ generando movimientos de reversa por cada imputación del aporte. NO     ║
-- ║ borra físicamente el aporte; lo marca con deleted_at + anulado_por +    ║
-- ║ anulado_en + motivo_anulacion para mantener trazabilidad.               ║
-- ║                                                                          ║
-- ║ Atomicidad: todo dentro del bloque PL/pgSQL es transaccional. RAISE     ║
-- ║ EXCEPTION revierte cualquier reversa parcial.                           ║
-- ║                                                                          ║
-- ║ Idempotente vía:                                                        ║
-- ║   - ALTER TABLE … ADD COLUMN IF NOT EXISTS                              ║
-- ║   - CREATE OR REPLACE FUNCTION                                          ║
-- ║                                                                          ║
-- ║ Tests: se hacen vía UI / Supabase con un user autenticado. SQL Editor   ║
-- ║ como service_role no pasa el guard get_my_role() (sin perfil).          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝


-- ─── 1. Columnas de trazabilidad en aportes_fondo ──────────────────────────

ALTER TABLE aportes_fondo
  ADD COLUMN IF NOT EXISTS anulado_por        UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS anulado_en         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_anulacion   TEXT;


-- ─── 2. RPC anular_aporte_socio ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION anular_aporte_socio(
  p_aporte_id UUID,
  p_motivo    TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_role         user_role;
  v_user_id      UUID;
  v_aporte       aportes_fondo%ROWTYPE;
  v_imp          aporte_imputaciones%ROWTYPE;
  v_now          TIMESTAMPTZ := now();
BEGIN
  -- Permisos
  v_role := get_my_role();
  IF v_role NOT IN ('admin','contador') THEN
    RAISE EXCEPTION 'Sin permiso para anular aportes.';
  END IF;
  v_user_id := auth.uid();

  -- Lock + validar aporte vivo
  SELECT * INTO v_aporte
    FROM aportes_fondo
   WHERE id = p_aporte_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aporte no encontrado.';
  END IF;
  IF v_aporte.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'El aporte ya fue anulado.';
  END IF;

  -- Recorrer imputaciones y generar reversas. Si alguna falla, el bloque
  -- entero revierte (atomicidad implícita).
  FOR v_imp IN
    SELECT * FROM aporte_imputaciones WHERE aporte_id = p_aporte_id
  LOOP
    IF v_imp.destino_tipo = 'medios_propios' THEN
      -- Reversa MP: INSERT débito (trigger fn_aplicar_movimiento_fondo
      -- actualiza fondos.saldo_actual).
      INSERT INTO movimientos_fondo
        (fondo_id, pago_id, tipo, monto, saldo_anterior, saldo_resultante,
         concepto, fecha, created_by)
      VALUES
        (v_imp.fondo_id, NULL, 'debito', v_imp.monto, 0, 0,
         'Reversa aporte ' || COALESCE(v_aporte.codigo, '?') || ' — MP',
         v_now::date, v_user_id);

    ELSIF v_imp.destino_tipo = 'tercero' THEN
      -- Reversa Tercero: INSERT movimientos_financiacion tipo='reversa'
      -- (la vista v_saldos_financiadores la considera para recalcular saldo).
      INSERT INTO movimientos_financiacion
        (financiador_id, tipo_movimiento, importe, moneda, gasto_id, pago_id,
         aporte_id, socio_id, descripcion, created_by)
      VALUES
        (v_imp.financiador_id, 'reversa', v_imp.monto, v_imp.moneda,
         NULL, NULL, p_aporte_id, v_aporte.socio_id,
         'Reversa aporte ' || COALESCE(v_aporte.codigo, '?'), v_user_id);

    ELSE
      RAISE EXCEPTION 'Imputación con destino_tipo inválido: %', v_imp.destino_tipo;
    END IF;
  END LOOP;

  -- Marcar aporte anulado (no DELETE físico). deleted_at + metadatos.
  UPDATE aportes_fondo
     SET deleted_at       = v_now,
         anulado_por      = v_user_id,
         anulado_en       = v_now,
         motivo_anulacion = NULLIF(trim(COALESCE(p_motivo, '')), '')
   WHERE id = p_aporte_id;

  RETURN jsonb_build_object('ok', true, 'aporte_id', p_aporte_id);
END;
$$;


-- ─── 3. Verificación post-creación ──────────────────────────────────────────

DO $$
DECLARE v_body TEXT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_body
    FROM pg_proc WHERE proname = 'anular_aporte_socio';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'FIN2.5: anular_aporte_socio NO está presente';
  END IF;
  IF v_body NOT LIKE '%aporte_imputaciones%' THEN
    RAISE EXCEPTION 'FIN2.5: la función no recorre aporte_imputaciones';
  END IF;
  RAISE NOTICE 'FIN2.5 [check] OK — anular_aporte_socio creada';
END $$;
