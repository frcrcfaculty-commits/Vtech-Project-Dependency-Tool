-- 0008: only named accounts may delete projects (VTech decision 2026-10-31: Vipul and Hansal only).
-- Before this, any super admin could delete. Being a super admin is no longer enough: the account must also be listed
-- in project_deleters. Nothing in the app can write that table (no write policy, privileges revoked), so a future
-- super admin cannot grant themselves the right; it is changed only by SQL run by the project owner.

create table public.project_deleters (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  note       text
);
alter table public.project_deleters enable row level security;
-- Each user can see whether they themselves are listed (the UI shows the Delete button from this). No write policies.
create policy project_deleters_read_own on public.project_deleters for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.project_deleters from anon, authenticated;

create function public.can_delete_projects() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_deleters d join public.profiles p on p.id = d.user_id
     where d.user_id = auth.uid() and p.active)
$$;
revoke all on function public.can_delete_projects() from public, anon;
grant execute on function public.can_delete_projects() to authenticated;

drop policy projects_delete on public.projects;
create policy projects_delete on public.projects for delete to authenticated using (public.can_delete_projects());

insert into public.project_deleters (user_id, note)
select id, 'VTech decision 2026-10-31' from public.profiles
 where lower(email) in ('vipul@vtechpl.com', 'hansalgandhi@gmail.com')
on conflict do nothing;
