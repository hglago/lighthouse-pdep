-- =============================================================================
-- FIX RLS: alinear policies de gastos_recurrentes con el modelo RBAC (2026-06-17)
--
-- SÍNTOMA:
--   Al Eliminar / Desactivar / Editar / crear un gasto recurrente, un usuario
--   con rol 'supervisor' (o 'revisor') recibía:
--     "new row violates row-level security policy for table gastos_recurrentes"
--
-- CAUSA:
--   Las policies de escritura se crearon en 20260519000012 ANTES del refactor
--   RBAC (2026-05-25) y quedaron con el rol legacy 'contador':
--       WITH CHECK (get_my_role() IN ('admin','contador'))
--   El guard de la app (gastos/actions.ts → ROLES_RECURRENTES) ya permite
--   ['admin','supervisor','revisor'], pero la RLS no fue actualizada. Un
--   supervisor pasa el guard de la app y luego la policy lo rechaza.
--
--   El soft-delete es un UPDATE (SET deleted_at = now()), por eso el error es
--   "new row violates ... policy" del WITH CHECK del UPDATE, no un DELETE.
--
-- FIX:
--   Realinear insert/update al MISMO set de roles que el guard de la app:
--       ('admin','supervisor','revisor')
--   Invariante deseada: roles de la RLS == roles del guard de la app.
--   DELETE físico se mantiene admin-only (operativamente solo hacemos
--   soft-delete vía UPDATE; el DELETE policy queda como red de seguridad).
--   Se castea get_my_role()::text para evitar cualquier problema de membresía
--   del enum user_role.
--
-- IDEMPOTENTE: DROP POLICY IF EXISTS + CREATE. Re-ejecutable sin efectos.
-- =============================================================================

BEGIN;

-- SELECT sin cambios (cualquier autenticado ve recurrentes activos), se recrea
-- igual solo por completitud/idempotencia.
DROP POLICY IF EXISTS recurrentes_select ON gastos_recurrentes;
CREATE POLICY recurrentes_select ON gastos_recurrentes
  FOR SELECT USING (deleted_at IS NULL AND auth.uid() IS NOT NULL);

-- INSERT: admin + supervisor + revisor (legacy). Conserva el self-check de creador.
DROP POLICY IF EXISTS recurrentes_insert ON gastos_recurrentes;
CREATE POLICY recurrentes_insert ON gastos_recurrentes
  FOR INSERT WITH CHECK (
    get_my_role()::text IN ('admin', 'supervisor', 'revisor')
    AND created_by = auth.uid()
  );

-- UPDATE: idem set de roles. Cubre edición, desactivar (activo=false) y
-- soft-delete (deleted_at = now()).
DROP POLICY IF EXISTS recurrentes_update ON gastos_recurrentes;
CREATE POLICY recurrentes_update ON gastos_recurrentes
  FOR UPDATE
  USING      (get_my_role()::text IN ('admin', 'supervisor', 'revisor') AND deleted_at IS NULL)
  WITH CHECK (get_my_role()::text IN ('admin', 'supervisor', 'revisor'));

-- DELETE físico: admin-only (sin cambios funcionales; recreado por idempotencia).
DROP POLICY IF EXISTS recurrentes_delete ON gastos_recurrentes;
CREATE POLICY recurrentes_delete ON gastos_recurrentes
  FOR DELETE USING (get_my_role()::text = 'admin');

COMMIT;

-- PostgREST cachea el schema; forzar reload tras cambios de policies.
NOTIFY pgrst, 'reload schema';
