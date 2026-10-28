// Demo data: "Demo – Shah Residence", mirroring the Specimen tab of the "Vtech Project Dependency" sheet.
// Usage: npx tsx --env-file=.env.local scripts/seed-demo.ts
//
// Idempotent: deletes the demo project (by exact name) and recreates it. Touches nothing else.
// Uses the service-role key (scripts only — never ship this key to app/** or the browser).
// Goes through the real RPCs (add_master_dependencies, apply_dependencies, finalize_visit) so the
// data looks exactly like data entered through the app.
import { createClient } from '@supabase/supabase-js';

const DEMO_NAME = 'Demo – Shah Residence';
const DEMO_PM_EMAIL = process.env.DEMO_PM_EMAIL ?? 'hansalgandhi+pm@gmail.com';
const VISIT_DAYS_AGO = 7;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (in .env.local)');
if (!DEMO_NAME.startsWith('Demo –')) throw new Error('demo project name must start with "Demo –"');

const db = createClient(url, key, { auth: { persistSession: false } });

// No generated DB types in this repo: callers state the row shape they selected.
type Rec = Record<string, string>;
function must<T = Rec[]>(res: { data: unknown; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null) throw new Error(`${what}: no data`);
  return res.data as T;
}

// ───────────── data (from the Specimen tab) ─────────────
type AgencyType = 'Electrician' | 'Carpenter' | 'Curtain Vendor' | 'Painter' | 'VTech' | 'Wallpaper Vendor';

// "Whole Floor" room = items the Specimen lists against the floor only (no specific room).
const WHOLE_FLOOR = 'Whole Floor';
const FLOORS: Record<string, string[]> = {
  '12th Floor': ['Exit Area', 'Kitchen Area', 'Daughter Bathroom', 'Parents Walk-in', 'Parents Bedroom', 'Her Walk-in',
    'Master Bathroom', 'Son Bathroom', 'Dining Room', 'Son Bedroom'],
  '13th Floor': [WHOLE_FLOOR, 'Exit Door', 'Mandir Area', 'Double-Height Dining Area', 'Bar Area', 'Dining Foyer',
    'Exit Area', 'Main Entrance'],
  '14th Floor': [WHOLE_FLOOR, 'Entertainment Area', 'Guest Bedroom', 'Home Office', 'Pool Area', 'Exit Area',
    'Main Entrance', 'Lift Lobby'],
};

// Master items used (agency type + exact master text). Custom = not in the master list (added "on the go").
type Dep = { agency: AgencyType; text: string; custom?: true };
const D = {
  magnet:     { agency: 'Carpenter', text: 'Door magnet cutout pending.' },
  lockCutout: { agency: 'Carpenter', text: 'Door lock cutout not done.' },
  roller:     { agency: 'Curtain Vendor', text: 'Roller blind fabric installation pending.' },
  curtain:    { agency: 'Curtain Vendor', text: 'Curtain fabric installation pending.' },
  onOff:      { agency: 'Electrician', text: 'On/off lights installation pending.' },
  faceReader: { agency: 'Electrician', text: 'Face reader installation pending.' },
  coveDali:   { agency: 'Electrician', text: 'Cove light DALI connection pending.' },
  limit:      { agency: 'VTech', text: 'Curtain motor limit setting pending.' },
  lightProg:  { agency: 'VTech', text: 'New light programming pending.' },
  acAddr:     { agency: 'VTech', text: 'AC addressing pending.' },
  wallFinish: { agency: 'Wallpaper Vendor', text: 'Wall finish not complete — blocks face reader/eKey installation.' },
  paintTv:    { agency: 'Painter', text: 'Painting pending — blocks TV-side lights installation.', custom: true },
  paintKeypad:{ agency: 'Painter', text: 'Final paint pending — blocks keypad installation.', custom: true },
} satisfies Record<string, Dep>;
type DepKey = keyof typeof D;

// [floor, room, dependency, note, status]. Specimen rows 1–43, plus one completed item from row 34's note.
type Row = [string, string, DepKey, string | null, 'pending' | 'complete'];
const P = 'pending' as const;
const ROWS: Row[] = [
  ['12th Floor', 'Exit Area', 'wallFinish', 'Face reader installation pending (wall not final).', P],
  ['12th Floor', 'Kitchen Area', 'paintTv', 'TV side – all lights installation pending.', P],
  ...(['Daughter Bathroom', 'Parents Walk-in', 'Parents Bedroom', 'Her Walk-in', 'Master Bathroom', 'Son Bathroom',
    'Dining Room', 'Son Bedroom'] as const).flatMap((r): Row[] => [
    ['12th Floor', r, 'roller', null, P],
    ['12th Floor', r, 'limit', null, P],
  ]),
  ['13th Floor', WHOLE_FLOOR, 'paintKeypad', '3 keypads.', P],
  ['13th Floor', WHOLE_FLOOR, 'onOff', null, P],
  ['13th Floor', WHOLE_FLOOR, 'magnet', 'Door bolt installation done.', P],
  ['13th Floor', 'Mandir Area', 'curtain', null, P],
  ['13th Floor', 'Double-Height Dining Area', 'curtain', null, P],
  ['13th Floor', 'Bar Area', 'roller', null, P],
  ['13th Floor', 'Dining Foyer', 'roller', null, P],
  ['13th Floor', 'Exit Area', 'faceReader', 'Wall not final.', P],
  ['13th Floor', 'Main Entrance', 'faceReader', 'Wall not final.', P],
  ['13th Floor', WHOLE_FLOOR, 'lightProg', null, P],
  ['13th Floor', WHOLE_FLOOR, 'acAddr', null, P],
  ['13th Floor', WHOLE_FLOOR, 'wallFinish', 'eKey installation pending, cutout done (wall not final).', P],
  ['13th Floor', 'Exit Door', 'lockCutout', 'Lock given to carpenter for cutout.', P],
  ['14th Floor', WHOLE_FLOOR, 'paintKeypad', '3 keypads.', P],
  ['14th Floor', WHOLE_FLOOR, 'onOff', null, P],
  ['14th Floor', WHOLE_FLOOR, 'magnet', null, P],
  ['14th Floor', WHOLE_FLOOR, 'lockCutout', 'All door lock cutouts done.', 'complete'],
  ['14th Floor', 'Entertainment Area', 'curtain', null, P],
  ['14th Floor', 'Guest Bedroom', 'curtain', null, P],
  ['14th Floor', 'Home Office', 'curtain', null, P],
  ['14th Floor', 'Pool Area', 'roller', null, P],
  ['14th Floor', 'Exit Area', 'wallFinish', 'Face reader installation pending (wall not final).', P],
  ['14th Floor', 'Main Entrance', 'wallFinish', 'Face reader installation pending (wall not final).', P],
  ['14th Floor', WHOLE_FLOOR, 'lightProg', null, P],
  ['14th Floor', WHOLE_FLOOR, 'acAddr', null, P],
  ['14th Floor', 'Lift Lobby', 'coveDali', null, P],
];

// Contacts use reserved example.com addresses and dummy numbers, so nothing real is ever messaged.
type Contact = { name: string; designation: string; level: 1 | 2 | 3; phone?: string; email?: string };
const AGENCIES: { type: AgencyType; company: string; contacts: Contact[] }[] = [
  { type: 'Electrician', company: 'Demo Sparks Electricals', contacts: [
    { name: 'Ramesh Patil', designation: 'Site Supervisor', level: 1, phone: '+919000000101', email: 'ramesh@sparks.example.com' },
    { name: 'Suresh Jadhav', designation: 'Project Engineer', level: 2, phone: '+919000000102', email: 'suresh@sparks.example.com' },
    { name: 'Mahesh Shinde', designation: 'Owner', level: 3, phone: '+919000000103', email: 'mahesh@sparks.example.com' } ] },
  { type: 'Carpenter', company: 'Demo Woodcraft Interiors', contacts: [
    { name: 'Anil Mistry', designation: 'Head Carpenter', level: 1, phone: '+919000000201' },
    { name: 'Rakesh Sharma', designation: 'Owner', level: 3, phone: '+919000000203', email: 'rakesh@woodcraft.example.com' } ] },
  { type: 'Curtain Vendor', company: 'Demo Drapes & Blinds', contacts: [
    { name: 'Imran Shaikh', designation: 'Installer', level: 1, phone: '+919000000301', email: 'imran@drapes.example.com' },
    { name: 'Neha Kapoor', designation: 'Operations Manager', level: 2, email: 'neha@drapes.example.com' },
    { name: 'Farhan Merchant', designation: 'Proprietor', level: 3, phone: '+919000000303', email: 'farhan@drapes.example.com' } ] },
  { type: 'Painter', company: 'Demo ColourCoat Painters', contacts: [
    { name: 'Santosh Gupta', designation: 'Site Supervisor', level: 1, phone: '+919000000401' },
    { name: 'Vijay Rane', designation: 'Contractor', level: 2, phone: '+919000000402', email: 'vijay@colourcoat.example.com' },
    { name: 'Prakash Naik', designation: 'Owner', level: 3, phone: '+919000000403', email: 'prakash@colourcoat.example.com' } ] },
  { type: 'VTech', company: 'VTech Technologies (demo contacts)', contacts: [
    { name: 'Demo Programmer', designation: 'Automation Programmer', level: 1, phone: '+919000000501', email: 'programmer@vtech.example.com' },
    { name: 'Demo Project Head', designation: 'Project Head', level: 2, email: 'projecthead@vtech.example.com' } ] },
  { type: 'Wallpaper Vendor', company: 'Demo WallArt Studio', contacts: [
    { name: 'Kiran Desai', designation: 'Installer', level: 1, phone: '+919000000601', email: 'kiran@wallart.example.com' },
    { name: 'Pooja Mehta', designation: 'Studio Manager', level: 2, phone: '+919000000602', email: 'pooja@wallart.example.com' },
    { name: 'Rohan Shah', designation: 'Owner', level: 3, email: 'rohan@wallart.example.com' } ] },
];

// ───────────── run ─────────────
const istToday = new Date(Date.now() + 5.5 * 3600_000);
istToday.setUTCDate(istToday.getUTCDate() - VISIT_DAYS_AGO);
const visitDate = istToday.toISOString().slice(0, 10);

// 1. Delete the previous demo project (cascades to floors, rooms, agencies, items, visits, dispatches).
const del = await db.from('projects').delete().eq('name', DEMO_NAME).select('id');
if (del.error) throw new Error(`delete old demo: ${del.error.message}`);
console.log(`deleted ${del.data.length} old demo project(s)`);

const pm = must<Rec>(await db.from('profiles').select('id').eq('email', DEMO_PM_EMAIL).single(), `PM ${DEMO_PM_EMAIL}`);

// 2. Project (created_by = PM, so the trigger makes the PM a member).
const project = must<Rec>(await db.from('projects').insert({
  name: DEMO_NAME, client_name: 'Shah family (demo)', site_address: 'Demo site, 12th–14th floors, Mumbai',
  created_by: pm.id,
}).select('id').single(), 'insert project');
const pid = project.id as string;

// 3. Floors + rooms.
const floorRows = must(await db.from('floors').insert(
  Object.keys(FLOORS).map((label, i) => ({ project_id: pid, label, sort: i + 1 })),
).select('id,label'), 'insert floors');
const floorId = Object.fromEntries(floorRows.map((f) => [f.label, f.id as string]));
const roomRows = must(await db.from('rooms').insert(
  Object.entries(FLOORS).flatMap(([label, rooms]) =>
    rooms.map((name, i) => ({ project_id: pid, floor_id: floorId[label], name, sort: i + 1 }))),
).select('id,name,floor_id'), 'insert rooms');
const roomId = (floor: string, room: string) => {
  const r = roomRows.find((x) => x.floor_id === floorId[floor] && x.name === room);
  if (!r) throw new Error(`room not found: ${floor} – ${room}`);
  return r.id as string;
};

// 4. Agencies + contacts (before dependencies, so apply_dependencies assigns items to them).
const types = must(await db.from('agency_types').select('id,name'), 'agency types');
const typeId = (name: string) => {
  const t = types.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!t) throw new Error(`agency type missing: ${name}`);
  return t.id as string;
};
for (const a of AGENCIES) {
  const ag = must<Rec>(await db.from('agencies').insert({ project_id: pid, agency_type_id: typeId(a.type), company_name: a.company })
    .select('id').single(), `agency ${a.type}`);
  must(await db.from('agency_contacts').insert(a.contacts.map((c) => ({
    project_id: pid, agency_id: ag.id, name: c.name, designation: c.designation, level: c.level,
    phone: c.phone ?? null, email: c.email ?? null,
  }))).select('id'), `contacts ${a.type}`);
}

// 5. Project dependencies: master items via RPC, custom items inserted directly.
const masters = must(await db.from('master_dependencies').select('id,text,agency_type_id').eq('active', true), 'master list');
const masterIds = Object.values(D).filter((d) => !('custom' in d)).map((d) => {
  const m = masters.find((x) => x.agency_type_id === typeId(d.agency) && x.text === d.text);
  if (!m) throw new Error(`master item missing: ${d.agency} / ${d.text}`);
  return m.id as string;
});
must(await db.rpc('add_master_dependencies', { p_project: pid, p_master_ids: masterIds }), 'add_master_dependencies');
const customs = Object.values(D).filter((d) => 'custom' in d);
must(await db.from('project_dependencies').insert(customs.map((d, i) => ({
  project_id: pid, agency_type_id: typeId(d.agency), text: d.text, seq: 100 + i, created_by: pm.id,
}))).select('id'), 'custom dependencies');
const projDeps = must(await db.from('project_dependencies').select('id,text,agency_type_id').eq('project_id', pid), 'project deps');
const depId = (k: DepKey) => projDeps.find((x) => x.agency_type_id === typeId(D[k].agency) && x.text === D[k].text)!.id as string;

// 6. Apply each dependency to exactly the rooms the Specimen lists it for.
const byDep = new Map<DepKey, string[]>();
for (const [floor, room, dep] of ROWS) byDep.set(dep, [...(byDep.get(dep) ?? []), roomId(floor, room)]);
for (const [dep, rooms] of byDep) {
  must(await db.rpc('apply_dependencies', { p_project: pid, p_dep_ids: [depId(dep)], p_room_ids: rooms }), `apply ${dep}`);
}

// 7. One site visit by the PM, every item checked, then finalized via the real RPC.
const items = must(await db.from('dependency_items').select('id,room_id,project_dependency_id,agency_id').eq('project_id', pid), 'items');
const unassigned = items.filter((i) => !i.agency_id).length;
if (unassigned) throw new Error(`${unassigned} items have no agency`);
const visit = must<Rec>(await db.from('site_visits').insert({ project_id: pid, pm_id: pm.id, visit_date: visitDate })
  .select('id').single(), 'insert visit');
const visitId = visit.id as string;
const pmId = pm.id as string;
must(await db.from('visit_checks').insert(ROWS.map(([floor, room, dep, note, status]) => {
  const item = items.find((i) => i.room_id === roomId(floor, room) && i.project_dependency_id === depId(dep));
  if (!item) throw new Error(`item missing: ${floor} – ${room} / ${dep}`);
  return { project_id: pid, visit_id: visitId, item_id: item.id, status, status_date: visitDate, note, checked_by: pmId };
})).select('id'), 'visit checks');
const n = must<number>(await db.rpc('finalize_visit', { p_visit: visitId }), 'finalize_visit');

// 8. Summary.
const { data: final } = await db.from('dependency_items').select('status').eq('project_id', pid);
const pending = final?.filter((i) => i.status === 'pending').length ?? 0;
const complete = final?.filter((i) => i.status === 'complete').length ?? 0;
console.log(`created "${DEMO_NAME}" (${pid})`);
console.log(`  floors ${floorRows.length} · rooms ${roomRows.length} · agencies ${AGENCIES.length} · contacts ${AGENCIES.reduce((s, a) => s + a.contacts.length, 0)}`);
console.log(`  items ${items.length} (pending ${pending}, complete ${complete}) · visit ${visitDate} finalized, ${n} checks applied`);
console.log(`  PM member: ${DEMO_PM_EMAIL}. Drafts are not pre-built: open the visit and use "rebuild drafts" (POST /api/visits/<id>/dispatches).`);
