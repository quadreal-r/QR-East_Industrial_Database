-- Per-RTU budget allocation for the RTU Replacement Cost estimator
-- (applied to remote 2026-07-16 as add_rtu_budget)

ALTER TABLE rtus ADD COLUMN IF NOT EXISTS budget NUMERIC NULL;
