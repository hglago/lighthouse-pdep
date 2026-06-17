-- =============================================================================
-- RPC soft_delete_gasto — baja lógica de gastos (2026-06-17)
--
-- POR QUÉ:
--   Igual que gastos_recurrentes / proveedores / fondos: el UPDATE directo de
--   deleted_at sobre la tabla gastos es rechazado por el hardening (en la UI se
--   veía como el overlay genérico de Next, porque deleteGasto hace throw). El
--   patrón del proyecto es mover la baja lógica a un RPC SECURITY DEFINER que
--   corre como owner y bypassea RLS, validando auth.uid() adentro.
--
--   El chequeo de dependencias (pagos asociados) lo hace el client ANTES de
--   invocar, igual que soft_delete_proveedor.
--
-- IDEMPOTENTE: CREATE OR REPLACE. Re-ejecutable sin efectos.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_gasto(gasto_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  UPDATE public.gastos
  SET deleted_at = now()
  WHERE id = gasto_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gasto no encontrado o ya dado de baja';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.soft_delete_gasto(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_gasto(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
