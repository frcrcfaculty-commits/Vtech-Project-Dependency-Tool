// GET /api/reports/pending.pdf — every pending item across all projects the signed-in user can see (RLS decides),
// grouped project → agency, with a cover page of totals per project. For Vipul / the PM lead.
import { handle, requireUser } from '@/lib/auth';
import { loadPdfFonts } from '@/lib/pdf/fonts';
import { buildPortfolioPdf, type PortfolioItem, type PortfolioProject } from '@/lib/pdf/portfolioReport';

export const runtime = 'nodejs';

const one = <T,>(x: unknown): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null)) as T | null;

export async function GET() {
  return handle(async () => {
    const { db } = await requireUser();
    const { data: projects, error: pErr } = await db.from('projects')
      .select('id, name, client_name, l2_after, l3_after, mgmt_cc_level, status').neq('status', 'closed').order('name');
    if (pErr) throw pErr;
    const ids = (projects ?? []).map((p) => p.id);

    const items: { project_id: string; first_raised_on: string | null; reminder_count: number; note: string | null;
      rooms: unknown; project_dependencies: unknown; agencies: unknown }[] = [];
    // Page through (PostgREST caps responses at 1,000 rows by default).
    for (let from = 0; ids.length; from += 1000) {
      const { data, error } = await db.from('dependency_items')
        .select(`project_id, first_raised_on, reminder_count, note,
          rooms(name, sort, floors(label, sort)), project_dependencies(text, seq),
          agencies(company_name, escalation_enabled, agency_types(name, sort))`)
        .in('project_id', ids).eq('status', 'pending').order('id').range(from, from + 999);
      if (error) throw error;
      items.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    const byProject = new Map<string, PortfolioProject>();
    for (const p of projects ?? []) {
      byProject.set(p.id, { name: p.name, clientName: p.client_name, items: [], escalationByAgency: {},
        policy: { l2After: p.l2_after, l3After: p.l3_after, mgmtCcLevel: p.mgmt_cc_level } });
    }
    for (const i of items) {
      const room = one<{ name: string; sort: number; floors: unknown }>(i.rooms);
      const floor = one<{ label: string; sort: number }>(room?.floors);
      const dep = one<{ text: string; seq: number }>(i.project_dependencies);
      const ag = one<{ company_name: string; escalation_enabled: boolean; agency_types: unknown }>(i.agencies);
      const type = one<{ name: string; sort: number }>(ag?.agency_types);
      const proj = byProject.get(i.project_id)!;
      const company = ag?.company_name ?? '—';
      proj.escalationByAgency![company] = ag?.escalation_enabled ?? true;
      const row: PortfolioItem = {
        floorLabel: floor?.label ?? '', floorSort: floor?.sort ?? 0, roomName: room?.name ?? '', roomSort: room?.sort ?? 0,
        agencyType: type?.name ?? 'Unassigned', agencyTypeSort: type?.sort ?? 999, company,
        seq: dep?.seq ?? 0, text: dep?.text ?? '', note: i.note, firstRaisedOn: i.first_raised_on, reminderCount: i.reminder_count,
      };
      proj.items.push(row);
    }

    const generatedOn = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    // Projects with pending items first (most pending on top); empty ones still appear on the cover with 0.
    const list = [...byProject.values()].sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
    const pdf = await buildPortfolioPdf({ generatedOn, projects: list }, await loadPdfFonts());
    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="VTech_pending_${generatedOn}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
}
