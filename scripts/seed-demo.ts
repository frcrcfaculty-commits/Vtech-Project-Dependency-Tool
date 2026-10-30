// Demo data: "Demo – Shah Residence", mirroring the Specimen tab of the "Vtech Project Dependency" sheet.
// Usage: npx tsx --env-file=.env.local scripts/seed-demo.ts
//
// Idempotent: deletes the three demo projects (by exact name) and recreates them. Touches nothing else.
// Second project "Demo – Mehta Villa" (office mode, v2) is built only via add_room_dependencies + set_item_status.
// Third project "Demo – Gandhi Residency 2" (product tracking, v3) is built only via add_room_product + set_item_status.
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

// ═════════════ Office mode demo: "Demo – Mehta Villa" ═════════════
// Built ONLY through the office RPCs (add_room_dependencies, set_item_status), signed in as the PM lead (the office
// user), so item_events history carries a real author. Falls back to the service role (author blank) if no password.
// Reminder counts are set directly at the end: in real use they come from sent reminder rounds, which need the
// Next.js API; faking a sent dispatch here would duplicate dispatch logic.
{
  const NAME = 'Demo – Mehta Villa';
  const LEAD_EMAIL = process.env.DEMO_LEAD_EMAIL ?? 'hansalgandhi+pmlead@gmail.com';
  const LEAD_PASSWORD = process.env.DEMO_LEAD_PASSWORD ?? process.env.E2E_LEAD_PASSWORD;
  const istDay = (ago: number) => new Date(Date.now() + 5.5 * 3600_000 - ago * 86_400_000).toISOString().slice(0, 10);

  const del2 = await db.from('projects').delete().eq('name', NAME).select('id');
  if (del2.error) throw new Error(`delete old ${NAME}: ${del2.error.message}`);

  const lead = must<Rec>(await db.from('profiles').select('id').eq('email', LEAD_EMAIL).single(), `lead ${LEAD_EMAIL}`);
  let office = db;
  if (LEAD_PASSWORD) {
    office = createClient(url!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { error } = await office.auth.signInWithPassword({ email: LEAD_EMAIL, password: LEAD_PASSWORD });
    if (error) throw new Error(`sign in ${LEAD_EMAIL}: ${error.message}`);
  } else {
    console.warn(`  (no DEMO_LEAD_PASSWORD/E2E_LEAD_PASSWORD: building ${NAME} with the service role; history has no author)`);
  }

  const proj = must<Rec>(await office.from('projects').insert({
    name: NAME, client_name: 'Mehta family (demo)', site_address: 'Demo bungalow, Lonavala', created_by: lead.id,
  }).select('id').single(), 'insert Mehta project');
  const mid = proj.id;
  const floor = must<Rec>(await office.from('floors').insert({ project_id: mid, label: 'Ground Floor', sort: 1 }).select('id').single(), 'Mehta floor');
  const ROOMS = ['Living Room', 'Kitchen', 'Master Bedroom', 'Home Theatre', 'Pooja Room'];
  const mRooms = must(await office.from('rooms').insert(ROOMS.map((name, i) => ({ project_id: mid, floor_id: floor.id, name, sort: i + 1 })))
    .select('id,name'), 'Mehta rooms');
  const mRoom = (n: string) => mRooms.find((r) => r.name === n)!.id;

  const MAG: { type: string; company: string; contacts: Contact[] }[] = [
    { type: 'Electrician', company: 'Demo Lonavala Electricals', contacts: [
      { name: 'Ganesh More', designation: 'Supervisor', level: 1, phone: '+919000000701', email: 'ganesh@lonavala-elec.example.com' },
      { name: 'Sunil Kale', designation: 'Owner', level: 3, phone: '+919000000703', email: 'sunil@lonavala-elec.example.com' } ] },
    { type: 'Carpenter', company: 'Demo Teak & Co', contacts: [
      { name: 'Babu Mistry', designation: 'Head Carpenter', level: 1, phone: '+919000000711' },
      { name: 'Hitesh Panchal', designation: 'Owner', level: 3, phone: '+919000000713', email: 'hitesh@teak.example.com' } ] },
    { type: 'AC Vendor', company: 'Demo CoolAir HVAC', contacts: [
      { name: 'Arif Khan', designation: 'Technician', level: 1, phone: '+919000000721', email: 'arif@coolair.example.com' },
      { name: 'Meera Iyer', designation: 'Service Manager', level: 2, email: 'meera@coolair.example.com' } ] },
    { type: 'AV Vendor', company: 'Demo SoundStage AV', contacts: [
      { name: 'Karan Malhotra', designation: 'Installer', level: 1, phone: '+919000000731', email: 'karan@soundstage.example.com' },
      { name: 'Ritu Bose', designation: 'Project Manager', level: 2, phone: '+919000000732', email: 'ritu@soundstage.example.com' },
      { name: 'Anand Rao', designation: 'Director', level: 3, email: 'anand@soundstage.example.com' } ] },
    { type: 'Network Agency', company: 'Demo NetLink', contacts: [
      { name: 'Pradeep Nair', designation: 'Engineer', level: 1, phone: '+919000000741', email: 'pradeep@netlink.example.com' } ] },
  ];
  for (const a of MAG) {
    const ag = must<Rec>(await office.from('agencies').insert({ project_id: mid, agency_type_id: typeId(a.type), company_name: a.company })
      .select('id').single(), `Mehta agency ${a.type}`);
    must(await office.from('agency_contacts').insert(a.contacts.map((c) => ({
      project_id: mid, agency_id: ag.id, name: c.name, designation: c.designation, level: c.level, phone: c.phone ?? null, email: c.email ?? null,
    }))).select('id'), `Mehta contacts ${a.type}`);
  }

  // [room, agency type, text, custom?, final state]
  //   pending: raised N days ago, reminded R times, optional note (and a later follow-up note → 2 history events)
  //   complete: raised then closed (2 history events) · na: not applicable · new: added pending today (on the go)
  type St = { s: 'pending'; ago: number; rem: number; note?: string; later?: string } | { s: 'complete'; ago: number; doneAgo: number; note?: string }
    | { s: 'na'; note?: string } | { s: 'new'; note?: string };
  const PLAN: [string, string, string, boolean, St][] = [
    ['Living Room', 'Electrician', 'Regular ceiling lights not yet installed.', false, { s: 'pending', ago: 30, rem: 7, note: 'Fittings not delivered.', later: 'Electrician promised Friday; third promise.' }],
    ['Living Room', 'AV Vendor', 'Display device not yet installed for VTech to control.', false, { s: 'pending', ago: 21, rem: 4 }],
    ['Living Room', 'Network Agency', 'Wi-Fi access points not yet installed and activated.', false, { s: 'complete', ago: 18, doneAgo: 4, note: 'Confirmed on call with site supervisor.' }],
    ['Kitchen', 'Electrician', 'Decorative ceiling lights not yet installed.', false, { s: 'na', note: 'No decorative lights in kitchen per final drawings.' }],
    ['Kitchen', 'Carpenter', 'Keypad cutout not done.', false, { s: 'pending', ago: 10, rem: 2 }],
    ['Kitchen', 'AC Vendor', 'Outdoor termination of automation cable not done.', false, { s: 'pending', ago: 14, rem: 3, note: 'Outdoor unit on terrace; needs ladder access.' }],
    ['Master Bedroom', 'Electrician', 'Curtain motor cable not at its position.', false, { s: 'complete', ago: 12, doneAgo: 2 }],
    ['Master Bedroom', 'Carpenter', 'Door lock cutout not done.', false, { s: 'pending', ago: 5, rem: 1 }],
    ['Master Bedroom', 'AC Vendor', 'CoolMaster / BACnet addressing pending.', false, { s: 'new', note: 'Reported by site engineer on phone today.' }],
    ['Home Theatre', 'AV Vendor', 'Amplifier/home theatre system not yet installed for VTech to control.', false, { s: 'pending', ago: 25, rem: 5, note: 'Amplifier stuck at customs.' }],
    ['Home Theatre', 'AV Vendor', 'Speakers not yet installed at their positions.', false, { s: 'complete', ago: 20, doneAgo: 6 }],
    ['Home Theatre', 'Electrician', 'Speaker cable not at its position.', false, { s: 'complete', ago: 22, doneAgo: 9 }],
    ['Home Theatre', 'Carpenter', 'Acoustic panel cutouts for speakers pending.', true, { s: 'pending', ago: 3, rem: 0 }],
    ['Pooja Room', 'Electrician', 'Cove light DALI connection pending.', false, { s: 'pending', ago: 8, rem: 2 }],
    ['Pooja Room', 'Network Agency', 'Local network not yet functional.', false, { s: 'na' }],
  ];

  const masterId = (type: string, text: string) => {
    const m = masters.find((x) => x.agency_type_id === typeId(type) && x.text === text);
    if (!m) throw new Error(`master item missing: ${type} / ${text}`);
    return m.id as string;
  };
  // Room by room, as the office user adds them ("new" items are added already pending, raised today).
  for (const room of ROOMS) {
    const rows = PLAN.filter((p) => p[0] === room);
    const normal = rows.filter((p) => p[4].s !== 'new');
    must<number>(await office.rpc('add_room_dependencies', {
      p_room: mRoom(room),
      p_master_ids: normal.filter((p) => !p[3]).map((p) => masterId(p[1], p[2])),
      p_custom: normal.filter((p) => p[3]).map((p) => ({ agency_type_id: typeId(p[1]), text: p[2] })),
    }), `add_room_dependencies ${room}`);
    for (const p of rows.filter((x) => x[4].s === 'new')) {
      must<number>(await office.rpc('add_room_dependencies', {
        p_room: mRoom(room), p_master_ids: p[3] ? [] : [masterId(p[1], p[2])],
        p_custom: p[3] ? [{ agency_type_id: typeId(p[1]), text: p[2] }] : [], p_initial_status: 'pending', p_date: istDay(0),
      }), `add pending ${p[2]}`);
    }
  }
  const mItems = must(await office.from('dependency_items').select('id, room_id, agency_id, project_dependencies(text)').eq('project_id', mid), 'Mehta items');
  type MI = { id: string; room_id: string; agency_id: string | null; project_dependencies: { text: string } | { text: string }[] };
  const itemId = (room: string, text: string) => {
    const it = (mItems as unknown as MI[]).find((i) => i.room_id === mRoom(room) &&
      (Array.isArray(i.project_dependencies) ? i.project_dependencies[0] : i.project_dependencies).text === text);
    if (!it) throw new Error(`Mehta item missing: ${room} / ${text}`);
    return it.id;
  };
  if ((mItems as unknown as MI[]).some((i) => !i.agency_id)) throw new Error('Mehta: item without agency');

  const setStatus = async (item: string, status: string, ago: number, note?: string) =>
    must(await office.rpc('set_item_status', { p_item: item, p_status: status, p_date: istDay(ago), p_note: note ?? null, p_photo: null }), `set_item_status ${status}`);
  for (const [room, , text, , st] of PLAN) {
    const id = itemId(room, text);
    if (st.s === 'pending') {
      await setStatus(id, 'pending', st.ago, st.note);
      if (st.later) await setStatus(id, 'pending', 1, st.later);
      if (st.rem > 0) {
        must(await office.from('dependency_items').update({ reminder_count: st.rem, last_reminded_on: istDay(Math.min(st.ago, 2)) })
          .eq('id', id).select('id'), 'reminder count');
      }
    } else if (st.s === 'complete') {
      await setStatus(id, 'pending', st.ago);
      await setStatus(id, 'complete', st.doneAgo, st.note);
    } else if (st.s === 'na') {
      await setStatus(id, 'na', 7, st.note);
    } else if (st.note) {
      await setStatus(id, 'pending', 0, st.note);
    }
  }
  if (LEAD_PASSWORD) await office.auth.signOut();

  const fin = must(await db.from('dependency_items').select('status, reminder_count').eq('project_id', mid), 'Mehta final') as unknown as { status: string; reminder_count: number }[];
  const ev = await db.from('item_events').select('id', { count: 'exact', head: true }).eq('project_id', mid);
  const c = (s: string) => fin.filter((i) => i.status === s).length;
  console.log(`created "${NAME}" (${mid})`);
  console.log(`  floors 1 · rooms ${ROOMS.length} · agencies ${MAG.length} · items ${fin.length} (pending ${c('pending')}, complete ${c('complete')}, na ${c('na')}) · ` +
    `reminded ${fin.filter((i) => i.reminder_count > 0).length} (max ${Math.max(...fin.map((i) => i.reminder_count))}) · history events ${ev.count}`);
}

// ═════════════ Product tracking demo (v3): "Demo – Gandhi Residency 2" ═════════════
// Built ONLY through add_room_product + set_item_status, signed in as the PM lead. Products and their step chains come
// from the catalogue (migration 0007, sheet "Ashutosh Project Status" → "Hansal"). Gate rule: a product's green
// (phase 1) steps are open together; every other step unlocks once all greens are Done/N.A., so statuses are applied
// greens first, then phase 2, in date order. Steps not listed in PLAN stay unchecked.
{
  const NAME = 'Demo – Gandhi Residency 2';
  const LEAD_EMAIL = process.env.DEMO_LEAD_EMAIL ?? 'hansalgandhi+pmlead@gmail.com';
  const LEAD_PASSWORD = process.env.DEMO_LEAD_PASSWORD ?? process.env.E2E_LEAD_PASSWORD;
  const istDay = (ago: number) => new Date(Date.now() + 5.5 * 3600_000 - ago * 86_400_000).toISOString().slice(0, 10);

  const del3 = await db.from('projects').delete().eq('name', NAME).select('id');
  if (del3.error) throw new Error(`delete old ${NAME}: ${del3.error.message}`);

  const lead = must<Rec>(await db.from('profiles').select('id').eq('email', LEAD_EMAIL).single(), `lead ${LEAD_EMAIL}`);
  let office = db;
  if (LEAD_PASSWORD) {
    office = createClient(url!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { error } = await office.auth.signInWithPassword({ email: LEAD_EMAIL, password: LEAD_PASSWORD });
    if (error) throw new Error(`sign in ${LEAD_EMAIL}: ${error.message}`);
  } else {
    console.warn(`  (no DEMO_LEAD_PASSWORD/E2E_LEAD_PASSWORD: building ${NAME} with the service role; history has no author)`);
  }

  const gid = must<Rec>(await office.from('projects').insert({
    name: NAME, client_name: 'Gandhi family (demo)', site_address: 'Demo duplex, Palghar (W)', created_by: lead.id,
  }).select('id').single(), 'insert Gandhi project').id;
  const FL: Record<string, string[]> = {
    'Ground Floor': ['Living Room', 'Dining', 'Kitchen'],
    'First Floor': ['Master Bedroom', 'Kids Bedroom', 'Home Office'],
  };
  const gRooms: Rec[] = [];
  let fs = 0;
  for (const [label, rooms] of Object.entries(FL)) {
    const f = must<Rec>(await office.from('floors').insert({ project_id: gid, label, sort: ++fs }).select('id').single(), `Gandhi floor ${label}`);
    gRooms.push(...must(await office.from('rooms').insert(rooms.map((name, i) => ({ project_id: gid, floor_id: f.id, name, sort: i + 1 })))
      .select('id,name'), `Gandhi rooms ${label}`));
  }
  const gRoom = (n: string) => gRooms.find((r) => r.name === n)!.id;

  // External agencies + internal VTech teams (agencies first, so add_room_product assigns every step to one).
  const GAG: { type: string; company: string; contacts: Contact[] }[] = [
    { type: 'Electrician', company: 'Demo Palghar Power Works', contacts: [
      { name: 'Ramesh Patil', designation: 'Supervisor', level: 1, phone: '+919000000801', email: 'ramesh@palgharpower.example.com' },
      { name: 'Dinesh Vartak', designation: 'Owner', level: 3, phone: '+919000000803', email: 'dinesh@palgharpower.example.com' } ] },
    { type: 'Painter', company: 'Demo ColourCraft Painters', contacts: [
      { name: 'Salim Shaikh', designation: 'Contractor', level: 1, phone: '+919000000811', email: 'salim@colourcraft.example.com' } ] },
    { type: 'Architect', company: 'Demo Studio Axis Architects', contacts: [
      { name: 'Nisha Desai', designation: 'Project Architect', level: 1, phone: '+919000000821', email: 'nisha@studioaxis.example.com' },
      { name: 'Kunal Joshi', designation: 'Principal', level: 3, email: 'kunal@studioaxis.example.com' } ] },
    { type: 'Curtain Vendor', company: 'Demo Drape House', contacts: [
      { name: 'Farhan Ali', designation: 'Fitter', level: 1, phone: '+919000000831', email: 'farhan@drapehouse.example.com' } ] },
    { type: 'Carpenter', company: 'Demo Woodline Interiors', contacts: [
      { name: 'Mahesh Suthar', designation: 'Head Carpenter', level: 1, phone: '+919000000841' },
      { name: 'Jignesh Mistry', designation: 'Owner', level: 3, phone: '+919000000843', email: 'jignesh@woodline.example.com' } ] },
    { type: 'Network Agency', company: 'Demo FiberNet Palghar', contacts: [
      { name: 'Vivek Naik', designation: 'Field Engineer', level: 1, phone: '+919000000851', email: 'vivek@fibernet.example.com' } ] },
    { type: 'Client', company: 'Gandhi family (demo client)', contacts: [
      { name: 'Mr. Gandhi (demo)', designation: 'Home owner', level: 1, phone: '+919000000861', email: 'owner@gandhi-demo.example.com' } ] },
    { type: 'VTech Installers', company: 'VTech Installers', contacts: [
      { name: 'Santosh (demo installer)', designation: 'Lead Installer', level: 1, phone: '+919000000871', email: 'installers@vtech-demo.example.com' },
      { name: 'Ajay (demo installer)', designation: 'Installer', level: 2, phone: '+919000000872' } ] },
    { type: 'VTech Programmers', company: 'VTech Programmers', contacts: [
      { name: 'Priya (demo programmer)', designation: 'Programmer', level: 1, phone: '+919000000881', email: 'programmers@vtech-demo.example.com' } ] },
    { type: 'VTech Project Managers', company: 'VTech Project Managers', contacts: [
      { name: 'Rohan (demo PM)', designation: 'Project Manager', level: 1, phone: '+919000000891', email: 'pm@vtech-demo.example.com' },
      { name: 'Sneha (demo PM)', designation: 'Senior PM', level: 2, email: 'seniorpm@vtech-demo.example.com' } ] },
  ];
  for (const a of GAG) {
    const ag = must<Rec>(await office.from('agencies').insert({ project_id: gid, agency_type_id: typeId(a.type), company_name: a.company })
      .select('id').single(), `Gandhi agency ${a.type}`);
    must(await office.from('agency_contacts').insert(a.contacts.map((c) => ({
      project_id: gid, agency_id: ag.id, name: c.name, designation: c.designation, level: c.level, phone: c.phone ?? null, email: c.email ?? null,
    }))).select('id'), `Gandhi contacts ${a.type}`);
  }

  // Step states keyed by step label: P = pending (raised N days ago, optional note), D = done N days ago, X = N.A.
  type S = ['P' | 'D', number, string?] | ['X', string?];
  const DLV = 'Delivery pending client / VTECH';
  const greensDone = (labels: string[], ago: number): Record<string, S> => Object.fromEntries(labels.map((l) => [l, ['D', ago] as S]));
  const PLAN: { room: string | null; product: string; location?: string; steps: Record<string, S> }[] = [
    // Still in green, 2–3 greens pending at once
    { room: 'Living Room', product: 'Keypad', location: 'Entrance', steps: {
      'Engraving submitted': ['P', 12, 'Engraving text not yet approved.'], [DLV]: ['D', 9],
      'Readiness to install': ['P', 6], 'Readiness of dustfree': ['P', 4, 'Final paint coat on this wall pending.'] } },
    { room: 'Living Room', product: 'Curtain', location: 'Sheer', steps: {
      'Schedule from the other vendor': ['P', 10], [DLV]: ['D', 8], 'Opening details': ['D', 7],
      'Readiness of cable': ['P', 5], 'Readiness of dustfree': ['X', 'No painting near this window.'] } },
    { room: 'Home Office', product: 'Wifi Access point', location: 'Ceiling', steps: {
      [DLV]: ['D', 6], 'Readiness of cable': ['P', 5], 'Readiness to install': ['P', 5] } },
    { room: 'Kids Bedroom', product: 'Speakers', location: 'Wall', steps: { 'Readiness of cable': ['P', 3] } },
    // Green step waiting on the client (reported, never chased)
    { room: 'Dining', product: 'Off Termination', location: 'Main DB location', steps: { [DLV]: ['P', 15, 'Client to confirm delivery date.'] } },
    // Unlocked: Installation pending
    { room: 'Master Bedroom', product: 'Keypad', location: 'Bedside', steps: {
      ...greensDone(['Engraving submitted', DLV, 'Readiness to install', 'Readiness of dustfree'], 8), Installation: ['P', 3] } },
    { room: 'Living Room', product: 'Speakers', location: 'Ceiling', steps: {
      ...greensDone([DLV, 'Readiness of cable', 'Readiness to install'], 9), Installation: ['P', 4, 'Speakers on site; team booked.'] } },
    { room: 'Kitchen', product: 'Sensor sada', location: 'Ceiling', steps: {
      ...greensDone([DLV, 'Readiness of cable', 'Readiness to install'], 7), Installation: ['P', 2] } },
    { room: 'Kitchen', product: 'Fan control', location: 'Main DB location', steps: {
      ...greensDone([DLV, 'Readiness to install'], 6), 'Readiness of dustfree': ['X'], Installation: ['D', 3], Configuration: ['P', 1] } },
    // Blue: door lock waiting on the carpenter
    { room: 'Master Bedroom', product: 'Door lock', location: 'Door frame', steps: {
      ...greensDone([DLV, 'Readiness of cable', 'Readiness to install'], 10), 'Readiness by carpenter': ['P', 7, 'Lock cutout in door frame not done.'] } },
    // Blue: curtain fabric with the curtain vendor
    { room: 'Master Bedroom', product: 'Curtain', location: 'Heavy', steps: {
      ...greensDone(['Schedule from the other vendor', DLV, 'Opening details', 'Readiness of cable', 'Readiness of dustfree'], 14),
      Installation: ['D', 6], 'Fabric installation': ['P', 5] } },
    // Dimmer on "Scene setting" (waits on client)
    { room: 'Living Room', product: 'Dimmer dali', location: 'Main DB location', steps: {
      ...greensDone([DLV, 'Readiness to install', 'Readiness of dustfree'], 20), Installation: ['D', 15], Configuration: ['D', 13],
      'Partial installation done': ['D', 11], 'Light addressing (partial)': ['D', 9], 'Complete installation': ['D', 6],
      'Scene setting': ['P', 4, 'Waiting for client to choose scenes.'] } },
    // Switch/Router on "Internet activation" (Network Agency)
    { room: 'Home Office', product: 'Switch /Router', location: 'AV Rack', steps: {
      ...greensDone([DLV, 'Readiness of cable', 'Readiness of dustfree'], 12), Installation: ['D', 8], Configuration: ['D', 6],
      'Internet activation': ['P', 5, 'ISP visit not yet scheduled.'] } },
    // Freshly placed / barely started
    { room: 'Kids Bedroom', product: 'Keypad', location: 'Bedside', steps: {} },
    { room: 'Kids Bedroom', product: 'Curtain', location: 'Roller', steps: {} },
    { room: 'Home Office', product: 'Camera', location: 'Ceiling', steps: { [DLV]: ['D', 2] } },
    { room: 'Living Room', product: 'Sensor Intelligent', location: 'Ceiling', steps: {} },
    { room: 'Dining', product: 'Wall panel', location: 'Entrance', steps: { 'Readiness to install': ['P', 2] } },
    // Project-wide products (no green steps: open from the start)
    { room: null, product: 'iPhone programming', steps: { Configuration: ['P', 2] } },
    { room: null, product: 'Client Side', steps: { 'As built drawing': ['P', 3], 'Roomwise BOQ': ['D', 1] } },
  ];

  const catalogue = must(await office.from('product_catalogue').select('id,title'), 'product catalogue');
  const productId = (t: string) => {
    const p = catalogue.find((x) => x.title === t);
    if (!p) throw new Error(`product missing: ${t}`);
    return p.id;
  };
  type GI = { id: string; agency_id: string | null; product_steps: { label: string; phase: number } };
  const ops: { item: string; phase: number; ago: number; status: string; note?: string; label: string }[] = [];
  for (const p of PLAN) {
    const rp = must<string>(await office.rpc('add_room_product', {
      p_project: gid, p_room: p.room ? gRoom(p.room) : null, p_product: productId(p.product), p_location: p.location ?? null, p_quantity: 1, p_note: null,
    }), `add_room_product ${p.product}`);
    const its = must(await office.from('dependency_items').select('id, agency_id, product_steps(label, phase)').eq('room_product_id', rp),
      `steps ${p.product}`) as unknown as GI[];
    if (its.some((i) => !i.agency_id)) throw new Error(`Gandhi: ${p.product} has a step without an agency`);
    for (const [label, st] of Object.entries(p.steps)) {
      const it = its.find((i) => i.product_steps.label === label);
      if (!it) throw new Error(`Gandhi: step "${label}" not in ${p.product}`);
      if (st[0] === 'X') ops.push({ item: it.id, phase: it.product_steps.phase, ago: 30, status: 'na', note: st[1], label });
      else ops.push({ item: it.id, phase: it.product_steps.phase, ago: st[1], status: st[0] === 'P' ? 'pending' : 'complete', note: st[2], label });
    }
  }
  // Greens first, then phase 2; oldest first within a phase. Done steps are raised first, then closed (2 history events).
  ops.sort((a, b) => a.phase - b.phase || b.ago - a.ago);
  for (const o of ops) {
    if (o.status === 'complete') {
      must(await office.rpc('set_item_status', { p_item: o.item, p_status: 'pending', p_date: istDay(o.ago + 3), p_note: null, p_photo: null }), `raise ${o.label}`);
    }
    must(await office.rpc('set_item_status', { p_item: o.item, p_status: o.status, p_date: istDay(o.ago), p_note: o.note ?? null, p_photo: null }),
      `set_item_status ${o.label} ${o.status}`);
  }
  if (LEAD_PASSWORD) await office.auth.signOut();

  const gate = must(await db.from('item_gate').select('status, locked, waits_on_client, responsibility').eq('project_id', gid), 'Gandhi gate') as unknown as
    { status: string; locked: boolean; waits_on_client: boolean; responsibility: string }[];
  const pend = gate.filter((g) => g.status === 'pending');
  const lanes = {
    external: pend.filter((g) => !g.waits_on_client && g.responsibility !== 'internal').length,
    internal: pend.filter((g) => !g.waits_on_client && g.responsibility === 'internal').length,
    client: pend.filter((g) => g.waits_on_client).length,
  };
  const c = (s: string) => gate.filter((g) => g.status === s).length;
  console.log(`created "${NAME}" (${gid})`);
  console.log(`  floors 2 (+ Project-wide) · rooms ${gRooms.length} · agencies ${GAG.length} · products ${PLAN.length} · steps ${gate.length} ` +
    `(pending ${c('pending')}, complete ${c('complete')}, na ${c('na')}, unchecked ${c('unchecked')}; locked ${gate.filter((g) => g.locked).length})`);
  console.log(`  lanes: external ${lanes.external} · internal ${lanes.internal} · waiting on client ${lanes.client}`);
  if (!lanes.external || !lanes.internal || !lanes.client) throw new Error('Gandhi: a lane is empty');
}
