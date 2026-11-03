-- v5 (VTech change request 2026-11-03, docs/BRIEF_V5.md).
-- 1. Agency groups = the 7 in sheet tab "HansalV2" (rows 20-28). Other types are deactivated, never deleted.
-- 2. Defaults that pointed at retired types move to the new groups.
-- 3. "Hansal" tab colours: magenta FF00FF = VTECH Sales Team (internal; PM follows up), purple 9900FF = Electrician.
-- 4. Reminder categories from tab "Reminder Format" (+ "Sales dependency" for the new magenta colour).
-- Escalation columns (projects.l2_after/l3_after/mgmt_cc_level, agency_contacts.level) stay but are no longer used.

-- ── 1. agency groups ──
alter table public.agency_types add column active boolean not null default true;
alter table public.agency_types add column contact_slots int check (contact_slots between 1 and 20);  -- null = 1 row + "Add contact"

insert into public.agency_types (name, sort, internal) values
  ('PMC / Architect / Client person', 2, false),
  ('VTECH Sales Team', 20, true)
on conflict do nothing;

update public.agency_types t set active = v.active, sort = v.sort, contact_slots = v.slots
  from (values ('Client', true, 1, 3), ('PMC / Architect / Client person', true, 2, 6), ('Electrician', true, 3, 2),
               ('Carpenter', true, 4, 2), ('VTECH Sales Team', true, 20, null), ('VTech Installers', true, 21, null),
               ('VTech Programmers', true, 22, null)) v(name, active, sort, slots)
 where t.name = v.name;
update public.agency_types set active = false
 where name not in ('Client', 'PMC / Architect / Client person', 'Electrician', 'Carpenter',
                    'VTECH Sales Team', 'VTech Installers', 'VTech Programmers');

-- contact rows from the sheet: Name / Designation / Email / Phone; designation optional, no escalation level
alter table public.agency_contacts alter column designation drop not null;
alter table public.agency_contacts alter column level set default 1;

-- ── 2. re-point defaults of retired types ──
-- (no temp tables: the Supabase SQL editor rejects them across statements)
update public.product_steps s set default_agency_type_id = n.id,
       responsibility = case when n.internal then 'internal' when n.name = 'Client' then 'client' else 'external' end
  from public.agency_types o,
       (values ('Architect', 'PMC / Architect / Client person'), ('Painter', 'PMC / Architect / Client person'),
               ('Curtain Vendor', 'PMC / Architect / Client person'), ('AC Vendor', 'PMC / Architect / Client person'),
               ('Network Agency', 'Client'), ('VTech Project Managers', 'VTECH Sales Team')) m(old_name, new_name),
       public.agency_types n
 where s.default_agency_type_id = o.id and o.name = m.old_name and n.name = m.new_name;
update public.step_reasons r set agency_type = m.new_name
  from (values ('Architect', 'PMC / Architect / Client person'), ('Painter', 'PMC / Architect / Client person'),
               ('Curtain Vendor', 'PMC / Architect / Client person'), ('AC Vendor', 'PMC / Architect / Client person'),
               ('Network Agency', 'Client'), ('VTech Project Managers', 'VTECH Sales Team')) m(old_name, new_name)
 where r.agency_type = m.old_name;

-- ── 3. catalogue colours (same pattern as 0009 §6; labels unchanged so existing items keep their names) ──
update public.product_steps s set responsibility = 'internal', sheet_colour = 'FF00FF',
       default_agency_type_id = (select id from public.agency_types where name = 'VTECH Sales Team')
  from public.product_catalogue p
 where p.id = s.product_id and (p.title, s.label) in (('Curtain', 'Fabric installation'), ('Ekey scanner', 'Client impressions'),
       ('Dimmer dali', 'Scene setting'), ('Dimmer', 'Scene setting'), ('Switch /Router', 'Internet activation'));
update public.project_dependencies d set agency_type_id = s.default_agency_type_id
  from public.product_steps s where d.step_id = s.id and s.sheet_colour = 'FF00FF';
update public.dependency_items i set responsibility = 'internal',
       agency_id = (select a.id from public.agencies a join public.agency_types t on t.id = a.agency_type_id
                     where a.project_id = i.project_id and t.name = 'VTECH Sales Team' order by a.created_at limit 1)
  from public.product_steps s where i.step_id = s.id and s.sheet_colour = 'FF00FF';

update public.product_steps s set sheet_colour = '9900FF'
  from public.product_catalogue p
 where p.id = s.product_id and (p.title, s.label) in (('Off Termination', 'Ferrule sheet'),
       ('Dimmer dali', 'Partial installation done'), ('Dimmer dali', 'Complete installation'),
       ('Dimmer', 'Partial installation done'), ('Dimmer', 'Complete installation'));

-- ── 4. reminder categories ("Reminder Format" tab) ──
create table public.reminder_categories (
  key                  text primary key,
  label                text not null,
  sort                 int  not null default 0,
  item_agency_type_id  uuid references public.agency_types (id),  -- null = every pending item of the project
  colour               text                                       -- sheet colour shown as a chip
);
create table public.reminder_category_recipients (
  category_key    text not null references public.reminder_categories (key) on delete cascade,
  agency_type_id  uuid not null references public.agency_types (id),
  default_checked boolean not null default true,
  sort            int not null default 0,
  primary key (category_key, agency_type_id)
);
alter table public.reminder_categories          enable row level security;
alter table public.reminder_category_recipients enable row level security;
create policy reminder_categories_read  on public.reminder_categories for select to authenticated using (true);
create policy reminder_categories_write on public.reminder_categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy reminder_category_recipients_read  on public.reminder_category_recipients for select to authenticated using (true);
create policy reminder_category_recipients_write on public.reminder_category_recipients for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.reminder_categories (key, label, sort, item_agency_type_id, colour)
select v.key, v.label, v.sort, t.id, v.colour
  from (values ('all', 'All dependencies', 1, null, null),
               ('installer', 'Installer dependency', 2, 'VTech Installers', 'E06666'),
               ('programmer', 'Programmer dependency', 3, 'VTech Programmers', 'F4CCCC'),
               ('electrical', 'Only electrical dependency', 4, 'Electrician', null),
               ('carpentry', 'Only carpentry dependency', 5, 'Carpenter', null),
               ('sales', 'Sales dependency', 6, 'VTECH Sales Team', 'FF00FF')) v(key, label, sort, type_name, colour)
  left join public.agency_types t on t.name = v.type_name;

-- HansalV2 col C: Client "Selected only" → unchecked; PMC "All emails" → checked; Electrician/Carpenter "Selected whenever" → checked
insert into public.reminder_category_recipients (category_key, agency_type_id, default_checked, sort)
select v.key, t.id, v.checked, v.sort
  from (values ('all', 'Client', false, 1), ('all', 'PMC / Architect / Client person', true, 2), ('all', 'VTECH Sales Team', true, 3),
               ('all', 'VTech Installers', true, 4), ('all', 'VTech Programmers', true, 5),
               ('installer', 'VTECH Sales Team', true, 1), ('installer', 'VTech Installers', true, 2), ('installer', 'VTech Programmers', true, 3),
               ('programmer', 'VTECH Sales Team', true, 1), ('programmer', 'VTech Installers', true, 2), ('programmer', 'VTech Programmers', true, 3),
               ('electrical', 'Electrician', true, 1),
               ('carpentry', 'Carpenter', true, 1),
               ('sales', 'VTECH Sales Team', true, 1)) v(key, type_name, checked, sort)
  join public.agency_types t on t.name = v.type_name;

-- Pending items per category. "Waiting on" = the item's agency type, else the step default, else the custom dependency's type.
create view public.reminder_category_items with (security_invoker = true) as
select i.project_id, c.key as category_key, i.id as item_id, t.id as agency_type_id
  from public.dependency_items i
  left join public.agencies a             on a.id = i.agency_id
  left join public.product_steps s        on s.id = i.step_id
  left join public.project_dependencies d on d.id = i.project_dependency_id
  join public.agency_types t              on t.id = coalesce(a.agency_type_id, s.default_agency_type_id, d.agency_type_id)
  join public.reminder_categories c       on c.item_agency_type_id is null or c.item_agency_type_id = t.id
 where i.status = 'pending';
grant select on public.reminder_categories, public.reminder_category_recipients, public.reminder_category_items to authenticated;

