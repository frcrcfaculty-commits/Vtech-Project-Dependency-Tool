// End-to-end: the real Next.js app (E2E_BASE_URL) + the real Supabase project, signed in as real test users.
// The UI does wizard/visit steps as direct Supabase calls under RLS (see docs/SPEC.md §5), so this test does the
// same with the user's own session; the server steps go through the app's HTTP API exactly as the UI will.
import { expect, test } from '@playwright/test';
import { cleanup, env, ok, PNG_1PX, signIn, TEST_PREFIX, type Session } from './helpers';

const PM = { email: env('E2E_PM_EMAIL'), password: env('E2E_PM_PASSWORD') };
const LEAD = { email: env('E2E_LEAD_EMAIL'), password: env('E2E_LEAD_PASSWORD') };

test.describe.configure({ mode: 'serial' });

let pm: Session;
let lead: Session;
const s: {
  projectId?: string; floor1?: string; floor2?: string;
  elec?: string; carp?: string;
  items?: { id: string; room: string; dep: string; agency: string }[];
  visits: string[];
} = { visits: [] };

test.beforeAll(async () => {
  await cleanup();
  pm = await signIn(PM.email, PM.password);
  lead = await signIn(LEAD.email, LEAD.password);
});

test.afterAll(async () => {
  await cleanup();
  await pm?.api.dispose();
  await lead?.api.dispose();
});

test('sign in: both test users have the expected roles', async () => {
  const me = ok(await pm.db.from('profiles').select('role').eq('id', pm.userId).single(), 'pm profile');
  expect(me.role).toBe('pm');
  const ld = ok(await lead.db.from('profiles').select('role').eq('id', lead.userId).single(), 'lead profile');
  expect(ld.role).toBe('pm_lead');
});

test('wizard: PM creates a project with floors, rooms, agencies, contacts, dependencies', async () => {
  const { db } = pm;
  const p = ok(await db.from('projects').insert({ name: `${TEST_PREFIX} wizard ${Date.now()}`, client_name: 'E2E client', site_address: 'E2E site' })
    .select('id, l2_after, l3_after').single(), 'create project');
  s.projectId = p.id;
  expect([p.l2_after, p.l3_after]).toEqual([3, 6]);

  const f1 = ok(await db.from('floors').insert({ project_id: p.id, label: '12th Floor', sort: 1 }).select('id').single(), 'floor');
  s.floor1 = f1.id;
  const rooms = ok(await db.from('rooms').insert(['Living Room', 'Master Bedroom'].map((name, i) => ({ project_id: p.id, floor_id: f1.id, name, sort: i })))
    .select('id, name'), 'rooms');

  const types = ok(await db.from('agency_types').select('id, name').in('name', ['Electrician', 'Carpenter']), 'types');
  const typeId = (n: string) => types.find((t) => t.name === n)!.id;
  const mk = async (type: string, company: string, contacts: { name: string; level: number; email: string; phone: string }[]) => {
    const a = ok(await db.from('agencies').insert({ project_id: p.id, agency_type_id: typeId(type), company_name: company }).select('id').single(), type);
    ok(await db.from('agency_contacts').insert(contacts.map((c) => ({ project_id: p.id, agency_id: a.id, designation: `L${c.level}`, ...c }))).select('id'), `${type} contacts`);
    return a.id as string;
  };
  s.elec = await mk('Electrician', 'E2E Sparks', [
    { name: 'Elec L1', level: 1, email: 'l1@sparks.example.com', phone: '+919000000901' },
    { name: 'Elec L2', level: 2, email: 'l2@sparks.example.com', phone: '+919000000902' },
  ]);
  s.carp = await mk('Carpenter', 'E2E Woodcraft', [{ name: 'Carp L1', level: 1, email: 'l1@wood.example.com', phone: '+919000000911' }]);

  const masters = ok(await db.from('master_dependencies').select('id, agency_type_id, seq').in('agency_type_id', [typeId('Electrician'), typeId('Carpenter')]).order('seq'), 'master');
  const pick = [...masters.filter((m) => m.agency_type_id === typeId('Electrician')).slice(0, 2), ...masters.filter((m) => m.agency_type_id === typeId('Carpenter')).slice(0, 1)];
  expect(ok(await db.rpc('add_master_dependencies', { p_project: p.id, p_master_ids: pick.map((m) => m.id) }), 'add deps')).toBe(3);
  const deps = ok(await db.from('project_dependencies').select('id').eq('project_id', p.id), 'deps');
  // 2 rooms × 3 deps
  expect(ok(await db.rpc('apply_dependencies', { p_project: p.id, p_dep_ids: deps.map((d) => d.id), p_room_ids: rooms.map((r) => r.id) }), 'apply')).toBe(6);
});

test('copy floor duplicates rooms and their dependencies', async () => {
  const { db } = pm;
  s.floor2 = ok(await db.rpc('copy_floor', { p_floor: s.floor1, p_label: '13th Floor' }), 'copy floor') as string;
  const items = ok(await db.from('dependency_items').select('id, agency_id, status, room_id, project_dependency_id, rooms(floor_id)').eq('project_id', s.projectId!), 'items');
  expect(items).toHaveLength(12);
  expect(items.every((i) => i.agency_id && i.status === 'unchecked')).toBe(true);
  s.items = items.map((i) => ({ id: i.id, room: i.room_id, dep: i.project_dependency_id, agency: i.agency_id! }));
});

/** Run one visit: given statuses per item index, upload a photo on the first pending, finalize via the API. */
async function visit(statuses: ('pending' | 'complete' | 'na')[], date: string, withPhoto = false) {
  const { db, api } = pm;
  const v = ok(await db.from('site_visits').insert({ project_id: s.projectId, visit_date: date }).select('id').single(), 'visit');
  s.visits.push(v.id);
  let photo: string | null = null;
  if (withPhoto) {
    photo = `${s.projectId}/${v.id}/evidence.png`;
    const up = await db.storage.from('evidence').upload(photo, PNG_1PX, { contentType: 'image/png' });
    expect(up.error, up.error?.message).toBeNull();
  }
  ok(await db.from('visit_checks').insert(statuses.map((status, n) => ({
    project_id: s.projectId, visit_id: v.id, item_id: s.items![n].id, status, status_date: date,
    photo_path: n === 0 ? photo : null, note: n === 0 ? 'e2e note' : null,
  }))).select('id'), 'checks');
  const res = await api.post(`/api/visits/${v.id}/finalize`);
  expect(res.status(), await res.text()).toBe(200);
  return { visitId: v.id as string, body: await res.json() as { applied: number; dispatches: { id: string; channel: string; level: number; agency: string }[]; warnings: string[] } };
}

// Items 0..11: electrician/carpenter items on both floors. Keep 0–2 (one per dependency) pending across all visits.
const V1: ('pending' | 'complete' | 'na')[] = ['pending', 'pending', 'pending', 'complete', 'na', 'complete', 'complete', 'complete', 'complete', 'complete', 'complete', 'complete'];

test('visit 1: mark pending/done/N.A., one photo, finalize → one draft per agency per channel', async () => {
  const { body } = await visit(V1, '2026-10-01', true);
  expect(body.applied).toBe(12);
  const pending = ok(await pm.db.from('dependency_items').select('id, agency_id, status, photo_path').eq('project_id', s.projectId!).eq('status', 'pending'), 'pending');
  expect(pending).toHaveLength(3);
  expect(pending.some((i) => i.photo_path?.endsWith('evidence.png'))).toBe(true);
  const agencies = new Set(pending.map((i) => i.agency_id));
  // email + whatsapp for every agency with pending items, all at L1
  expect(body.dispatches).toHaveLength(agencies.size * 2);
  expect(body.dispatches.every((d) => d.level === 1)).toBe(true);
  const signed = await pm.db.storage.from('evidence').createSignedUrl(pending.find((i) => i.photo_path)!.photo_path!, 60);
  expect(signed.error).toBeNull();
});

/** Send every draft of a visit: email through /send (dryrun → sent; compose_link → confirm), WhatsApp link → confirm. */
async function sendAll(visitId: string) {
  const { api } = pm;
  const list = await (await api.get(`/api/visits/${visitId}/dispatches`)).json() as { dispatches: { id: string; channel: string; status: string }[] };
  for (const d of list.dispatches.filter((x) => x.status === 'draft')) {
    const r = await api.post(`/api/dispatches/${d.id}/send`);
    expect(r.status(), await r.text()).toBe(200);
    const out = await r.json() as { status: string; ref?: string; links?: { url: string }[] };
    if (d.channel === 'email' && out.status === 'sent') expect(out.ref).toMatch(/^dryrun-/);
    if (out.status === 'needs_confirmation') {
      expect(out.links!.length).toBeGreaterThan(0);
      if (d.channel === 'whatsapp') expect(out.links![0].url).toMatch(/^https:\/\/wa\.me\/91900000\d{4}\?text=/);
      const c = await api.post(`/api/dispatches/${d.id}/confirm`);
      expect(c.status(), await c.text()).toBe(200);
    }
  }
  const after = await (await api.get(`/api/visits/${visitId}/dispatches`)).json() as { dispatches: { status: string }[] };
  expect(after.dispatches.every((d) => d.status === 'sent')).toBe(true);
}

const counts = async () => (ok(await pm.db.from('dependency_items').select('reminder_count').eq('project_id', s.projectId!).eq('status', 'pending'), 'counts')).map((i) => i.reminder_count);

test('send email (dryrun) + confirm WhatsApp → reminder counts = 1 (once per item per visit)', async () => {
  await sendAll(s.visits[0]);
  expect(await counts()).toEqual([1, 1, 1]);
  const v = ok(await pm.db.from('site_visits').select('status').eq('id', s.visits[0]).single(), 'visit status');
  expect(v.status).toBe('sent');
});

test('visit 2: same items still pending → counts = 2', async () => {
  const { visitId } = await visit(V1.slice(0, 3), '2026-10-08');
  await sendAll(visitId);
  expect(await counts()).toEqual([2, 2, 2]);
});

test('set l2_after = 1 → visit 3 drafts go to L2 with L1 in CC', async () => {
  ok(await pm.db.from('projects').update({ l2_after: 1 }).eq('id', s.projectId!).select('id'), 'policy');
  const { visitId, body } = await visit(V1.slice(0, 3), '2026-10-15');
  const list = await (await pm.api.get(`/api/visits/${visitId}/dispatches`)).json() as {
    dispatches: { channel: string; level: number; recipients: { to: { name: string }[]; cc: { name: string }[] }; agencies: { company_name: string } }[] };
  const elecEmail = list.dispatches.find((d) => d.channel === 'email' && d.agencies.company_name === 'E2E Sparks')!;
  expect(elecEmail.level).toBe(2);
  expect(elecEmail.recipients.to.map((p) => p.name)).toEqual(['Elec L2']);
  expect(elecEmail.recipients.cc.map((p) => p.name)).toEqual(['Elec L1']);
  // Carpenter has no L2 contact: falls back to L1 and warns.
  const carpEmail = list.dispatches.find((d) => d.channel === 'email' && d.agencies.company_name === 'E2E Woodcraft')!;
  expect(carpEmail.recipients.to.map((p) => p.name)).toEqual(['Carp L1']);
  expect(body.warnings.some((w) => /No L2 email contact for E2E Woodcraft/.test(w))).toBe(true);
});

test('access: a PM not assigned to a project sees nothing of it and gets 404 on its visit', async () => {
  // PM lead creates a project (PM lead becomes member; the PM is not).
  const p = ok(await lead.db.from('projects').insert({ name: `${TEST_PREFIX} other ${Date.now()}` }).select('id').single(), 'lead project');
  const f = ok(await lead.db.from('floors').insert({ project_id: p.id, label: 'G' }).select('id').single(), 'lead floor');
  ok(await lead.db.from('rooms').insert({ project_id: p.id, floor_id: f.id, name: 'Lobby' }).select('id'), 'lead room');
  const v = ok(await lead.db.from('site_visits').insert({ project_id: p.id, visit_date: '2026-10-20' }).select('id').single(), 'lead visit');

  const mine = ok(await pm.db.from('projects').select('id'), 'pm projects');
  expect(mine.map((x) => x.id)).not.toContain(p.id);
  expect(ok(await pm.db.from('floors').select('id').eq('project_id', p.id), 'pm floors')).toEqual([]);
  expect(ok(await pm.db.from('site_visits').select('id').eq('project_id', p.id), 'pm visits')).toEqual([]);

  const list = await pm.api.get(`/api/visits/${v.id}/dispatches`);
  expect(list.status()).toBe(200);
  expect((await list.json()).dispatches).toEqual([]);
  expect((await pm.api.post(`/api/visits/${v.id}/dispatches`)).status()).toBe(404);
  expect((await pm.api.post(`/api/visits/${v.id}/finalize`)).status()).toBe(400); // RPC: "visit not found or no access"

  // Once the lead assigns the PM, the project appears.
  ok(await lead.db.from('project_members').insert({ project_id: p.id, user_id: pm.userId }).select('project_id'), 'assign');
  expect(ok(await pm.db.from('projects').select('id').eq('id', p.id), 'pm sees')).toHaveLength(1);
});

test('roles: PM cannot create users; PM lead cannot create a super admin', async () => {
  expect((await pm.api.post('/api/admin/users', { data: { email: 'x@example.com', fullName: 'X', role: 'pm' } })).status()).toBe(403);
  expect((await lead.api.post('/api/admin/users', { data: { email: 'x@example.com', fullName: 'X', role: 'super_admin' } })).status()).toBe(403);
});

test('signed-out requests are refused', async () => {
  const { request } = await import('@playwright/test');
  const anon = await request.newContext({ baseURL: env('E2E_BASE_URL') });
  expect((await anon.get('/api/dashboard', { maxRedirects: 0 })).status()).toBe(401);
  await anon.dispose();
});
