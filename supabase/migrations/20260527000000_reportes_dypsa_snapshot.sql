-- REP4.1: Tablas + RPC para Informe Dypsa numerado con snapshot congelado.
--
-- Política de pagos parciales:
--   - Un gasto se incluye si tiene al menos un pago confirmado (estado='pagado')
--     cuya fecha_pago cae dentro del rango [p_fecha_desde, p_fecha_hasta].
--   - Si un gasto tiene más de un pago confirmado dentro del rango, se genera
--     una sola fila por gasto (UNIQUE reporte_id+gasto_id).
--   - El importe informado se calcula sobre gasto.monto (no sobre la suma de pagos).
--   - pago_id y fecha_pago corresponden al primer pago confirmado dentro del rango
--     (ORDER BY fecha_pago, created_at LIMIT 1) y sirven como referencia de inclusión.
--   - No se guarda porcentaje de uplift en items para evitar exposición accidental
--     del mark-up. Solo se guarda el monto_final_informe ya calculado.

-- ── Secuencia para código visible ──
CREATE SEQUENCE IF NOT EXISTS reportes_dypsa_codigo_seq START WITH 1;

-- ── Cabecera del informe ──
CREATE TABLE IF NOT EXISTS reportes_dypsa (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo           TEXT NOT NULL UNIQUE
                     DEFAULT 'IDY-' || LPAD(nextval('reportes_dypsa_codigo_seq')::text, 6, '0'),
  fecha_desde      DATE NOT NULL,
  fecha_hasta      DATE NOT NULL,
  fecha_generacion TIMESTAMPTZ NOT NULL DEFAULT now(),
  generado_por     UUID REFERENCES auth.users(id),
  total_informado  NUMERIC(14,2) NOT NULL DEFAULT 0,
  moneda           TEXT NOT NULL DEFAULT 'ARS',
  cantidad_items   INT NOT NULL DEFAULT 0,
  estado           TEXT NOT NULL DEFAULT 'emitido',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT reportes_dypsa_rango_valido CHECK (fecha_hasta >= fecha_desde)
);

CREATE INDEX IF NOT EXISTS idx_reportes_dypsa_fecha_gen ON reportes_dypsa(fecha_generacion);
CREATE INDEX IF NOT EXISTS idx_reportes_dypsa_estado    ON reportes_dypsa(estado);

-- ── Items snapshot (congelados) ──
CREATE TABLE IF NOT EXISTS reportes_dypsa_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporte_id            UUID NOT NULL REFERENCES reportes_dypsa(id) ON DELETE CASCADE,
  gasto_id              UUID NOT NULL REFERENCES gastos(id),
  pago_id               UUID REFERENCES pagos(id),
  fecha_gasto           DATE,
  fecha_pago            DATE,
  periodo               TEXT,
  proveedor_nombre      TEXT NOT NULL DEFAULT 'Sin proveedor',
  tipo_gasto_nombre     TEXT NOT NULL DEFAULT 'Sin clasificar',
  descripcion           TEXT,
  moneda                TEXT NOT NULL,
  monto_final_informe   NUMERIC(14,2) NOT NULL,
  comprobante_path      TEXT,
  tiene_comprobante     BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT reportes_dypsa_items_unico UNIQUE (reporte_id, gasto_id)
);

CREATE INDEX IF NOT EXISTS idx_reportes_dypsa_items_reporte ON reportes_dypsa_items(reporte_id);
CREATE INDEX IF NOT EXISTS idx_reportes_dypsa_items_gasto   ON reportes_dypsa_items(gasto_id);

-- ── Trigger para asignar código si no viene (patrón estándar del proyecto) ──
CREATE OR REPLACE FUNCTION fn_set_reporte_dypsa_codigo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.codigo IS NULL THEN
    NEW.codigo := 'IDY-' || LPAD(nextval('reportes_dypsa_codigo_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_reporte_dypsa_codigo ON reportes_dypsa;
CREATE TRIGGER trg_set_reporte_dypsa_codigo
  BEFORE INSERT ON reportes_dypsa
  FOR EACH ROW
  EXECUTE FUNCTION fn_set_reporte_dypsa_codigo();

-- ── RPC: generar informe Dypsa con snapshot ──
-- SECURITY DEFINER para leer joins cruzados sin depender de RLS.
CREATE OR REPLACE FUNCTION fn_generar_reporte_dypsa(
  p_fecha_desde DATE,
  p_fecha_hasta DATE
)
RETURNS reportes_dypsa
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reporte_id UUID;
  v_total      NUMERIC(14,2) := 0;
  v_count      INT := 0;
  v_result     reportes_dypsa;
BEGIN
  -- Validaciones
  IF p_fecha_desde IS NULL OR p_fecha_hasta IS NULL THEN
    RAISE EXCEPTION 'Fechas desde y hasta son requeridas.';
  END IF;
  IF p_fecha_hasta < p_fecha_desde THEN
    RAISE EXCEPTION 'La fecha hasta debe ser mayor o igual a la fecha desde.';
  END IF;

  -- Crear cabecera (codigo se asigna por trigger)
  INSERT INTO reportes_dypsa (codigo, fecha_desde, fecha_hasta, generado_por)
  VALUES (NULL, p_fecha_desde, p_fecha_hasta, auth.uid())
  RETURNING id INTO v_reporte_id;

  -- Insertar items snapshot.
  -- Para cada gasto que tenga al menos un pago confirmado dentro del rango,
  -- tomamos el primer pago confirmado como referencia de inclusión.
  -- El importe informado se calcula con uplift: monto * (1 + uplift/100).
  -- Fuente de uplift: snapshot del gasto; si es 0, fallback al proveedor actual.
  WITH pagos_en_rango AS (
    SELECT DISTINCT ON (p.gasto_id)
      p.gasto_id,
      p.id AS pago_id,
      p.fecha_pago
    FROM pagos p
    WHERE p.estado = 'pagado'
      AND p.gasto_id IS NOT NULL
      AND p.fecha_pago >= p_fecha_desde
      AND p.fecha_pago <= p_fecha_hasta
    ORDER BY p.gasto_id, p.fecha_pago, p.created_at
  ),
  datos AS (
    SELECT
      pr.gasto_id,
      pr.pago_id,
      pr.fecha_pago,
      g.fecha_gasto,
      COALESCE(g.periodo_analitico, TO_CHAR(g.fecha_gasto, 'YYYY-MM')) AS periodo,
      COALESCE(
        NULLIF(prov.nombre_informe, ''),
        prov.nombre,
        'Sin proveedor'
      ) AS proveedor_nombre,
      COALESCE(tg.nombre, 'Sin clasificar') AS tipo_gasto_nombre,
      g.descripcion,
      g.moneda,
      g.monto,
      g.monto * (1 + COALESCE(
        NULLIF(g.porcentaje_uplift_snapshot, 0),
        CASE WHEN prov.tiene_uplift = true THEN prov.porcentaje_uplift ELSE 0 END,
        0
      ) / 100) AS monto_final_informe,
      g.comprobante_path
    FROM pagos_en_rango pr
    JOIN gastos g ON g.id = pr.gasto_id AND g.deleted_at IS NULL
    LEFT JOIN proveedores prov ON prov.id = g.proveedor_id
    LEFT JOIN tipos_gasto tg ON tg.id = g.tipo_gasto_id
  )
  INSERT INTO reportes_dypsa_items (
    reporte_id, gasto_id, pago_id, fecha_gasto, fecha_pago,
    periodo, proveedor_nombre, tipo_gasto_nombre, descripcion,
    moneda, monto_final_informe, comprobante_path, tiene_comprobante
  )
  SELECT
    v_reporte_id,
    d.gasto_id,
    d.pago_id,
    d.fecha_gasto,
    d.fecha_pago,
    d.periodo,
    d.proveedor_nombre,
    d.tipo_gasto_nombre,
    d.descripcion,
    d.moneda,
    ROUND(d.monto_final_informe, 2),
    d.comprobante_path,
    d.comprobante_path IS NOT NULL
  FROM datos d;

  -- Contar items y calcular total
  SELECT COUNT(*), COALESCE(SUM(monto_final_informe), 0)
  INTO v_count, v_total
  FROM reportes_dypsa_items
  WHERE reporte_id = v_reporte_id;

  -- Si no hay items, rechazar
  IF v_count = 0 THEN
    DELETE FROM reportes_dypsa WHERE id = v_reporte_id;
    RAISE EXCEPTION 'No hay gastos pagados para el período seleccionado.';
  END IF;

  -- Actualizar cabecera con totales
  UPDATE reportes_dypsa
  SET total_informado = v_total,
      cantidad_items  = v_count
  WHERE id = v_reporte_id;

  SELECT * INTO v_result FROM reportes_dypsa WHERE id = v_reporte_id;
  RETURN v_result;
END;
$$;
