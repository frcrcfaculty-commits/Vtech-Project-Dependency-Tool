import { handle, json, requireUser, HttpError } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/server';

// POST {email, fullName, phone?, role} — super_admin creates any role; pm_lead creates PMs only.
// The new user gets an invite email (Supabase Auth) to set their password.
export async function POST(req: Request) {
  return handle(async () => {
    const { me } = await requireUser();
    const body = (await req.json()) as { email?: string; fullName?: string; phone?: string; role?: string };
    const email = body.email?.trim().toLowerCase();
    const fullName = body.fullName?.trim();
    const role = body.role ?? 'pm';
    if (!email || !fullName) throw new HttpError(400, 'email and fullName are required');
    if (!['super_admin', 'pm_lead', 'pm'].includes(role)) throw new HttpError(400, 'invalid role');
    if (me.role === 'pm') throw new HttpError(403, 'PMs cannot create users');
    if (me.role === 'pm_lead' && role !== 'pm') throw new HttpError(403, 'PM lead can only create PM accounts');

    const admin = supabaseAdmin();
    const origin = new URL(req.url).origin;
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${origin}/login` });
    if (error || !data.user) throw new HttpError(400, error?.message ?? 'invite failed');
    const { error: pErr } = await admin.from('profiles').insert({ id: data.user.id, email, full_name: fullName, phone: body.phone ?? null, role });
    if (pErr) throw new HttpError(400, pErr.message);
    return json({ id: data.user.id, email, role }, 201);
  });
}
