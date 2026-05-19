-- =============================================================================
-- MIGRACIÓN: Admin puede aprobar/rechazar sus propios gastos
-- Problema: la restricción anti-self-approval aplicaba a todos los roles.
-- Solución: solo revisor no puede aprobar/rechazar sus propios gastos.
--           Admin puede hacerlo.
-- También elimina el CHECK constraint de tabla que bloqueaba aprobado_por = created_by.
-- =============================================================================

-- 1. Eliminar el constraint de tabla que impide self-approval a nivel DB
ALTER TABLE gastos DROP CONSTRAINT IF EXISTS gastos_aprobador_distinto;

-- 2. Reemplazar la función del trigger con la lógica corregida
CREATE OR REPLACE FUNCTION fn_gastos_validar_estado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_rol user_role;
BEGIN
  IF OLD.estado = NEW.estado THEN
    RETURN NEW;
  END IF;

  v_rol := get_my_role();

  IF NEW.estado = 'enviado' THEN
    IF OLD.estado <> 'borrador' THEN
      RAISE EXCEPTION 'Solo se puede enviar un gasto en borrador';
    END IF;
    IF NEW.created_by <> auth.uid() THEN
      RAISE EXCEPTION 'Solo el creador puede enviar el gasto';
    END IF;

  ELSIF NEW.estado = 'aprobado' THEN
    IF OLD.estado <> 'enviado' THEN
      RAISE EXCEPTION 'Solo se puede aprobar un gasto enviado';
    END IF;
    IF v_rol NOT IN ('admin', 'revisor') THEN
      RAISE EXCEPTION 'Sin permisos para aprobar gastos';
    END IF;
    -- Solo revisor tiene restricción de no aprobar su propio gasto; admin no
    IF v_rol = 'revisor' AND NEW.created_by = auth.uid() THEN
      RAISE EXCEPTION 'No podés aprobar tu propio gasto';
    END IF;
    NEW.aprobado_por := auth.uid();
    NEW.aprobado_en  := now();

  ELSIF NEW.estado = 'rechazado' THEN
    IF OLD.estado NOT IN ('enviado', 'aprobado') THEN
      RAISE EXCEPTION 'Solo se puede rechazar un gasto enviado o aprobado';
    END IF;
    IF v_rol NOT IN ('admin', 'revisor') THEN
      RAISE EXCEPTION 'Sin permisos para rechazar gastos';
    END IF;
    -- Solo revisor tiene restricción de no rechazar su propio gasto; admin no
    IF v_rol = 'revisor' AND NEW.created_by = auth.uid() THEN
      RAISE EXCEPTION 'No podés rechazar tu propio gasto';
    END IF;
    NEW.rechazado_por := auth.uid();
    NEW.rechazado_en  := now();

  ELSIF NEW.estado = 'pagado' THEN
    IF OLD.estado <> 'aprobado' THEN
      RAISE EXCEPTION 'Solo se puede marcar como pagado un gasto aprobado';
    END IF;
    IF v_rol NOT IN ('admin', 'contador') THEN
      RAISE EXCEPTION 'Sin permisos para registrar pagos';
    END IF;

  ELSE
    RAISE EXCEPTION 'Transición de estado no permitida: % -> %', OLD.estado, NEW.estado;
  END IF;

  RETURN NEW;
END;
$$;
