-- Remember whether a suite 360° gate still uses the auto facade position.
-- Existing gates default to true so they re-snap to the shortest exterior edge.
alter table public.tenants
  add column if not exists auto_placed boolean not null default true;
