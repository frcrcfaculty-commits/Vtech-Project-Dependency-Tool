import { handle, json, requireUser } from '@/lib/auth';
import { loadCategories } from '@/lib/reminders';

// GET → [{ key, label, colour, itemCount, recipients: [{ agencyTypeId, name, internal, defaultChecked, agencies: [{ id, companyName, contacts }] }] }]
// Categories and recipient groups come from the sheet tab "Reminder Format" (migration 0010). RLS limits items and agencies to the project.
export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  return handle(async () => {
    const { projectId } = await ctx.params;
    const { db } = await requireUser();
    return json(await loadCategories(db, projectId));
  });
}
