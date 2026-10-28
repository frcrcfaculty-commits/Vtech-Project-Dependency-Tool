// One-time: create the first accounts (2 super admins + PM lead) and email them invites.
// Usage: npx tsx --env-file=.env.local scripts/bootstrap.ts
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const users = JSON.parse(process.env.BOOTSTRAP_USERS ?? '[]') as { email: string; fullName: string; role: string }[];
if (!url || !key || !users.length) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BOOTSTRAP_USERS');

const db = createClient(url, key, { auth: { persistSession: false } });

for (const u of users) {
  const { data: existing } = await db.from('profiles').select('id').eq('email', u.email).maybeSingle();
  if (existing) { console.log(`skip ${u.email} (exists)`); continue; }
  const { data, error } = await db.auth.admin.inviteUserByEmail(u.email);
  if (error || !data.user) { console.error(`invite ${u.email}: ${error?.message}`); continue; }
  const { error: pErr } = await db.from('profiles').insert({ id: data.user.id, email: u.email, full_name: u.fullName, role: u.role });
  console.log(pErr ? `profile ${u.email}: ${pErr.message}` : `created ${u.role} ${u.email}`);
}
