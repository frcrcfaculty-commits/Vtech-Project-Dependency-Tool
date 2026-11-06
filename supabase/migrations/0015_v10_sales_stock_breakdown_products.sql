-- v10 (VTech, 2026-11-06; sheet "Ashutosh Project Status", tabs HansalV2 rows 1-28 "Green Dependency Detailed Breakdown" and Hansal rows 39-44).
-- No temp tables (Supabase SQL editor).
-- 1. Colours per HansalV2: grey 666666 = VTECH Sales (new group), magenta FF00FF = Client / Architect (contact person, not the owner),
--    orange F9CB9C = VTECH PM. New internal stakeholder "VTECH Stock" (stock purchase) – counted, not a contact group.
-- 2. Every pending green step is "blocked by" the stakeholder of its stuck reason (step_reasons.agency_type); reminders, trackers
--    and counts use that stakeholder when a reason is set.
-- 3. New products from the Hansal tab: EPABX backend, EPABX room socket, Power sockets, NVR, Ventilation of AV Rack, Ventilation of DB.

-- ── 1. groups ──
insert into public.agency_types (name, sort, internal) values ('VTECH Sales', 19, true), ('VTECH Stock', 23, true)
on conflict do nothing;
update public.agency_types set active = true  where name = 'VTECH Sales';
update public.agency_types set active = false where name = 'VTECH Stock';

-- stakeholders of the green breakdown (HansalV2 col D)
update public.step_reasons r set agency_type = v.who
  from (values ('Yet not prepared by VTECH', 'VTECH Sales'), ('Sales Clearance awaited', 'VTECH Sales'),
               ('Stock purchase awaited', 'VTECH Stock'),
               ('Given to client/ architect approval awaited', 'PMC / Architect / Client person'),
               ('Given to client/ architect -Final approval awaited', 'PMC / Architect / Client person'),
               ('Client approval awaited', 'PMC / Architect / Client person'),
               ('Approval pending from PMC/Architect/Client', 'PMC / Architect / Client person'),
               ('Site cleaning awaited', 'PMC / Architect / Client person')) v(reason, who)
 where r.reason = v.reason;

-- magenta catalogue steps now belong to Client / Architect (contact person)
update public.product_steps s set default_agency_type_id = (select id from public.agency_types where name = 'PMC / Architect / Client person'),
       responsibility = 'external'
 where s.sheet_colour = 'FF00FF';
update public.project_dependencies d set agency_type_id = s.default_agency_type_id
  from public.product_steps s where d.step_id = s.id and s.sheet_colour = 'FF00FF';
update public.dependency_items i set responsibility = 'external',
       agency_id = (select a.id from public.agencies a join public.agency_types t on t.id = a.agency_type_id
                     where a.project_id = i.project_id and t.name = 'PMC / Architect / Client person' order by a.created_at limit 1)
  from public.product_steps s where i.step_id = s.id and s.sheet_colour = 'FF00FF';

-- reminder groups: VTECH Sales joins All / Installer / Programmer (HansalV2 rows 53-60) and gets its own category
update public.reminder_categories set label = 'PM dependency', colour = 'F9CB9C' where key = 'sales';
insert into public.reminder_categories (key, label, sort, item_agency_type_id, colour, section)
select 'vtech_sales', 'VTECH Sales dependency', 7, id, '666666', 'vtech' from public.agency_types where name = 'VTECH Sales'
on conflict do nothing;
insert into public.reminder_category_recipients (category_key, agency_type_id, default_checked, sort)
select v.key, t.id, true, v.sort
  from (values ('all', 8), ('installer', 0), ('programmer', 0), ('vtech_sales', 1)) v(key, sort)
  cross join public.agency_types t where t.name = 'VTECH Sales'
on conflict do nothing;

-- ── 2. "blocked by": the stuck reason's stakeholder wins ──
create or replace view public.item_responsible with (security_invoker = true) as
select i.id as item_id, i.project_id, i.status, i.stuck_reason,
       coalesce(rt.id, a.agency_type_id, s.default_agency_type_id, d.agency_type_id) as agency_type_id,
       coalesce(rt.name, at.name, st.name, dt.name) as responsible,
       rt.id is not null as via_reason
  from public.dependency_items i
  left join public.agencies a             on a.id = i.agency_id
  left join public.agency_types at        on at.id = a.agency_type_id
  left join public.product_steps s        on s.id = i.step_id
  left join public.agency_types st        on st.id = s.default_agency_type_id
  left join public.project_dependencies d on d.id = i.project_dependency_id
  left join public.agency_types dt        on dt.id = d.agency_type_id
  left join lateral (
    select r.agency_type from public.step_reasons r
     where i.stuck_reason is not null and r.reason = i.stuck_reason
       and lower(coalesce(s.label, d.text)) like lower(r.step_prefix) || '%'
     order by length(r.step_prefix) desc limit 1) rs on true
  left join public.agency_types rt        on rt.name = rs.agency_type;
grant select on public.item_responsible to authenticated;

create or replace view public.reminder_category_items with (security_invoker = true) as
select r.project_id, c.key as category_key, r.item_id, r.agency_type_id
  from public.item_responsible r
  join public.reminder_categories c on c.item_agency_type_id is null or c.item_agency_type_id = r.agency_type_id
 where r.status = 'pending';

-- ── 3. new products (Hansal rows 39-44); defaults mapped to the active groups ──
insert into public.product_catalogue (title, scope, location_options, sort, conso_group, conso_sort) values
  ('EPABX backend', 'room', array['AV Rack'], 28, 'EPABX', 70),
  ('EPABX room socket', 'room', array['Side Table'], 29, 'EPABX', 71),
  ('Power sockets', 'room', array['Main DB location', 'AV rack', 'Room Rack'], 30, 'Network', 82),
  ('NVR', 'room', array['AV Rack'], 31, 'Camera', 60),
  ('Ventilation of AV Rack', 'room', array['Main DB location', 'AV rack', 'Room Rack'], 32, 'AV Rack location', 23),
  ('Ventilation of DB', 'room', array['Main DB location', 'AV rack', 'Room Rack'], 33, 'Backend', 17)
on conflict (lower(title)) do nothing;

insert into public.product_steps (product_id, seq, label, phase, responsibility, gate, default_agency_type_id, sheet_colour)
select p.id, v.seq, v.label, v.phase, v.resp, v.gate, t.id, v.colour
from (values
  ('EPABX backend', 1, 'Delivery pending client / VTECH', 1, 'external', 'none', 'Client', 'D9EAD3'),
  ('EPABX backend', 2, 'Readiness of cable', 1, 'external', 'none', 'Electrician', 'D9EAD3'),
  ('EPABX backend', 3, 'Readiness of dustfree', 1, 'external', 'none', 'PMC / Architect / Client person', 'D9EAD3'),
  ('EPABX backend', 4, 'Installation', 2, 'internal', 'after_external', 'VTech Installers', 'E06666'),
  ('EPABX backend', 5, 'Configuration', 2, 'internal', 'after_external', 'VTech Programmers', 'F4CCCC'),
  ('EPABX backend', 6, 'Outside line activation', 2, 'external', 'after_external', 'PMC / Architect / Client person', 'FF00FF'),
  ('EPABX room socket', 1, 'Readiness of cable', 1, 'external', 'none', 'Electrician', 'D9EAD3'),
  ('EPABX room socket', 2, 'Readiness of socket / switchboard', 1, 'external', 'none', 'Electrician', 'D9EAD3'),
  ('EPABX room socket', 3, 'Installation', 2, 'internal', 'after_external', 'VTech Installers', 'E06666'),
  ('Power sockets', 1, 'Readiness of cable', 1, 'external', 'none', 'Electrician', 'D9EAD3'),
  ('Power sockets', 2, 'Readiness of socket / switchboard', 1, 'external', 'none', 'Electrician', 'D9EAD3'),
  ('NVR', 1, 'Delivery pending client / VTECH', 1, 'external', 'none', 'Client', 'D9EAD3'),
  ('NVR', 2, 'Readiness of cable', 1, 'external', 'none', 'Electrician', 'D9EAD3'),
  ('NVR', 3, 'Readiness of dustfree', 1, 'external', 'none', 'PMC / Architect / Client person', 'D9EAD3'),
  ('NVR', 4, 'Installation', 2, 'internal', 'after_external', 'VTech Installers', 'E06666'),
  ('NVR', 5, 'Configuration', 2, 'internal', 'after_external', 'VTech Installers', 'E06666'),
  ('NVR', 6, 'Internet activation', 2, 'external', 'after_external', 'PMC / Architect / Client person', 'FF00FF'),
  ('NVR', 7, '5G controls', 2, 'internal', 'after_external', 'VTech Installers', 'E06666'),
  ('NVR', 8, 'Client phone activation', 2, 'internal', 'after_external', 'VTECH PM', 'F9CB9C'),
  ('Ventilation of AV Rack', 1, 'Readiness from carpenter', 1, 'external', 'none', 'Carpenter', 'D9EAD3'),
  ('Ventilation of DB', 1, 'Readiness from carpenter', 1, 'external', 'none', 'Carpenter', 'D9EAD3')
) v(product, seq, label, phase, resp, gate, type_name, colour)
join public.product_catalogue p on p.title = v.product
join public.agency_types t on t.name = v.type_name
on conflict (product_id, seq) do nothing;
