-- Building Map Explorer schema
-- Public read, authenticated write via RLS

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE utility_type AS ENUM (
  'Sprinkler Rooms',
  'Electrical Rooms',
  'Fire Hydrants',
  'Natural Gas Shut-Off'
);

CREATE TABLE buildings (
  id BIGSERIAL PRIMARY KEY,
  park TEXT NOT NULL,
  address TEXT NOT NULL UNIQUE,
  bu TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  sqft TEXT,
  cluster TEXT,
  manager TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rtus (
  id BIGSERIAL PRIMARY KEY,
  building_id BIGINT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  model TEXT,
  serial TEXT,
  make TEXT,
  install_date TEXT,
  install_year INTEGER,
  heating_btu TEXT,
  cooling_tons DOUBLE PRECISION,
  suite TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenants (
  id BIGSERIAL PRIMARY KEY,
  building_id BIGINT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE utilities (
  id BIGSERIAL PRIMARY KEY,
  utility_type utility_type NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE polygons (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT NOT NULL DEFAULT '#60a5fa',
  paths JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app_settings (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_buildings_park ON buildings(park);
CREATE INDEX idx_buildings_cluster ON buildings(cluster);
CREATE INDEX idx_buildings_manager ON buildings(manager);
CREATE INDEX idx_rtus_building_id ON rtus(building_id);
CREATE INDEX idx_tenants_building_id ON tenants(building_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER buildings_updated_at BEFORE UPDATE ON buildings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER rtus_updated_at BEFORE UPDATE ON rtus
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER utilities_updated_at BEFORE UPDATE ON utilities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER polygons_updated_at BEFORE UPDATE ON polygons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER app_settings_updated_at BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rtus ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE utilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE polygons ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read buildings" ON buildings FOR SELECT USING (true);
CREATE POLICY "Auth write buildings" ON buildings FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Public read rtus" ON rtus FOR SELECT USING (true);
CREATE POLICY "Auth write rtus" ON rtus FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Public read tenants" ON tenants FOR SELECT USING (true);
CREATE POLICY "Auth write tenants" ON tenants FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Public read utilities" ON utilities FOR SELECT USING (true);
CREATE POLICY "Auth write utilities" ON utilities FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Public read polygons" ON polygons FOR SELECT USING (true);
CREATE POLICY "Auth write polygons" ON polygons FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Public read app_settings" ON app_settings FOR SELECT USING (true);
CREATE POLICY "Auth write app_settings" ON app_settings FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
