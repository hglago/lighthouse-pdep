-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ RESET DEV DATA (2026-05-24) — scope mínimo (transaccional puro)         ║
-- ║                                                                          ║
-- ║ Vacía las tablas TRANSACCIONALES para preparar lote formal de pruebas   ║
-- ║ end-to-end. Preserva datos maestros (proveedores, socios, financiadores,║
-- ║ fondos, recurrentes) y todas las definiciones de la Etapa 1+.           ║
-- ║                                                                          ║
-- ║ ⚠ DESTRUCTIVO — NO ejecutar en producción.                              ║
-- ║                                                                          ║
-- ║ Alcance:                                                                 ║
-- ║   - TRUNCATE: gastos, pagos, aportes_fondo, aporte_imputaciones,        ║
-- ║              movimientos_fondo, movimientos_financiacion, anticipos     ║
-- ║   - UPDATE fondos.saldo_actual = monto_inicial (resetea ledger)         ║
-- ║   - RESET aportes_codigo_seq → 1 (próximo APO = APO-001)                ║
-- ║   - RESET gastos_codigo_seq + pagos_codigo_seq SI existen               ║
-- ║                                                                          ║
-- ║ Preserva:                                                                ║
-- ║   - profiles, auth.users                                                 ║
-- ║   - fondos (con saldo reseteado), socios, financiadores, proveedores    ║
-- ║   - gastos_recurrentes (templates intactos)                             ║
-- ║   - sequences SOC/FIN (sus tablas no se truncan; resetear los choca     ║
-- ║     con códigos vivos en UNIQUE)                                        ║
-- ║                                                                          ║
-- ║ Atomicidad: todo dentro de BEGIN/COMMIT. Si algún TRUNCATE falla,       ║
-- ║ se revierte y no quedan tablas a medio vaciar.                          ║
-- ║                                                                          ║
-- ║ Idempotente: re-ejecutar sobre tablas ya vacías no hace daño            ║
-- ║ (TRUNCATE sobre tabla vacía es no-op).                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝


BEGIN;

-- ─── 1. Snapshot pre-reset (para diff) ──────────────────────────────────────

DO $$
DECLARE
  v_g    INTEGER; v_p    INTEGER; v_a    INTEGER; v_ai   INTEGER;
  v_mf   INTEGER; v_mfin INTEGER; v_an   INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_g    FROM gastos;
  SELECT COUNT(*) INTO v_p    FROM pagos;
  SELECT COUNT(*) INTO v_a    FROM aportes_fondo;
  SELECT COUNT(*) INTO v_ai   FROM aporte_imputaciones;
  SELECT COUNT(*) INTO v_mf   FROM movimientos_fondo;
  SELECT COUNT(*) INTO v_mfin FROM movimientos_financiacion;
  SELECT COUNT(*) INTO v_an   FROM anticipos;
  RAISE NOTICE '[reset-dev] PRE  → gastos:% pagos:% aportes:% imputaciones:% mov_fondo:% mov_fin:% anticipos:%',
    v_g, v_p, v_a, v_ai, v_mf, v_mfin, v_an;
END $$;


-- ─── 2. TRUNCATE transaccional ──────────────────────────────────────────────
-- CASCADE asegura que cualquier FK colateral no listada (legacy) se limpie
-- junto. Las tablas maestras (proveedores/socios/financiadores/fondos/
-- recurrentes/profiles) no tienen FKs entrantes desde estas, así que CASCADE
-- no las toca.

TRUNCATE TABLE
  aporte_imputaciones,
  movimientos_fondo,
  movimientos_financiacion,
  aportes_fondo,
  pagos,
  anticipos,
  gastos
RESTART IDENTITY CASCADE;


-- ─── 3. Resetear saldo_actual de fondos a monto_inicial ────────────────────
-- Sin esto, los nuevos movimientos partirían de un saldo viejo.

UPDATE fondos
   SET saldo_actual = monto_inicial,
       updated_at   = now()
 WHERE deleted_at IS NULL
   AND saldo_actual <> monto_inicial;


-- ─── 4. Resetear sequences de codigos cuyas tablas SÍ se vaciaron ──────────
-- NO se tocan socios_codigo_seq ni financiadores_codigo_seq: sus tablas
-- siguen vivas y resetearlas chocaría con UNIQUE.

DO $$
BEGIN
  PERFORM setval('aportes_codigo_seq', 1, false);
  RAISE NOTICE '[reset-dev] aportes_codigo_seq → 1 (próximo APO-001)';

  IF to_regclass('public.gastos_codigo_seq') IS NOT NULL THEN
    PERFORM setval('gastos_codigo_seq', 1, false);
    RAISE NOTICE '[reset-dev] gastos_codigo_seq → 1';
  END IF;
  IF to_regclass('public.pagos_codigo_seq') IS NOT NULL THEN
    PERFORM setval('pagos_codigo_seq', 1, false);
    RAISE NOTICE '[reset-dev] pagos_codigo_seq → 1';
  END IF;
END $$;


-- ─── 5. Verificación post-reset ────────────────────────────────────────────

DO $$
DECLARE
  v_g    INTEGER; v_p    INTEGER; v_a    INTEGER; v_ai   INTEGER;
  v_mf   INTEGER; v_mfin INTEGER; v_an   INTEGER;
  v_fondos_mal INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_g    FROM gastos;
  SELECT COUNT(*) INTO v_p    FROM pagos;
  SELECT COUNT(*) INTO v_a    FROM aportes_fondo;
  SELECT COUNT(*) INTO v_ai   FROM aporte_imputaciones;
  SELECT COUNT(*) INTO v_mf   FROM movimientos_fondo;
  SELECT COUNT(*) INTO v_mfin FROM movimientos_financiacion;
  SELECT COUNT(*) INTO v_an   FROM anticipos;
  SELECT COUNT(*) INTO v_fondos_mal
    FROM fondos
   WHERE saldo_actual <> monto_inicial
     AND deleted_at IS NULL;

  IF v_g + v_p + v_a + v_ai + v_mf + v_mfin + v_an > 0 THEN
    RAISE EXCEPTION '[reset-dev] FAIL — tablas no vacías post-reset (g:% p:% a:% ai:% mf:% mfin:% an:%)',
      v_g, v_p, v_a, v_ai, v_mf, v_mfin, v_an;
  END IF;
  IF v_fondos_mal > 0 THEN
    RAISE EXCEPTION '[reset-dev] FAIL — % fondos con saldo_actual != monto_inicial', v_fondos_mal;
  END IF;

  RAISE NOTICE '[reset-dev] POST → todas las tablas transaccionales vacías, fondos reseteados';
  RAISE NOTICE '[reset-dev] OK — listo para test suite';
END $$;


COMMIT;


-- ─── 6. (FUERA DE TRX) Validación interactiva opcional ────────────────────
--
--   SELECT codigo, nombre, monto_inicial, saldo_actual, moneda, estado
--     FROM fondos WHERE deleted_at IS NULL ORDER BY codigo;
--   SELECT codigo, nombre FROM socios        WHERE deleted_at IS NULL ORDER BY codigo;
--   SELECT codigo, nombre FROM financiadores WHERE deleted_at IS NULL ORDER BY codigo;
--   SELECT nombre        FROM proveedores    WHERE deleted_at IS NULL ORDER BY nombre;
--   SELECT last_value, is_called FROM aportes_codigo_seq;
