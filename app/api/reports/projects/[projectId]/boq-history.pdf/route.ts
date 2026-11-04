import { handle, HttpError, requireUser } from '@/lib/auth';
import { loadPdfFonts } from '@/lib/pdf/fonts';
import { buildBoqHistoryPdf, type BoqHistoryItem } from '@/lib/pdf/boqReport';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  return handle(async () => {
    const { projectId } = await ctx.params;
    if (!UUID.test(projectId)) throw new HttpError(400, 'Bad project id');
    const { db } = await requireUser();

    const { data: project, error: pErr } = await db
      .from('projects')
      .select('name, client_name, site_address')
      .eq('id', projectId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!project) throw new HttpError(404, 'Project not found');

    const { data: events, error: eErr } = await db
      .from('boq_events')
      .select('at, event, product, room, floor, project_changes(requested_by, reason, reference_type, reference)')
      .eq('project_id', projectId)
      .order('at', { ascending: false });
    if (eErr) throw eErr;

    type Raw = {
      at: string;
      event: string;
      product: string;
      room: string | null;
      floor: string | null;
      project_changes: {
        requested_by: string;
        reason: string;
        reference_type: string | null;
        reference: string | null;
      } | null;
    };

    const historyItems: BoqHistoryItem[] = ((events as unknown as Raw[]) ?? []).map((ev) => ({
      at: ev.at,
      event: ev.event,
      product: ev.product,
      room: ev.room,
      floor: ev.floor,
      requestedBy: ev.project_changes?.requested_by ?? '',
      reason: ev.project_changes?.reason ?? '',
      referenceType: ev.project_changes?.reference_type ?? null,
      reference: ev.project_changes?.reference ?? null,
    }));

    const generatedOn = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const pdf = await buildBoqHistoryPdf(
      {
        projectName: project.name,
        clientName: project.client_name,
        siteAddress: project.site_address,
        generatedOn,
        history: historyItems,
      },
      await loadPdfFonts()
    );

    const safeName = project.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'project';
    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safeName}_BOQ_History_${generatedOn}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
}
