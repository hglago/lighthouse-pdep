-- Agrega campo observaciones a proveedores
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS observaciones TEXT;
