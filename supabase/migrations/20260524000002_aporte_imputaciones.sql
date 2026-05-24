-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ FIN2.2 (2026-05-24): tabla aporte_imputaciones                          ║
-- ║                                                                          ║
-- ║ Modelo: PG = MP + MT                                                     ║
-- ║   MP = fondos.saldo_actual                                              ║
-- ║   MT = -SUM(v_saldos_financiadores.saldo_pendiente)                     ║
-- ║                                                                          ║
-- ║ Un aporte puede imputarse a Medios Propios y/o a uno o más Terceros.   ║
-- ║ La RPC actual registrar_aporte_socio solo admite un destino por        ║
-- ║ aporte. Esta migración:                                                 ║
-- ║                                                                          ║
-- ║   1) Crea la tabla aporte_imputaciones (cabecera = aportes_fondo,      ║
-- ║      detalle = aporte_imputaciones).                                    ║
-- ║   2) Agrega índices, CHECK constraints y RLS append-only.              ║
-- ║   3) Backfillea cada aporte existente con una sola línea de detalle    ║
-- ║      derivada de aportes_fondo.destino_aporte/fondo_id/financiador_id  ║
-- ║      y vinculada al movimiento correspondiente.                         ║
-- ║   4) Valida al final que cada aporte tiene ≥1 línea y que la suma de   ║
-- ║      las líneas == cabecera.                                            ║
-- ║                                                                          ║
-- ║ NO se toca:                                                              ║
-- ║   - aportes_fondo (cabecera intacta, columnas legacy se conservan).    ║
-- ║   - movimientos_fondo / movimientos_financiacion.                      ║
-- ║   - RLS de aportes_fondo / fondos / financiadores.                     ║
-- ║   - RPCs existentes (registrar_aporte_socio queda intacta y útil hasta ║
-- ║     que FIN2.3 entregue registrar_aporte_socio_v2).                    ║
-- ║                                                                          ║
-- ║ Idempotente: CREATE TABLE IF NOT EXISTS · CREATE INDEX IF NOT EXISTS · ║
-- ║ DROP POLICY IF EXISTS antes de CREATE POLICY · backfill con WHERE NOT  ║
-- ║ EXISTS por aporte_id.                                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝


-- ─── 1. Tabla ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS aporte_imputaciones (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  aporte_id       UUID          NOT NULL REFERENCES aportes_fondo(id),
  destino_tipo    TEXT          NOT NULL,
  fondo_id        UUID          REFERENCES fondos(id),
  financiador_id  UUID          REFERENCES financiadores(id),
  monto           NUMERIC(14,2) NOT NULL,
  moneda          TEXT          NOT NULL,
  movimiento_fondo_id        UUID REFERENCES movimientos_fondo(id),
  movimiento_financiacion_id UUID REFERENCES movimientos_financiacion(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Constraints separadas con DO blocks para idempotencia (ADD CONSTRAINT no
-- es idempotente; se evita el error con un check previo en pg_constraint).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'aporte_imp_destino_valido'
  ) THEN
    ALTER TABLE aporte_imputaciones
      ADD CONSTRAINT aporte_imp_destino_valido
      CHECK (destino_tipo IN ('medios_propios','tercero'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'aporte_imp_monto_positivo'
  ) THEN
    ALTER TABLE aporte_imputaciones
      ADD CONSTRAINT aporte_imp_monto_positivo CHECK (monto > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'aporte_imp_moneda_valida'
  ) THEN
    ALTER TABLE aporte_imputaciones
      ADD CONSTRAINT aporte_imp_moneda_valida CHECK (moneda ~ '^[A-Z]{3}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'aporte_imp_destino_coherente'
  ) THEN
    ALTER TABLE aporte_imputaciones
      ADD CONSTRAINT aporte_imp_destino_coherente CHECK (
        (destino_tipo = 'medios_propios' AND fondo_id IS NOT NULL AND financiador_id IS NULL)
        OR
        (destino_tipo = 'tercero'        AND financiador_id IS NOT NULL AND fondo_id IS NULL)
      );
  END IF;
END $$;


-- ─── 2. Índices ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS aporte_imp_aporte_id_idx
  ON aporte_imputaciones (aporte_id);

CREATE INDEX IF NOT EXISTS aporte_imp_financiador_id_idx
  ON aporte_imputaciones (financiador_id)
  WHERE financiador_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS aporte_imp_fondo_id_idx
  ON aporte_imputaciones (fondo_id)
  WHERE fondo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS aporte_imp_mov_fondo_idx
  ON aporte_imputaciones (movimiento_fondo_id)
  WHERE movimiento_fondo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS aporte_imp_mov_fin_idx
  ON aporte_imputaciones (movimiento_financiacion_id)
  WHERE movimiento_financiacion_id IS NOT NULL;


-- ─── 3. RLS — append-only, sin UPDATE ni DELETE ─────────────────────────────
-- Coherente con aportes_fondo (que ya es append-only en la práctica). Solo
-- la RPC SECURITY DEFINER (FIN2.3) podrá insertar líneas. Lectura para todo
-- usuario autenticado.

ALTER TABLE aporte_imputaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS aporte_imp_select ON aporte_imputaciones;
CREATE POLICY aporte_imp_select ON aporte_imputaciones
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS aporte_imp_insert ON aporte_imputaciones;
CREATE POLICY aporte_imp_insert ON aporte_imputaciones
  FOR INSERT WITH CHECK (get_my_role() IN ('admin','contador'));

-- Sin POLICY de UPDATE ni DELETE → bloqueados por RLS deny-by-default.


-- ─── 4. Backfill desde aportes_fondo legacy ─────────────────────────────────
-- Para cada aporte existente sin línea detalle, crear UNA línea derivada de
-- los campos cabecera. Idempotente vía WHERE NOT EXISTS por aporte_id.
--
-- Reglas:
--   destino_aporte='risa' (o NULL) → destino_tipo='medios_propios'
--     fondo_id = aportes_fondo.fondo_id
--     movimiento_fondo_id = aportes_fondo.movimiento_id (1-a-1 con el crédito)
--   destino_aporte='cancelacion_financiacion' → destino_tipo='tercero'
--     financiador_id = aportes_fondo.financiador_id
--     movimiento_financiacion_id = lookup en movimientos_financiacion por
--       aporte_id (FK trazabilidad agregada en Etapa 1)
--
-- Aportes soft-deleted también se backfillean: sus movimientos siguen vivos
-- en el ledger (semántica de aportes_fondo).
--
-- Las columnas legacy aportes_fondo.destino_aporte y financiador_id quedan
-- pobladas tal cual (no se NULLean) por compatibilidad de queries existentes.

INSERT INTO aporte_imputaciones (
  aporte_id, destino_tipo, fondo_id, financiador_id, monto, moneda,
  movimiento_fondo_id, movimiento_financiacion_id
)
SELECT
  a.id AS aporte_id,
  CASE
    WHEN a.destino_aporte = 'cancelacion_financiacion' THEN 'tercero'
    ELSE 'medios_propios'
  END AS destino_tipo,
  CASE
    WHEN a.destino_aporte = 'cancelacion_financiacion' THEN NULL
    ELSE a.fondo_id
  END AS fondo_id,
  CASE
    WHEN a.destino_aporte = 'cancelacion_financiacion' THEN a.financiador_id
    ELSE NULL
  END AS financiador_id,
  a.monto,
  a.moneda,
  CASE
    WHEN a.destino_aporte = 'cancelacion_financiacion' THEN NULL
    ELSE a.movimiento_id
  END AS movimiento_fondo_id,
  CASE
    WHEN a.destino_aporte = 'cancelacion_financiacion' THEN (
      SELECT mf.id FROM movimientos_financiacion mf
       WHERE mf.aporte_id = a.id
         AND mf.tipo_movimiento = 'cancelacion_por_aporte'
       ORDER BY mf.created_at ASC LIMIT 1
    )
    ELSE NULL
  END AS movimiento_financiacion_id
FROM aportes_fondo a
WHERE NOT EXISTS (
  SELECT 1 FROM aporte_imputaciones ai WHERE ai.aporte_id = a.id
);


-- ─── 5. Validaciones post-backfill ──────────────────────────────────────────

DO $$
DECLARE
  v_aportes_sin_detalle INT;
  v_aportes_con_suma_distinta INT;
  v_aportes_con_destino_invalido INT;
  v_total INT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM aportes_fondo;

  -- 1. Todo aporte debe tener al menos una línea.
  SELECT COUNT(*)
    INTO v_aportes_sin_detalle
    FROM aportes_fondo a
   WHERE NOT EXISTS (
     SELECT 1 FROM aporte_imputaciones ai WHERE ai.aporte_id = a.id
   );
  IF v_aportes_sin_detalle > 0 THEN
    RAISE EXCEPTION 'FIN2.2 backfill FAIL: % aporte(s) sin línea detalle', v_aportes_sin_detalle;
  END IF;

  -- 2. La suma de líneas por aporte debe igualar la cabecera.
  SELECT COUNT(*)
    INTO v_aportes_con_suma_distinta
    FROM (
      SELECT a.id, a.monto AS monto_cab,
             COALESCE(SUM(ai.monto), 0) AS monto_det
      FROM aportes_fondo a
      LEFT JOIN aporte_imputaciones ai ON ai.aporte_id = a.id
      GROUP BY a.id, a.monto
      HAVING ABS(a.monto - COALESCE(SUM(ai.monto), 0)) > 0.01
    ) sub;
  IF v_aportes_con_suma_distinta > 0 THEN
    RAISE EXCEPTION
      'FIN2.2 backfill FAIL: % aporte(s) con suma de líneas distinta a la cabecera',
      v_aportes_con_suma_distinta;
  END IF;

  -- 3. destino_tipo coherente con FK (la CHECK ya lo garantiza, pero
  --    re-validamos los aportes históricos por defensa).
  SELECT COUNT(*)
    INTO v_aportes_con_destino_invalido
    FROM aporte_imputaciones ai
   WHERE NOT (
     (ai.destino_tipo = 'medios_propios' AND ai.fondo_id IS NOT NULL AND ai.financiador_id IS NULL)
     OR
     (ai.destino_tipo = 'tercero'        AND ai.financiador_id IS NOT NULL AND ai.fondo_id IS NULL)
   );
  IF v_aportes_con_destino_invalido > 0 THEN
    RAISE EXCEPTION
      'FIN2.2 backfill FAIL: % línea(s) con destino_tipo incoherente con FKs',
      v_aportes_con_destino_invalido;
  END IF;

  RAISE NOTICE 'FIN2.2 OK — % aporte(s) verificado(s) con detalle coherente', v_total;
END $$;
