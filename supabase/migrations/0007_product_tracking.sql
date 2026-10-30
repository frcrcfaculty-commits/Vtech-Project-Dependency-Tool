-- Product tracking (VTech change request, 2026-10-30, sheet rev. 11:50).
-- Rooms get PRODUCTS VTech sells (sheet "Ashutosh Project Status" → tab "Hansal": Products, Location, Dependency 1..14).
-- Each product carries a fixed chain of steps. Colour legend (rows 36-40):
--   green  → other agencies   (phase 1: all open at once)
--   blue   → other agencies   (phase 2)
--   dark red → VTech Installers, light red → VTech Programmers, orange → VTech Project managers (internal, phase 2)
-- ALL phase-2 steps unlock together once EVERY green step of that product is Done or N.A. (gate 'after_external').
-- 'after_previous' (sequential) is supported for catalogue edits but not used by the sheet.
-- Steps assigned to the project's Client agency are reported, never chased by reminder.
-- Additive: the master-list flow (0006) and the classic visit flow keep working.

-- ── internal team ──
alter table public.agency_types add column internal boolean not null default false;
update public.agency_types set internal = true where name = 'VTech';
insert into public.agency_types (name, sort, internal) values
  ('VTech Installers', 20, true), ('VTech Programmers', 21, true), ('VTech Project Managers', 22, true)
on conflict do nothing;

-- ── catalogue ──
create table public.product_catalogue (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  scope             text not null default 'room' check (scope in ('room', 'project')),
  location_options  text[] not null default '{}',
  sort              int  not null default 0,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);
create unique index product_catalogue_title_uq on public.product_catalogue (lower(title));

create table public.product_steps (
  id                      uuid primary key default gen_random_uuid(),
  product_id              uuid not null references public.product_catalogue (id) on delete cascade,
  seq                     int  not null,
  label                   text not null,
  phase                   int  not null check (phase in (1, 2)),
  responsibility          text not null check (responsibility in ('external', 'internal', 'client')),
  gate                    text not null default 'none' check (gate in ('none', 'after_external', 'after_previous')),
  default_agency_type_id  uuid not null references public.agency_types (id),
  sheet_colour            text,
  unique (product_id, seq)
);

alter table public.product_catalogue enable row level security;
alter table public.product_steps     enable row level security;
create policy product_catalogue_read  on public.product_catalogue for select to authenticated using (true);
create policy product_catalogue_write on public.product_catalogue for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy product_steps_read      on public.product_steps     for select to authenticated using (true);
create policy product_steps_write     on public.product_steps     for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── products placed in rooms ──
create table public.room_products (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null,
  room_id     uuid not null,
  product_id  uuid not null references public.product_catalogue (id),
  location    text,
  quantity    int  not null default 1 check (quantity >= 1),
  note        text,
  created_by  uuid references public.profiles (id) default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (id, project_id),
  foreign key (room_id, project_id) references public.rooms (id, project_id) on delete cascade
);
alter table public.room_products enable row level security;
create policy room_products_project_access on public.room_products for all to authenticated
  using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));

alter table public.project_dependencies add column step_id uuid references public.product_steps (id);
alter table public.dependency_items add column room_product_id uuid;
alter table public.dependency_items add column step_id uuid references public.product_steps (id);
alter table public.dependency_items add column responsibility text check (responsibility in ('external', 'internal', 'client'));
alter table public.dependency_items add constraint dependency_items_room_product_fk
  foreign key (room_product_id, project_id) references public.room_products (id, project_id) on delete cascade;
create index dependency_items_room_product_idx on public.dependency_items (room_product_id);

-- ── gate: which product steps are locked right now ──
create view public.item_gate with (security_invoker = true) as
select i.id as item_id, i.project_id, i.room_id, i.room_product_id, i.status,
       s.id as step_id, s.seq, s.label, s.phase, s.responsibility, s.gate,
       pc.title, rp.location,
       coalesce(t.name = 'Client', false) as waits_on_client,
       case
         when s.phase = 1 or i.status in ('complete', 'na') then false
         when exists (select 1 from public.dependency_items j join public.product_steps sj on sj.id = j.step_id
                       where j.room_product_id = i.room_product_id and sj.phase = 1
                         and j.status not in ('complete', 'na')) then true
         when s.gate = 'after_previous' and exists (
                select 1 from public.dependency_items j join public.product_steps sj on sj.id = j.step_id
                 where j.room_product_id = i.room_product_id and sj.phase = 2 and sj.seq < s.seq
                   and j.status not in ('complete', 'na')) then true
         else false
       end as locked
  from public.dependency_items i
  join public.product_steps s       on s.id = i.step_id
  join public.room_products rp      on rp.id = i.room_product_id
  join public.product_catalogue pc  on pc.id = rp.product_id
  left join public.agencies a       on a.id = i.agency_id
  left join public.agency_types t   on t.id = coalesce(a.agency_type_id, s.default_agency_type_id);

create function public.item_is_locked(p_item uuid) returns boolean
language sql stable security invoker set search_path = public as $$
  select coalesce((select locked from public.item_gate where item_id = p_item), false)
$$;

-- A project-wide room for products with scope 'project' (iPhone programming, client handover).
create function public.project_wide_room(p_project uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare f uuid; r uuid;
begin
  select id into f from public.floors where project_id = p_project and label = 'Project-wide';
  if f is null then
    insert into public.floors (project_id, label, sort) values (p_project, 'Project-wide', 9999) returning id into f;
  end if;
  select id into r from public.rooms where floor_id = f and name = 'Handover & client';
  if r is null then
    insert into public.rooms (project_id, floor_id, name, sort) values (p_project, f, 'Handover & client', 1) returning id into r;
  end if;
  return r;
end $$;

-- Place a product in a room: creates its full step chain as dependency items (status unchecked).
-- p_room may be null for a project-scope product (goes to the project-wide room).
create function public.add_room_product(
  p_project uuid, p_room uuid, p_product uuid, p_location text default null, p_quantity int default 1, p_note text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare pc public.product_catalogue; room uuid := p_room; rp uuid; s record; pd uuid; loc text := nullif(trim(p_location), '');
begin
  select * into pc from public.product_catalogue where id = p_product and active;
  if not found then raise exception 'product not found'; end if;
  if room is null then
    if pc.scope <> 'project' then raise exception 'room is required for %', pc.title; end if;
    room := public.project_wide_room(p_project);
  end if;
  if not exists (select 1 from public.rooms where id = room and project_id = p_project) then
    raise exception 'room not found or no access';
  end if;

  insert into public.room_products (project_id, room_id, product_id, location, quantity, note)
  values (p_project, room, p_product, loc, coalesce(p_quantity, 1), p_note) returning id into rp;

  for s in select * from public.product_steps where product_id = p_product order by seq loop
    insert into public.project_dependencies (project_id, agency_type_id, text, seq, step_id)
    values (p_project, s.default_agency_type_id,
            pc.title || coalesce(' (' || loc || ')', '') || ' – ' || s.label, s.seq, s.id)
    returning id into pd;
    insert into public.dependency_items (project_id, room_id, project_dependency_id, agency_id, room_product_id, step_id, responsibility)
    values (p_project, room, pd,
            (select a.id from public.agencies a where a.project_id = p_project and a.agency_type_id = s.default_agency_type_id
              order by a.created_at limit 1),
            rp, s.id, s.responsibility);
  end loop;
  return rp;
end $$;

-- Remove a product (and its steps) from a room.
create function public.remove_room_product(p_room_product uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.room_products where id = p_room_product) then
    raise exception 'not found or no access';
  end if;
  delete from public.project_dependencies d
   using public.dependency_items i
   where i.room_product_id = p_room_product and d.id = i.project_dependency_id;
  delete from public.room_products where id = p_room_product;
end $$;

-- Status changes respect the gate (Done/Pending blocked while locked; N.A. always allowed).
create or replace function public.set_item_status(
  p_item uuid, p_status public.item_status, p_date date default null, p_note text default null, p_photo text default null
) returns public.dependency_items
language plpgsql security invoker set search_path = public as $$
declare i public.dependency_items; d date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
begin
  if p_status = 'unchecked' then raise exception 'status must be pending, complete or na'; end if;
  select * into i from public.dependency_items where id = p_item for update;
  if not found then raise exception 'item not found or no access'; end if;
  if p_status in ('pending', 'complete') and public.item_is_locked(p_item) then
    raise exception 'locked: finish the external (green) steps of this product first';
  end if;

  update public.dependency_items set
    status          = p_status,
    first_raised_on = case when p_status = 'pending' and i.status <> 'pending' then d
                           when p_status = 'pending' then coalesce(i.first_raised_on, d)
                           else i.first_raised_on end,
    reminder_count  = case when p_status = 'pending' and i.status <> 'pending' then 0 else i.reminder_count end,
    completed_on    = case when p_status = 'complete' then d else null end,
    note            = coalesce(p_note, i.note),
    photo_path      = coalesce(p_photo, i.photo_path),
    updated_by      = auth.uid(),
    updated_at      = now()
  where id = p_item
  returning * into i;

  insert into public.item_events (project_id, item_id, status, status_date, note, photo_path, source)
  values (i.project_id, i.id, p_status, d, p_note, p_photo, 'office');
  return i;
end $$;

-- copy_floor now also copies placed products (fresh, unchecked step chains).
create or replace function public.copy_floor(p_floor uuid, p_label text) returns uuid
language plpgsql security invoker set search_path = public as $$
declare f public.floors; nf uuid; rp record;
begin
  select * into f from public.floors where id = p_floor;
  if not found then raise exception 'floor not found or no access'; end if;

  insert into public.floors (project_id, label, sort)
  values (f.project_id, p_label,
          (select coalesce(max(sort), 0) + 1 from public.floors where project_id = f.project_id and label <> 'Project-wide'))
  returning id into nf;

  insert into public.rooms (project_id, floor_id, name, sort)
  select f.project_id, nf, name, sort from public.rooms where floor_id = p_floor;

  insert into public.dependency_items (project_id, room_id, project_dependency_id, agency_id)
  select f.project_id, nr.id, i.project_dependency_id, i.agency_id
    from public.dependency_items i
    join public.rooms r  on r.id = i.room_id and r.floor_id = p_floor
    join public.rooms nr on nr.floor_id = nf and nr.name = r.name
   where i.room_product_id is null;

  for rp in
    select x.product_id, x.location, x.quantity, x.note, nr.id as new_room
      from public.room_products x
      join public.rooms r  on r.id = x.room_id and r.floor_id = p_floor
      join public.rooms nr on nr.floor_id = nf and nr.name = r.name
     order by x.created_at
  loop
    perform public.add_room_product(f.project_id, rp.new_room, rp.product_id, rp.location, rp.quantity, rp.note);
  end loop;
  return nf;
end $$;

revoke all on function public.item_is_locked(uuid) from public, anon;
revoke all on function public.project_wide_room(uuid) from public, anon;
revoke all on function public.add_room_product(uuid, uuid, uuid, text, int, text) from public, anon;
revoke all on function public.remove_room_product(uuid) from public, anon;
grant execute on function public.item_is_locked(uuid) to authenticated;
grant execute on function public.project_wide_room(uuid) to authenticated;
grant execute on function public.add_room_product(uuid, uuid, uuid, text, int, text) to authenticated;
grant execute on function public.remove_room_product(uuid) to authenticated;
grant select on public.item_gate to authenticated;
