-- Temporary compatibility for browsers still running pre-v1.11.0 JS
-- that fetch portfolio_map_views. New app code does not use this table.
CREATE TABLE IF NOT EXISTS public.portfolio_map_views (
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

ALTER TABLE public.portfolio_map_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read portfolio_map_views" ON public.portfolio_map_views;
CREATE POLICY "Public read portfolio_map_views"
  ON public.portfolio_map_views FOR SELECT USING (true);

DROP POLICY IF EXISTS "Auth write portfolio_map_views" ON public.portfolio_map_views;
CREATE POLICY "Auth write portfolio_map_views"
  ON public.portfolio_map_views FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
