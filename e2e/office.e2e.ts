// Office mode (v2), API level: the real app (E2E_BASE_URL) + live Supabase, signed in as the PM lead (the office user).
// Covers add_room_dependencies (master + custom, idempotent), set_item_status with note → item_events, on-the-go pending add,
// POST /api/projects/{id}/reminders with itemIds → one email + one WhatsApp draft with only those items → send (dryrun) +
// confirm → counts +1, follow-up wording, and isolation for an unassigned PM. Nothing mocked.
import { expect, test } from '@playwright/test';
import { cleanup, env, ok, signIn, TEST_PREFIX, type Session } from './helpers';

const LEAD = { email: env('E2E_LEAD_EMAIL'), password: env('E2E_LEAD_PASSWORD') };
const PM = { email: env('E2E_PM_EMAIL'), password: env('E2E_PM_PASSWORD') };
const ist = (ago = 0) => new Date(Date.now() + 5.5 * 3_600_000 - ago * 86_400_000).toISOString().slice(0, 10);

test.describe.configure({ mode: 'serial' });

let lead: Session;
let pm: Session;
const s: { projectId?: string; roomA?: string; roomB?: string; elec?: string; carp?: string; types?: Record<string, string>;
  masters?: { id: string; agency_type_id: string }[]; items?: Record<string, string>; visitId?: string } = {};

test.beforeAll(async () => {
  await cleanup();
  lead = await signIn(LEAD.email, LEAD.password);
  pm = await signIn(PM.email, PM.password);
});
test.afterAll(async () => {
  await cleanup();
  await lead?.api.dispose();
  await pm?.api.dispose();
});

test('setup: PM lead creates a 1-floor project with two agencies', async () => {
  const { db } = lead;
  const p = ok(await db.from('projects').insert({ name: `${TEST_PREFIX} office ${Date.now()}`, client_name: 'E2E office' }).select('id').single(), 'project');
  s.projectId = p.id;
  const f = ok(await db.from('floors').insert({ project_id: p.id, label: 'Ground Floor', sort: 1 }).select('id').single(), 'floor');
  const rooms = ok(await db.from('rooms').insert([{ project_id: p.id, floor_id: f.id, name: 'Living Room', sort: 1 }, { project_id: p.id, floor_id: f.id, name: 'Kitchen', sort: 2 }])
    .select('id, name'), 'rooms');
  s.roomA = rooms.find((r) => r.name === 'Living Room')!.id;
  s.roomB = rooms.find((r) => r.name === 'Kitchen')!.id;
  const types = ok(await db.from('agency_types').select('id, name').in('name', ['Electrician', 'Carpenter']), 'types');
  s.types = Object.fromEntries(types.map((t) => [t.name, t.id]));
  const mk = async (type: string, company: string, contacts: { name: string; level: number; email?: string; phone: string }[]) => {
    const a = ok(await db.from('agencies').insert({ project_id: p.id, agency_type_id: s.types![type], company_name: company }).select('id').single(), type);
    ok(await db.from('agency_contacts').insert(contacts.map((c) => ({ project_id: p.id, agency_id: a.id, designation: `L${c.level}`, email: null, ...c }))).select('id'), `${type} contacts`);
    return a.id as string;
  };
  s.elec = await mk('Electrician', 'E2E Office Sparks', [
    { name: 'Office Elec L1', level: 1, email: 'l1@office-sparks.example.com', phone: '+919000000951' },
    { name: 'Office Elec L3', level: 3, email: 'l3@office-sparks.example.com', phone: '+919000000953' },
  ]);
  s.carp = await mk('Carpenter', 'E2E Office Wood', [{ name: 'Office Carp L1', level: 1, email: 'l1@office-wood.example.com', phone: '+919000000961' }]);
  s.masters = ok(await db.from('master_dependencies').select('id, agency_type_id').in('agency_type_id', Object.values(s.types!)).order('seq'), 'masters');
});

test('add_room_dependencies: master + custom on one room, idempotent, auto-assigned to agencies', async () => {
  const { db } = lead;
  const elecM = s.masters!.filter((m) => m.agency_type_id === s.types!.Electrician).slice(0, 3).map((m) => m.id);
  const carpM = s.masters!.filter((m) => m.agency_type_id === s.types!.Carpenter).slice(0, 2).map((m) => m.id);
  const custom = [{ agency_type_id: s.types!.Carpenter, text: 'E2E custom: TV unit back panel cutout pending.' }];
  const args = { p_room: s.roomA, p_master_ids: [...elecM, ...carpM], p_custom: custom };
  expect(ok(await db.rpc('add_room_dependencies', args), 'add')).toBe(6);
  expect(await db.rpc('add_room_dependencies', args).then((r) => r.data)).toBe(0); // idempotent
  // Kitchen: other room untouched
  expect(ok(await db.from('dependency_items').select('id').eq('room_id', s.roomB!), 'kitchen')).toHaveLength(0);
  const items = ok(await db.from('dependency_items').select('id, status, agency_id, project_dependencies(text, master_dependency_id)').eq('room_id', s.roomA!), 'items');
  expect(items).toHaveLength(6);
  expect(items.every((i) => i.status === 'unchecked' && (i.agency_id === s.elec || i.agency_id === s.carp))).toBe(true);
  const dep = (i: (typeof items)[number]) => (Array.isArray(i.project_dependencies) ? i.project_dependencies[0] : i.project_dependencies) as { text: string; master_dependency_id: string | null };
  const customItem = items.find((i) => dep(i).text.startsWith('E2E custom'))!;
  expect(dep(customItem).master_dependency_id).toBeNull();
  expect(customItem.agency_id).toBe(s.carp);
  s.items = Object.fromEntries(items.map((i, n) => [`a${n}`, i.id]));
  s.items.custom = customItem.id;
  s.items.e1 = items.find((i) => i.agency_id === s.elec)!.id;
  s.items.e2 = items.filter((i) => i.agency_id === s.elec)[1].id;
  s.items.c1 = items.find((i) => i.agency_id === s.carp && i.id !== customItem.id)!.id;
});

test('set_item_status: pending with note, done, N.A. → item rows + item_events history', async () => {
  const { db } = lead;
  const r1 = ok(await db.rpc('set_item_status', { p_item: s.items!.e1, p_status: 'pending', p_date: ist(5), p_note: 'Fittings not delivered', p_photo: null }), 'pending');
  expect(r1).toMatchObject({ status: 'pending', first_raised_on: ist(5), reminder_count: 0, note: 'Fittings not delivered' });
  ok(await db.rpc('set_item_status', { p_item: s.items!.e2, p_status: 'pending', p_date: ist(3), p_note: null, p_photo: null }), 'pending2');
  ok(await db.rpc('set_item_status', { p_item: s.items!.c1, p_status: 'pending', p_date: ist(2), p_note: null, p_photo: null }), 'pending3');
  const done = ok(await db.rpc('set_item_status', { p_item: s.items!.custom, p_status: 'complete', p_date: ist(1), p_note: 'Done per site call', p_photo: null }), 'done');
  expect(done).toMatchObject({ status: 'complete', completed_on: ist(1) });
  const notApplicable = Object.values(s.items!).find((id) => ![s.items!.e1, s.items!.e2, s.items!.c1, s.items!.custom].includes(id))!;
  expect(ok(await db.rpc('set_item_status', { p_item: notApplicable, p_status: 'na', p_date: ist(0), p_note: null, p_photo: null }), 'na').status).toBe('na');
  await expect(db.rpc('set_item_status', { p_item: notApplicable, p_status: 'unchecked' }).then((r) => r.error?.message)).resolves.toMatch(/pending, complete or na/);

  const ev = ok(await db.from('item_events').select('item_id, status, status_date, note, source, created_by').eq('project_id', s.projectId!), 'events');
  expect(ev).toHaveLength(5);
  expect(ev.every((e) => e.source === 'office' && e.created_by === lead.userId)).toBe(true);
  expect(ev.find((e) => e.item_id === s.items!.e1)).toMatchObject({ status: 'pending', status_date: ist(5), note: 'Fittings not delivered' });
});

test('on-the-go: add a dependency to another room already pending (raised today)', async () => {
  const { db } = lead;
  const m = s.masters!.filter((x) => x.agency_type_id === s.types!.Electrician)[5].id;
  expect(ok(await db.rpc('add_room_dependencies', { p_room: s.roomB, p_master_ids: [m], p_custom: [], p_initial_status: 'pending', p_date: ist(0) }), 'otg')).toBe(1);
  const it = ok(await db.from('dependency_items').select('id, status, first_raised_on, agency_id').eq('room_id', s.roomB!).single(), 'kitchen item');
  expect(it).toMatchObject({ status: 'pending', first_raised_on: ist(0), agency_id: s.elec });
  s.items!.k1 = it.id;
  expect(ok(await db.from('item_events').select('id').eq('item_id', it.id), 'otg events')).toHaveLength(1);
});

test('reminders with itemIds → exactly one email + one WhatsApp draft with only those items, follow-up wording', async () => {
  const chosen = [s.items!.e1, s.items!.k1]; // both Electrician; e2 (Electrician) and c1 (Carpenter) are pending but not chosen
  const res = await lead.api.post(`/api/projects/${s.projectId}/reminders`, { data: { itemIds: chosen } });
  expect(res.status(), await res.text()).toBe(200);
  const body = await res.json() as { visitId: string; dispatches: { id: string; channel: string; level: number; itemCount: number }[] };
  s.visitId = body.visitId;
  expect(body.dispatches.map((d) => d.channel).sort()).toEqual(['email', 'whatsapp']);
  expect(body.dispatches.every((d) => d.itemCount === 2 && d.level === 1)).toBe(true);

  const v = ok(await lead.db.from('site_visits').select('kind, status').eq('id', body.visitId).single(), 'round');
  expect(v).toMatchObject({ kind: 'office', status: 'finalized' });
  const di = ok(await lead.db.from('dispatch_items').select('dispatch_id, item_id').in('dispatch_id', body.dispatches.map((d) => d.id)), 'dispatch items');
  expect([...new Set(di.map((x) => x.item_id))].sort()).toEqual([...chosen].sort());

  const list = await (await lead.api.get(`/api/visits/${body.visitId}/dispatches`)).json() as {
    dispatches: { channel: string; subject: string | null; body_text: string; body_html: string | null; recipients: { to: { name: string }[] } }[] };
  const email = list.dispatches.find((d) => d.channel === 'email')!;
  const wa = list.dispatches.find((d) => d.channel === 'whatsapp')!;
  expect(email.recipients.to.map((p) => p.name)).toEqual(['Office Elec L1']);
  expect(email.body_text).toMatch(/^Dear Office Elec L1 and the E2E Office Sparks team,\n\nGreetings from VTech Technologies[^\n]*\n\nAs of .+ are still pending from your side\./m);
  expect(email.body_text).not.toMatch(/site visit/i);
  expect(email.body_html).toContain('are still pending.');
  expect(email.body_text).toContain('Fittings not delivered');
  expect(wa.body_text).toMatch(/Status as of /);
  expect(email.body_text).not.toContain('Ground Floor – Living Room: ' + 'E2E custom'); // done item never included

  // Empty selection of non-pending items → nothing to send, no round left behind
  const none = await lead.api.post(`/api/projects/${s.projectId}/reminders`, { data: { itemIds: [s.items!.custom] } });
  expect(none.status()).toBe(200);
  expect((await none.json()).visitId).toBeNull();
  expect(ok(await lead.db.from('site_visits').select('id').eq('project_id', s.projectId!), 'rounds')).toHaveLength(1);
});

test('send email (dryrun) + confirm WhatsApp → chosen items +1, others unchanged', async () => {
  const { api, db } = lead;
  const list = await (await api.get(`/api/visits/${s.visitId}/dispatches`)).json() as { dispatches: { id: string; channel: string }[] };
  for (const d of list.dispatches) {
    const r = await api.post(`/api/dispatches/${d.id}/send`);
    expect(r.status(), await r.text()).toBe(200);
    const out = await r.json() as { status: string; ref?: string; links?: { url: string }[] };
    if (d.channel === 'email') expect(out).toMatchObject({ status: 'sent' });
    if (d.channel === 'whatsapp') {
      expect(out.status).toBe('needs_confirmation');
      expect(out.links![0].url).toMatch(/^https:\/\/wa\.me\/919000000951\?text=/);
      expect((await api.post(`/api/dispatches/${d.id}/confirm`)).status()).toBe(200);
    }
  }
  const items = ok(await db.from('dependency_items').select('id, reminder_count, last_reminded_visit_id').in('id', [s.items!.e1, s.items!.k1, s.items!.e2, s.items!.c1]), 'counts');
  const by = Object.fromEntries(items.map((i) => [i.id, i]));
  expect(by[s.items!.e1]).toMatchObject({ reminder_count: 1, last_reminded_visit_id: s.visitId });
  expect(by[s.items!.k1]).toMatchObject({ reminder_count: 1, last_reminded_visit_id: s.visitId });
  expect(by[s.items!.e2].reminder_count).toBe(0);
  expect(by[s.items!.c1].reminder_count).toBe(0);
  expect(ok(await db.from('site_visits').select('status').eq('id', s.visitId!).single(), 'round sent').status).toBe('sent');
});

test('agencyIds: reminders for the Carpenter only', async () => {
  const res = await lead.api.post(`/api/projects/${s.projectId}/reminders`, { data: { agencyIds: [s.carp] } });
  const body = await res.json() as { visitId: string; dispatches: { itemCount: number; agency: string }[] };
  expect(body.dispatches.length).toBe(2);
  expect(body.dispatches.every((d) => d.agency.includes('E2E Office Wood') && d.itemCount === 1)).toBe(true);
});

test('isolation: an unassigned PM cannot see, change, or send reminders for the office project', async () => {
  const { db, api } = pm;
  expect(ok(await db.from('projects').select('id').eq('id', s.projectId!), 'pm project')).toEqual([]);
  expect(ok(await db.from('item_events').select('id').eq('project_id', s.projectId!), 'pm events')).toEqual([]);
  expect((await db.rpc('set_item_status', { p_item: s.items!.e2, p_status: 'complete' })).error?.message).toMatch(/not found or no access/);
  expect((await db.rpc('add_room_dependencies', { p_room: s.roomA, p_master_ids: [], p_custom: [] })).error?.message).toMatch(/not found or no access/);
  const r = await api.post(`/api/projects/${s.projectId}/reminders`, { data: {} });
  expect(r.status()).toBe(404);
  // Lead's data unchanged by the attempts
  expect(ok(await lead.db.from('dependency_items').select('status').eq('id', s.items!.e2).single(), 'unchanged').status).toBe('pending');
});
