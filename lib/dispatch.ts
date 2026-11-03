// Orchestration: visit → per-agency dispatch drafts → send/confirm.
// The PM reviews every draft before anything leaves (spec §4.3).

import type { Me } from './auth';
import { HttpError } from './auth';
import { buildAgencyReport, type BuiltReport, type Person, type ReportItem } from './report';
import { gmailComposeUrl, sendViaGmailApi, type OutgoingEmail } from './channels/email';
import { sendMetaTemplate, waLink } from './channels/whatsapp';
import { env } from './env';
import type { Db } from './supabase/server';

type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T => (Array.isArray(v) ? v[0] : v) as T;

interface ItemRow {
  id: string; agency_id: string | null; first_raised_on: string | null; reminder_count: number; note: string | null; stuck_reason?: string | null;
  rooms: One<{ name: string; sort: number; floors: One<{ label: string; sort: number }> }>;
  project_dependencies: One<{ text: string; seq: number }>;
}
interface AgencyRow {
  id: string; company_name: string;
  agency_types: One<{ name: string; internal: boolean }>;
  agency_contacts: { id: string; name: string; designation: string | null; email: string | null; phone: string | null; active: boolean }[];
}

export type Channel = 'email' | 'whatsapp';

export interface PrepareResult {
  dispatches: { id: string; agency: string; channel: Channel; itemCount: number }[];
  warnings: string[];
}

export interface PrepareOptions {
  /** Only these agencies (default: every agency with pending items). */
  agencyIds?: string[];
  /** Only these pending items (default: all pending items of the selected agencies). */
  itemIds?: string[];
}

export async function prepareDispatches(db: Db, me: Me, visitId: string, opts: PrepareOptions = {}): Promise<PrepareResult> {
  const { data: visit, error: vErr } = await db.from('site_visits')
    .select('id, project_id, visit_date, status, kind').eq('id', visitId).single();
  if (vErr || !visit) throw new HttpError(404, 'Visit not found');
  if (visit.status === 'draft') throw new HttpError(409, 'Finalize the visit before preparing reminders');

  const [{ data: project }, { data: agencies }, { data: items }] = await Promise.all([
    db.from('projects').select('name, client_name, terms').eq('id', visit.project_id).single(),
    db.from('agencies').select('id, company_name, agency_types(name, internal), agency_contacts(id, name, designation, email, phone, active)')
      .eq('project_id', visit.project_id),
    db.from('dependency_items')
      .select('id, agency_id, first_raised_on, reminder_count, note, stuck_reason, rooms!inner(name, sort, floors!inner(label, sort)), project_dependencies!inner(text, seq)')
      .eq('project_id', visit.project_id).eq('status', 'pending'),
  ]);
  if (!project) throw new HttpError(404, 'Project not found');

  const { data: existing } = await db.from('dispatches').select('agency_id, channel, status').eq('visit_id', visitId);
  const alreadySent = new Set((existing ?? []).filter((d) => d.status === 'sent').map((d) => `${d.agency_id}:${d.channel}`));
  await db.from('dispatches').delete().eq('visit_id', visitId).in('status', ['draft', 'failed']);

  const warnings: string[] = [];
  const byAgency = new Map<string, ReportItem[]>();
  const onlyAgencies = opts.agencyIds?.length ? new Set(opts.agencyIds) : null;
  const onlyItems = opts.itemIds?.length ? new Set(opts.itemIds) : null;
  let clientSkipped = 0;
  for (const r of (items ?? []) as ItemRow[]) {
    if (onlyItems && !onlyItems.has(r.id)) continue;
    if (onlyAgencies && (!r.agency_id || !onlyAgencies.has(r.agency_id))) continue;
    const room = one(r.rooms), floor = one(room.floors), dep = one(r.project_dependencies);
    if (!r.agency_id) { warnings.push(`"${dep.text}" in ${floor.label} – ${room.name} has no agency assigned; not sent.`); continue; }
    const list = byAgency.get(r.agency_id) ?? [];
    list.push({
      itemId: r.id, floorLabel: floor.label, floorSort: floor.sort, roomName: room.name, roomSort: room.sort,
      seq: dep.seq, text: dep.text, firstRaisedOn: r.first_raised_on, reminderCount: r.reminder_count, note: [r.stuck_reason, r.note].filter(Boolean).join(' · ') || null,
    });
    byAgency.set(r.agency_id, list);
  }

  const result: PrepareResult = { dispatches: [], warnings };
  for (const a of (agencies ?? []) as AgencyRow[]) {
    const list = byAgency.get(a.id);
    if (!list?.length) continue;
    const typeName = one(a.agency_types).name;
    // Items waiting on the client are reported, never chased by reminder (VTech's rule).
    if (typeName === 'Client') { clientSkipped += list.length; continue; }
    const report = buildAgencyReport({
      project: { name: project.name, clientName: project.client_name, terms: project.terms },
      visitDate: visit.visit_date,
      occasion: visit.kind === 'office' ? 'follow_up' : 'site_visit',
      agency: { companyName: a.company_name, typeName, contacts: a.agency_contacts, internal: !!one(a.agency_types).internal },
      pm: { name: me.fullName, email: me.email, phone: me.phone },
      items: list,
    });
    warnings.push(...report.warnings);

    for (const d of draftsOf(report)) {
      if (alreadySent.has(`${a.id}:${d.channel}`)) { warnings.push(`${a.company_name} ${d.channel} already sent for this visit; not re-drafted.`); continue; }
      const id = await saveDraft(db, { projectId: visit.project_id, visitId, agencyId: a.id }, d, report);
      result.dispatches.push({ id, agency: `${typeName} – ${a.company_name}`, channel: d.channel, itemCount: list.length });
    }
  }
  if (clientSkipped) warnings.push(`${clientSkipped} item${clientSkipped === 1 ? '' : 's'} waiting on the client — not sent as reminders (shown in reports).`);
  return result;
}

export interface Draft { channel: Channel; recipients: { to: Person[]; cc: Person[] }; subject: string | null; text: string; html: string | null }

/** The email and/or WhatsApp drafts a built report yields (a channel is missing when no contact has it). */
export function draftsOf(report: BuiltReport): Draft[] {
  const drafts: Draft[] = [];
  if (report.email) drafts.push({ channel: 'email', recipients: { to: report.email.to, cc: report.email.cc }, subject: report.email.subject, text: report.email.text, html: report.email.html });
  if (report.whatsapp) drafts.push({ channel: 'whatsapp', recipients: { to: report.whatsapp.to, cc: [] }, subject: null, text: report.whatsapp.text, html: null });
  return drafts;
}

/** Saves one draft + its items. dispatches.level / dispatch_items.level are legacy NOT NULL columns: always 1 since v5. */
export async function saveDraft(db: Db, at: { projectId: string; visitId: string; agencyId: string }, d: Draft, report: BuiltReport): Promise<string> {
  const { data: row, error } = await db.from('dispatches').insert({
    project_id: at.projectId, visit_id: at.visitId, agency_id: at.agencyId, channel: d.channel, level: 1,
    recipients: d.recipients, subject: d.subject, body_text: d.text, body_html: d.html,
  }).select('id').single();
  if (error || !row) throw new HttpError(500, `Could not save draft: ${error?.message}`);
  const { error: diErr } = await db.from('dispatch_items').insert(
    report.items.map((i) => ({ dispatch_id: row.id, item_id: i.itemId, reminder_no: i.reminderNo, level: 1 })));
  if (diErr) throw new HttpError(500, `Could not save draft items: ${diErr.message}`);
  return row.id as string;
}

export type SendOutcome =
  | { status: 'sent'; ref: string }
  | { status: 'needs_confirmation'; links: { label: string; url: string }[] };

export async function sendDispatch(db: Db, me: Me, dispatchId: string): Promise<SendOutcome> {
  const { data: d } = await db.from('dispatches')
    .select('id, channel, status, recipients, subject, body_text, body_html').eq('id', dispatchId).single();
  if (!d) throw new HttpError(404, 'Dispatch not found');
  if (d.status === 'sent') throw new HttpError(409, 'Already sent');
  const rcpt = d.recipients as { to: Person[]; cc: Person[] };

  try {
    if (d.channel === 'email') {
      const mail: OutgoingEmail = {
        from: { name: me.fullName, email: me.email }, to: rcpt.to, cc: rcpt.cc,
        subject: d.subject ?? '', text: d.body_text, html: d.body_html ?? d.body_text,
      };
      const mode = env.emailMode();
      if (mode === 'compose_link') return { status: 'needs_confirmation', links: [{ label: 'Open in Gmail', url: gmailComposeUrl(mail) }] };
      const ref = mode === 'dryrun' ? `dryrun-${Date.now()}` : await sendViaGmailApi(mail, env.googleServiceAccountJson());
      await rpc(db, 'mark_dispatch_sent', { p_dispatch: d.id, p_ref: ref });
      return { status: 'sent', ref };
    }

    if (env.whatsappMode() === 'link') {
      const links = rcpt.to.flatMap((p) => {
        const url = p.phone ? waLink(p.phone, d.body_text) : null;
        return url ? [{ label: `WhatsApp ${p.name}`, url }] : [];
      });
      if (!links.length) throw new Error('No valid WhatsApp numbers');
      return { status: 'needs_confirmation', links };
    }
    const cfg = env.meta();
    const refs: string[] = [];
    for (const p of rcpt.to) if (p.phone) refs.push(await sendMetaTemplate(cfg, p.phone, d.body_text));
    const ref = refs.join(',');
    await rpc(db, 'mark_dispatch_sent', { p_dispatch: d.id, p_ref: ref });
    return { status: 'sent', ref };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await rpc(db, 'mark_dispatch_failed', { p_dispatch: d.id, p_error: msg });
    throw new HttpError(502, `Send failed: ${msg}`);
  }
}

/** PM confirms they actually sent a link-mode message. */
export async function confirmDispatch(db: Db, dispatchId: string) {
  await rpc(db, 'mark_dispatch_sent', { p_dispatch: dispatchId, p_ref: 'manual' });
}

async function rpc(db: Db, fn: string, args: Record<string, unknown>) {
  const { error } = await db.rpc(fn, args);
  if (error) throw new HttpError(400, error.message);
}
