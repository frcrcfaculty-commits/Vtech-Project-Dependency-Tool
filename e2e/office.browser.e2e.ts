// Office mode (v2) in the real UI, signed in as the PM lead (the office user). Chromium against E2E_BASE_URL.
// Outcomes are checked in the DATABASE (service-role reads), never by colours or CSS classes; selectors are role/text.
// Creates only a "TEST – e2e office-ui …" project; teardown (cleanup) deletes it and its photos. Demo data is untouched.
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { admin, cleanup, env, PNG_1PX, TEST_PREFIX } from './helpers';

const LEAD = { email: env('E2E_LEAD_EMAIL'), password: env('E2E_LEAD_PASSWORD') };
const NAME = `${TEST_PREFIX} office-ui ${Date.now()}`;
const MASTER = ['Regular ceiling lights not yet installed.', 'Ceiling fan not yet installed.', 'Speaker cable not at its position.',
  'TV control cable not at its position.', 'Keypad back box not installed.'];
const CUSTOM = 'E2E custom: false ceiling access panel pending.';
const ON_THE_GO = 'Decorative ceiling lights not yet installed.';
const NOTE = 'Site engineer: fittings arrive Friday';
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

test.describe.configure({ mode: 'serial' });

const db = admin();
let ctx: BrowserContext;
let page: Page;
let projectId = '';
let roomId = '';

/** An item card on the Hub: nearest ancestor of the dependency text that holds its Done button (and so all 3 status buttons). */
const hubCard = (text: string): Locator =>
  page.getByText(text, { exact: true }).filter({ visible: true }).first()
    .locator('xpath=ancestor::div[.//button[contains(normalize-space(.), "Done")]][1]');

const items = async () => {
  const r = await db.from('dependency_items')
    .select('id, status, note, photo_path, first_raised_on, reminder_count, last_reminded_visit_id, project_dependencies(text, master_dependency_id)')
    .eq('project_id', projectId);
  if (r.error) throw new Error(r.error.message);
  return r.data.map((i) => {
    const d = (Array.isArray(i.project_dependencies) ? i.project_dependencies[0] : i.project_dependencies) as { text: string; master_dependency_id: string | null };
    return { ...i, text: d.text, custom: d.master_dependency_id === null };
  });
};
const byText = async (t: string) => (await items()).find((i) => i.text === t)!;

test.beforeAll(async ({ browser }) => {
  await cleanup();
  ctx = await browser.newContext({ baseURL: env('E2E_BASE_URL'), viewport: { width: 1280, height: 900 } });
  await ctx.route(/^https:\/\/(wa\.me|mail\.google\.com)\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: 'stub' }));
  page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
});
test.afterAll(async () => {
  await ctx?.close();
  await cleanup();
});

test('wizard: 1 floor by default → room picker adds 5 master + 1 custom', async () => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(LEAD.email);
  await page.getByLabel(/password/i).fill(LEAD.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));

  await page.goto('/projects/new');
  await page.getByLabel(/project name/i).fill(NAME);
  await page.getByRole('button', { name: /continue to floors/i }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/setup/);
  projectId = page.url().split('/projects/')[1].split('/')[0];

  // Floors default to 1
  await expect(page.getByRole('spinbutton')).toHaveValue('1');
  await expect(page.getByRole('textbox', { name: 'Floor label' })).toHaveCount(1);
  await page.getByRole('button', { name: '+ Living Room', exact: true }).click();
  await expect.poll(async () => (await db.from('rooms').select('id').eq('project_id', projectId)).data?.length).toBe(1);
  const f = await db.from('floors').select('id').eq('project_id', projectId);
  expect(f.data).toHaveLength(1);
  roomId = (await db.from('rooms').select('id').eq('project_id', projectId).single()).data!.id;

  // Agency with an L1 contact (email + WhatsApp)
  await page.getByRole('button', { name: /next: agencies/i }).click();
  // v3 (P1) split agencies into External / Internal team: accept both the old and new button names.
  await page.getByRole('button', { name: /^\+ Add (External )?Agency$/ }).click();
  await page.locator('select').filter({ hasText: 'Select type' }).first().selectOption({ label: 'Electrician' });
  await page.getByPlaceholder('e.g. Omkar Electricals').fill('E2E UI Sparks');
  await page.getByPlaceholder('Contact Name').fill('UI Elec L1');
  await page.getByPlaceholder('Phone').fill('+919000000981');
  await page.getByPlaceholder('Email').fill('l1@ui-sparks.example.com');
  await page.getByRole('button', { name: 'Save Agency' }).click();
  await expect.poll(async () => (await db.from('agency_contacts').select('id').eq('project_id', projectId)).data?.length).toBe(1);

  // Room-by-room picker: 5 master + 1 custom
  await page.getByRole('button', { name: /next: dependencies/i }).click();
  // v3 (P2): step 4 opens on the product picker; this spec covers the v2 master-list picker, which stays behind a toggle.
  const classic = page.getByRole('button', { name: 'Use master dependency list (classic)' }).first();
  if (await classic.isVisible()) await classic.click();
  await expect(page.getByRole('heading', { name: /configuring: living room/i })).toBeVisible();
  for (const t of MASTER) await page.getByRole('checkbox', { name: t }).check();
  const customBox = page.getByPlaceholder(/italian marble/i);
  await customBox.locator('xpath=ancestor::div[.//select][1]').locator('select').first().selectOption({ label: 'Electrician' });
  await customBox.fill(CUSTOM);
  await page.getByRole('button', { name: '+ Add', exact: true }).click();
  await page.getByRole('button', { name: 'Save to this room' }).click();
  await expect.poll(async () => (await items()).length, { timeout: 15_000 }).toBe(6);
  const all = await items();
  expect(all.filter((i) => i.custom).map((i) => i.text)).toEqual([CUSTOM]);
  expect(all.map((i) => i.text).sort()).toEqual([...MASTER, CUSTOM].sort());
  expect(all.every((i) => i.status === 'unchecked')).toBe(true);

  await page.getByRole('button', { name: /next: escalation/i }).click();
  await page.getByRole('button', { name: /complete setup/i }).click();
  await page.waitForURL(new RegExp(`/projects/${projectId}`));
});

test('Hub: mark Pending with note + photo → saved with history → reload shows it', async () => {
  await page.goto(`/hub?p=${projectId}`);
  await hubCard(MASTER[0]).getByRole('button', { name: /pending/i }).click();
  await expect(page.getByRole('heading', { name: /mark as pending/i })).toBeVisible();
  await page.getByPlaceholder(/conduit work/i).fill(NOTE);
  await page.locator('input[type="file"]').setInputFiles({ name: 'evidence.png', mimeType: 'image/png', buffer: PNG_1PX });
  await page.getByRole('button', { name: 'Save Status' }).click();

  await expect.poll(async () => {
    const i = await byText(MASTER[0]);
    return [i.status, i.note, Boolean(i.photo_path), i.first_raised_on];
  }, { timeout: 20_000 }).toEqual(['pending', NOTE, true, today()]);
  const item = await byText(MASTER[0]);
  const ev = await db.from('item_events').select('status, note, photo_path, source').eq('item_id', item.id);
  expect(ev.data).toHaveLength(1);
  expect(ev.data![0]).toMatchObject({ status: 'pending', note: NOTE, source: 'office' });
  expect(ev.data![0].photo_path).toBe(item.photo_path);
  const folder = item.photo_path!.split('/').slice(0, -1).join('/');
  const listed = await db.storage.from('evidence').list(folder);
  expect(listed.data?.some((o) => item.photo_path!.endsWith(o.name))).toBe(true);

  await page.reload();
  await expect(hubCard(MASTER[0])).toContainText(NOTE);
  await expect(hubCard(MASTER[0])).toContainText(/pending/i);
});

test('"+ Add dependency" from the Pending page adds a new item already pending (raised today)', async () => {
  await page.goto('/pending');
  await page.getByRole('button', { name: 'Add dependency' }).click();
  await expect(page.getByRole('heading', { name: '+ Add Dependency' })).toBeVisible();
  // v3 (P5): the modal opens on "Add product to room"; master-list items live under the custom tab.
  const customTab = page.getByRole('button', { name: /add custom dependency/i });
  if (await customTab.isVisible()) await customTab.click();
  const modal = page.getByRole('heading', { name: '+ Add Dependency' }).locator('xpath=ancestor::div[.//button[normalize-space(.)="Save Dependencies"]][1]');
  await modal.locator('select').filter({ has: page.locator('option', { hasText: NAME }) }).selectOption({ label: NAME });
  // The room dropdown updates asynchronously after the project changes; saving earlier writes to the previous
  // project's room (UI race, reported in the PR). Wait until it points at this project's room.
  await expect(modal.locator(`select:has(option[value="${roomId}"])`)).toHaveValue(roomId);
  await expect(modal.getByRole('checkbox', { name: /mark as pending now/i })).toBeChecked();
  await modal.getByPlaceholder(/search master dependencies/i).fill('Decorative ceiling');
  await modal.getByRole('checkbox', { name: ON_THE_GO }).check();
  // Baseline from the DATABASE clock (the test machine's clock can drift): newest change outside this project.
  const newestElsewhere = async () => (await db.from('dependency_items').select('updated_at').neq('project_id', projectId)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle()).data?.updated_at ?? '1970-01-01';
  const savedAt = await newestElsewhere();
  await modal.getByRole('button', { name: 'Save Dependencies' }).click();
  await expect.poll(async () => {
    const i = await byText(ON_THE_GO);
    return i ? [i.status, i.first_raised_on] : null;
  }, { timeout: 15_000 }).toEqual(['pending', today()]);
  expect((await items()).length).toBe(7);
  // Nothing landed in any other project (guards the demo data against the room-dropdown race).
  const stray = await db.from('dependency_items').select('project_id').neq('project_id', projectId)
    .gt('updated_at', savedAt);
  expect(stray.data).toEqual([]);
  expect((await db.from('dependency_items').select('room_id').eq('id', (await byText(ON_THE_GO)).id).single()).data?.room_id).toBe(roomId);
});

test('Hub → Send reminders → review & send: email (dryrun) + WhatsApp confirmed → counts +1 exactly', async () => {
  await page.goto(`/hub?p=${projectId}`);
  const before = (await items()).filter((i) => i.status === 'pending');
  expect(before).toHaveLength(2);
  await page.getByRole('button', { name: /send reminders \(2\)/i }).click();
  await page.waitForURL(/\/visits\/[0-9a-f-]{36}\/dispatches$/);
  const visitId = page.url().split('/visits/')[1].split('/')[0];
  const v = await db.from('site_visits').select('kind').eq('id', visitId).single();
  expect(v.data?.kind).toBe('office');
  const drafts = await db.from('dispatches').select('channel, status, body_text').eq('visit_id', visitId);
  expect(drafts.data!.map((d) => d.channel).sort()).toEqual(['email', 'whatsapp']);
  expect(drafts.data!.find((d) => d.channel === 'email')!.body_text).toMatch(/As of .+ are still pending\./);

  await page.getByRole('button', { name: /send all emails \(1\)/i }).click();
  await expect.poll(async () => (await db.from('dispatches').select('status').eq('visit_id', visitId).eq('channel', 'email').single()).data?.status,
    { timeout: 20_000 }).toBe('sent');
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: /send whatsapp/i }).click();
  const wa = await popup;
  expect(wa.url()).toMatch(/^https:\/\/wa\.me\/919000000981\?text=/);
  await wa.close();
  await page.getByRole('button', { name: /i have sent it/i }).click();
  await expect.poll(async () => (await db.from('dispatches').select('status').eq('visit_id', visitId)).data!.every((d) => d.status === 'sent'),
    { timeout: 20_000 }).toBe(true);

  const after = (await items()).filter((i) => i.status === 'pending');
  for (const i of after) {
    expect(i.reminder_count, i.text).toBe(1);
    expect(i.last_reminded_visit_id).toBe(visitId);
  }
});

// Pending list (fixed on main in fa1f62f): select 2 items of one project → Send reminders goes straight to review & send.
test('Pending list: select 2 items → Send reminders → review & send has only those 2', async () => {
  await page.goto('/pending');
  // The same master texts are pending in the Demo projects too: narrow the list with the page's project filter.
  await page.locator('select').filter({ has: page.locator('option', { hasText: /All Projects/ }) }).selectOption(projectId);
  // v3 (P4) labels rows "Room · text".
  for (const t of [MASTER[0], ON_THE_GO]) await page.getByRole('checkbox', { name: new RegExp(`^Select dependency: (Living Room · )?${t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`) }).check();
  await page.getByRole('button', { name: /send reminders \(2\)/i }).click();
  await page.waitForURL(/\/visits\/[0-9a-f-]{36}\/dispatches$/);
  const visitId = page.url().split('/visits/')[1].split('/')[0];
  const di = await db.from('dispatch_items').select('item_id, dispatches!inner(visit_id)').eq('dispatches.visit_id', visitId);
  const chosen = [(await byText(MASTER[0])).id, (await byText(ON_THE_GO)).id].sort();
  expect([...new Set(di.data!.map((d) => d.item_id))].sort()).toEqual(chosen);
  const d = await db.from('dispatches').select('channel').eq('visit_id', visitId);
  expect(d.data!.map((x) => x.channel).sort()).toEqual(['email', 'whatsapp']);
});
