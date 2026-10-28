import { handle, json, requireUser } from '@/lib/auth';
import { confirmDispatch } from '@/lib/dispatch';

// POST: PM confirms a link-mode (Gmail compose / wa.me) message was actually sent. Bumps reminder counts.
export async function POST(_req: Request, ctx: { params: Promise<{ dispatchId: string }> }) {
  return handle(async () => {
    const { dispatchId } = await ctx.params;
    const { db } = await requireUser();
    await confirmDispatch(db, dispatchId);
    return json({ status: 'sent' });
  });
}
