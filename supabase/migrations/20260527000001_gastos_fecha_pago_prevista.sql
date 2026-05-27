-- DASH0.1: fecha_pago_prevista en gastos.
--
-- fecha_vencimiento = vencimiento documental/contractual de la obligación.
-- fecha_pago_prevista = planificación operativa de pago. Base para la
--   necesidad semanal del Dashboard.
--
-- Backfill: COALESCE(fecha_vencimiento, fecha_gasto) para gastos existentes.

ALTER TABLE public.gastos
  ADD COLUMN IF NOT EXISTS fecha_pago_prevista DATE;

UPDATE public.gastos
SET fecha_pago_prevista = COALESCE(fecha_vencimiento, fecha_gasto)
WHERE fecha_pago_prevista IS NULL;

ALTER TABLE public.gastos
  ALTER COLUMN fecha_pago_prevista SET NOT NULL;

COMMENT ON COLUMN public.gastos.fecha_pago_prevista IS
  'Fecha planificada de pago operativo. Distinta de fecha_vencimiento (vencimiento documental). Usada por el Dashboard para calcular necesidad semanal de fondos.';

CREATE INDEX IF NOT EXISTS idx_gastos_fecha_pago_prevista
  ON public.gastos(fecha_pago_prevista)
  WHERE deleted_at IS NULL;
