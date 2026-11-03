-- v6 (VTech, 2026-11-03): project setup needs at least one contact per HansalV2 group.
-- When a contact isn't finalised yet, the PM marks it "not finalised" and the app reminds him after 7 days
-- (notifications bell + dashboard) until he adds the contact. No temp tables (Supabase SQL editor).

create table public.contact_followups (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  agency_type_id  uuid not null references public.agency_types (id),
  note            text,
  remind_on       date not null default ((now() at time zone 'Asia/Kolkata')::date + 7),
  created_by      uuid references public.profiles (id) default auth.uid(),
  created_at      timestamptz not null default now(),
  done_at         timestamptz
);
create unique index contact_followups_open_uq on public.contact_followups (project_id, agency_type_id) where done_at is null;
alter table public.contact_followups enable row level security;
create policy contact_followups_project_access on public.contact_followups for all to authenticated
  using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));
grant select, insert, update, delete on public.contact_followups to authenticated;

-- Adding a contact to an agency of that group closes the open follow-up automatically.
create function public.close_contact_followup() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  update public.contact_followups f set done_at = now()
    from public.agencies a
   where a.id = new.agency_id and f.project_id = a.project_id and f.agency_type_id = a.agency_type_id and f.done_at is null;
  return new;
end $$;
create trigger agency_contacts_close_followup after insert on public.agency_contacts
  for each row execute function public.close_contact_followup();

-- Due follow-ups for the signed-in user (RLS applies): for the bell and the dashboard banner.
create view public.contact_followups_due with (security_invoker = true) as
select f.id, f.project_id, p.name as project_name, f.agency_type_id, t.name as group_name, f.note, f.remind_on
  from public.contact_followups f
  join public.projects p     on p.id = f.project_id
  join public.agency_types t on t.id = f.agency_type_id
 where f.done_at is null and f.remind_on <= (now() at time zone 'Asia/Kolkata')::date;
grant select on public.contact_followups_due to authenticated;
