-- =============================================================================
-- Fondos — hardening: unique parcial (nombre, moneda) WHERE deleted_at IS NULL
-- =============================================================================
--
-- OBJETIVO
--   Impedir que existan dos fondos no eliminados con el mismo nombre y moneda.
--   Un fondo soft-deleted (deleted_at IS NOT NULL) queda fuera del scope del
--   índice, por lo que es posible "reusar" un nombre/moneda tras eliminar el fondo
--   anterior.
--
-- PREREQUISITO OBLIGATORIO
--   Ejecutar el BLOQUE DE SANEAMIENTO que sigue, resolver los duplicados manualmente
--   y confirmar que la query de verificación no devuelve filas.
--   Esta migración aborta con EXCEPTION si detecta duplicados al ejecutarse.
--
-- =============================================================================
-- BLOQUE DE SANEAMIENTO — ejecutar ANTES en Supabase SQL Editor
-- =============================================================================
--
-- 1. Ver duplicados activos:
--
--    SELECT
--      nombre,
--      moneda,
--      COUNT(*)                              AS cantidad,
--      array_agg(id       ORDER BY created_at) AS ids,
--      array_agg(saldo_actual ORDER BY created_at) AS saldos,
--      array_agg(estado   ORDER BY created_at) AS estados,
--      array_agg(created_at ORDER BY created_at) AS fechas_creacion
--    FROM fondos
--    WHERE deleted_at IS NULL
--    GROUP BY nombre, moneda
--    HAVING COUNT(*) > 1
--    ORDER BY nombre, moneda;
--
-- 2. Para cada grupo de duplicados, decidir cuál conservar y soft-deletear los demás.
--    Reemplazar <id_a_eliminar> con el UUID correspondiente:
--
--    UPDATE fondos
--    SET deleted_at = now()
--    WHERE id IN (
--      '<id_a_eliminar_1>',
--      '<id_a_eliminar_2>'
--    );
--
-- 3. Verificar que no quedan duplicados (debe devolver 0 filas):
--
--    SELECT nombre, moneda, COUNT(*)
--    FROM fondos
--    WHERE deleted_at IS NULL
--    GROUP BY nombre, moneda
--    HAVING COUNT(*) > 1;
--
-- =============================================================================
-- BACKWARD COMPATIBILITY
-- =============================================================================
--
-- ✓ createFondo (server action): insert sin check previo de unicidad.
--     Después de esta migración: Supabase retorna error PostgreSQL con código 23505
--     (unique_violation). La acción lanza new Error(error.message), que la UI
--     muestra como "duplicate key value violates unique constraint …".
--     Recomendación: mapear ese error a un mensaje amigable en el server action.
--
-- ✓ updateFondo (server action): puede cambiar nombre/moneda.
--     Si el nuevo (nombre, moneda) ya existe en un fondo activo, la operación falla
--     con el mismo error 23505. Comportamiento correcto y deseado.
--
-- ✓ deleteFondo (soft delete): setea deleted_at = now().
--     El fondo queda fuera del índice parcial; su nombre/moneda queda disponible
--     para un fondo nuevo.
--
-- ✓ fn_confirmar_pago / fn_anular_pago: no leen ni escriben nombre/moneda. Sin impacto.
--
-- ✓ fn_registrar_aporte (propuesto): ídem. Sin impacto.
--
-- ✓ Fondos cerrados / suspendidos (estado != 'activo') con deleted_at IS NULL:
--     Quedan dentro del scope del índice. Intención: evitar confusión de nombres
--     aunque el fondo esté cerrado; si se quiere "liberar" el nombre, eliminar
--     el fondo vía soft delete.
--
-- ✓ Datos históricos: ninguna fila existente es modificada ni eliminada por esta
--     migración. Solo se agrega el índice (previa verificación de duplicados).
--
-- =============================================================================

-- ─── Guardia: abortar si existen duplicados activos ──────────────────────────
-- Si la migración se ejecuta antes de sanear los datos, lanza EXCEPTION con
-- detalle de cuántas combinaciones conflictivas hay.

DO $$
DECLARE
  v_count  INTEGER;
  v_detail TEXT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM (
    SELECT nombre, moneda
    FROM   fondos
    WHERE  deleted_at IS NULL
    GROUP  BY nombre, moneda
    HAVING COUNT(*) > 1
  ) dups;

  IF v_count > 0 THEN
    SELECT string_agg(
      '"' || nombre || '" / ' || moneda || ' (' || cantidad || ' copias)',
      ', ' ORDER BY nombre, moneda
    ) INTO v_detail
    FROM (
      SELECT nombre, moneda, COUNT(*) AS cantidad
      FROM   fondos
      WHERE  deleted_at IS NULL
      GROUP  BY nombre, moneda
      HAVING COUNT(*) > 1
    ) d;

    RAISE EXCEPTION
      'Migración abortada: % combinación(es) duplicada(s) en fondos activos → [%]. '
      'Ejecutá el bloque de saneamiento en el encabezado de este archivo, '
      'resolvé los duplicados y volvé a ejecutar la migración.',
      v_count, v_detail;
  END IF;
END $$;

-- ─── Unique parcial ──────────────────────────────────────────────────────────
-- Usa un índice (no ADD CONSTRAINT) para poder especificar la cláusula WHERE.
-- Efecto idéntico a una UNIQUE constraint para el optimizer y el runtime.

CREATE UNIQUE INDEX fondos_nombre_moneda_activo_unico
  ON fondos(nombre, moneda)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX fondos_nombre_moneda_activo_unico IS
  'Impide fondos activos/cerrados/suspendidos con el mismo nombre y moneda. '
  'Excluye fondos eliminados (deleted_at IS NOT NULL): el nombre queda disponible '
  'para un fondo nuevo tras un soft delete.';
