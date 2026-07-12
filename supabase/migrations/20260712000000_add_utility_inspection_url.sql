-- Tour URL for electrical / sprinkler room 360° gates (same pattern as tenants.inspection_url).
alter table public.utilities
  add column if not exists inspection_url text;
