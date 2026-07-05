-- Saved satellite imagery provider per building (google, esri).
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS map_imagery_mode TEXT;
