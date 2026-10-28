import { handle, json, requireUser } from '@/lib/auth';
import { prepareDispatches } from '@/lib/dispatch';

// GET: list drafts/sent dispatches for review.
export async function GET(_req: Request, ctx: { params: Promise<{ visitId: string }> }) {
  return handle(async () => {
    const { visitId } = await ctx.params;
    const { db } = await requireUser();
    const { data, error } = await db.from('dispatches')
      .select('id, channel, level, status, recipients, subject, body_text, body_html, sent_at, error, agencies(company_name, agency_types(name)), dispatch_items(count)')
      .eq('visit_id', visitId).order('created_at');
    if (error) throw error;
    return json({ dispatches: data });
  });
}

// POST: rebuild drafts (e.g. after the PM fixed a contact). Sent dispatches are kept.
export async function POST(_req: Request, ctx: { params: Promise<{ visitId: string }> }) {
  return handle(async () => {
    const { visitId } = await ctx.params;
    const { db, me } = await requireUser();
    return json(await prepareDispatches(db, me, visitId));
  });
}
