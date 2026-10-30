// Product tracking (v3) in the real UI, signed in as the PM lead. Chromium against E2E_BASE_URL.
// Picker adds 3 products to a room → Hub shows the locked steps without status buttons → complete the greens in the UI →
// Installation (and the other phase-2 steps) become actionable. Every outcome is checked in the DATABASE (item_gate);
// selectors are role/text only. Creates only a "TEST – e2e …" project; cleanup() deletes it.
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { admin, cleanup, env, ok, TEST_PREFIX } from './helpers';

const LEAD = { email: env('E2E_LEAD_EMAIL'), password: env('E2E_LEAD_PASSWORD') };
const NAME = `${TEST_PREFIX} products-ui ${Date.now()}`;
const PRODUCTS: [string, string][] = [['Keypad', 'Entrance'], ['Speakers', 'Ceiling'], ['Door lock', 'Door frame']];

test.describe.configure({ mode: 'serial' });

const db = admin();
let ctx: BrowserContext;
let page: Page;
let projectId = '';
let roomId = '';

type Gate = { item_id: string; label: string; phase: number; status: string; locked: boolean };
const gate = async (title: string): Promise<Gate[]> => {
  const rp = ok(await db.from('room_products').select('id, product_catalogue!inner(title)').eq('project_id', projectId)
    .eq('product_catalogue.title', title).single(), `rp ${title}`);
  return ok(await db.from('item_gate').select('item_id, label, phase, status, locked').eq('room_product_id', rp.id).order('seq'), 'gate') as Gate[];
};

/** A product card on the Hub: the outermost ancestor of its heading that holds only that one product heading. */
const card = (title: string): Locator =>
  page.getByRole('heading', { level: 5, name: new RegExp(`^${title}\\b`) }).locator('xpath=ancestor::div[count(.//h5)=1][last()]');
/** A step row inside a product card: nearest ancestor of the step label holding its own actions (buttons or the lock). */
const row = (title: string, label: string): Locator =>
  card(title).locator('p', { hasText: new RegExp(`^#\\d+\\s*${label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`) })
    .locator('xpath=ancestor::div[.//button[contains(., "Done")] or .//span[contains(., "Locked")]][1]');

test.beforeAll(async ({ browser }) => {
  await cleanup();
  const lead = ok(await db.from('profiles').select('id').eq('email', LEAD.email).single(), 'lead');
  const p = ok(await db.from('projects').insert({ name: NAME, client_name: 'E2E products UI', created_by: lead.id }).select('id').single(), 'project');
  projectId = p.id;
  const f = ok(await db.from('floors').insert({ project_id: projectId, label: 'Ground Floor', sort: 1 }).select('id').single(), 'floor');
  roomId = ok(await db.from('rooms').insert({ project_id: projectId, floor_id: f.id, name: 'Living Room', sort: 1 }).select('id').single(), 'room').id;
  const types = ok(await db.from('agency_types').select('id, name').in('name', ['Electrician', 'Painter', 'Architect', 'Carpenter', 'Client', 'VTech Installers', 'VTech Programmers']), 'types');
  for (const t of types) ok(await db.from('agencies').insert({ project_id: projectId, agency_type_id: t.id, company_name: `E2E UI ${t.name}` }).select('id'), t.name);

  ctx = await browser.newContext({ baseURL: env('E2E_BASE_URL'), viewport: { width: 1366, height: 1000 } });
  page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(LEAD.email);
  await page.getByLabel(/password/i).fill(LEAD.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
});
test.afterAll(async () => {
  await ctx?.close();
  await cleanup();
});

test('product picker: add Keypad, Speakers and Door lock (with locations) to a room → full step chains in the DB', async () => {
  await page.goto(`/projects/${projectId}/rooms/${roomId}/dependencies`);
  await expect(page.getByRole('heading', { name: /add product to living room/i })).toBeVisible();
  for (const [title, loc] of PRODUCTS) {
    await page.getByPlaceholder(/filter products/i).fill(title);
    const tile = page.getByRole('heading', { level: 4, name: title, exact: true }).locator('xpath=ancestor::div[.//button[contains(., "+ Add to")]][1]');
    await tile.getByRole('combobox').selectOption(loc);
    await tile.getByRole('button', { name: /\+ Add to Room/ }).click();
    await expect.poll(async () => (await db.from('room_products').select('id').eq('project_id', projectId)).data?.length, { timeout: 15_000 })
      .toBe(PRODUCTS.findIndex((p) => p[0] === title) + 1);
  }
  const rps = ok(await db.from('room_products').select('location, room_id, product_catalogue(title)').eq('project_id', projectId), 'rps');
  expect(rps.map((r) => `${(r.product_catalogue as unknown as { title: string }).title}|${r.location}|${r.room_id === roomId}`).sort())
    .toEqual(PRODUCTS.map(([t, l]) => `${t}|${l}|true`).sort());
  expect((await gate('Keypad')).length).toBe(7);
  expect((await gate('Speakers')).length).toBe(5);
  expect((await gate('Door lock')).length).toBe(6);
});

test('Hub: locked steps have no status buttons; open greens do', async () => {
  await page.goto(`/hub?p=${projectId}`);
  await expect(card('Speakers')).toBeVisible();
  // Default view hides locked steps; switch to all steps to inspect them.
  await page.getByRole('button', { name: /what.s actionable now/i }).click();
  await expect(page.getByRole('button', { name: /show all steps/i })).toBeVisible();

  const g = await gate('Speakers');
  expect(g.filter((x) => x.locked).map((x) => x.label)).toEqual(['Installation', 'Sound testing']);
  for (const l of ['Installation', 'Sound testing']) {
    await expect(row('Speakers', l)).toContainText(/Locked/);
    await expect(row('Speakers', l).getByRole('button', { name: /done|pending|n\.a\./i })).toHaveCount(0);
  }
  for (const l of ['Readiness of cable', 'Readiness to install']) {
    await expect(row('Speakers', l).getByRole('button', { name: /done/i })).toBeEnabled();
  }
  // Door lock's blue carpenter step is locked too
  await expect(row('Door lock', 'Readiness by carpenter')).toContainText(/Locked/);
});

test('complete the Speakers greens in the UI → Installation and Sound testing unlock together and become actionable', async () => {
  for (const g of (await gate('Speakers')).filter((x) => x.phase === 1)) {
    await row('Speakers', g.label).getByRole('button', { name: /done/i }).click();
    await page.getByRole('button', { name: 'Save Status' }).click();
    await expect.poll(async () => (await gate('Speakers')).find((x) => x.item_id === g.item_id)!.status, { timeout: 15_000 }).toBe('complete');
  }
  const after = await gate('Speakers');
  expect(after.filter((x) => x.phase === 2).map((x) => [x.label, x.locked])).toEqual([['Installation', false], ['Sound testing', false]]);

  await page.reload();
  const toggle = page.getByRole('button', { name: /what.s actionable now/i });
  if (await toggle.isVisible()) await toggle.click();
  await expect(row('Speakers', 'Installation')).not.toContainText(/Locked/);
  await row('Speakers', 'Installation').getByRole('button', { name: /pending/i }).click();
  await page.getByRole('button', { name: 'Save Status' }).click();
  await expect.poll(async () => (await gate('Speakers')).find((x) => x.label === 'Installation')!.status, { timeout: 15_000 }).toBe('pending');
  // Other products are untouched: Keypad's phase-2 steps are still locked
  expect((await gate('Keypad')).filter((x) => x.phase === 2).every((x) => x.locked)).toBe(true);
});
