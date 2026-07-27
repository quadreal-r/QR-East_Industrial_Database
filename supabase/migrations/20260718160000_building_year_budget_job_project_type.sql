-- Capex Job Project Type on building-year pots (shown on Cost Center source notes).
alter table public.building_year_budgets
  add column if not exists capex_job_project_type text;

comment on column public.building_year_budgets.capex_job_project_type is
  'Capex Items Job Project Type (e.g. HVAC) for the pot source note.';
