import { handle, json, requireUser } from '@/lib/auth';
import { sendDispatch } from '@/lib/dispatch';

// POST: send one reviewed dispatch. Link modes return URLs and need /confirm after the PM sends.
export async function POST(_req: Request, ctx: { params: Promise<{ dispatchId: string }> }) {
  return handle(async () => {
    const { dispatchId } = await ctx.params;
    const { db, me } = await requireUser();
    return json(await sendDispatch(db, me, dispatchId));
  });
}
