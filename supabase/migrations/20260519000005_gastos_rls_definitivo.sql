-- =============================================================================
-- MIGRACIÓN DEFINITIVA: RLS UPDATE para gastos
-- =============================================================================
-- Por qué fallaba:
--   Las policies originales (000000) no tenían WITH CHECK explícito.
--   PostgreSQL usa el USING como WITH CHECK implícito en ese caso.
--   Ambas requerían "deleted_at IS NULL". Al hacer soft delete
--   (UPDATE SET deleted_at = now()), la fila nueva tiene deleted_at != NULL,
--   así que el WITH CHECK implícito falla en todas las policies.
--   OR(FALSE, FALSE) = FALSE → "new row violates row-level security policy".
--
-- Solución: tres policies UPDATE con WITH CHECK explícito y diferenciado.
--   gastos_soft_delete tiene WITH CHECK sin restricción deleted_at IS NULL,
--   permitiendo que la fila resultante tenga deleted_at seteado.
-- =============================================================================

-- Limpiar TODOS los nombres posibles de intentos anteriores
DROP POLICY IF EXISTS gastos_actualizar_propios  ON gastos;
DROP POLICY IF EXISTS gastos_update_owner        ON gastos;
DROP POLICY IF EXISTS gastos_update_draft_owner  ON gastos;
DROP POLICY IF EXISTS gastos_update_estado       ON gastos;
DROP POLICY IF EXISTS gastos_soft_delete         ON gastos;

-- -----------------------------------------------------------------------------
-- A) El creador puede editar campos de su propio gasto en borrador.
--    WITH CHECK explícito con deleted_at IS NULL: impide que el owner
--    haga soft-delete por sí solo.
-- -----------------------------------------------------------------------------
CREATE POLICY gastos_update_draft_owner ON gastos
  FOR UPDATE
  USING (
    created_by = auth.uid()
    AND estado = 'borrador'
    AND deleted_at IS NULL
  )
  WITH CHECK (
    created_by = auth.uid()
    AND estado = 'borrador'
    AND deleted_at IS NULL
  );

-- -----------------------------------------------------------------------------
-- B) admin / contador / revisor pueden cambiar estado.
--    WITH CHECK incluye deleted_at IS NULL: un cambio de estado no toca
--    deleted_at, así que la fila resultante sigue pasando la validación.
--    El trigger fn_gastos_validar_estado aplica la lógica de transiciones.
-- -----------------------------------------------------------------------------
CREATE POLICY gastos_update_estado ON gastos
  FOR UPDATE
  USING (
    get_my_role() IN ('admin', 'contador', 'revisor')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    get_my_role() IN ('admin', 'contador', 'revisor')
    AND deleted_at IS NULL
  );

-- -----------------------------------------------------------------------------
-- C) admin / contador pueden hacer soft-delete (SET deleted_at = now()).
--    USING: solo actúa sobre filas no eliminadas (deleted_at IS NULL en fila vieja).
--    WITH CHECK: solo verifica el rol, SIN deleted_at IS NULL.
--    → la fila resultante (con deleted_at seteado) pasa esta policy.
--    PostgreSQL OR-ea los WITH CHECK: OR(FALSE, FALSE, TRUE) = TRUE para admin/contador.
-- -----------------------------------------------------------------------------
CREATE POLICY gastos_soft_delete ON gastos
  FOR UPDATE
  USING (
    get_my_role() IN ('admin', 'contador')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    get_my_role() IN ('admin', 'contador')
  );
