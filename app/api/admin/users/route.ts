import { randomBytes } from 'node:crypto';
import { handle, json, requireUser, HttpError } from '@/lib/auth';

// POST {email, fullName, phone?, role, password?}
// super_admin creates any role; pm_lead creates PMs only (enforced again in the database function).
// If no password is given, a temporary one is generated and returned once so the admin can share it.
export async function POST(req: Request) {
  return handle(async () => {
    const { db, me } = await requireUser();
    const body = (await req.json()) as { email?: string; fullName?: string; phone?: string; role?: string; password?: string };
    const email = body.email?.trim().toLowerCase();
    const fullName = body.fullName?.trim();
    const role = body.role ?? 'pm';
    if (!email || !fullName) throw new HttpError(400, 'email and fullName are required');
    if (!['super_admin', 'pm_lead', 'pm'].includes(role)) throw new HttpError(400, 'invalid role');
    if (me.role === 'pm') throw new HttpError(403, 'PMs cannot create users');
    if (me.role === 'pm_lead' && role !== 'pm') throw new HttpError(403, 'PM lead can only create PM accounts');

    const password = body.password ?? `Vt-${randomBytes(6).toString('base64url')}`;
    const { data: id, error } = await db.rpc('create_app_user', {
      p_email: email, p_full_name: fullName, p_role: role, p_password: password, p_phone: body.phone ?? null,
    });
    if (error) throw new HttpError(400, error.message);
    return json({ id, email, role, temporaryPassword: body.password ? undefined : password }, 201);
  });
}
