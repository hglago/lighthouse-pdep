-- Fix: permite a admin hacer soft-delete de gastos (UPDATE deleted_at).
-- Las políticas gastos_update_owner y gastos_update_estado tienen WITH CHECK
-- implícito que requiere deleted_at IS NULL, lo que bloquea el UPDATE cuando
-- se intenta setear deleted_at = now(). Esta nueva política tiene un WITH CHECK
-- explícito sin esa restricción.
CREATE POLICY gastos_soft_delete ON gastos
  FOR UPDATE
  USING (
    get_my_role() = 'admin'
    AND estado = 'borrador'
    AND deleted_at IS NULL
  )
  WITH CHECK (
    get_my_role() = 'admin'
  );
