import { supabaseForUser } from './supabase/server';

export type Role = 'super_admin' | 'pm_lead' | 'pm';
export interface Me { id: string; email: string; fullName: string; phone: string | null; role: Role }

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function requireUser() {
  const db = await supabaseForUser();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new HttpError(401, 'Not signed in');
  const { data: p } = await db.from('profiles').select('id,email,full_name,phone,role,active').eq('id', user.id).single();
  if (!p || !p.active) throw new HttpError(403, 'No active profile');
  const me: Me = { id: p.id, email: p.email, fullName: p.full_name, phone: p.phone, role: p.role };
  return { db, me };
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function handle(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((e: unknown) => {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: e instanceof Error ? e.message : 'Internal error' }, 500);
  });
}
