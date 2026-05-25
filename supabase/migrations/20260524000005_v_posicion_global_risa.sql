-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ FIN2.6 (2026-05-24): vista v_posicion_global_risa multi-moneda          ║
-- ║                                                                          ║
-- ║ Única fuente de verdad server-side para Posición Global RISA:           ║
-- ║                                                                          ║
-- ║   PG = MP + MT                                                          ║
-- ║                                                                          ║
-- ║   MP (Medios Propios)  = Σ fondos.saldo_actual (estado='activo',        ║
-- ║                          deleted_at IS NULL) por moneda                 ║
-- ║   MT (Medios Terceros) = -Σ v_saldos_financiadores.saldo_pendiente      ║
-- ║                          (saldo > 0, financiador no eliminado) por      ║
-- ║                          moneda. Signo negativo: deuda con terceros     ║
-- ║                          drena la posición.                             ║
-- ║   PG = MP + MT (mismo signo que MP cuando no hay deuda).                ║
-- ║                                                                          ║
-- ║ Multi-moneda: FULL OUTER JOIN por moneda incluye monedas con solo MP    ║
-- ║ o solo MT. Cada fila también trae jsonb_agg con detalle (fondos / 3    ║
-- ║ terceros principales) para que el cliente no tenga que cruzar a mano.  ║
-- ║                                                                          ║
-- ║ Idempotente: CREATE OR REPLACE VIEW.                                    ║
-- ║                                                                          ║
-- ║ Seguridad: VIEW hereda RLS de las tablas/vistas base (fondos +          ║
-- ║ v_saldos_financiadores ya tienen policy SELECT para authenticated).     ║
-- ║ GRANT SELECT explícito para que se vea desde el cliente Supabase.       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝


-- ─── 1. Vista v_posicion_global_risa ────────────────────────────────────────

CREATE OR REPLACE VIEW v_posicion_global_risa AS
WITH mp AS (
  SELECT
    moneda,
    SUM(saldo_actual)::numeric AS total,
    jsonb_agg(
      jsonb_build_object(
        'fondo_id',     id,
        'codigo',       codigo,
        'nombre',       nombre,
        'saldo_actual', saldo_actual
      )
      ORDER BY nombre
    ) AS detalle
  FROM fondos
  WHERE deleted_at IS NULL
    AND estado = 'activo'
  GROUP BY moneda
),
mt AS (
  SELECT
    moneda,
    SUM(saldo_pendiente)::numeric AS total_deuda,
    jsonb_agg(
      jsonb_build_object(
        'financiador_id', financiador_id,
        'codigo',         financiador_codigo,
        'nombre',         financiador_nombre,
        'saldo_pendiente', saldo_pendiente
      )
      ORDER BY saldo_pendiente DESC
    ) FILTER (WHERE saldo_pendiente > 0) AS detalle
  FROM v_saldos_financiadores
  WHERE financiador_deleted_at IS NULL
    AND saldo_pendiente > 0
  GROUP BY moneda
)
SELECT
  COALESCE(mp.moneda, mt.moneda)                                      AS moneda,
  COALESCE(mp.total, 0)::numeric                                      AS mp_total,
  (-COALESCE(mt.total_deuda, 0))::numeric                             AS mt_total,
  (COALESCE(mp.total, 0) - COALESCE(mt.total_deuda, 0))::numeric      AS pg_total,
  COALESCE(mp.detalle, '[]'::jsonb)                                   AS mp_detalle,
  COALESCE(mt.detalle, '[]'::jsonb)                                   AS mt_detalle
FROM mp
FULL OUTER JOIN mt ON mp.moneda = mt.moneda
ORDER BY 1;


-- ─── 2. Permisos ────────────────────────────────────────────────────────────

GRANT SELECT ON v_posicion_global_risa TO authenticated;


-- ─── 3. Verificación post-creación ──────────────────────────────────────────

DO $$
DECLARE
  v_def    TEXT;
  v_count  INTEGER;
BEGIN
  SELECT pg_get_viewdef('v_posicion_global_risa'::regclass, true) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'FIN2.6: v_posicion_global_risa NO está presente';
  END IF;
  IF v_def NOT LIKE '%fondos%' OR v_def NOT LIKE '%v_saldos_financiadores%' THEN
    RAISE EXCEPTION 'FIN2.6: la vista no referencia fondos + v_saldos_financiadores';
  END IF;

  -- Smoke test: la vista debe ser consultable. No verificamos cantidad
  -- (puede ser 0 si no hay fondos activos y no hay deuda).
  EXECUTE 'SELECT COUNT(*) FROM v_posicion_global_risa' INTO v_count;
  RAISE NOTICE 'FIN2.6 [check] OK — v_posicion_global_risa creada (filas: %)', v_count;
END $$;
