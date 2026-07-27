-- Building-level Capex budgets by calendar year.
-- RTU budgets (rtus.budget) remain user allocations drawn from these pots.

CREATE TABLE IF NOT EXISTS building_year_budgets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  building_id BIGINT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  year INTEGER NOT NULL CHECK (year >= 2000 AND year <= 2100),
  budget NUMERIC NOT NULL CHECK (budget >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (building_id, year)
);

CREATE INDEX IF NOT EXISTS idx_building_year_budgets_building_id
  ON building_year_budgets (building_id);

CREATE TRIGGER building_year_budgets_updated_at
  BEFORE UPDATE ON building_year_budgets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE building_year_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read building_year_budgets"
  ON building_year_budgets FOR SELECT USING (true);

CREATE POLICY "Auth write building_year_budgets"
  ON building_year_budgets FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
