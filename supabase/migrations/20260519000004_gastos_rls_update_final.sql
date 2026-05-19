-- Reemplaza TODAS las políticas UPDATE de gastos con versiones correctas.
-- Seguro de re-ejecutar: DROP IF EXISTS antes de cada CREATE.

-- Limpiar todas las variantes posibles (nombres de intentos anteriores)
DROP POLICY IF EXISTS gastos_actualizar_propios  ON gastos;
DROP POLICY IF EXISTS gastos_update_owner        ON gastos;
DROP POLICY IF EXISTS gastos_update_draft_owner  ON gastos;
DROP POLICY IF EXISTS gastos_update_estado       ON gastos;
DROP POLICY IF EXISTS gastos_soft_delete         ON gastos;

-- A) El creador puede editar campos de su propio gasto en borrador.
--    WITH CHECK incluye deleted_at IS NULL: el creador NO puede hacer soft-delete.
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

-- B) admin/contador/revisor pueden cambiar estado.
--    WITH CHECK incluye deleted_at IS NULL: cambio de estado no toca deleted_at.
--    El trigger fn_gastos_validar_estado valida las transiciones permitidas.
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

-- C) admin/contador pueden hacer soft-delete (SET deleted_at = now()).
--    USING verifica que la fila aún no esté eliminada (deleted_at IS NULL en fila vieja).
--    WITH CHECK NO incluye deleted_at IS NULL, lo que permite que la fila nueva
--    tenga deleted_at seteado. PostgreSQL OR-ea los WITH CHECK de todas las
--    políticas cuyo USING pasa — esta policy hace que el OR resulte TRUE para
--    admin/contador aunque las otras policies fallen su WITH CHECK.
CREATE POLICY gastos_soft_delete ON gastos
  FOR UPDATE
  USING (
    get_my_role() IN ('admin', 'contador')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    get_my_role() IN ('admin', 'contador')
  );
