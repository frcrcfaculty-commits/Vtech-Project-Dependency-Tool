// Weekly digest for super admins (Vipul). buildDigest is pure and tested; loadDigestRows reads with the service role.

import { levelForReminder } from './escalation';
import { daysOpen, formatDate } from './report';
import { supabaseAdmin } from './supabase/server';

export interface DigestItem { projectId: string; agency: string; status: string; firstRaisedOn: string | null; completedOn: string | null; reminderCount: number }
export interface DigestProject { id: string; name: string; l2After: number; l3After: number; lastVisit: string | null }

export function buildDigest(projects: DigestProject[], items: DigestItem[], asOf: string) {
  const weekAgo = new Date(Date.parse(`${asOf}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  const sections = projects.map((p) => {
    const mine = items.filter((i) => i.projectId === p.id);
    const pending = mine.filter((i) => i.status === 'pending');
    const closedThisWeek = mine.filter((i) => i.status === 'complete' && i.completedOn && i.completedOn > weekAgo).length;
    const policy = { l2After: p.l2After, l3After: p.l3After, mgmtCcLevel: 4 };
    const escalated = pending.filter((i) => i.reminderCount > 0 && levelForReminder(i.reminderCount, policy) >= 2).length;
    const oldest = pending.reduce<number | null>((m, i) => { const d = daysOpen(i.firstRaisedOn, asOf); return d !== null && (m === null || d > m) ? d : m; }, null);
    const byAgency = new Map<string, number>();
    for (const i of pending) byAgency.set(i.agency, (byAgency.get(i.agency) ?? 0) + 1);
    return { project: p, pending: pending.length, closedThisWeek, escalated, oldest, byAgency: [...byAgency.entries()].sort((a, b) => b[1] - a[1]) };
  }).sort((a, b) => b.escalated - a.escalated || b.pending - a.pending);

  const text = [
    `VTech site dependencies — week ending ${formatDate(asOf)}`,
    '',
    ...sections.flatMap((s) => [
      `${s.project.name}: ${s.pending} pending, ${s.escalated} escalated (L2+), ${s.closedThisWeek} closed this week, oldest ${s.oldest ?? 0} days, last visit ${formatDate(s.project.lastVisit)}`,
      ...s.byAgency.map(([a, n]) => `   • ${a}: ${n}`),
    ]),
  ].join('\n');

  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;max-width:760px">
<h2 style="font-size:18px">VTech site dependencies — week ending ${formatDate(asOf)}</h2>
<table style="border-collapse:collapse;width:100%;font-size:13px">
<thead><tr style="background:#f4f4f4;text-align:left"><th style="padding:6px">Project</th><th style="padding:6px">Pending</th><th style="padding:6px">Escalated</th><th style="padding:6px">Closed (7d)</th><th style="padding:6px">Oldest</th><th style="padding:6px">Last visit</th><th style="padding:6px">By agency</th></tr></thead>
<tbody>${sections.map((s) => `<tr>
<td style="padding:6px;border-bottom:1px solid #eee"><b>${esc(s.project.name)}</b></td>
<td style="padding:6px;border-bottom:1px solid #eee">${s.pending}</td>
<td style="padding:6px;border-bottom:1px solid #eee${s.escalated ? ';color:#b42318;font-weight:600' : ''}">${s.escalated}</td>
<td style="padding:6px;border-bottom:1px solid #eee">${s.closedThisWeek}</td>
<td style="padding:6px;border-bottom:1px solid #eee">${s.oldest ?? 0} d</td>
<td style="padding:6px;border-bottom:1px solid #eee">${formatDate(s.project.lastVisit)}</td>
<td style="padding:6px;border-bottom:1px solid #eee">${s.byAgency.map(([a, n]) => `${esc(a)} ${n}`).join(', ') || '—'}</td></tr>`).join('')}</tbody></table></div>`;

  return { subject: `VTech weekly: ${sections.reduce((n, s) => n + s.pending, 0)} pending across ${sections.length} projects`, text, html, sections };
}

export async function loadDigestRows() {
  const db = supabaseAdmin();
  const { data: projects, error } = await db.from('projects').select('id, name, l2_after, l3_after').eq('status', 'active');
  if (error) throw error;
  const ids = (projects ?? []).map((p) => p.id);
  if (!ids.length) return { projects: [], items: [] };
  const [{ data: items }, { data: visits }, { data: recipients }] = await Promise.all([
    db.from('dependency_items').select('project_id, status, first_raised_on, completed_on, reminder_count, agencies(company_name, agency_types(name))')
      .in('project_id', ids).in('status', ['pending', 'complete']),
    db.from('site_visits').select('project_id, visit_date').in('project_id', ids).order('visit_date', { ascending: false }),
    db.from('profiles').select('full_name, email').eq('role', 'super_admin').eq('active', true),
  ]);
  const lastVisit = new Map<string, string>();
  for (const v of visits ?? []) if (!lastVisit.has(v.project_id)) lastVisit.set(v.project_id, v.visit_date);
  type Ag = { company_name: string; agency_types: { name: string } | { name: string }[] } | null;
  const agencyName = (a: Ag | Ag[]) => {
    const x = Array.isArray(a) ? a[0] : a;
    if (!x) return 'Unassigned';
    const t = Array.isArray(x.agency_types) ? x.agency_types[0] : x.agency_types;
    return `${t?.name ?? ''} – ${x.company_name}`;
  };
  return {
    projects: (projects ?? []).map((p) => ({ id: p.id, name: p.name, l2After: p.l2_after, l3After: p.l3_after, lastVisit: lastVisit.get(p.id) ?? null })),
    items: (items ?? []).map((i) => ({
      projectId: i.project_id, agency: agencyName(i.agencies as unknown as Ag | Ag[]), status: i.status,
      firstRaisedOn: i.first_raised_on, completedOn: i.completed_on, reminderCount: i.reminder_count,
    })),
    recipients: (recipients ?? []).map((r) => ({ name: r.full_name, email: r.email })),
  };
}
