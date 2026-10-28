-- Fix: INSERT ... RETURNING on projects failed for PMs. Postgres checks the SELECT policy on the new row
-- before the AFTER trigger adds the creator to project_members, so the creator could not see the row it just made.
-- The creator can always see their project.
drop policy projects_read on public.projects;
create policy projects_read on public.projects for select to authenticated
  using (public.can_access_project(id) or created_by = auth.uid());
