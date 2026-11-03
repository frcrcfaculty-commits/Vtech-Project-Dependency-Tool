import { handle, json, requireUser } from '@/lib/auth';
import { parseRoundInput, runRound } from '@/lib/reminders';

// POST { category, agencyTypeIds: string[], channel: 'email'|'whatsapp', preview?: boolean }
// preview: true → { preview, itemCount, drafts:[{agency,email,whatsapp}], email, whatsapp, warnings } — writes nothing.
// otherwise → opens an office round, one draft per agency of each ticked group (all items of the category), sends it:
// { preview:false, visitId, itemCount, dispatches:[{ id, agency, channel, outcome }], warnings }.
// outcome 'needs_confirmation' carries Gmail/wa.me links; the PM confirms via POST /api/dispatches/{id}/confirm.
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  return handle(async () => {
    const { projectId } = await ctx.params;
    const { db, me } = await requireUser();
    const input = parseRoundInput(await req.json().catch(() => null));
    return json(await runRound(db, me, projectId, input));
  });
}
