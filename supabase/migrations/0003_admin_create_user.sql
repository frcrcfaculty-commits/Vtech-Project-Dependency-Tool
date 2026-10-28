-- Server-side helper to create a confirmed email/password user + profile in one call.
-- Callable only by the database owner / service role (not by app users). Used for bootstrap and test accounts.
-- Passwords are passed at call time and never stored in git.
create or replace function public.admin_create_user(
  p_email text, p_password text, p_full_name text, p_role public.app_role, p_phone text default null
) returns uuid
language plpgsql security definer set search_path = public, extensions, auth as $$
declare uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', lower(p_email),
            crypt(p_password, gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', p_full_name), now(), now(),
            '', '', '', '');
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, jsonb_build_object('sub', uid::text, 'email', lower(p_email), 'email_verified', true),
            'email', uid::text, now(), now(), now());
  else
    update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = uid;
  end if;

  insert into public.profiles (id, full_name, email, phone, role)
  values (uid, p_full_name, lower(p_email), p_phone, p_role)
  on conflict (id) do update set full_name = excluded.full_name, role = excluded.role, active = true;
  return uid;
end $$;

revoke all on function public.admin_create_user(text, text, text, public.app_role, text) from public, anon, authenticated;
