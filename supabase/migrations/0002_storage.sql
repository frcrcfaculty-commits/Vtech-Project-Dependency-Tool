-- Evidence photos. Private bucket; object path MUST start with "<project_id>/".
-- Client compresses to ~1280px WebP (~150–250 KB) before upload — see docs/BRIEF_ANTIGRAVITY.md.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'evidence'
         and public.can_access_project(((storage.foldername(name))[1])::uuid));

create policy evidence_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence'
              and public.can_access_project(((storage.foldername(name))[1])::uuid));

create policy evidence_delete on storage.objects for delete to authenticated
  using (bucket_id = 'evidence'
         and public.can_access_project(((storage.foldername(name))[1])::uuid));
