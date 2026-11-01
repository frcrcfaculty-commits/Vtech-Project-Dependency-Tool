-- 0009: VTech Project Dependency Tracker v4 — Dashboard (Hansal, 2026-11-01).
--
-- 1. Gate (replaces the v3 rule). Per placed product, in sheet order:
--    • every GREEN step (phase 1) is open at once;
--    • after all greens are Done/N.A., the remaining steps open ONE AT A TIME, in sequence
--      (the next one appears "in the same space" when the previous is Done/N.A.).
-- 2. Project triggers (sheet rows 34–35):
--    • "iPhone programming" opens when ≥ 50 % of the BOQ quantity is in the installation phase
--      (all green steps of the line Done/N.A.);
--    • "Client Side" opens when ≥ 80 % of all programming steps (light-red F4CCCC) are Done/N.A.
-- 3. Two-state status in the UI: Done (✓) or not done (✗). Marking ✗ stores WHY (stuck_reason), from the
--    "HansalV2" tab when the sheet lists reasons for that step, otherwise free text.
-- 4. BOQ fields on placed products (brand, make, model, the BOQ's own product name), BOQ products that are not
--    in the catalogue (product_id null; the PM adds their steps by hand), and location validation when the BOQ
--    location is not one of the catalogue's usual locations.
-- 5. Projects can be 'finished'; every project edit is logged with why and who asked for it (project_changes).
-- 6. Catalogue fixes from the sheet re-read on 2026-11-01: Client Side "Special prog." belongs to the programmers,
--    "AMC team intro" to the VTech project managers.

-- ── 5. project status + change log ──
do $$ declare c text; begin
  for c in select conname from pg_constraint
            where conrelid = 'public.projects'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%' loop
    execute format('alter table public.projects drop constraint %I', c);
  end loop;
end $$;
alter table public.projects add constraint projects_status_check check (status in ('active', 'on_hold', 'closed', 'finished'));

create table public.project_changes (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  changed_by    uuid references public.profiles (id) default auth.uid(),
  requested_by  text not null check (length(trim(requested_by)) > 0),
  reason        text not null check (length(trim(reason)) > 0),
  changes       jsonb not null default '[]'::jsonb,   -- [{ "what": "Client name", "from": "...", "to": "..." }, ...]
  created_at    timestamptz not null default now()
);
create index project_changes_project_idx on public.project_changes (project_id, created_at desc);
alter table public.project_changes enable row level security;
create policy project_changes_read on public.project_changes for select to authenticated using (public.can_access_project(project_id));
create policy project_changes_insert on public.project_changes for insert to authenticated
  with check (public.can_access_project(project_id) and changed_by = auth.uid());
-- The log is append-only: no update or delete policy.

-- ── 4. BOQ fields, unmatched products, location validation ──
alter table public.room_products alter column product_id drop not null;
alter table public.room_products
  add column boq_title text,
  add column brand text,
  add column make text,
  add column model text,
  add column location_validated_at timestamptz,
  add column location_validated_by uuid references public.profiles (id),
  add constraint room_products_title_check check (product_id is not null or length(trim(coalesce(boq_title, ''))) > 0);

-- Steps the PM adds by hand (for BOQ products not in the catalogue) carry their own order and colour.
alter table public.dependency_items
  add column step_label text,
  add column step_seq int,
  add column step_phase int check (step_phase in (1, 2)),
  add column step_colour text,
  add column stuck_reason text;
alter table public.item_events add column reason text;

-- ── 3. reasons a step is stuck (sheet tab "HansalV2") ──
create table public.step_reasons (
  id            uuid primary key default gen_random_uuid(),
  step_prefix   text not null,          -- matches product_steps.label case-insensitively by prefix
  reason        text not null,
  agency_type   text,                   -- whose work it is; the item is re-assigned to that agency when the project has one
  sort          int  not null default 0,
  unique (step_prefix, reason)
);
alter table public.step_reasons enable row level security;
create policy step_reasons_read  on public.step_reasons for select to authenticated using (true);
create policy step_reasons_write on public.step_reasons for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.step_reasons (step_prefix, reason, agency_type, sort) values
  ('Engraving submitted',   'Yet not prepared by VTECH',                          'VTech Project Managers', 1),
  ('Engraving submitted',   'Given to client/ architect approval awaited',        'Architect', 2),
  ('Engraving submitted',   'Given to client/ architect -Final approval awaited', 'Architect', 3),
  ('Delivery pending',      'Client approval awaited',                            'Client', 1),
  ('Delivery pending',      'Sales Clearance awaited',                            'VTech Project Managers', 2),
  ('Delivery pending',      'Stock purchase awaited',                             'VTech Project Managers', 3),
  ('Readiness to install',  'Work pending from Carpentar side',                   'Carpenter', 1),
  ('Readiness to install',  'Work pending from electrician',                      'Electrician', 2),
  ('Readiness to install',  'Approval pending from PMC/Architect/Client',         'Architect', 3),
  ('Readiness of dustfree', 'Site cleaning awaited',                              'Painter', 1),
  ('Readiness of cable',    'Work pending from electrician',                      'Electrician', 1),
  ('Readiness of cable',    'Work pending from Carpentar side',                   'Carpenter', 2),
  ('Readiness of cable',    'Approval pending from PMC/Architect/Client',         'Architect', 3)
on conflict do nothing;

-- ── 6. catalogue fixes ──
update public.product_steps s set responsibility = 'internal', sheet_colour = 'F4CCCC',
       default_agency_type_id = (select id from public.agency_types where name = 'VTech Programmers')
  from public.product_catalogue p
 where p.id = s.product_id and p.title = 'Client Side' and s.label = 'Special programming';
update public.product_steps s set responsibility = 'internal', sheet_colour = 'F9CB9C',
       default_agency_type_id = (select id from public.agency_types where name = 'VTech Project Managers')
  from public.product_catalogue p
 where p.id = s.product_id and p.title = 'Client Side' and s.label = 'AMC team intro';
update public.dependency_items i set responsibility = 'internal'
  from public.product_steps s join public.product_catalogue p on p.id = s.product_id
 where i.step_id = s.id and p.title = 'Client Side' and s.label in ('Special programming', 'AMC team intro');

-- ── 1 + 2. the gate ──
-- Per project: share of BOQ quantity that has reached installation, and share of programming steps done.
create view public.project_progress with (security_invoker = true) as
with lines as (
  select rp.id, rp.project_id, rp.quantity, pc.title,
         not exists (select 1 from public.dependency_items j
                      left join public.product_steps sj on sj.id = j.step_id
                      where j.room_product_id = rp.id and coalesce(sj.phase, j.step_phase) = 1
                        and j.status not in ('complete', 'na')) as in_installation
    from public.room_products rp
    left join public.product_catalogue pc on pc.id = rp.product_id
   where coalesce(pc.scope, 'room') = 'room'
), prog as (
  select j.project_id,
         count(*)                                                as total,
         count(*) filter (where j.status in ('complete', 'na'))  as done
    from public.dependency_items j
    join public.product_steps sj on sj.id = j.step_id
    join public.product_catalogue pj on pj.id = sj.product_id
   where sj.sheet_colour = 'F4CCCC' and pj.title not in ('Client Side')
   group by j.project_id
)
select p.id as project_id,
       coalesce((select sum(quantity) from lines l where l.project_id = p.id), 0)                        as boq_qty,
       coalesce((select sum(quantity) from lines l where l.project_id = p.id and l.in_installation), 0)  as installation_qty,
       coalesce(prog.total, 0) as programming_total,
       coalesce(prog.done, 0)  as programming_done,
       case when coalesce((select sum(quantity) from lines l where l.project_id = p.id), 0) = 0 then 0
            else round(100.0 * (select sum(quantity) from lines l where l.project_id = p.id and l.in_installation)
                       / (select sum(quantity) from lines l where l.project_id = p.id), 1) end            as installation_pct,
       case when coalesce(prog.total, 0) = 0 then 0 else round(100.0 * prog.done / prog.total, 1) end    as programming_pct
  from public.projects p
  left join prog on prog.project_id = p.id;

drop function if exists public.item_is_locked(uuid);
drop view if exists public.item_gate;

create view public.item_gate with (security_invoker = true) as
with base as (
  select i.id as item_id, i.project_id, i.room_id, i.room_product_id, i.status, i.agency_id, i.stuck_reason, i.note,
         i.first_raised_on, i.completed_on, i.reminder_count,
         s.id as step_id,
         coalesce(s.seq, i.step_seq, 999)                                  as seq,
         coalesce(s.label, i.step_label, pd.text)                          as label,
         coalesce(s.phase, i.step_phase, 2)                                as phase,
         coalesce(s.responsibility, i.responsibility, 'external')          as responsibility,
         coalesce(s.gate, 'after_previous')                                as gate,
         coalesce(s.sheet_colour, i.step_colour, case when coalesce(s.phase, i.step_phase, 2) = 1 then 'D9EAD3' else 'E06666' end)
                                                                           as sheet_colour,
         coalesce(pc.title, rp.boq_title)                                  as title,
         rp.location, rp.quantity, pc.title as catalogue_title,
         coalesce(t.name = 'Client', false)                                as waits_on_client
    from public.dependency_items i
    join public.room_products rp            on rp.id = i.room_product_id
    left join public.product_steps s        on s.id = i.step_id
    left join public.product_catalogue pc   on pc.id = rp.product_id
    left join public.project_dependencies pd on pd.id = i.project_dependency_id
    left join public.agencies a             on a.id = i.agency_id
    left join public.agency_types t         on t.id = coalesce(a.agency_type_id, s.default_agency_type_id)
), flags as (
  select b.*,
         exists (select 1 from base g where g.room_product_id = b.room_product_id and g.phase = 1
                   and g.status not in ('complete', 'na'))                                    as greens_open,
         exists (select 1 from base e where e.room_product_id = b.room_product_id and e.phase = 2
                   and (e.seq, e.item_id) < (b.seq, b.item_id) and e.status not in ('complete', 'na')) as earlier_open,
         case b.catalogue_title
           when 'iPhone programming' then coalesce((select pp.installation_pct < 50 from public.project_progress pp where pp.project_id = b.project_id), true)
           when 'Client Side'        then coalesce((select pp.programming_pct  < 80 from public.project_progress pp where pp.project_id = b.project_id), true)
           else false
         end as waiting_trigger
    from base b
)
select item_id, project_id, room_id, room_product_id, status, agency_id, stuck_reason, note, first_raised_on, completed_on,
       reminder_count, step_id, seq, label, phase, responsibility, gate, sheet_colour, title, location, quantity, catalogue_title,
       waits_on_client, waiting_trigger,
       case
         when status in ('complete', 'na') then false
         when waiting_trigger then true
         when phase = 1 then false
         when greens_open or earlier_open then true
         else false
       end as locked
  from flags;

create function public.item_is_locked(p_item uuid) returns boolean
language sql stable security invoker set search_path = public as $$
  select coalesce((select locked from public.item_gate where item_id = p_item), false)
$$;

-- ── 3. set_item_status gains the stuck reason (and re-assigns the waiting agency from the reason) ──
drop function if exists public.set_item_status(uuid, public.item_status, date, text, text);
create function public.set_item_status(
  p_item uuid, p_status public.item_status, p_date date default null, p_note text default null, p_photo text default null,
  p_reason text default null
) returns public.dependency_items
language plpgsql security invoker set search_path = public as $$
declare i public.dependency_items; d date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
        new_agency uuid; why text := nullif(trim(p_reason), '');
begin
  if p_status = 'unchecked' then raise exception 'status must be pending, complete or na'; end if;
  select * into i from public.dependency_items where id = p_item for update;
  if not found then raise exception 'item not found or no access'; end if;
  if p_status in ('pending', 'complete') and public.item_is_locked(p_item) then
    raise exception 'locked: finish the earlier steps of this product first';
  end if;

  if p_status = 'pending' and why is not null then
    select a.id into new_agency
      from public.step_reasons r
      join public.agency_types t on lower(t.name) = lower(r.agency_type)
      join public.agencies a on a.agency_type_id = t.id and a.project_id = i.project_id
      left join public.product_steps s on s.id = i.step_id
     where lower(r.reason) = lower(why)
       and lower(coalesce(s.label, '')) like lower(r.step_prefix) || '%'
     order by a.created_at limit 1;
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
    stuck_reason    = case when p_status = 'pending' then coalesce(why, i.stuck_reason) else null end,
    agency_id       = coalesce(new_agency, i.agency_id),
    updated_by      = auth.uid(),
    updated_at      = now()
  where id = p_item
  returning * into i;

  insert into public.item_events (project_id, item_id, status, status_date, note, photo_path, source, reason)
  values (i.project_id, i.id, p_status, d, p_note, p_photo, 'office', why);
  return i;
end $$;

-- ── 4. a BOQ line that is not in the catalogue, and its hand-made steps ──
create function public.add_boq_line(
  p_project uuid, p_room uuid, p_title text, p_location text default null, p_quantity int default 1,
  p_brand text default null, p_make text default null, p_model text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare pid uuid; rp uuid;
begin
  select id into pid from public.product_catalogue where active and lower(title) = lower(trim(p_title));
  if pid is not null then
    rp := public.add_room_product(p_project, p_room, pid, p_location, p_quantity, null);
  else
    if p_room is null or not exists (select 1 from public.rooms where id = p_room and project_id = p_project) then
      raise exception 'room not found or no access';
    end if;
    insert into public.room_products (project_id, room_id, product_id, boq_title, location, quantity)
    values (p_project, p_room, null, trim(p_title), nullif(trim(p_location), ''), coalesce(p_quantity, 1)) returning id into rp;
  end if;
  update public.room_products set boq_title = coalesce(boq_title, trim(p_title)), brand = nullif(trim(p_brand), ''),
         make = nullif(trim(p_make), ''), model = nullif(trim(p_model), '') where id = rp;
  return rp;
end $$;

create function public.add_custom_step(
  p_room_product uuid, p_label text, p_phase int default 2, p_responsibility text default 'external', p_agency uuid default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare rp public.room_products; pd uuid; it uuid; nseq int;
begin
  select * into rp from public.room_products where id = p_room_product;
  if not found then raise exception 'not found or no access'; end if;
  if length(trim(coalesce(p_label, ''))) = 0 then raise exception 'step name is required'; end if;
  if p_phase not in (1, 2) then raise exception 'phase must be 1 (green, before installation) or 2'; end if;
  select coalesce(max(coalesce(s.seq, i.step_seq)), 0) + 1 into nseq
    from public.dependency_items i left join public.product_steps s on s.id = i.step_id where i.room_product_id = rp.id;
  insert into public.project_dependencies (project_id, agency_type_id, text, seq)
  values (rp.project_id, coalesce((select agency_type_id from public.agencies where id = p_agency),
                                  (select id from public.agency_types where name = 'VTech Project Managers')),
          coalesce((select title from public.product_catalogue where id = rp.product_id), rp.boq_title)
            || coalesce(' (' || rp.location || ')', '') || ' – ' || trim(p_label), nseq)
  returning id into pd;
  insert into public.dependency_items (project_id, room_id, project_dependency_id, agency_id, room_product_id, responsibility,
                                       step_label, step_seq, step_phase, step_colour)
  values (rp.project_id, rp.room_id, pd, p_agency, rp.id, p_responsibility, trim(p_label), nseq, p_phase,
          case when p_phase = 1 then 'D9EAD3' when p_responsibility = 'internal' then 'E06666' else 'C9DAF8' end)
  returning id into it;
  return it;
end $$;

-- Location check against the catalogue's usual locations ("Other" in the sheet means anything goes).
create view public.location_checks with (security_invoker = true) as
select rp.id as room_product_id, rp.project_id, rp.room_id, rp.location, pc.title, pc.location_options,
       rp.location_validated_at,
       case
         when pc.id is null then 'not_in_catalogue'
         when rp.location is null or cardinality(pc.location_options) = 0 then 'ok'
         when exists (select 1 from unnest(pc.location_options) o
                       where lower(trim(o)) = 'other'
                          or lower(rp.location) like '%' || lower(trim(o)) || '%'
                          or lower(trim(o)) like '%' || lower(rp.location) || '%') then 'ok'
         else 'mismatch'
       end as check_result
  from public.room_products rp
  left join public.product_catalogue pc on pc.id = rp.product_id;

grant select on public.project_progress, public.item_gate, public.location_checks to authenticated;
