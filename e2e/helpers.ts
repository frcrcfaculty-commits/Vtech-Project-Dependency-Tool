// Shared e2e helpers. Real Supabase, real Next.js app; nothing mocked.
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { request as pwRequest, type APIRequestContext } from '@playwright/test';

export const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k} (see e2e/README.md)`);
  return v;
};

export const BASE_URL = () => env('E2E_BASE_URL').replace(/\/$/, '');
export const TEST_PREFIX = 'TEST – e2e';

/** Service-role client. Setup/teardown ONLY (deleting TEST projects). Never used for the steps under test. */
export function admin(): SupabaseClient {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
}

export interface Session {
  db: SupabaseClient;        // the user's own Supabase client: RLS applies, exactly like the browser
  api: APIRequestContext;    // HTTP client for the Next.js app, carrying the same session cookies
  userId: string;
}

/** Sign in like the browser does (@supabase/ssr cookies), and hand the cookies to an HTTP client for the app. */
export async function signIn(email: string, password: string): Promise<Session> {
  const jar = new Map<string, string>();
  const db = createServerClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach((c) => (c.value ? jar.set(c.name, c.value) : jar.delete(c.name))),
    },
  }) as unknown as SupabaseClient;
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`sign in ${email}: ${error?.message}`);
  const headers: Record<string, string> = { cookie: [...jar].map(([n, v]) => `${n}=${v}`).join('; ') };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers['x-vercel-protection-bypass'] = bypass;
  const api = await pwRequest.newContext({ baseURL: BASE_URL(), extraHTTPHeaders: headers });
  return { db, api, userId: data.user.id };
}

/** Throw on a Supabase error, return data. */
export function ok<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null || res.data === undefined) throw new Error(`${what}: no data`);
  return res.data as NonNullable<T>;
}

/** Delete every e2e project (name starts with TEST) and its evidence photos. Never touches anything else. */
export async function cleanup() {
  const db = admin();
  const { data: projects } = await db.from('projects').select('id,name').like('name', `${TEST_PREFIX}%`);
  for (const p of projects ?? []) {
    if (!p.name.startsWith('TEST')) continue; // belt and braces
    const { data: files } = await db.storage.from('evidence').list(p.id, { limit: 1000 });
    for (const f of files ?? []) {
      const { data: inner } = await db.storage.from('evidence').list(`${p.id}/${f.name}`, { limit: 1000 });
      const paths = (inner?.length ? inner.map((x) => `${p.id}/${f.name}/${x.name}`) : [`${p.id}/${f.name}`]);
      await db.storage.from('evidence').remove(paths);
    }
    await db.from('projects').delete().eq('id', p.id);
  }
}

// 1×1 transparent PNG, the smallest valid evidence photo.
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
