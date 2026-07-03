-- Schedule columns on rtus, pricing table, picture/document metadata tables

ALTER TABLE buildings ADD COLUMN IF NOT EXISTS sold BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE rtus
  ADD COLUMN IF NOT EXISTS replacement_year INTEGER NULL,
  ADD COLUMN IF NOT EXISTS replacement_note TEXT NULL;

CREATE TABLE rtu_pricing (
  id BIGSERIAL PRIMARY KEY,
  tonnage_key DOUBLE PRECISION NOT NULL UNIQUE,
  label TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  supply_std NUMERIC NOT NULL DEFAULT 0,
  supply_hyb NUMERIC NOT NULL DEFAULT 0,
  install NUMERIC NOT NULL DEFAULT 0,
  consulting NUMERIC NOT NULL DEFAULT 0,
  structural NUMERIC NOT NULL DEFAULT 0,
  service_balancing NUMERIC NOT NULL DEFAULT 0,
  electrical NUMERIC NOT NULL DEFAULT 0,
  miscellaneous NUMERIC NOT NULL DEFAULT 0,
  supervisory_mult NUMERIC NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rtu_pictures (
  id BIGSERIAL PRIMARY KEY,
  rtu_id BIGINT NULL REFERENCES rtus(id) ON DELETE SET NULL,
  building_address TEXT NOT NULL,
  rtu_name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (building_address, rtu_name, file_name)
);

CREATE TABLE rtu_documents (
  id BIGSERIAL PRIMARY KEY,
  rtu_id BIGINT NULL REFERENCES rtus(id) ON DELETE SET NULL,
  building_address TEXT NOT NULL,
  rtu_name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  title TEXT NULL,
  doc_type TEXT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (building_address, rtu_name, file_name)
);

CREATE INDEX idx_rtu_pictures_rtu_id ON rtu_pictures(rtu_id);
CREATE INDEX idx_rtu_pictures_building_address ON rtu_pictures(building_address);
CREATE INDEX idx_rtu_documents_rtu_id ON rtu_documents(rtu_id);
CREATE INDEX idx_rtu_documents_building_address ON rtu_documents(building_address);
CREATE INDEX idx_rtu_pricing_position ON rtu_pricing(position);

CREATE TRIGGER rtu_pricing_updated_at BEFORE UPDATE ON rtu_pricing
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER rtu_pictures_updated_at BEFORE UPDATE ON rtu_pictures
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER rtu_documents_updated_at BEFORE UPDATE ON rtu_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE rtu_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE rtu_pictures ENABLE ROW LEVEL SECURITY;
ALTER TABLE rtu_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read rtu_pricing" ON rtu_pricing FOR SELECT USING (true);
CREATE POLICY "Auth write rtu_pricing" ON rtu_pricing FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Public read rtu_pictures" ON rtu_pictures FOR SELECT USING (true);
CREATE POLICY "Auth write rtu_pictures" ON rtu_pictures FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Public read rtu_documents" ON rtu_documents FOR SELECT USING (true);
CREATE POLICY "Auth write rtu_documents" ON rtu_documents FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
