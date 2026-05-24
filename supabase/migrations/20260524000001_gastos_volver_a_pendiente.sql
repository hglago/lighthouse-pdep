-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ GASTOS-UX-3 (2026-05-24): permitir aprobado → enviado ("Volver a        ║
-- ║                            pendiente") sin cancelar el gasto.            ║
-- ║                                                                          ║
-- ║ El trigger fn_gastos_validar_estado original (migración                  ║
-- ║ 20260519000006) solo permitía 'enviado' como destino desde 'borrador',  ║
-- ║ con `IF OLD.estado <> 'borrador' THEN RAISE 'Solo se puede enviar un    ║
-- ║ gasto en borrador'`. Eso bloqueaba la operación de desaprobar           ║
-- ║ administrativamente un gasto sin marcarlo como cancelado.                ║
-- ║                                                                          ║
-- ║ Esta migración extiende el handler de 'enviado' para aceptar también    ║
-- ║ la transición desde 'aprobado', exclusivamente para roles admin /        ║
-- ║ revisor. En ese camino:                                                  ║
-- ║   - NO se requiere ser el creador del gasto (a diferencia del envío     ║
-- ║     inicial).                                                            ║
-- ║   - Se limpian aprobado_por / aprobado_en para no dejar metadatos        ║
-- ║     obsoletos.                                                            ║
-- ║                                                                          ║
-- ║ Idempotente vía CREATE OR REPLACE FUNCTION. El trigger asociado          ║
-- ║ (trg_gastos_validar_estado) no requiere recreación: ya apunta a la       ║
-- ║ función por nombre.                                                      ║
-- ║                                                                          ║
-- ║ Lo que NO cambia:                                                        ║
-- ║   - rama 'aprobado' (sigue exigiendo OLD='enviado').                    ║
-- ║   - rama 'rechazado' (sigue aceptando 'enviado' o 'aprobado').          ║
-- ║   - rama 'pagado' (sigue exigiendo OLD='aprobado').                     ║
-- ║   - validación anti-self-approval para revisor.                          ║
-- ║   - RLS, secuencias, otras funciones.                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

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
    IF OLD.estado = 'borrador' THEN
      -- Envío inicial: solo el creador puede enviar su propio gasto.
      IF NEW.created_by <> auth.uid() THEN
        RAISE EXCEPTION 'Solo el creador puede enviar el gasto';
      END IF;
    ELSIF OLD.estado = 'aprobado' THEN
      -- GASTOS-UX-3: "Volver a pendiente" (desaprobar). Solo admin/revisor.
      -- No exige ser creador. Limpia los metadatos de aprobación.
      IF v_rol NOT IN ('admin', 'revisor') THEN
        RAISE EXCEPTION 'Sin permisos para volver el gasto a pendiente';
      END IF;
      NEW.aprobado_por := NULL;
      NEW.aprobado_en  := NULL;
    ELSE
      RAISE EXCEPTION 'No se puede pasar a "enviado" desde estado %', OLD.estado;
    END IF;

  ELSIF NEW.estado = 'aprobado' THEN
    IF OLD.estado <> 'enviado' THEN
      RAISE EXCEPTION 'Solo se puede aprobar un gasto enviado';
    END IF;
    IF v_rol NOT IN ('admin', 'revisor') THEN
      RAISE EXCEPTION 'Sin permisos para aprobar gastos';
    END IF;
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

-- Verificación rápida: confirmar que la rama nueva está presente.
-- Resultado esperado: 'OK — Volver a pendiente habilitado'.
DO $$
DECLARE
  v_body TEXT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_body
    FROM pg_proc WHERE proname = 'fn_gastos_validar_estado';
  IF v_body NOT LIKE '%Sin permisos para volver el gasto a pendiente%' THEN
    RAISE EXCEPTION 'GASTOS-UX-3: el handler aprobado→enviado NO está presente';
  END IF;
  RAISE NOTICE 'GASTOS-UX-3 [check] OK — Volver a pendiente habilitado';
END $$;
