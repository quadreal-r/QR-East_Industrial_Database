-- Saved map camera for portfolio filter views (park / cluster / manager combinations).
-- filter_key matches the app's `${park}|${cluster}|${manager}` key (empty string when unset).
CREATE TABLE IF NOT EXISTS portfolio_map_views (
  filter_key TEXT PRIMARY KEY,
  map_lat DOUBLE PRECISION,
  map_lng DOUBLE PRECISION,
  map_zoom DOUBLE PRECISION,
  map_heading DOUBLE PRECISION,
  map_tilt DOUBLE PRECISION,
  map_imagery_mode TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE portfolio_map_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read portfolio_map_views"
  ON portfolio_map_views FOR SELECT USING (true);

CREATE POLICY "Auth write portfolio_map_views"
  ON portfolio_map_views FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
