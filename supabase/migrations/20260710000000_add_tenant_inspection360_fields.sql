-- Link suite entrance markers to tenant polygons and store QR-360° tour URLs.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS polygon_id BIGINT REFERENCES polygons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inspection_url TEXT;

CREATE INDEX IF NOT EXISTS idx_tenants_polygon_id ON tenants(polygon_id);
