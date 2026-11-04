// GET /api/reports/completed.pdf — completed items across all projects (or ?project=<id>)
import { handle, requireUser } from '@/lib/auth';
import { loadPdfFonts } from '@/lib/pdf/fonts';
import { buildCompletedPdf, type CompletedItem, type CompletedProject } from '@/lib/pdf/completedReport';

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
      const pdf = await buildCompletedPdf({ generatedOn, projects: [] }, await loadPdfFonts());
      return new Response(Buffer.from(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="VTech_completed_${generatedOn}.pdf"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }

    const items: any[] = [];
    for (let from = 0; ids.length; from += 1000) {
      const { data, error } = await db
        .from('dependency_items')
        .select(`
          project_id, first_raised_on, completed_on, note,
          rooms(name, sort, floors(label, sort)),
          project_dependencies(text, seq),
          room_products(location, product_catalogue(title)),
          product_steps(label, seq),
          agencies(company_name, agency_types(name, sort))
        `)
        .in('project_id', ids)
        .eq('status', 'complete')
        .order('completed_on', { ascending: false })
        .range(from, from + 999);

      if (error) throw error;
      items.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    const byProject = new Map<string, CompletedProject>();
    for (const p of projects ?? []) {
      byProject.set(p.id, { name: p.name, clientName: p.client_name, items: [] });
    }

    for (const i of items) {
      const room = one<{ name: string; sort: number; floors: unknown }>(i.rooms);
      const floor = one<{ label: string; sort: number }>(room?.floors);
      const dep = one<{ text: string; seq: number }>(i.project_dependencies);
      const rp = one<{ location: string | null; product_catalogue: unknown }>(i.room_products);
      const prodCat = one<{ title: string }>(rp?.product_catalogue);
      const step = one<{ label: string; seq: number }>(i.product_steps);
      const ag = one<{ company_name: string; agency_types: unknown }>(i.agencies);
      const type = one<{ name: string; sort: number }>(ag?.agency_types);
      const proj = byProject.get(i.project_id);
      if (!proj) continue;

      let title = dep?.text ?? 'Dependency';
      if (prodCat?.title) {
        title = `${prodCat.title}${rp?.location ? ` (${rp.location})` : ''} · ${step?.label ?? dep?.text ?? 'Step'}`;
      }

      let daysToComplete: number | null = null;
      if (i.first_raised_on && i.completed_on) {
        const start = new Date(i.first_raised_on).getTime();
        const end = new Date(i.completed_on).getTime();
        daysToComplete = Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
      }

      const row: CompletedItem = {
        floorLabel: floor?.label ?? 'Floor',
        floorSort: floor?.sort ?? 0,
        roomName: room?.name ?? 'Room',
        roomSort: room?.sort ?? 0,
        productTitle: title,
        agencyType: type?.name ?? 'General',
        company: ag?.company_name ?? '—',
        firstRaisedOn: i.first_raised_on,
        completedOn: i.completed_on,
        daysToComplete,
        note: i.note,
      };
      proj.items.push(row);
    }

    const generatedOn = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const list = [...byProject.values()].sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
    const pdf = await buildCompletedPdf({ generatedOn, projects: list }, await loadPdfFonts());

    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="VTech_completed_${generatedOn}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
}
