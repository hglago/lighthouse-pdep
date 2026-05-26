-- REP1: agregar rol socio al enum de roles
-- Prerequisito: verificar que el tipo existe con:
--   SELECT typname FROM pg_type WHERE typname = 'user_role';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'socio';

-- REP2: agregar campo nombre_informe a proveedores
BEGIN;

ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS nombre_informe TEXT;

COMMENT ON COLUMN public.proveedores.nombre_informe IS
  'Nombre normalizado del proveedor para mostrar en informes a socios. Si está vacío, se usa el nombre principal del proveedor.';

COMMIT;
