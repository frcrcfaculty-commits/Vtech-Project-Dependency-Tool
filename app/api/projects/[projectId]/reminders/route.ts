import { handle, json, requireUser, HttpError } from '@/lib/auth';
import { prepareDispatches } from '@/lib/dispatch';

// POST { agencyIds?: string[], itemIds?: string[] }
// Office mode: open a follow-up round for this project and build drafts (one email + one WhatsApp per agency)
// for the chosen pending items. Returns { visitId, dispatches, warnings }.
// The UI then shows the existing review & send screen: /projects/{projectId}/visits/{visitId}/dispatches,
// which uses GET /api/visits/{visitId}/dispatches, POST /api/dispatches/{id}/send and /confirm unchanged.
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  return handle(async () => {
    const { projectId } = await ctx.params;
    const { db, me } = await requireUser();
    const body = (await req.json().catch(() => ({}))) as { agencyIds?: unknown; itemIds?: unknown };
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);

    const { data: visitId, error } = await db.rpc('start_office_followup', { p_project: projectId });
    if (error || !visitId) throw new HttpError(error?.message.includes('no access') ? 404 : 400, error?.message ?? 'could not start follow-up');

    const result = await prepareDispatches(db, me, visitId as string, { agencyIds: ids(body.agencyIds), itemIds: ids(body.itemIds) });
    if (!result.dispatches.length) {
      await db.from('site_visits').delete().eq('id', visitId); // nothing to send: don't leave an empty round behind
    }
    return json({ visitId: result.dispatches.length ? visitId : null, ...result });
  });
}
