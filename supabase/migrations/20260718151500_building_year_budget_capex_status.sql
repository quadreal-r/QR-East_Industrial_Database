ALTER TABLE building_year_budgets
  ADD COLUMN IF NOT EXISTS capex_status text;

COMMENT ON COLUMN building_year_budgets.capex_status IS
  'Capex Status for the source note (Approved, Submitted, Rejected)';
