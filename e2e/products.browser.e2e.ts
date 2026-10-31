// Product tracking on the v4 Dashboard, signed in as the PM lead. Chromium against E2E_BASE_URL.
// Picker adds 3 products → Dashboard shows only green ✗ checkboxes → reasons → greens ✓ → one step at a time → sort + logged edit.
// Every outcome is checked in the DATABASE (item_gate); selectors are role/text only. Creates only a "TEST – e2e …" project.
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

/** A BOQ line on the v4 Dashboard matrix. */
const line = (title: string): Locator =>
  page.locator('li[data-line]').filter({ has: page.locator('p', { hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(not in list)?$`) }) }).first();
/** A status checkbox (chip) in a line, by step label. */
const chip = (title: string, label: string): Locator =>
  line(title).getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}: `) });

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

test('Dashboard: only the green steps show as ✗ checkboxes; later steps are hidden until the greens are done', async () => {
  await page.goto(`/hub?p=${projectId}`);
  await expect(page.getByRole('heading', { name: 'VTech Dashboard' })).toBeVisible();
  await expect(line('Speakers')).toBeVisible();
  for (const l of ['Delivery pending client / VTECH', 'Readiness of cable', 'Readiness to install']) {
    await expect(chip('Speakers', l)).toBeEnabled();
    await expect(chip('Speakers', l)).toHaveAccessibleName(/not done/);
  }
  await expect(chip('Speakers', 'Installation')).toHaveCount(0);
  const g = await gate('Speakers');
  expect(g.filter((x) => x.locked).map((x) => x.label)).toEqual(['Installation', 'Sound testing']);
  // "Show all steps" reveals them, locked
  await page.getByLabel('Show all steps').check();
  await expect(chip('Speakers', 'Installation')).toBeDisabled();
  await page.getByLabel('Show all steps').uncheck();
});

test('✗ asks why (HansalV2 reasons) and points the step at that agency', async () => {
  await chip('Speakers', 'Readiness of cable').click();
  await page.getByRole('radio', { name: 'Not done' }).click();
  await page.getByRole('radio', { name: /Work pending from electrician/ }).check();
  await page.getByRole('button', { name: 'Save as not done' }).click();
  await expect.poll(async () => (await gate('Speakers')).find((x) => x.label === 'Readiness of cable')!.status, { timeout: 15_000 }).toBe('pending');
  const it = ok(await db.from('dependency_items').select('stuck_reason, agencies(company_name)')
    .eq('id', (await gate('Speakers')).find((x) => x.label === 'Readiness of cable')!.item_id).single(), 'item');
  expect(it.stuck_reason).toBe('Work pending from electrician');
  expect((it.agencies as unknown as { company_name: string }).company_name).toBe('E2E UI Electrician');
  await expect(chip('Speakers', 'Readiness of cable')).toHaveAccessibleName(/Work pending from electrician/);
});

test('✓ all greens → only Installation appears in the same space; Sound testing waits for it', async () => {
  for (const l of ['Delivery pending client / VTECH', 'Readiness of cable', 'Readiness to install']) {
    await chip('Speakers', l).click();
    await page.getByRole('radio', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Save as done' }).click();
    await expect.poll(async () => (await gate('Speakers')).find((x) => x.label === l)!.status, { timeout: 15_000 }).toBe('complete');
  }
  const after = await gate('Speakers');
  expect(after.filter((x) => x.phase === 2).map((x) => [x.label, x.locked])).toEqual([['Installation', false], ['Sound testing', true]]);
  await expect(chip('Speakers', 'Installation')).toBeEnabled();
  await expect(chip('Speakers', 'Readiness of cable')).toHaveCount(0);
  await expect(chip('Speakers', 'Sound testing')).toHaveCount(0);
  await chip('Speakers', 'Installation').click();
  await page.getByRole('radio', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Save as done' }).click();
  await expect(chip('Speakers', 'Sound testing')).toBeEnabled({ timeout: 15_000 });
  // Other products are untouched: Keypad's later steps are still locked
  expect((await gate('Keypad')).filter((x) => x.phase === 2).every((x) => x.locked)).toBe(true);
});

test('Sort product-wise / floor-wise; Edit project details logs why and who asked', async () => {
  await page.getByRole('radio', { name: /Product-wise/ }).click();
  await expect(page.getByRole('heading', { level: 3, name: /^Door lock/ })).toBeVisible();
  await page.getByRole('radio', { name: /Floor-wise/ }).click();
  await expect(page.getByRole('heading', { level: 3, name: /^Ground Floor/ })).toBeVisible();

  await page.getByRole('button', { name: 'Edit project details' }).click();
  await page.getByLabel('Keypad location').fill('Bedside');
  await page.getByRole('button', { name: /^Save 1 change$/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: /why the change is needed/ })).toBeVisible();
  await page.getByLabel('Requested by').fill('Client – E2E');
  await page.getByLabel('Why is the change needed?').fill('Keypad moved after site visit');
  await page.getByRole('button', { name: /^Save 1 change$/ }).click();
  await expect.poll(async () => (await db.from('room_products').select('location, product_catalogue!inner(title)').eq('project_id', projectId)
    .eq('product_catalogue.title', 'Keypad').single()).data?.location, { timeout: 15_000 }).toBe('Bedside');
  await expect.poll(async () => (await db.from('project_changes').select('id').eq('project_id', projectId)).data?.length, { timeout: 15_000 }).toBe(1);
  const log = ok(await db.from('project_changes').select('requested_by, reason, changes').eq('project_id', projectId), 'log');
  expect(log[0]).toMatchObject({ requested_by: 'Client – E2E', reason: 'Keypad moved after site visit' });
  expect(log[0].changes).toEqual([{ what: 'Keypad · Ground Floor · Living Room: location', from: 'Entrance', to: 'Bedside' }]);
});

test('Floating "+ Add": a BOQ product not in the list → bell + "Add dependencies"; a dependency added to a product shows as ✗', async () => {
  await page.goto(`/hub?p=${projectId}`);
  await page.getByRole('button', { name: 'Add dependency', exact: true }).first().click();
  await page.getByLabel('Product (as in the BOQ)').fill('Motorised TV lift');
  await page.getByLabel('Location', { exact: true }).fill('Wall');
  await page.getByRole('button', { name: 'Add product' }).click();
  await expect.poll(async () => (await db.from('room_products').select('product_id, boq_title').eq('project_id', projectId).eq('boq_title', 'Motorised TV lift')).data?.length,
    { timeout: 15_000 }).toBe(1);
  await expect(page.getByRole('button', { name: /^Notifications \(\d+\)/ })).toBeVisible();
  await line('Motorised TV lift').getByRole('button', { name: /Add dependencies/ }).click();
  await page.getByRole('button', { name: 'Save dependencies' }).click();
  await expect(chip('Motorised TV lift', 'Readiness of cable')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Add dependency', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Dependency to a product' }).click();
  await page.getByLabel('Product in this room').selectOption({ label: 'Keypad · Bedside' });
  await page.getByLabel('Dependency', { exact: true }).fill('False ceiling opening for keypad');
  await page.getByLabel('Why is it not done?').fill('Work pending from electrician');
  await page.getByRole('button', { name: 'Add dependency', exact: true }).last().click();
  await expect(chip('Keypad', 'False ceiling opening for keypad')).toHaveAccessibleName(/Work pending from electrician/, { timeout: 15_000 });
});
