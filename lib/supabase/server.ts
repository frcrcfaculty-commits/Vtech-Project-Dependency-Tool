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

/** Service-role client. Bypasses RLS — server only, never import from client code. */
export function supabaseAdmin() {
  return createClient(env.supabaseUrl(), env.supabaseServiceKey(), { auth: { persistSession: false } });
}

export type Db = Awaited<ReturnType<typeof supabaseForUser>> | ReturnType<typeof supabaseAdmin>;
