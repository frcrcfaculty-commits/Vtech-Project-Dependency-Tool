// GET /api/reports/boq.pdf — all products (BOQ) across all projects (or ?project=<id>)
import { handle, requireUser } from '@/lib/auth';
import { loadPdfFonts } from '@/lib/pdf/fonts';
import { buildAllBoqPdf, type BoqProjectLine, type BoqProjectGroup } from '@/lib/pdf/allBoqReport';

export const runtime = 'nodejs';

const one = <T,>(x: unknown): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null)) as T | null;

export async function GET(req: Request) {
  return handle(async () => {
    const { db } = await requireUser();
    const url = new URL(req.url);
    const filterProjectId = url.searchParams.get('project');

    let query = db.from('projects').select('id, name, client_name, status').neq('status', 'closed');
    if (filterProjectId) {
      query = query.eq('id', filterProjectId);
    }
    const { data: projects, error: pErr } = await query.order('name');
    if (pErr) throw pErr;

    const ids = (projects ?? []).map((p) => p.id);
    if (!ids.length) {
      const generatedOn = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
      const pdf = await buildAllBoqPdf({ generatedOn, projects: [] }, await loadPdfFonts());
      return new Response(Buffer.from(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="VTech_BOQ_${generatedOn}.pdf"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }

    const { data: rooms, error: rErr } = await db
      .from('rooms')
      .select('id, project_id, name, sort, floors(label, sort)')
      .in('project_id', ids);
    if (rErr) throw rErr;

    const roomMap = new Map<string, { projectId: string; roomName: string; roomSort: number; floorLabel: string; floorSort: number }>();
    for (const r of rooms ?? []) {
      const fl = one<{ label: string; sort: number }>(r.floors);
      roomMap.set(r.id, {
        projectId: r.project_id,
        roomName: r.name,
        roomSort: r.sort,
        floorLabel: fl?.label ?? 'Floor',
        floorSort: fl?.sort ?? 0,
      });
    }

    const { data: roomProducts, error: rpErr } = await db
      .from('room_products')
      .select('id, room_id, location, make, model, note, quantity, product_catalogue(title)')
      .order('id');
    if (rpErr) throw rpErr;

    const byProject = new Map<string, BoqProjectGroup>();
    for (const p of projects ?? []) {
      byProject.set(p.id, { name: p.name, clientName: p.client_name, lines: [] });
    }

    for (const rp of roomProducts ?? []) {
      const rInfo = roomMap.get(rp.room_id);
      if (!rInfo) continue;
      const proj = byProject.get(rInfo.projectId);
      if (!proj) continue;

      const cat = one<{ title: string }>(rp.product_catalogue);
      proj.lines.push({
        floorLabel: rInfo.floorLabel,
        floorSort: rInfo.floorSort,
        roomName: rInfo.roomName,
        roomSort: rInfo.roomSort,
        productTitle: cat?.title ?? 'Product',
        location: rp.location ?? null,
        make: rp.make ?? null,
        model: rp.model ?? null,
        quantity: rp.quantity || 1,
        note: rp.note ?? null,
      });
    }

    // Sort lines in each project: floorSort -> roomSort -> productTitle -> location
    for (const p of byProject.values()) {
      p.lines.sort(
        (a, b) =>
          a.floorSort - b.floorSort ||
          a.roomSort - b.roomSort ||
          a.productTitle.localeCompare(b.productTitle) ||
          (a.location || '').localeCompare(b.location || '')
      );
    }

    const generatedOn = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const list = [...byProject.values()].sort((a, b) => b.lines.length - a.lines.length || a.name.localeCompare(b.name));
    const pdf = await buildAllBoqPdf({ generatedOn, projects: list }, await loadPdfFonts());

    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="VTech_BOQ_${generatedOn}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
}
