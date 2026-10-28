-- Remove the deployed app's need for the Supabase service-role key.
-- Everything the app did with that key now goes through narrow SECURITY DEFINER functions with their own checks.

-- Secrets readable only by definer functions (RLS on, no policies, no grants).
create table public.app_secrets (
  key    text primary key,
  value  text not null
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

-- Super admins to CC on top-level escalations. Any signed-in user may read just name+email.
create function public.management_contacts() returns table (full_name text, email text)
language sql stable security definer set search_path = public as $$
  select p.full_name, p.email from public.profiles p
   where p.role = 'super_admin' and p.active and auth.uid() is not null
$$;

-- Create a login. super_admin: any role. pm_lead: PM only. pm: never.
create function public.create_app_user(
  p_email text, p_full_name text, p_role public.app_role, p_password text, p_phone text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.app_role := public.my_role();
begin
  if r is null or r = 'pm' then raise exception 'not allowed to create users'; end if;
  if r = 'pm_lead' and p_role <> 'pm' then raise exception 'PM lead can only create PM accounts'; end if;
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid email'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'password must be at least 8 characters'; end if;
  if exists (select 1 from public.profiles where lower(email) = lower(p_email)) then raise exception 'user already exists'; end if;
  return public.admin_create_user(p_email, p_password, p_full_name, p_role, p_phone);
end $$;

-- Weekly digest data for the cron route, gated by a shared secret stored in app_secrets('cron_secret').
create function public.cron_digest_data(p_secret text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if p_secret is null or not exists (select 1 from public.app_secrets where key = 'cron_secret' and value = p_secret) then
    raise exception 'unauthorized';
  end if;
  return jsonb_build_object(
    'projects', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', p.id, 'name', p.name, 'l2After', p.l2_after, 'l3After', p.l3_after,
                   'lastVisit', (select max(v.visit_date) from public.site_visits v where v.project_id = p.id))), '[]'::jsonb)
                 from public.projects p where p.status = 'active'),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                   'projectId', i.project_id,
                   'agency', coalesce(t.name || ' – ' || a.company_name, 'Unassigned'),
                   'status', i.status, 'firstRaisedOn', i.first_raised_on, 'completedOn', i.completed_on,
                   'reminderCount', i.reminder_count)), '[]'::jsonb)
              from public.dependency_items i
              join public.projects p on p.id = i.project_id and p.status = 'active'
              left join public.agencies a on a.id = i.agency_id
              left join public.agency_types t on t.id = a.agency_type_id
             where i.status in ('pending', 'complete')),
    'recipients', (select coalesce(jsonb_agg(jsonb_build_object('name', full_name, 'email', email)), '[]'::jsonb)
                   from public.profiles where role = 'super_admin' and active)
  );
end $$;

revoke all on function public.management_contacts() from public, anon;
revoke all on function public.create_app_user(text, text, public.app_role, text, text) from public, anon;
revoke all on function public.cron_digest_data(text) from public;
grant execute on function public.management_contacts() to authenticated;
grant execute on function public.create_app_user(text, text, public.app_role, text, text) to authenticated;
grant execute on function public.cron_digest_data(text) to anon, authenticated;
