-- Behaviour + RLS tests. Run after stub, 0001_init.sql and seed.sql. Fails loudly via ON_ERROR_STOP.
\set ON_ERROR_STOP on

-- users: Vipul (super_admin), lead (pm_lead), pm1 (member), pm2 (outsider)
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-000000000001','vipul@vtechpl.com'),
 ('00000000-0000-0000-0000-000000000002','lead@vtechpl.com'),
 ('00000000-0000-0000-0000-000000000003','pm1@vtechpl.com'),
 ('00000000-0000-0000-0000-000000000004','pm2@vtechpl.com');
insert into public.profiles (id, full_name, email, role) values
 ('00000000-0000-0000-0000-000000000001','Vipul Shah','vipul@vtechpl.com','super_admin'),
 ('00000000-0000-0000-0000-000000000002','PM Lead','lead@vtechpl.com','pm_lead'),
 ('00000000-0000-0000-0000-000000000003','PM One','pm1@vtechpl.com','pm'),
 ('00000000-0000-0000-0000-000000000004','PM Two','pm2@vtechpl.com','pm');

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false);
end $$;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond,false) then raise exception 'ASSERT FAILED: %', msg; end if; raise notice 'ok - %', msg; end $$;

select pg_temp.assert((select count(*) from public.master_dependencies where active) = 78, '78 active master dependencies seeded');
select pg_temp.assert((select count(*) from public.master_dependencies where not active) = 0, 'no inactive items after VTech approval');

-- ── PM1 sets up a project ──
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
set role authenticated;

-- the app always inserts with RETURNING; the creator must see the row immediately
insert into public.projects (name, client_name) values ('Shah Residence', 'Mr Shah') returning id;
select pg_temp.assert((select count(*) from public.projects) = 1, 'creator sees own project');
select pg_temp.assert((select terms from public.projects) like 'General terms%', 'project terms default from settings');

create temp table t_ids as select id as project_id from public.projects;
insert into public.floors (project_id, label, sort) select project_id, '12th Floor', 12 from t_ids;
insert into public.rooms (project_id, floor_id, name, sort)
  select f.project_id, f.id, r.name, r.sort from public.floors f,
  (values ('Living Room',1),('Daughter''s Bedroom',2),('DB / Rack Room',3)) r(name,sort);

-- agency + 2 contacts (L1, L3)
insert into public.agencies (project_id, agency_type_id, company_name)
  select t.project_id, at.id, 'Sparks Electricals' from t_ids t, public.agency_types at where at.name='Electrician';
insert into public.agency_contacts (project_id, agency_id, name, designation, level, phone, email)
  select a.project_id, a.id, 'Ramesh', 'Site Supervisor', 1, '9876543210', 'ramesh@sparks.in' from public.agencies a;
insert into public.agency_contacts (project_id, agency_id, name, designation, level, phone, email)
  select a.project_id, a.id, 'Mr Kapoor', 'Owner', 3, '9820000000', 'owner@sparks.in' from public.agencies a;

-- pick 3 electrician master items + 1 custom carpenter item
select public.add_master_dependencies((select project_id from t_ids),
  array(select m.id from public.master_dependencies m join public.agency_types at on at.id=m.agency_type_id
        where at.name='Electrician' and m.seq in (1,4,16)));
insert into public.project_dependencies (project_id, agency_type_id, text, seq)
  select t.project_id, at.id, 'Pooja room jaali cutout not done.', 99 from t_ids t, public.agency_types at where at.name='Carpenter';
select pg_temp.assert((select count(*) from public.project_dependencies) = 4, '3 master + 1 custom dependency on project');

-- apply all deps to all rooms -> 12 items; electrician items auto-assigned
select pg_temp.assert(public.apply_dependencies((select project_id from t_ids),
  array(select id from public.project_dependencies), array(select id from public.rooms)) = 12, 'apply_dependencies created 12 items');
select pg_temp.assert(public.apply_dependencies((select project_id from t_ids),
  array(select id from public.project_dependencies), array(select id from public.rooms)) = 0, 'apply_dependencies is idempotent');
select pg_temp.assert((select count(*) from public.dependency_items where agency_id is not null) = 9, 'electrician items auto-assigned to agency');

-- adding carpenter agency later assigns its items
insert into public.agencies (project_id, agency_type_id, company_name)
  select t.project_id, at.id, 'WoodWorks' from t_ids t, public.agency_types at where at.name='Carpenter';
select pg_temp.assert((select count(*) from public.dependency_items where agency_id is null) = 0, 'late-added agency picks up unassigned items');

-- copy floor -> 13th floor with 3 rooms, 12 unchecked items
select public.copy_floor((select id from public.floors where label='12th Floor'), '13th Floor');
select pg_temp.assert((select count(*) from public.rooms) = 6, 'copy_floor duplicated rooms');
select pg_temp.assert((select count(*) from public.dependency_items) = 24, 'copy_floor duplicated applied items');

-- ── visit 1 (24 Oct): one item pending, one complete ──
insert into public.site_visits (project_id, visit_date) select project_id, date '2026-10-24' from t_ids;
create temp table t_v1 as select id from public.site_visits;
create temp table t_item as
  select i.id from public.dependency_items i
  join public.rooms r on r.id=i.room_id join public.floors f on f.id=r.floor_id
  join public.project_dependencies d on d.id=i.project_dependency_id
  where f.label='12th Floor' and r.name='Living Room' and d.text like 'Regular ceiling%';
create temp table t_item2 as
  select i.id from public.dependency_items i
  join public.rooms r on r.id=i.room_id join public.floors f on f.id=r.floor_id
  join public.project_dependencies d on d.id=i.project_dependency_id
  where f.label='12th Floor' and r.name='Living Room' and d.text like 'Ceiling fan%';
insert into public.visit_checks (project_id, visit_id, item_id, status, status_date)
  select (select project_id from t_ids), (select id from t_v1), (select id from t_item), 'pending', date '2026-10-24';
insert into public.visit_checks (project_id, visit_id, item_id, status, status_date)
  select (select project_id from t_ids), (select id from t_v1), (select id from t_item2), 'complete', date '2026-10-23';
select pg_temp.assert(public.finalize_visit((select id from t_v1)) = 2, 'finalize_visit applied 2 checks');
select pg_temp.assert((select first_raised_on from public.dependency_items where id=(select id from t_item)) = date '2026-10-24', 'first_raised_on set');
select pg_temp.assert((select completed_on from public.dependency_items where id=(select id from t_item2)) = date '2026-10-23', 'completed_on set');

do $$ begin
  perform public.finalize_visit((select id from t_v1));
  raise exception 'should have failed';
exception when others then
  if sqlerrm not like 'visit already%' then raise; end if;
  raise notice 'ok - cannot finalize twice';
end $$;

-- dispatch: email + whatsapp for same item -> reminder_count increments ONCE
insert into public.dispatches (project_id, visit_id, agency_id, channel, level, body_text)
  select i.project_id, (select id from t_v1), i.agency_id, c, 1, 'x'
  from public.dependency_items i, unnest(array['email','whatsapp']::public.dispatch_channel[]) c
  where i.id=(select id from t_item);
insert into public.dispatch_items (dispatch_id, item_id, reminder_no, level)
  select d.id, (select id from t_item), 1, 1 from public.dispatches d;
select public.mark_dispatch_sent(id, 'ref') from public.dispatches where channel='email';
select pg_temp.assert((select status from public.site_visits where id=(select id from t_v1)) = 'finalized', 'visit not sent while a draft remains');
select public.mark_dispatch_sent(id, 'ref') from public.dispatches where channel='whatsapp';
select pg_temp.assert((select reminder_count from public.dependency_items where id=(select id from t_item)) = 1, 'reminder counted once per visit across channels');
select pg_temp.assert((select status from public.site_visits where id=(select id from t_v1)) = 'sent', 'visit marked sent when no drafts remain');

-- PM cannot promote to master or assign members
do $$ begin
  perform public.promote_dependency((select id from public.project_dependencies where master_dependency_id is null));
  raise exception 'should have failed';
exception when others then
  if sqlerrm not like 'only admins%' then raise; end if;
  raise notice 'ok - PM cannot edit master list';
end $$;
do $$ begin
  insert into public.project_members (project_id, user_id)
    select id, '00000000-0000-0000-0000-000000000004' from public.projects;
  raise exception 'should have failed';
exception when insufficient_privilege then raise notice 'ok - PM cannot assign members';
end $$;
do $$ begin
  update public.profiles set role='super_admin' where id='00000000-0000-0000-0000-000000000003';
  if exists (select 1 from public.profiles where id='00000000-0000-0000-0000-000000000003' and role='super_admin')
  then raise exception 'PM escalated own role'; end if;
  raise notice 'ok - PM cannot change own role';
end $$;
reset role;

-- ── outsider PM2 sees nothing ──
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
set role authenticated;
select pg_temp.assert((select count(*) from public.projects) = 0, 'unassigned PM sees no projects');
select pg_temp.assert((select count(*) from public.dependency_items) = 0, 'unassigned PM sees no items');
select pg_temp.assert((select count(*) from public.agency_contacts) = 0, 'unassigned PM sees no contacts');
reset role;

-- ── PM lead assigns PM2, can create/modify only PMs ──
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
set role authenticated;
insert into public.project_members (project_id, user_id) select id, '00000000-0000-0000-0000-000000000004' from public.projects;
do $$ begin
  update public.profiles set role='super_admin' where id='00000000-0000-0000-0000-000000000004';
  raise exception 'should have failed';
exception when insufficient_privilege then raise notice 'ok - PM lead blocked from promoting to super admin';
end $$;
reset role;
select pg_temp.assert((select role from public.profiles where id='00000000-0000-0000-0000-000000000004') = 'pm', 'PM lead cannot promote anyone to super admin');

select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
set role authenticated;
select pg_temp.assert((select count(*) from public.projects) = 1, 'assigned PM now sees project');
reset role;

-- ── reopen: complete item later found pending again -> new episode ──
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
set role authenticated;
insert into public.site_visits (project_id, visit_date) select project_id, date '2026-10-31' from t_ids;
insert into public.visit_checks (project_id, visit_id, item_id, status, status_date)
  select (select project_id from t_ids), (select id from public.site_visits where visit_date='2026-10-31'), (select id from t_item2), 'pending', date '2026-10-31';
select public.finalize_visit((select id from public.site_visits where visit_date='2026-10-31'));
select pg_temp.assert((select first_raised_on = date '2026-10-31' and completed_on is null and reminder_count = 0
  from public.dependency_items where id=(select id from t_item2)), 'reopened item starts a new pending episode');
reset role;

-- ── Vipul (super admin) sees all and can promote ──
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
set role authenticated;
select pg_temp.assert((select count(*) from public.projects) = 1, 'super admin sees all projects');
select pg_temp.assert(public.promote_dependency((select id from public.project_dependencies where master_dependency_id is null)) is not null, 'super admin promotes custom dependency to master');
reset role;

-- anon sees nothing
set role anon;
select pg_temp.assert((select count(*) from public.master_dependencies) = 0, 'anon cannot read master list');
reset role;

-- ── 0003/0004: user creation, management contacts, cron digest ──
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
set role authenticated;
select pg_temp.assert(public.create_app_user('newpm@vtechpl.com','New PM','pm','Secret123!') is not null, 'PM lead creates a PM login');
do $$ begin
  perform public.create_app_user('x@vtechpl.com','X','super_admin','Secret123!');
  raise exception 'should have failed';
exception when others then if sqlerrm not like 'PM lead can only%' then raise; end if; raise notice 'ok - PM lead cannot create super admin';
end $$;
do $$ begin
  perform public.create_app_user('newpm@vtechpl.com','Dup','pm','Secret123!');
  raise exception 'should have failed';
exception when others then if sqlerrm not like 'user already exists%' then raise; end if; raise notice 'ok - duplicate email rejected';
end $$;
select pg_temp.assert((select count(*) from public.management_contacts()) = 1, 'management_contacts returns active super admins');
do $$ begin
  perform public.admin_create_user('y@vtechpl.com','pw123456','Y','super_admin');
  raise exception 'should have failed';
exception when insufficient_privilege then raise notice 'ok - app users cannot call admin_create_user directly';
end $$;
reset role;
select pg_temp.assert((select encrypted_password like '$2%' and email_confirmed_at is not null from auth.users where email='newpm@vtechpl.com'), 'new login has bcrypt password and is confirmed');
select pg_temp.assert((select count(*) from auth.identities i join auth.users u on u.id=i.user_id where u.email='newpm@vtechpl.com') = 1, 'new login has an email identity');

select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
set role authenticated;
do $$ begin
  perform public.create_app_user('z@vtechpl.com','Z','pm','Secret123!');
  raise exception 'should have failed';
exception when others then if sqlerrm not like 'not allowed%' then raise; end if; raise notice 'ok - PM cannot create users';
end $$;
reset role;

insert into public.app_secrets values ('cron_secret', 's3cret');
set role anon;
do $$ begin
  perform public.cron_digest_data('wrong');
  raise exception 'should have failed';
exception when others then if sqlerrm <> 'unauthorized' then raise; end if; raise notice 'ok - cron digest rejects wrong secret';
end $$;
select pg_temp.assert(jsonb_array_length(public.cron_digest_data('s3cret')->'projects') = 1, 'cron digest returns data with right secret');
do $$ begin
  perform * from public.app_secrets;
  raise exception 'should have failed';
exception when insufficient_privilege then raise notice 'ok - anon cannot read app_secrets';
end $$;
reset role;

-- ── 0006 office mode ──
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');  -- PM lead (the office user)
set role authenticated;
create temp table t_room as select r.id from public.rooms r join public.floors f on f.id=r.floor_id where f.label='13th Floor' and r.name='Living Room';
create temp table t_m as select m.id from public.master_dependencies m join public.agency_types t on t.id=m.agency_type_id where t.name='Painter' and m.seq in (1,2);
select pg_temp.assert(public.add_room_dependencies((select id from t_room), array(select id from t_m),
  jsonb_build_array(jsonb_build_object('agency_type_id', (select id from public.agency_types where name='Carpenter'), 'text', 'Jaali panel cutout pending.'))) = 3,
  'add_room_dependencies: 2 master + 1 custom added to one room');
select pg_temp.assert(public.add_room_dependencies((select id from t_room), array(select id from t_m)) = 0, 'add_room_dependencies is idempotent');
select pg_temp.assert((select count(*) from public.dependency_items i join public.project_dependencies d on d.id=i.project_dependency_id
  where i.room_id=(select id from t_room) and d.text='Jaali panel cutout pending.' and i.agency_id is not null) = 1, 'custom item auto-assigned to the Carpenter agency');
select pg_temp.assert(public.add_room_dependencies((select id from t_room), '{}',
  jsonb_build_array(jsonb_build_object('agency_type_id', (select id from public.agency_types where name='Electrician'), 'text', 'Found today: DB label missing.')), 'pending', date '2026-10-29') = 1,
  'on-the-go dependency added as pending');
select pg_temp.assert((select i.status='pending' and i.first_raised_on=date '2026-10-29' from public.dependency_items i join public.project_dependencies d on d.id=i.project_dependency_id
  where d.text='Found today: DB label missing.'), 'on-the-go item raised today');

create temp table t_oi as select i.id from public.dependency_items i join public.project_dependencies d on d.id=i.project_dependency_id where d.text='Jaali panel cutout pending.';
select public.set_item_status((select id from t_oi), 'pending', date '2026-10-29', 'Carpenter says Friday', 'p/x.webp');
select pg_temp.assert((select status='pending' and first_raised_on=date '2026-10-29' and note='Carpenter says Friday' from public.dependency_items where id=(select id from t_oi)), 'set_item_status pending with note');
select public.set_item_status((select id from t_oi), 'complete', date '2026-10-31');
select pg_temp.assert((select status='complete' and completed_on=date '2026-10-31' and note='Carpenter says Friday' from public.dependency_items where id=(select id from t_oi)), 'set_item_status complete keeps note');
select pg_temp.assert((select count(*) from public.item_events where item_id=(select id from t_oi)) = 2, 'item history has 2 events');
do $$ begin
  perform public.set_item_status((select id from t_oi), 'unchecked');
  raise exception 'should have failed';
exception when others then if sqlerrm not like 'status must be%' then raise; end if; raise notice 'ok - cannot set unchecked';
end $$;

create temp table t_fv as select public.start_office_followup((select id from public.projects limit 1)) as id;
select pg_temp.assert((select kind='office' and status='finalized' from public.site_visits where id=(select id from t_fv)), 'office follow-up round is finalized and kind=office');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-000000000004');  -- PM2 was assigned; remove and check isolation of history
reset role;
delete from public.project_members where user_id='00000000-0000-0000-0000-000000000004';
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
set role authenticated;
select pg_temp.assert((select count(*) from public.item_events) = 0, 'unassigned PM sees no item history');
do $$ begin
  perform public.start_office_followup((select id from public.projects limit 1));
  raise exception 'should have failed';
exception when others then if sqlerrm not like '%no access%' then raise; end if; raise notice 'ok - unassigned PM cannot start follow-up';
end $$;
reset role;

-- ── 0007 product tracking ──
select pg_temp.assert((select count(*) from public.product_catalogue) = 27, '27 products from the Hansal sheet');
select pg_temp.assert((select count(*) from public.product_steps) = 163, '163 product steps');
select pg_temp.assert((select count(*) from public.agency_types where internal) = 4, '4 internal agency types');
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
set role authenticated;
create temp table t_sp as select id from public.product_catalogue where title = 'Speakers';
create temp table t_rp as select public.add_room_product((select id from public.projects limit 1), (select id from t_room), (select id from t_sp), 'Ceiling') as id;
create temp table t_g as select * from public.item_gate where room_product_id = (select id from t_rp);
select pg_temp.assert((select count(*) from t_g) = 5, 'speaker placed: 5 steps created');
select pg_temp.assert((select string_agg(label || ':' || locked, ',' order by seq) from t_g)
  = 'Delivery pending client / VTECH:false,Readiness of cable:false,Readiness to install:false,Installation:true,Sound testing:true', 'green steps open, red steps locked');
create temp table t_s as select item_id, seq from public.item_gate where room_product_id = (select id from t_rp);
select public.set_item_status((select item_id from t_s where seq=1), 'pending');
select public.set_item_status((select item_id from t_s where seq=2), 'pending');
select public.set_item_status((select item_id from t_s where seq=3), 'pending');
select pg_temp.assert((select count(*) from public.dependency_items where room_product_id=(select id from t_rp) and status='pending') = 3, 'three green steps pending at the same time');
do $$ begin
  perform public.set_item_status((select item_id from t_s where seq=4), 'complete');
  raise exception 'should have failed';
exception when others then if sqlerrm not like 'locked%' then raise; end if; raise notice 'ok - installation blocked while greens open';
end $$;
select public.set_item_status((select item_id from t_s where seq=1), 'complete');
select public.set_item_status((select item_id from t_s where seq=2), 'complete');
select pg_temp.assert(public.item_is_locked((select item_id from t_s where seq=4)), 'still locked with one green open');
select public.set_item_status((select item_id from t_s where seq=3), 'na');
select pg_temp.assert(not public.item_is_locked((select item_id from t_s where seq=4)), 'installation unlocks once all greens done/N.A.');
select pg_temp.assert(not public.item_is_locked((select item_id from t_s where seq=5)), 'all other colours unlock together (sound testing too)');
select pg_temp.assert((select responsibility from public.dependency_items where id=(select item_id from t_s where seq=4)) = 'internal', 'installation step is internal');
select pg_temp.assert((select waits_on_client from public.item_gate where item_id=(select item_id from t_s where seq=1)), 'delivery step waits on client by default');
create temp table t_cp as select public.copy_floor((select floor_id from public.rooms where id=(select id from t_room)), '13th Floor copy') as id;
select pg_temp.assert((select count(*) from public.room_products rp join public.rooms r on r.id=rp.room_id where r.floor_id=(select id from t_cp)) = 1, 'copy_floor copies placed products');
select pg_temp.assert((select count(*) from public.dependency_items i join public.rooms r on r.id=i.room_id where r.floor_id=(select id from t_cp) and i.room_product_id is not null and i.status='unchecked') = 5, 'copied product steps start fresh');
-- project-scope product goes to the project-wide room
create temp table t_cs as select public.add_room_product((select id from public.projects limit 1), null, (select id from public.product_catalogue where title='Client Side')) as id;
select pg_temp.assert((select r.name from public.room_products rp join public.rooms r on r.id=rp.room_id where rp.id=(select id from t_cs)) = 'Handover & client', 'project-scope product placed in project-wide room');
select pg_temp.assert((select count(*) from public.item_gate where room_product_id=(select id from t_cs) and waits_on_client) = 1, 'AMC team intro waits on client');
select pg_temp.assert((select count(*) from public.item_gate where room_product_id=(select id from t_cs) and not locked) = 9, 'client-side: no greens, all 9 steps open');
-- remove
select public.remove_room_product((select id from t_cs));
select pg_temp.assert((select count(*) from public.dependency_items where room_product_id=(select id from t_cs)) = 0, 'remove_room_product removes its steps');
reset role;

\echo ALL SQL TESTS PASSED
