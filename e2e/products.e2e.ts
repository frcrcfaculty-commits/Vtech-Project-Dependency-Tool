// Product tracking (v3), API level: the real app (E2E_BASE_URL) + live Supabase, signed in as the PM lead.
// Covers add_room_product (room + project scope), the gate (greens open together; every other step locked until all greens
// are Done/N.A., then they open together; N.A. always allowed), remove_room_product, copy_floor copying products, and
// reminders: Client steps never drafted (warning), internal steps → "[Internal]" draft to the internal team only,
// blue "Internet activation" → Network Agency. Outcomes are read from the database (item_gate, dispatches). Nothing mocked.
import { expect, test } from '@playwright/test';
import { cleanup, env, ok, signIn, TEST_PREFIX, type Session } from './helpers';

const LEAD = { email: env('E2E_LEAD_EMAIL'), password: env('E2E_LEAD_PASSWORD') };

test.describe.configure({ mode: 'serial' });

let lead: Session;
const s: { projectId: string; floor: string; room: string; room2: string; agencies: Record<string, string>; products: Record<string, string>;
  rp: Record<string, string> } = { projectId: '', floor: '', room: '', room2: '', agencies: {}, products: {}, rp: {} };

type Gate = { item_id: string; label: string; seq: number; phase: number; status: string; locked: boolean; waits_on_client: boolean; responsibility: string };
const steps = async (rp: string): Promise<Gate[]> =>
  ok(await lead.db.from('item_gate').select('item_id, label, seq, phase, status, locked, waits_on_client, responsibility').eq('room_product_id', rp).order('seq'), 'gate') as Gate[];
const step = async (rp: string, label: string) => (await steps(rp)).find((g) => g.label === label)!;
const setStatus = (item: string, status: string, note?: string) =>
  lead.db.rpc('set_item_status', { p_item: item, p_status: status, p_date: null, p_note: note ?? null, p_photo: null });
const place = async (product: string, room: string | null, location: string | null = null) =>
  ok(await lead.db.rpc('add_room_product', { p_project: s.projectId, p_room: room, p_product: s.products[product], p_location: location, p_quantity: 1, p_note: null }),
    `place ${product}`) as unknown as string;
const closeGreens = async (rp: string, except: string[] = []) => {
  for (const g of (await steps(rp)).filter((x) => x.phase === 1 && !except.includes(x.label))) ok(await setStatus(g.item_id, 'complete'), `done ${g.label}`);
};

test.beforeAll(async () => {
  await cleanup();
  lead = await signIn(LEAD.email, LEAD.password);
});
test.afterAll(async () => {
  await cleanup();
  await lead?.api.dispose();
});

test('setup: project, 1 floor × 2 rooms, external agencies + internal teams with contacts', async () => {
  const { db } = lead;
  const p = ok(await db.from('projects').insert({ name: `${TEST_PREFIX} products ${Date.now()}`, client_name: 'E2E products' }).select('id').single(), 'project');
  s.projectId = p.id;
  s.floor = ok(await db.from('floors').insert({ project_id: p.id, label: 'Ground Floor', sort: 1 }).select('id').single(), 'floor').id;
  const rooms = ok(await db.from('rooms').insert([{ project_id: p.id, floor_id: s.floor, name: 'Living Room', sort: 1 }, { project_id: p.id, floor_id: s.floor, name: 'Office', sort: 2 }])
    .select('id, name'), 'rooms');
  s.room = rooms.find((r) => r.name === 'Living Room')!.id;
  s.room2 = rooms.find((r) => r.name === 'Office')!.id;
  const TYPES = ['Electrician', 'Painter', 'Architect', 'Carpenter', 'Network Agency', 'Client', 'VTech Installers', 'VTech Programmers', 'VTech Project Managers'];
  const types = ok(await db.from('agency_types').select('id, name, internal').in('name', TYPES), 'types');
  expect(types.filter((t) => t.internal).map((t) => t.name).sort()).toEqual(['VTech Installers', 'VTech Programmers', 'VTech Project Managers']);
  for (const [n, t] of TYPES.entries()) {
    const id = types.find((x) => x.name === t)!.id;
    const a = ok(await db.from('agencies').insert({ project_id: p.id, agency_type_id: id, company_name: `E2E ${t}` }).select('id').single(), t);
    s.agencies[t] = a.id;
    ok(await db.from('agency_contacts').insert({ project_id: p.id, agency_id: a.id, name: `${t} L1`, designation: 'L1', level: 1,
      email: `l1-${n}@products-e2e.example.com`, phone: `+9190000009${String(n).padStart(2, '0')}` }).select('id'), `${t} contact`);
  }
  const cat = ok(await db.from('product_catalogue').select('id, title'), 'catalogue');
  for (const c of cat) s.products[c.title] = c.id;
  expect(cat.length).toBeGreaterThanOrEqual(27);
});

test('add_room_product: room scope creates the full step chain (unchecked, owners by colour); project scope goes to the project-wide room', async () => {
  s.rp.keypad = await place('Keypad', s.room, 'Entrance');
  const k = await steps(s.rp.keypad);
  expect(k.map((g) => g.label)).toEqual(['Engraving submitted', 'Delivery pending client / VTECH', 'Readiness to install', 'Readiness of dustfree',
    'Installation', 'Identifying', 'Programming']);
  expect(k.every((g) => g.status === 'unchecked')).toBe(true);
  expect(k.map((g) => g.locked)).toEqual([false, false, false, false, true, true, true]);
  expect(k.find((g) => g.label.startsWith('Delivery'))!.waits_on_client).toBe(true);
  const items = ok(await lead.db.from('dependency_items').select('agency_id, project_dependencies(text), step_id').eq('room_product_id', s.rp.keypad), 'keypad items');
  const agencyOf = (label: string) => items.find((i) => (i.project_dependencies as unknown as { text: string }).text.endsWith(`– ${label}`))!.agency_id;
  expect((items[0].project_dependencies as unknown as { text: string }).text).toMatch(/^Keypad \(Entrance\) – /);
  expect(agencyOf('Engraving submitted')).toBe(s.agencies.Architect);
  expect(agencyOf('Readiness of dustfree')).toBe(s.agencies.Painter);
  expect(agencyOf('Installation')).toBe(s.agencies['VTech Installers']);
  expect(agencyOf('Programming')).toBe(s.agencies['VTech Programmers']);

  s.rp.clientSide = await place('Client Side', null);
  const rp = ok(await lead.db.from('room_products').select('room_id, rooms(name, floors(label))').eq('id', s.rp.clientSide).single(), 'client side');
  expect(rp.rooms).toMatchObject({ name: 'Handover & client', floors: { label: 'Project-wide' } });
  const cs = await steps(s.rp.clientSide);
  expect(cs).toHaveLength(9);
  expect(cs.every((g) => !g.locked)).toBe(true); // no green steps → open from the start
  expect((await place('iPhone programming', null)).length).toBe(36);
  expect(ok(await lead.db.from('rooms').select('id').eq('project_id', s.projectId).eq('name', 'Handover & client'), 'pw rooms')).toHaveLength(1);

  const bad = await lead.db.rpc('add_room_product', { p_project: s.projectId, p_room: null, p_product: s.products.Keypad, p_location: null, p_quantity: 1, p_note: null });
  expect(bad.error?.message).toMatch(/room is required/);
});

test('gate: three greens pending together; Installation AND Sound testing locked until all greens are Done/N.A., then open together; N.A. allowed when locked', async () => {
  // Keypad: 3 greens pending at once
  for (const l of ['Engraving submitted', 'Readiness to install', 'Readiness of dustfree']) ok(await setStatus((await step(s.rp.keypad, l)).item_id, 'pending'), l);
  expect((await steps(s.rp.keypad)).filter((g) => g.phase === 1 && g.status === 'pending')).toHaveLength(3);
  const inst = await step(s.rp.keypad, 'Installation');
  const blocked = await setStatus(inst.item_id, 'pending');
  expect(blocked.error?.message).toMatch(/^locked: /);
  expect((await setStatus(inst.item_id, 'complete')).error?.message).toMatch(/^locked: /);
  // N.A. is allowed on a locked step
  ok(await setStatus((await step(s.rp.keypad, 'Identifying')).item_id, 'na', 'Pre-identified at factory'), 'na on locked');
  expect((await step(s.rp.keypad, 'Identifying')).status).toBe('na');

  // Speakers: Installation (installer) + Sound testing (programmer) both locked until the last green closes
  s.rp.speakers = await place('Speakers', s.room, 'Ceiling');
  const greens = (await steps(s.rp.speakers)).filter((g) => g.phase === 1);
  expect(greens.map((g) => g.label)).toEqual(['Delivery pending client / VTECH', 'Readiness of cable', 'Readiness to install']);
  ok(await setStatus(greens[0].item_id, 'complete'), 'g1');
  ok(await setStatus(greens[1].item_id, 'na', 'Cable pre-laid'), 'g2 na');
  const mid = await steps(s.rp.speakers);
  expect(mid.filter((g) => g.phase === 2).map((g) => [g.label, g.locked])).toEqual([['Installation', true], ['Sound testing', true]]);
  ok(await setStatus(greens[2].item_id, 'complete'), 'g3');
  const after = await steps(s.rp.speakers);
  expect(after.filter((g) => g.phase === 2).map((g) => [g.label, g.locked])).toEqual([['Installation', false], ['Sound testing', false]]);
  ok(await setStatus((await step(s.rp.speakers, 'Installation')).item_id, 'pending'), 'installation pending now allowed');
  expect(ok(await lead.db.rpc('item_is_locked', { p_item: (await step(s.rp.speakers, 'Sound testing')).item_id }), 'is_locked')).toBe(false);

  // Door lock: blue "Readiness by carpenter" (external) is locked until greens are done
  s.rp.door = await place('Door lock', s.room2, 'Door frame');
  const carp = await step(s.rp.door, 'Readiness by carpenter');
  expect(carp).toMatchObject({ phase: 2, responsibility: 'external', locked: true });
  expect((await setStatus(carp.item_id, 'pending')).error?.message).toMatch(/^locked: /);
  await closeGreens(s.rp.door);
  expect((await step(s.rp.door, 'Readiness by carpenter')).locked).toBe(false);
  ok(await setStatus(carp.item_id, 'pending', 'Lock cutout pending'), 'carpenter pending');
  const ci = ok(await lead.db.from('dependency_items').select('agency_id').eq('id', carp.item_id).single(), 'carp item');
  expect(ci.agency_id).toBe(s.agencies.Carpenter);
});

test('remove_room_product removes the product and all its steps', async () => {
  const rp = await place('Camera', s.room2, 'Ceiling');
  expect(await steps(rp)).toHaveLength(6);
  const rm = await lead.db.rpc('remove_room_product', { p_room_product: rp }); // returns void
  expect(rm.error).toBeNull();
  expect(ok(await lead.db.from('room_products').select('id').eq('id', rp), 'rp gone')).toHaveLength(0);
  expect(ok(await lead.db.from('dependency_items').select('id').eq('room_product_id', rp), 'steps gone')).toHaveLength(0);
});

test('copy_floor copies placed products with fresh (unchecked) steps', async () => {
  const before = ok(await lead.db.from('room_products').select('product_id, location, rooms!inner(name, floor_id)').eq('rooms.floor_id', s.floor), 'src');
  const nf = ok(await lead.db.rpc('copy_floor', { p_floor: s.floor, p_label: 'First Floor' }), 'copy') as unknown as string;
  const copied = ok(await lead.db.from('room_products').select('id, product_id, location, rooms!inner(name, floor_id)').eq('rooms.floor_id', nf), 'copied');
  const key = (r: { product_id: string; location: string | null; rooms: unknown }) => `${(r.rooms as { name: string }).name}|${r.product_id}|${r.location}`;
  expect(copied.map(key).sort()).toEqual(before.map(key).sort());
  expect(copied.length).toBe(3); // Keypad + Speakers (Living Room), Door lock (Office); project-wide products are not on this floor
  for (const c of copied) {
    const st = await steps(c.id);
    expect(st.length).toBeGreaterThan(0);
    expect(st.every((g) => g.status === 'unchecked')).toBe(true);
  }
});

test('reminders: Client step never drafted (warning); internal step → "[Internal]" draft to the internal team only; blue Internet activation → Network Agency', async () => {
  // Client: Off Termination's delivery is pending with the Client agency
  s.rp.off = await place('Off Termination', s.room2, 'Main DB location');
  const delivery = await step(s.rp.off, 'Delivery pending client / VTECH');
  expect(delivery.waits_on_client).toBe(true);
  ok(await setStatus(delivery.item_id, 'pending'), 'client pending');
  const c = await lead.api.post(`/api/projects/${s.projectId}/reminders`, { data: { itemIds: [delivery.item_id] } });
  expect(c.status(), await c.text()).toBe(200);
  const cb = await c.json() as { visitId: string | null; dispatches: unknown[]; warnings: string[] };
  expect(cb.dispatches).toHaveLength(0);
  expect(cb.visitId).toBeNull();
  expect(cb.warnings.join(' ')).toMatch(/waiting on the client/i);

  // Internal: Speakers' Installation is pending with VTech Installers
  const inst = await step(s.rp.speakers, 'Installation');
  const r = await lead.api.post(`/api/projects/${s.projectId}/reminders`, { data: { itemIds: [inst.item_id, delivery.item_id] } });
  expect(r.status(), await r.text()).toBe(200);
  const rb = await r.json() as { visitId: string; dispatches: { id: string; channel: string }[]; warnings: string[] };
  expect(rb.dispatches.map((d) => d.channel).sort()).toEqual(['email', 'whatsapp']);
  expect(rb.warnings.join(' ')).toMatch(/waiting on the client/i);
  const drafts = ok(await lead.db.from('dispatches').select('agency_id, channel, subject, body_text').eq('visit_id', rb.visitId), 'internal drafts');
  expect(new Set(drafts.map((d) => d.agency_id))).toEqual(new Set([s.agencies['VTech Installers']]));
  expect(drafts.find((d) => d.channel === 'email')!.subject).toContain('[Internal]');
  const di = ok(await lead.db.from('dispatch_items').select('item_id').in('dispatch_id', rb.dispatches.map((d) => d.id)), 'internal items');
  expect([...new Set(di.map((x) => x.item_id))]).toEqual([inst.item_id]);

  // Blue: Switch/Router "Internet activation" → Network Agency (external, not [Internal])
  s.rp.router = await place('Switch /Router', s.room2, 'AV Rack');
  await closeGreens(s.rp.router);
  const net = await step(s.rp.router, 'Internet activation');
  expect(net).toMatchObject({ phase: 2, responsibility: 'external', locked: false });
  ok(await setStatus(net.item_id, 'pending'), 'net pending');
  const n = await lead.api.post(`/api/projects/${s.projectId}/reminders`, { data: { itemIds: [net.item_id] } });
  expect(n.status(), await n.text()).toBe(200);
  const nb = await n.json() as { visitId: string };
  const nd = ok(await lead.db.from('dispatches').select('agency_id, channel, subject').eq('visit_id', nb.visitId), 'network drafts');
  expect(nd.map((d) => d.channel).sort()).toEqual(['email', 'whatsapp']);
  expect(new Set(nd.map((d) => d.agency_id))).toEqual(new Set([s.agencies['Network Agency']]));
  expect(nd.find((d) => d.channel === 'email')!.subject).not.toContain('[Internal]');
});
