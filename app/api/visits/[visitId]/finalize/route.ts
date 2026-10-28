import { handle, json, requireUser, HttpError } from '@/lib/auth';
import { prepareDispatches } from '@/lib/dispatch';

// POST: apply this visit's checks to the items, then build per-agency drafts for PM review.
export async function POST(_req: Request, ctx: { params: Promise<{ visitId: string }> }) {
  return handle(async () => {
    const { visitId } = await ctx.params;
    const { db, me } = await requireUser();
    const { data: applied, error } = await db.rpc('finalize_visit', { p_visit: visitId });
    if (error) throw new HttpError(400, error.message);
    const drafts = await prepareDispatches(db, me, visitId);
    return json({ applied, ...drafts });
  });
}
