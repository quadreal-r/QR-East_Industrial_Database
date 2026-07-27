-- Capex pot source note (e.g. Capex Description that funded this year).
ALTER TABLE building_year_budgets
  ADD COLUMN IF NOT EXISTS note text;

COMMENT ON COLUMN building_year_budgets.note IS
  'Source Capex Description(s) for this building-year pot';
