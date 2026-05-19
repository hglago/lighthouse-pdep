-- =============================================================================
-- Etapa 2: Schema inicial - auth, profiles, fondos, proveedores, gastos
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('admin', 'contador', 'revisor', 'visualizador');
CREATE TYPE fondo_estado AS ENUM ('activo', 'cerrado', 'suspendido');
CREATE TYPE gasto_estado AS ENUM ('borrador', 'enviado', 'aprobado', 'pagado', 'rechazado');

-- -----------------------------------------------------------------------------
-- 2. Funciones auxiliares simples (no referencian tablas del dominio)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_fondos_inicializar_saldo()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.saldo_actual = NEW.monto_inicial;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Tabla profiles (debe existir antes de get_my_role)
-- -----------------------------------------------------------------------------
CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  full_name   TEXT,
  role        user_role NOT NULL DEFAULT 'visualizador',
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

-- -----------------------------------------------------------------------------
-- 4. Función para crear profile automático al registrar usuario en auth
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_crear_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. get_my_role() — LANGUAGE sql, referencias profiles; va después de la tabla
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- 6. Tablas de dominio
-- -----------------------------------------------------------------------------
CREATE TABLE fondos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         TEXT NOT NULL,
  descripcion    TEXT,
  monto_inicial  NUMERIC(14,2) NOT NULL DEFAULT 0,
  saldo_actual   NUMERIC(14,2) NOT NULL DEFAULT 0,
  moneda         TEXT NOT NULL DEFAULT 'ARS',
  estado         fondo_estado NOT NULL DEFAULT 'activo',
  responsable_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_by     UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ,
  CONSTRAINT fondos_monto_positivo CHECK (monto_inicial >= 0),
  CONSTRAINT fondos_saldo_no_negativo CHECK (saldo_actual >= 0)
);

CREATE TABLE proveedores (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre       TEXT NOT NULL,
  cuit         TEXT,
  email        TEXT,
  telefono     TEXT,
  direccion    TEXT,
  activo       BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ,
  CONSTRAINT proveedores_cuit_unico UNIQUE (cuit)
);

CREATE TABLE gastos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fondo_id        UUID NOT NULL REFERENCES fondos(id) ON DELETE RESTRICT,
  proveedor_id    UUID REFERENCES proveedores(id) ON DELETE SET NULL,
  descripcion     TEXT NOT NULL,
  monto           NUMERIC(14,2) NOT NULL,
  moneda          TEXT NOT NULL DEFAULT 'ARS',
  estado          gasto_estado NOT NULL DEFAULT 'borrador',
  fecha_gasto     DATE NOT NULL DEFAULT CURRENT_DATE,
  comprobante_url TEXT,
  notas           TEXT,
  created_by      UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  aprobado_por    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  aprobado_en     TIMESTAMPTZ,
  rechazado_por   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  rechazado_en    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT gastos_monto_positivo CHECK (monto > 0),
  CONSTRAINT gastos_aprobador_distinto CHECK (aprobado_por IS NULL OR aprobado_por <> created_by)
);

-- -----------------------------------------------------------------------------
-- 7. fn_gastos_validar_estado — anti-self-approval + transiciones válidas
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_gastos_validar_estado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_rol user_role;
BEGIN
  -- Solo actuar cuando cambia el estado
  IF OLD.estado = NEW.estado THEN
    RETURN NEW;
  END IF;

  v_rol := get_my_role();

  -- Transiciones permitidas por rol
  IF NEW.estado = 'enviado' THEN
    -- Cualquier rol puede enviar su propio borrador
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
    IF NEW.created_by = auth.uid() THEN
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
    IF NEW.created_by = auth.uid() THEN
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

-- -----------------------------------------------------------------------------
-- 8. get_saldo_disponible() — LANGUAGE sql, después de fondos y gastos
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_saldo_disponible(p_fondo_id UUID)
RETURNS NUMERIC
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE AS $$
  SELECT saldo_actual FROM public.fondos WHERE id = p_fondo_id;
$$;

-- -----------------------------------------------------------------------------
-- 9. Indexes
-- -----------------------------------------------------------------------------
-- profiles
CREATE INDEX idx_profiles_role        ON profiles(role)       WHERE deleted_at IS NULL;
CREATE INDEX idx_profiles_activo      ON profiles(activo)     WHERE deleted_at IS NULL;

-- fondos
CREATE INDEX idx_fondos_estado        ON fondos(estado)       WHERE deleted_at IS NULL;
CREATE INDEX idx_fondos_responsable   ON fondos(responsable_id) WHERE deleted_at IS NULL;

-- proveedores
CREATE INDEX idx_proveedores_activo   ON proveedores(activo)  WHERE deleted_at IS NULL;
CREATE INDEX idx_proveedores_cuit     ON proveedores(cuit)    WHERE cuit IS NOT NULL AND deleted_at IS NULL;

-- gastos
CREATE INDEX idx_gastos_fondo         ON gastos(fondo_id)     WHERE deleted_at IS NULL;
CREATE INDEX idx_gastos_estado        ON gastos(estado)       WHERE deleted_at IS NULL;
CREATE INDEX idx_gastos_created_by    ON gastos(created_by)   WHERE deleted_at IS NULL;
CREATE INDEX idx_gastos_fecha         ON gastos(fecha_gasto)  WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 10. Triggers
-- -----------------------------------------------------------------------------
-- updated_at
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_fondos_updated_at
  BEFORE UPDATE ON fondos
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_proveedores_updated_at
  BEFORE UPDATE ON proveedores
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_gastos_updated_at
  BEFORE UPDATE ON gastos
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- fondos: inicializar saldo_actual = monto_inicial en INSERT
CREATE TRIGGER trg_fondos_init_saldo
  BEFORE INSERT ON fondos
  FOR EACH ROW EXECUTE FUNCTION fn_fondos_inicializar_saldo();

-- auth: crear profile automático al registrar usuario
CREATE TRIGGER trg_auth_crear_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION fn_crear_profile();

-- gastos: validar transiciones de estado
CREATE TRIGGER trg_gastos_validar_estado
  BEFORE UPDATE OF estado ON gastos
  FOR EACH ROW EXECUTE FUNCTION fn_gastos_validar_estado();

-- -----------------------------------------------------------------------------
-- 11. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fondos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE gastos      ENABLE ROW LEVEL SECURITY;

-- profiles: cada usuario ve su propio perfil; admin ve todos
CREATE POLICY profiles_select ON profiles
  FOR SELECT USING (
    id = auth.uid()
    OR get_my_role() = 'admin'
  );

CREATE POLICY profiles_update_self ON profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = (SELECT role FROM profiles WHERE id = auth.uid()));

CREATE POLICY profiles_admin_all ON profiles
  FOR ALL USING (get_my_role() = 'admin');

-- fondos: todos los autenticados ven fondos activos; admin/contador modifican
CREATE POLICY fondos_select ON fondos
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND deleted_at IS NULL
  );

CREATE POLICY fondos_insert ON fondos
  FOR INSERT WITH CHECK (
    get_my_role() IN ('admin', 'contador')
  );

CREATE POLICY fondos_update ON fondos
  FOR UPDATE USING (
    get_my_role() IN ('admin', 'contador')
    AND deleted_at IS NULL
  );

CREATE POLICY fondos_delete ON fondos
  FOR DELETE USING (get_my_role() = 'admin');

-- proveedores: todos ven; admin/contador crean/editan
CREATE POLICY proveedores_select ON proveedores
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND deleted_at IS NULL
  );

CREATE POLICY proveedores_insert ON proveedores
  FOR INSERT WITH CHECK (
    get_my_role() IN ('admin', 'contador')
  );

CREATE POLICY proveedores_update ON proveedores
  FOR UPDATE USING (
    get_my_role() IN ('admin', 'contador')
    AND deleted_at IS NULL
  );

CREATE POLICY proveedores_delete ON proveedores
  FOR DELETE USING (get_my_role() = 'admin');

-- gastos: creador ve los suyos; revisor/admin ven todos; contador ve aprobados+
CREATE POLICY gastos_select ON gastos
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      created_by = auth.uid()
      OR get_my_role() IN ('admin', 'revisor')
      OR (get_my_role() = 'contador' AND estado IN ('aprobado', 'pagado'))
    )
  );

CREATE POLICY gastos_insert ON gastos
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
  );

-- Política 1: el creador puede editar su propio borrador (campos no-estado)
CREATE POLICY gastos_update_owner ON gastos
  FOR UPDATE USING (
    created_by = auth.uid()
    AND estado = 'borrador'
    AND deleted_at IS NULL
  );

-- Política 2: revisor/admin pueden cambiar estado (trigger valida la lógica)
CREATE POLICY gastos_update_estado ON gastos
  FOR UPDATE USING (
    get_my_role() IN ('admin', 'revisor', 'contador')
    AND deleted_at IS NULL
  );

CREATE POLICY gastos_delete ON gastos
  FOR DELETE USING (get_my_role() = 'admin');
