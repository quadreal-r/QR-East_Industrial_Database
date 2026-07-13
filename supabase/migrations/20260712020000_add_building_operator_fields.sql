-- Building operator roster fields (from Excel "Building Operators" sheet).
alter table public.buildings
  add column if not exists building_operator text,
  add column if not exists operator_phone text,
  add column if not exists ops_manager text,
  add column if not exists gm_ops text,
  add column if not exists vp text;

comment on column public.buildings.building_operator is 'On-site building operator name';
comment on column public.buildings.operator_phone is 'Building operator phone';
comment on column public.buildings.ops_manager is 'Regional ops manager (e.g. Eldin Shima (West))';
comment on column public.buildings.gm_ops is 'GM Ops';
comment on column public.buildings.vp is 'VP';
