-- v7 (VTech, 2026-11-04). No temp tables (Supabase SQL editor).
-- 1. Send-reminder page is grouped in 3 sections (All dependencies · VTECH dependencies · Other agency);
--    "All dependencies" now also offers Electrician and Carpenter (Hansal's sketch).
-- 2. Every project edit needs: who requested it, when, a reference (email / call / meeting / other) and a reason of >= 10 words.
-- 3. BOQ history: every product added / removed / changed in a room is logged (boq_events), linked to the change request when
--    it was made through edit_boq(). Vipul exports both logs from the app.

-- ── 1. reminder sections ──
alter table public.reminder_categories add column section text not null default 'all'
  check (section in ('all', 'vtech', 'other'));
update public.reminder_categories set section = 'vtech' where key in ('installer', 'programmer', 'sales');
update public.reminder_categories set section = 'other' where key in ('electrical', 'carpentry');
insert into public.reminder_category_recipients (category_key, agency_type_id, default_checked, sort)
select 'all', t.id, true, v.sort
  from (values ('Electrician', 6), ('Carpenter', 7)) v(name, sort)
  join public.agency_types t on t.name = v.name
on conflict do nothing;
-- display order inside "All dependencies": Client, PMC, Electrician, Carpenter, Sales, Installers, Programmers
update public.reminder_category_recipients r set sort = v.sort
  from (values ('Client', 1), ('PMC / Architect / Client person', 2), ('Electrician', 3), ('Carpenter', 4),
               ('VTECH Sales Team', 5), ('VTech Installers', 6), ('VTech Programmers', 7)) v(name, sort),
       public.agency_types t
 where r.category_key = 'all' and t.id = r.agency_type_id and t.name = v.name;

-- ── 2. change requests ──
alter table public.project_changes
  add column requested_at   timestamptz not null default now(),
  add column reference_type text check (reference_type in ('email', 'call', 'meeting', 'other')),
  add column reference      text check (length(reference) <= 5000),
  add column kind           text not null default 'project' check (kind in ('project', 'boq'));
-- New rows only (NOT VALID keeps older short reasons): at least 10 words, and a reference.
alter table public.project_changes add constraint project_changes_reason_10_words
  check (coalesce(array_length(regexp_split_to_array(trim(reason), '\s+'), 1), 0) >= 10) not valid;
alter table public.project_changes add constraint project_changes_reference_given
  check (reference_type is not null and length(trim(coalesce(reference, ''))) > 0) not valid;

-- ── 3. BOQ history ──
create table public.boq_events (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  room_product_id  uuid,                         -- no FK: the row survives the product's removal
  change_id        uuid references public.project_changes (id),
  event            text not null check (event in ('added', 'removed', 'changed')),
  product          text not null,
  floor            text,
  room             text,
  location         text,
  quantity         int,
  details          jsonb not null default '{}'::jsonb,   -- for 'changed': { field: { from, to } }
  by_user          uuid references public.profiles (id) default auth.uid(),
  at               timestamptz not null default now()
);
create index boq_events_project_idx on public.boq_events (project_id, at desc);
alter table public.boq_events enable row level security;
create policy boq_events_read on public.boq_events for select to authenticated using (public.can_access_project(project_id));
-- written only by the trigger below (runs as the user; insert allowed on accessible projects)
create policy boq_events_insert on public.boq_events for insert to authenticated with check (public.can_access_project(project_id));
grant select, insert on public.boq_events to authenticated;

create function public.log_boq_event() returns trigger
language plpgsql security invoker set search_path = public as $$
declare r public.room_products; ev text; title text; fl text; rm text; d jsonb := '{}'::jsonb;
        cid uuid := nullif(current_setting('app.change_id', true), '')::uuid;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  -- project being deleted (cascade): nothing to log
  if tg_op = 'DELETE' and not exists (select 1 from public.projects where id = r.project_id) then return old; end if;
  ev := case tg_op when 'INSERT' then 'added' when 'DELETE' then 'removed' else 'changed' end;
  if tg_op = 'UPDATE' then
    if new.location is distinct from old.location then d := d || jsonb_build_object('location', jsonb_build_object('from', old.location, 'to', new.location)); end if;
    if new.quantity is distinct from old.quantity then d := d || jsonb_build_object('quantity', jsonb_build_object('from', old.quantity, 'to', new.quantity)); end if;
    if new.room_id  is distinct from old.room_id  then d := d || jsonb_build_object('room_id',  jsonb_build_object('from', old.room_id,  'to', new.room_id));  end if;
    if d = '{}'::jsonb then return new; end if;   -- validation stamps etc. are not BOQ changes
  end if;
  select coalesce(pc.title, r.boq_title, 'Product') into title from (select 1) x left join public.product_catalogue pc on pc.id = r.product_id;
  select f.label, ro.name into fl, rm from public.rooms ro join public.floors f on f.id = ro.floor_id where ro.id = r.room_id;
  insert into public.boq_events (project_id, room_product_id, change_id, event, product, floor, room, location, quantity, details)
  values (r.project_id, r.id, cid, ev, title, fl, rm, r.location, r.quantity, d);
  return r;
end $$;
create trigger room_products_boq_log after insert or update or delete on public.room_products
  for each row execute function public.log_boq_event();

-- Edit the BOQ of a project as one logged change request.
-- p_add:    [{ "room_id": uuid|null, "product_id": uuid, "location": text, "quantity": int }]
-- p_remove: room_products ids
create function public.edit_boq(
  p_project uuid, p_add jsonb, p_remove uuid[],
  p_requested_by text, p_requested_at timestamptz, p_reason text, p_reference_type text, p_reference text
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare cid uuid; a jsonb; rid uuid;
begin
  if coalesce(jsonb_array_length(p_add), 0) = 0 and coalesce(array_length(p_remove, 1), 0) = 0 then
    raise exception 'nothing to change';
  end if;
  insert into public.project_changes (project_id, requested_by, requested_at, reason, reference_type, reference, kind, changes)
  values (p_project, p_requested_by, coalesce(p_requested_at, now()), p_reason, p_reference_type, p_reference, 'boq',
          jsonb_build_object('added', coalesce(jsonb_array_length(p_add), 0), 'removed', coalesce(array_length(p_remove, 1), 0)))
  returning id into cid;
  perform set_config('app.change_id', cid::text, true);
  for a in select * from jsonb_array_elements(coalesce(p_add, '[]'::jsonb)) loop
    perform public.add_room_product(p_project, nullif(a->>'room_id', '')::uuid, (a->>'product_id')::uuid,
                                    a->>'location', coalesce((a->>'quantity')::int, 1), null);
  end loop;
  foreach rid in array coalesce(p_remove, '{}') loop
    if not exists (select 1 from public.room_products where id = rid and project_id = p_project) then
      raise exception 'product % is not in this project', rid;
    end if;
    perform public.remove_room_product(rid);
  end loop;
  perform set_config('app.change_id', '', true);
  return cid;
end $$;
revoke all on function public.edit_boq(uuid, jsonb, uuid[], text, timestamptz, text, text, text) from public, anon;
grant execute on function public.edit_boq(uuid, jsonb, uuid[], text, timestamptz, text, text, text) to authenticated;

-- Existing products get one "added" row each so the history starts complete (dated when they were placed).
insert into public.boq_events (project_id, room_product_id, event, product, floor, room, location, quantity, by_user, at)
select rp.project_id, rp.id, 'added', coalesce(pc.title, rp.boq_title, 'Product'), f.label, r.name, rp.location, rp.quantity, rp.created_by, rp.created_at
  from public.room_products rp
  left join public.product_catalogue pc on pc.id = rp.product_id
  join public.rooms r  on r.id = rp.room_id
  join public.floors f on f.id = r.floor_id;
