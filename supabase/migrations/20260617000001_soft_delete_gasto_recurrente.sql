-- =============================================================================
-- RPC soft_delete_gasto_recurrente — baja lógica de gastos_recurrentes (2026-06-17)
--
-- POR QUÉ:
--   El soft-delete por UPDATE directo de deleted_at sobre gastos_recurrentes es
--   rechazado por un trigger/policy de hardening (falso "new row violates RLS
--   policy"), igual que pasaba con Proveedores y Fondos. El UPDATE de otras
--   columnas (ej. activo, en Desactivar) sí pasa; solo el camino de deleted_at
--   se traba. El patrón del proyecto (CLAUDE.md #3, RLS_RPC.md) es mover la baja
--   lógica a un RPC SECURITY DEFINER que corre con privilegios del owner y
--   bypassea RLS, validando auth.uid() adentro.
--
--   Mismo patrón que public.soft_delete_proveedor (ya en producción).
--
-- IDEMPOTENTE: CREATE OR REPLACE. Re-ejecutable sin efectos.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_gasto_recurrente(recurrente_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  UPDATE public.gastos_recurrentes
  SET deleted_at = now()
  WHERE id = recurrente_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gasto recurrente no encontrado o ya dado de baja';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.soft_delete_gasto_recurrente(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_gasto_recurrente(uuid) TO authenticated;

-- PostgREST cachea el schema; forzar reload para que el RPC sea invocable ya.
NOTIFY pgrst, 'reload schema';
