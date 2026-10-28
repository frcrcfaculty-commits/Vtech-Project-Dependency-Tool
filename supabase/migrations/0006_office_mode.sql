-- Office mode (Vipul, 2026-10-29): one PM lead in the office updates items whenever someone calls,
-- adds dependencies room by room as they surface, and sends reminders on demand.
-- Additive only: the site-visit flow (site_visits/visit_checks/finalize_visit) keeps working unchanged.

-- History of every status change, from either flow.
create table public.item_events (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null,
  item_id      uuid not null,
  status       public.item_status not null,
  status_date  date not null,
  note         text,
  photo_path   text,
  source       text not null default 'office' check (source in ('office', 'visit')),
  created_by   uuid references public.profiles (id) default auth.uid(),
  created_at   timestamptz not null default now(),
  foreign key (item_id, project_id) references public.dependency_items (id, project_id) on delete cascade
);
create index item_events_item_idx on public.item_events (item_id, created_at desc);
alter table public.item_events enable row level security;
create policy item_events_project_access on public.item_events for all to authenticated
  using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));

-- Reminders sent from the office hang off a lightweight "follow-up" visit so the existing
-- dispatch engine (one message per agency per channel, count once per send round) is reused as-is.
alter table public.site_visits add column kind text not null default 'site' check (kind in ('site', 'office'));

-- Set one item's status directly (office mode). Same episode rules as finalize_visit.
create function public.set_item_status(
  p_item uuid, p_status public.item_status, p_date date default null, p_note text default null, p_photo text default null
) returns public.dependency_items
language plpgsql security invoker set search_path = public as $$
declare i public.dependency_items; d date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
begin
  if p_status = 'unchecked' then raise exception 'status must be pending, complete or na'; end if;
  select * into i from public.dependency_items where id = p_item for update;
  if not found then raise exception 'item not found or no access'; end if;

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

-- Add dependencies to ONE room: any number of master items + any number of custom items.
-- p_custom: [{"agency_type_id": "...", "text": "..."}]. Custom items become project dependencies (promotable later).
-- p_initial_status: 'unchecked' (just applicable) or 'pending' (newly found problem, raised today).
create function public.add_room_dependencies(
  p_room uuid, p_master_ids uuid[] default '{}', p_custom jsonb default '[]'::jsonb,
  p_initial_status public.item_status default 'unchecked', p_date date default null
) returns int
language plpgsql security invoker set search_path = public as $$
declare r public.rooms; dep_ids uuid[]; c jsonb; new_dep uuid; n int := 0; item record;
begin
  if p_initial_status not in ('unchecked', 'pending') then raise exception 'initial status must be unchecked or pending'; end if;
  select * into r from public.rooms where id = p_room;
  if not found then raise exception 'room not found or no access'; end if;

  perform public.add_master_dependencies(r.project_id, coalesce(p_master_ids, '{}'));
  select coalesce(array_agg(id), '{}') into dep_ids
    from public.project_dependencies
   where project_id = r.project_id and master_dependency_id = any (coalesce(p_master_ids, '{}'));

  for c in select * from jsonb_array_elements(coalesce(p_custom, '[]'::jsonb)) loop
    if coalesce(trim(c->>'text'), '') = '' or c->>'agency_type_id' is null then
      raise exception 'custom dependency needs agency_type_id and text';
    end if;
    select id into new_dep from public.project_dependencies
     where project_id = r.project_id and master_dependency_id is null
       and agency_type_id = (c->>'agency_type_id')::uuid and lower(text) = lower(trim(c->>'text'));
    if new_dep is null then
      insert into public.project_dependencies (project_id, agency_type_id, text, seq)
      values (r.project_id, (c->>'agency_type_id')::uuid, trim(c->>'text'), 999)
      returning id into new_dep;
    end if;
    dep_ids := dep_ids || new_dep;
    new_dep := null;
  end loop;

  for item in
    insert into public.dependency_items (project_id, room_id, project_dependency_id, agency_id)
    select r.project_id, r.id, d.id,
           (select a.id from public.agencies a
             where a.project_id = r.project_id and a.agency_type_id = d.agency_type_id
             order by a.created_at limit 1)
      from public.project_dependencies d
     where d.id = any (dep_ids)
    on conflict (room_id, project_dependency_id) do nothing
    returning id
  loop
    n := n + 1;
    if p_initial_status = 'pending' then
      perform public.set_item_status(item.id, 'pending', p_date, null, null);
    end if;
  end loop;
  return n;
end $$;

-- Open a follow-up round for sending reminders from the office. Returns the visit id the dispatch API uses.
create function public.start_office_followup(p_project uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v uuid;
begin
  if not public.can_access_project(p_project) then raise exception 'project not found or no access'; end if;
  insert into public.site_visits (project_id, kind, status, finalized_at)
  values (p_project, 'office', 'finalized', now())
  returning id into v;
  return v;
end $$;

-- The site-visit flow now also writes history.
create or replace function public.finalize_visit(p_visit uuid) returns int
language plpgsql security invoker set search_path = public as $$
declare v public.site_visits; n int;
begin
  select * into v from public.site_visits where id = p_visit for update;
  if not found then raise exception 'visit not found or no access'; end if;
  if v.status <> 'draft' then raise exception 'visit already %', v.status; end if;

  update public.dependency_items i set
    status          = c.status,
    first_raised_on = case when c.status = 'pending' and i.status <> 'pending' then c.status_date
                           when c.status = 'pending' then coalesce(i.first_raised_on, c.status_date)
                           else i.first_raised_on end,
    reminder_count  = case when c.status = 'pending' and i.status <> 'pending' then 0
                           else i.reminder_count end,
    completed_on    = case when c.status = 'complete' then c.status_date else null end,
    note            = coalesce(c.note, i.note),
    photo_path      = coalesce(c.photo_path, i.photo_path),
    updated_by      = auth.uid(),
    updated_at      = now()
  from public.visit_checks c
  where c.visit_id = p_visit and c.item_id = i.id;
  get diagnostics n = row_count;

  insert into public.item_events (project_id, item_id, status, status_date, note, photo_path, source)
  select c.project_id, c.item_id, c.status, c.status_date, c.note, c.photo_path, 'visit'
    from public.visit_checks c where c.visit_id = p_visit;

  update public.site_visits set status = 'finalized', finalized_at = now() where id = p_visit;
  return n;
end $$;

revoke all on function public.set_item_status(uuid, public.item_status, date, text, text) from public, anon;
revoke all on function public.add_room_dependencies(uuid, uuid[], jsonb, public.item_status, date) from public, anon;
revoke all on function public.start_office_followup(uuid) from public, anon;
grant execute on function public.set_item_status(uuid, public.item_status, date, text, text) to authenticated;
grant execute on function public.add_room_dependencies(uuid, uuid[], jsonb, public.item_status, date) to authenticated;
grant execute on function public.start_office_followup(uuid) to authenticated;
