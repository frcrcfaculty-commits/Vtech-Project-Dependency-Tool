import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { env } from '../env';

/** Per-request client acting as the signed-in user (RLS applies). */
export async function supabaseForUser() {
  const store = await cookies();
  return createServerClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* called from a Server Component */ }
      },
    },
  });
}

/** Anonymous client with no session — only for secret-gated RPCs (cron). The app never uses the service-role key. */
export function supabaseAnon() {
  return createClient(env.supabaseUrl(), env.supabaseAnonKey(), { auth: { persistSession: false } });
}

export type Db = Awaited<ReturnType<typeof supabaseForUser>>;
