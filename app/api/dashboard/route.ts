import { handle, json, requireUser } from '@/lib/auth';
import { buildDigest } from '@/lib/digest';

// GET: portfolio summary for every project the signed-in user can see (Vipul sees all).
export async function GET() {
  return handle(async () => {
    const { db } = await requireUser();
    const { data: projects, error } = await db.from('projects').select('id, name, l2_after, l3_after, status').neq('status', 'closed');
    if (error) throw error;
    const ids = (projects ?? []).map((p) => p.id);
    if (!ids.length) return json({ sections: [] });
    const [{ data: items }, { data: visits }] = await Promise.all([
      db.from('dependency_items').select('project_id, status, first_raised_on, completed_on, reminder_count, agencies(company_name, agency_types(name))')
        .in('project_id', ids).in('status', ['pending', 'complete']),
      db.from('site_visits').select('project_id, visit_date').in('project_id', ids).order('visit_date', { ascending: false }),
    ]);
    const last = new Map<string, string>();
    for (const v of visits ?? []) if (!last.has(v.project_id)) last.set(v.project_id, v.visit_date);
    const agencyName = (a: unknown) => {
      const x = (Array.isArray(a) ? a[0] : a) as { company_name: string; agency_types: unknown } | null;
      if (!x) return 'Unassigned';
      const t = (Array.isArray(x.agency_types) ? x.agency_types[0] : x.agency_types) as { name: string } | null;
      return `${t?.name ?? ''} – ${x.company_name}`;
    };
    const asOf = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const digest = buildDigest(
      (projects ?? []).map((p) => ({ id: p.id, name: p.name, l2After: p.l2_after, l3After: p.l3_after, lastVisit: last.get(p.id) ?? null })),
      (items ?? []).map((i) => ({ projectId: i.project_id, agency: agencyName(i.agencies), status: i.status, firstRaisedOn: i.first_raised_on, completedOn: i.completed_on, reminderCount: i.reminder_count })),
      asOf,
    );
    return json({ asOf, sections: digest.sections });
  });
}
