// v5 reminder categories (sheet tab "Reminder Format", migration 0010).
// A category lists pending items by who they wait on; the PM ticks recipient groups and sends one message per agency.
import type { Me } from './auth';
import { HttpError } from './auth';
import { draftsOf, saveDraft, sendDispatch, type Channel, type SendOutcome } from './dispatch';
import { buildAgencyReport, type BuiltReport, type Contact, type ReportItem } from './report';
import type { Db } from './supabase/server';

type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T => (Array.isArray(v) ? v[0] : v) as T;
const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

export interface CategoryAgency { id: string; companyName: string; contacts: { name: string; designation: string | null; email: string | null; phone: string | null }[] }
export interface CategoryRecipient { agencyTypeId: string; name: string; internal: boolean; defaultChecked: boolean; agencies: CategoryAgency[] }
export interface Category { key: string; label: string; colour: string | null; itemCount: number; recipients: CategoryRecipient[] }

interface AgencyRow {
  id: string; company_name: string; agency_type_id: string;
  agency_contacts: { name: string; designation: string | null; email: string | null; phone: string | null; active: boolean }[];
}

async function loadAgencies(db: Db, projectId: string): Promise<AgencyRow[]> {
  const { data, error } = await db.from('agencies')
    .select('id, company_name, agency_type_id, agency_contacts(name, designation, email, phone, active)')
    .eq('project_id', projectId).order('created_at');
  if (error) throw new HttpError(400, error.message);
  return (data ?? []) as AgencyRow[];
}

/** GET …/reminder-categories: every category with its pending count and the project's agencies per recipient group. */
export async function loadCategories(db: Db, projectId: string): Promise<Category[]> {
  const [cats, recips, counts, agencies] = await Promise.all([
    db.from('reminder_categories').select('key, label, colour, sort').order('sort'),
    db.from('reminder_category_recipients').select('category_key, agency_type_id, default_checked, sort, agency_types(name, internal)').order('sort'),
    db.from('reminder_category_items').select('category_key').eq('project_id', projectId),
    loadAgencies(db, projectId),
  ]);
  for (const r of [cats, recips, counts]) if (r.error) throw new HttpError(400, r.error.message);
  const n = new Map<string, number>();
  for (const r of counts.data ?? []) n.set(r.category_key, (n.get(r.category_key) ?? 0) + 1);
  return (cats.data ?? []).map((c) => ({
    key: c.key, label: c.label, colour: c.colour, itemCount: n.get(c.key) ?? 0,
    recipients: (recips.data ?? []).filter((r) => r.category_key === c.key).map((r) => {
      const t = one(r.agency_types as One<{ name: string; internal: boolean }>);
      return {
        agencyTypeId: r.agency_type_id, name: t.name, internal: t.internal, defaultChecked: r.default_checked,
        agencies: agencies.filter((a) => a.agency_type_id === r.agency_type_id).map((a) => ({
          id: a.id, companyName: a.company_name,
          contacts: a.agency_contacts.filter((x) => x.active).map(({ name, designation, email, phone }) => ({ name, designation, email, phone })),
        })),
      };
    }),
  }));
}

export interface RoundInput { category: string; agencyTypeIds: string[]; channel: Channel; preview?: boolean }

/** Validates the request body; throws 400 with a plain message. */
export function parseRoundInput(body: unknown): RoundInput {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.category !== 'string' || !b.category) throw new HttpError(400, 'category is required');
  if (!Array.isArray(b.agencyTypeIds) || !b.agencyTypeIds.length || !b.agencyTypeIds.every((x) => typeof x === 'string'))
    throw new HttpError(400, 'Tick at least one recipient group');
  if (b.channel !== 'email' && b.channel !== 'whatsapp') throw new HttpError(400, "channel must be 'email' or 'whatsapp'");
  return { category: b.category, agencyTypeIds: [...new Set(b.agencyTypeIds as string[])], channel: b.channel, preview: b.preview === true };
}

export interface PlannedMessage { agencyId: string; agency: string; typeName: string; report: BuiltReport }

/**
 * Pure: one report per selected agency, each listing ALL items of the category (not only the agency's own).
 * Agencies of an unselected group are ignored. Every active contact receives it; no escalation, no CC.
 */
export function planRound(input: {
  project: { name: string; clientName: string | null; terms: string };
  date: string; category: string;
  groups: { agencyTypeId: string; name: string; internal: boolean }[];
  agencies: { id: string; companyName: string; agencyTypeId: string; contacts: Contact[] }[];
  items: ReportItem[];
  pm: { name: string; email: string; phone: string | null };
}): { messages: PlannedMessage[]; warnings: string[] } {
  const warnings: string[] = [];
  const messages: PlannedMessage[] = [];
  for (const g of input.groups) {
    const mine = input.agencies.filter((a) => a.agencyTypeId === g.agencyTypeId);
    if (!mine.length) { warnings.push(`${g.name}: not added to this project; skipped.`); continue; }
    for (const a of mine) {
      const report = buildAgencyReport({
        project: input.project, visitDate: input.date, occasion: 'follow_up', category: input.category,
        agency: { companyName: a.companyName, typeName: g.name, contacts: a.contacts, internal: g.internal },
        pm: input.pm, items: input.items,
      });
      warnings.push(...report.warnings);
      messages.push({ agencyId: a.id, agency: `${g.name} – ${a.companyName}`, typeName: g.name, report });
    }
  }
  return { messages, warnings };
}

interface ItemRow {
  id: string; first_raised_on: string | null; reminder_count: number; note: string | null; stuck_reason: string | null;
  rooms: One<{ name: string; sort: number; floors: One<{ label: string; sort: number }> }>;
  project_dependencies: One<{ text: string; seq: number }>;
}

export type RoundResult =
  | { preview: true; itemCount: number; drafts: { agency: string; email: BuiltReport['email']; whatsapp: BuiltReport['whatsapp'] }[];
      email: BuiltReport['email']; whatsapp: BuiltReport['whatsapp']; warnings: string[] }
  | { preview: false; visitId: string; itemCount: number;
      dispatches: { id: string; agency: string; channel: Channel; outcome: SendOutcome | { status: 'failed'; error: string } }[]; warnings: string[] };

/** POST …/reminder-rounds. preview writes nothing; otherwise opens an office round, saves and sends one draft per agency. */
export async function runRound(db: Db, me: Me, projectId: string, input: RoundInput): Promise<RoundResult> {
  const [{ data: cat }, { data: recips }, { data: catItems, error: ciErr }, { data: project }, { data: types }, agencies] = await Promise.all([
    db.from('reminder_categories').select('key, label').eq('key', input.category).maybeSingle(),
    db.from('reminder_category_recipients').select('agency_type_id').eq('category_key', input.category),
    db.from('reminder_category_items').select('item_id, agency_type_id').eq('project_id', projectId).eq('category_key', input.category),
    db.from('projects').select('name, client_name, terms').eq('id', projectId).maybeSingle(),
    db.from('agency_types').select('id, name, internal'),
    loadAgencies(db, projectId),
  ]);
  if (!cat) throw new HttpError(400, `Unknown category "${input.category}"`);
  if (!project) throw new HttpError(404, 'Project not found');
  if (ciErr) throw new HttpError(400, ciErr.message);
  const allowed = new Set((recips ?? []).map((r) => r.agency_type_id));
  const bad = input.agencyTypeIds.filter((id) => !allowed.has(id));
  if (bad.length) throw new HttpError(400, `Not a recipient group of "${cat.label}"`);

  const typeById = new Map((types ?? []).map((t) => [t.id as string, t as { id: string; name: string; internal: boolean }]));
  const ownerOf = new Map((catItems ?? []).map((r) => [r.item_id as string, typeById.get(r.agency_type_id)?.name ?? null]));
  if (!ownerOf.size) throw new HttpError(400, `Nothing pending under "${cat.label}"`);

  const { data: rows, error: iErr } = await db.from('dependency_items')
    .select('id, first_raised_on, reminder_count, note, stuck_reason, rooms(name, sort, floors(label, sort)), project_dependencies(text, seq)')
    .eq('project_id', projectId).eq('status', 'pending');
  if (iErr) throw new HttpError(400, iErr.message);
  const items: ReportItem[] = ((rows ?? []) as ItemRow[]).filter((r) => ownerOf.has(r.id)).map((r) => {
    const room = one(r.rooms), floor = one(room.floors), dep = one(r.project_dependencies);
    return {
      itemId: r.id, floorLabel: floor.label, floorSort: floor.sort, roomName: room.name, roomSort: room.sort,
      seq: dep.seq, text: dep.text, firstRaisedOn: r.first_raised_on, reminderCount: r.reminder_count,
      note: [r.stuck_reason, r.note].filter(Boolean).join(' · ') || null, owner: ownerOf.get(r.id),
    };
  });

  const plan = planRound({
    project: { name: project.name, clientName: project.client_name, terms: project.terms },
    date: todayIst(), category: cat.label,
    groups: input.agencyTypeIds.map((id) => typeById.get(id)).filter((t): t is { id: string; name: string; internal: boolean } => !!t)
      .map((t) => ({ agencyTypeId: t.id, name: t.name, internal: t.internal })),
    agencies: agencies.map((a) => ({ id: a.id, companyName: a.company_name, agencyTypeId: a.agency_type_id, contacts: a.agency_contacts })),
    items, pm: { name: me.fullName, email: me.email, phone: me.phone },
  });

  if (input.preview) {
    const drafts = plan.messages.map((m) => ({ agency: m.agency, email: m.report.email, whatsapp: m.report.whatsapp }));
    return { preview: true, itemCount: items.length, drafts, email: drafts[0]?.email ?? null, whatsapp: drafts[0]?.whatsapp ?? null, warnings: plan.warnings };
  }

  const sendable = plan.messages.flatMap((m) => draftsOf(m.report).filter((d) => d.channel === input.channel).map((d) => ({ m, d })));
  if (!sendable.length) {
    throw new HttpError(400, `No ${input.channel === 'email' ? 'email address' : 'WhatsApp number'} for the ticked groups. ${plan.warnings.join(' ')}`.trim());
  }
  const { data: visitId, error: vErr } = await db.rpc('start_office_followup', { p_project: projectId });
  if (vErr || !visitId) throw new HttpError(vErr?.message.includes('no access') ? 404 : 400, vErr?.message ?? 'could not start follow-up');

  const dispatches: Extract<RoundResult, { preview: false }>['dispatches'] = [];
  for (const { m, d } of sendable) {
    const id = await saveDraft(db, { projectId, visitId: visitId as string, agencyId: m.agencyId }, d, m.report);
    try {
      dispatches.push({ id, agency: m.agency, channel: d.channel, outcome: await sendDispatch(db, me, id) });
    } catch (e) {
      dispatches.push({ id, agency: m.agency, channel: d.channel, outcome: { status: 'failed', error: e instanceof Error ? e.message : String(e) } });
    }
  }
  return { preview: false, visitId: visitId as string, itemCount: items.length, dispatches, warnings: plan.warnings };
}
