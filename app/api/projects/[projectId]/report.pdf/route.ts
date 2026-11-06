// GET /api/projects/:projectId/report.pdf?agency=<agency id, optional>
// Pending items in the Specimen layout. Runs as the signed-in user, so RLS decides what is visible.
import { handle, HttpError, requireUser } from '@/lib/auth';
import { loadPdfFonts } from '@/lib/pdf/fonts';
import { buildPendingPdf, type PdfRow } from '@/lib/pdf/pendingReport';
import { formatBlockedBy } from '@/lib/client/steps';

export const runtime = 'nodejs';

const one = <T,>(x: T | T[] | null): T | null => (Array.isArray(x) ? x[0] ?? null : x);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  return handle(async () => {
    const { projectId } = await ctx.params;
    const agency = new URL(req.url).searchParams.get('agency');
    if (!UUID.test(projectId) || (agency && !UUID.test(agency))) throw new HttpError(400, 'Bad id');
    const { db } = await requireUser();

    const { data: project, error: pErr } = await db.from('projects')
      .select('name, client_name, site_address, terms').eq('id', projectId).maybeSingle();
    if (pErr) throw pErr;
    if (!project) throw new HttpError(404, 'Project not found');

    let q = db.from('dependency_items')
      .select(`id, first_raised_on, reminder_count, note,
        rooms(name, sort, floors(label, sort)),
        project_dependencies(text, seq),
        agencies(company_name, agency_types(name, sort))`)
      .eq('project_id', projectId).eq('status', 'pending');
    if (agency) q = q.eq('agency_id', agency);
    const [{ data: items, error }, { data: irRows }] = await Promise.all([
      q,
      db.from('item_responsible').select('item_id, responsible').eq('project_id', projectId),
    ]);
    if (error) throw error;

    const respMap = new Map<string, string>();
    for (const r of (irRows ?? []) as { item_id: string; responsible: string }[]) {
      if (r.item_id && r.responsible) respMap.set(r.item_id, r.responsible);
    }

    type Raw = {
      id: string;
      first_raised_on: string | null; reminder_count: number; note: string | null;
      rooms: unknown; project_dependencies: unknown; agencies: unknown;
    };
    const rows: PdfRow[] = (items as Raw[] ?? []).map((i) => {
      const room = one(i.rooms as { name: string; sort: number; floors: unknown } | null);
      const floor = one(room?.floors as { label: string; sort: number } | null);
      const dep = one(i.project_dependencies as { text: string; seq: number } | null);
      const ag = one(i.agencies as { company_name: string; agency_types: unknown } | null);
      const type = one(ag?.agency_types as { name: string; sort: number } | null);
      const responsible = respMap.get(i.id) || type?.name;
      const blockedBy = formatBlockedBy(responsible, ag?.company_name);

      return {
        floorLabel: floor?.label ?? '', floorSort: floor?.sort ?? 0,
        roomName: room?.name ?? '', roomSort: room?.sort ?? 0,
        agencyType: blockedBy, agencyTypeSort: type?.sort ?? 999, company: ag?.company_name ?? '—',
        seq: dep?.seq ?? 0, text: dep?.text ?? '', note: i.note,
        firstRaisedOn: i.first_raised_on, reminderCount: i.reminder_count,
      };
    });

    const generatedOn = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const pdf = await buildPendingPdf({
      projectName: project.name, clientName: project.client_name, siteAddress: project.site_address,
      generatedOn, terms: project.terms ?? '', rows,
    }, await loadPdfFonts());

    const file = `${project.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'project'}_pending_${generatedOn}.pdf`;
    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${file}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
}
