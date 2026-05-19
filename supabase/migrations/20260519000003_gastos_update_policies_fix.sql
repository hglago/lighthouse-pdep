-- Fix soft-delete RLS on gastos.
-- Root cause: gastos_update_owner and gastos_update_estado had no explicit WITH CHECK,
-- so PostgreSQL used their USING clause as WITH CHECK. Both required deleted_at IS NULL,
-- which failed after UPDATE SET deleted_at = now() because the new row has deleted_at set.
-- Fix: recreate all three UPDATE policies with explicit WITH CHECK clauses.
-- gastos_soft_delete gets a WITH CHECK without deleted_at IS NULL so soft-delete is allowed.

DROP POLICY IF EXISTS gastos_update_owner  ON gastos;
DROP POLICY IF EXISTS gastos_update_estado ON gastos;
DROP POLICY IF EXISTS gastos_soft_delete   ON gastos;

-- Owner edits their own borrador fields; cannot change deleted_at or estado
CREATE POLICY gastos_update_owner ON gastos
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

-- admin/revisor/contador may change estado; trigger validates the transition
CREATE POLICY gastos_update_estado ON gastos
  FOR UPDATE
  USING (
    get_my_role() IN ('admin', 'revisor', 'contador')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    get_my_role() IN ('admin', 'revisor', 'contador')
    AND deleted_at IS NULL
  );

-- admin/contador may soft-delete (set deleted_at); WITH CHECK omits deleted_at IS NULL
-- so the resulting row (with deleted_at set) still passes policy validation
CREATE POLICY gastos_soft_delete ON gastos
  FOR UPDATE
  USING (
    get_my_role() IN ('admin', 'contador')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    get_my_role() IN ('admin', 'contador')
  );
