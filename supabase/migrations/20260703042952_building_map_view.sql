-- Per-building saved map view (camera): center, zoom, heading (rotation), tilt.
-- All nullable: NULL means no saved view (fall back to default navigation).
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS map_lat DOUBLE PRECISION;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS map_lng DOUBLE PRECISION;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS map_zoom DOUBLE PRECISION;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS map_heading DOUBLE PRECISION;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS map_tilt DOUBLE PRECISION;
