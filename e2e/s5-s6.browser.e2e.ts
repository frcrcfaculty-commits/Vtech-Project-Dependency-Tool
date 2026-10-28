// Browser specs for S5 (site visit) and S6 (review & send), driven through the real UI as the test PM,
// against "Demo – Shah Residence" (seeded by scripts/seed-demo.ts).
// Every outcome is checked in the DATABASE (service-role reads), never by button colour or CSS classes.
// Selectors are role/text based. Teardown deletes the visits this spec created on the Demo project and
// restores every Demo item to its pre-test state, so the demo data is left exactly as it was.
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { admin, env, PNG_1PX } from './helpers';

const DEMO = 'Demo – Shah Residence';
const PM = { email: env('E2E_PM_EMAIL'), password: env('E2E_PM_PASSWORD') };
const DONE_TEXT = 'On/off lights installation pending.';        // Electrician → mark Done (with date)
const PENDING_TEXT = 'Door magnet cutout pending.';             // Carpenter   → mark Pending + photo
const NA_TEXT = 'New light programming pending.';               // VTech       → mark N.A.

test.describe.configure({ mode: 'serial' });

type ItemSnap = {
  id: string; status: string; first_raised_on: string | null; completed_on: string | null; reminder_count: number;
  last_reminded_on: string | null; last_reminded_visit_id: string | null; note: string | null; photo_path: string | null;
};
const db = admin();
let ctx: BrowserContext;
let page: Page;
let projectId = '';
let visitId = '';
let snapshot: ItemSnap[] = [];
let startedAt = '';
const ids: Record<'done' | 'pending' | 'na', string> = { done: '', pending: '', na: '' };

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() + 5.5 * 3_600_000 - n * 86_400_000).toISOString().slice(0, 10);

/** The card for one dependency item: nearest ancestor of its text that holds a Done button. */
const card = (text: string): Locator =>
  page.getByText(text, { exact: true }).locator('xpath=ancestor::div[.//button[contains(normalize-space(.), "Done")]][1]');

test.beforeAll(async ({ browser }) => {
  startedAt = new Date().toISOString();
  const p = await db.from('projects').select('id').eq('name', DEMO).single();
  if (p.error || !p.data) throw new Error(`"${DEMO}" missing: run npx tsx --env-file=.env.local scripts/seed-demo.ts`);
  projectId = p.data.id;
  const items = await db.from('dependency_items')
    .select('id, status, first_raised_on, completed_on, reminder_count, last_reminded_on, last_reminded_visit_id, note, photo_path, rooms!inner(name, floors!inner(label)), project_dependencies!inner(text)')
    .eq('project_id', projectId);
  if (items.error) throw new Error(items.error.message);
  snapshot = items.data.map(({ rooms: _r, project_dependencies: _d, ...rest }) => rest as ItemSnap);
  type Row = { id: string; rooms: unknown; project_dependencies: unknown };
  const one = <T,>(x: unknown) => (Array.isArray(x) ? x[0] : x) as T;
  const find = (text: string) => (items.data as Row[]).find((i) => {
    const room = one<{ name: string; floors: unknown }>(i.rooms);
    return one<{ label: string }>(room.floors).label === '13th Floor' && room.name === 'Whole Floor'
      && one<{ text: string }>(i.project_dependencies).text === text;
  })!.id;
  ids.done = find(DONE_TEXT); ids.pending = find(PENDING_TEXT); ids.na = find(NA_TEXT);

  ctx = await browser.newContext({ baseURL: env('E2E_BASE_URL'), viewport: { width: 420, height: 900 } });
  // Never hit the real wa.me / Gmail from a test: stub any external link the app opens.
  await ctx.route(/^https:\/\/(wa\.me|mail\.google\.com)\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: 'stub' }));
  page = await ctx.newPage();
});

test.afterAll(async () => {
  await ctx?.close();
  if (!projectId) return;
  // 1. Delete only the visits this run created (cascades to visit_checks, dispatches, dispatch_items).
  const mine = await db.from('site_visits').select('id').eq('project_id', projectId).gte('created_at', startedAt);
  const visitIds = (mine.data ?? []).map((v) => v.id);
  if (visitIds.length) await db.from('site_visits').delete().in('id', visitIds);
  // 2. Remove photos uploaded during the run.
  const after = await db.from('dependency_items').select('id, photo_path').eq('project_id', projectId);
  const newPhotos = (after.data ?? []).filter((a) => a.photo_path && a.photo_path !== snapshot.find((s) => s.id === a.id)?.photo_path)
    .map((a) => a.photo_path as string);
  if (newPhotos.length) await db.storage.from('evidence').remove(newPhotos);
  // 3. Restore every Demo item exactly.
  for (const s of snapshot) {
    const { id, ...fields } = s;
    await db.from('dependency_items').update(fields).eq('id', id);
  }
});

test('S5 site visit: sign in, start visit, mark Done (dated) / Pending (photo) / N.A., marks persist, finalize', async () => {
  // Sign in
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(PM.email);
  await page.getByLabel(/password/i).fill(PM.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));

  // Open the Demo project and start a visit
  await page.getByRole('link', { name: new RegExp(DEMO) }).first().click();
  await page.waitForURL(new RegExp(`/projects/${projectId}$`));
  await page.getByRole('link', { name: /start site visit|new visit/i }).first().click();
  await page.getByRole('button', { name: /start visit/i }).click();
  await page.waitForURL(/\/visits\/[0-9a-f-]{36}$/);
  visitId = page.url().split('/').pop()!;
  const v = await db.from('site_visits').select('status, visit_date, project_id').eq('id', visitId).single();
  expect(v.data).toMatchObject({ status: 'draft', project_id: projectId, visit_date: today() });

  // Go to 13th Floor → Whole Floor
  await page.getByRole('button', { name: /^13th Floor/ }).click();
  await page.getByRole('button', { name: /^Whole Floor/ }).click();
  await expect(page.getByRole('heading', { name: 'Whole Floor' })).toBeVisible();

  // Done, then set the completion date through "+ Note" → date → Save Details
  const doneDate = daysAgo(2);
  await card(DONE_TEXT).getByRole('button', { name: /done/i }).click();
  await card(DONE_TEXT).getByRole('button', { name: /note/i }).click();
  await page.locator('input[type="date"]').fill(doneDate);
  await page.getByRole('button', { name: /save details/i }).click();

  // Pending + one photo
  await card(PENDING_TEXT).getByRole('button', { name: /pending/i }).click();
  await card(PENDING_TEXT).locator('input[type="file"]').setInputFiles({ name: 'evidence.png', mimeType: 'image/png', buffer: PNG_1PX });

  // N.A.
  await card(NA_TEXT).getByRole('button', { name: /n\.a\./i }).click();

  // Database has the three checks
  const checks = async () => {
    const r = await db.from('visit_checks').select('item_id, status, status_date, photo_path').eq('visit_id', visitId);
    return Object.fromEntries((r.data ?? []).map((c) => [c.item_id, c]));
  };
  await expect.poll(async () => {
    const c = await checks();
    return [c[ids.done]?.status, c[ids.done]?.status_date, c[ids.pending]?.status, Boolean(c[ids.pending]?.photo_path), c[ids.na]?.status];
  }, { timeout: 20_000 }).toEqual(['complete', doneDate, 'pending', true, 'na']);
  const photoPath = (await checks())[ids.pending].photo_path as string;
  expect(photoPath.startsWith(`${projectId}/${ids.pending}/`)).toBe(true);
  const obj = await db.storage.from('evidence').list(`${projectId}/${ids.pending}`);
  expect(obj.data?.some((o) => photoPath.endsWith(o.name))).toBe(true);

  // Reload: marks persisted server-side (nothing left in the offline queue), same rows in the DB
  await page.reload();
  await expect(page.getByRole('button', { name: /finalize visit/i })).toBeVisible();
  await expect(page.getByText(/\d+ unsaved/)).toHaveCount(0);
  expect(Object.keys(await checks())).toHaveLength(3);

  // Finalize → lands on review & send
  await page.getByRole('button', { name: /finalize visit/i }).click();
  await page.waitForURL(new RegExp(`/visits/${visitId}/dispatches$`));
  const fin = await db.from('site_visits').select('status').eq('id', visitId).single();
  expect(fin.data?.status).toBe('finalized');
  const it = await db.from('dependency_items').select('id, status, completed_on, photo_path').in('id', Object.values(ids));
  const byId = Object.fromEntries((it.data ?? []).map((i) => [i.id, i]));
  expect(byId[ids.done]).toMatchObject({ status: 'complete', completed_on: doneDate });
  expect(byId[ids.pending]).toMatchObject({ status: 'pending', photo_path: photoPath });
  expect(byId[ids.na].status).toBe('na');
});

test('S6 review & send: drafts per agency, send email (dryrun), open WhatsApp + confirm, counts +1 exactly', async () => {
  test.skip(!visitId, 'S5 did not create a visit');
  await expect(page.getByRole('button', { name: /send all emails/i })).toBeVisible();

  // Drafts: one WhatsApp per agency with pending items; one email where the target (L1) level has an email contact.
  const pendingNow = await db.from('dependency_items').select('id, agency_id, reminder_count').eq('project_id', projectId).eq('status', 'pending');
  const before = new Map((pendingNow.data ?? []).map((i) => [i.id, i.reminder_count as number]));
  const agencyIds = [...new Set((pendingNow.data ?? []).map((i) => i.agency_id as string))];
  const contacts = await db.from('agency_contacts').select('agency_id, level, email, phone, active').in('agency_id', agencyIds);
  const drafts = await db.from('dispatches').select('id, agency_id, channel, status, level').eq('visit_id', visitId);
  expect(drafts.data!.every((d) => d.status === 'draft' && d.level === 1)).toBe(true);
  for (const a of agencyIds) {
    const l1 = (contacts.data ?? []).filter((c) => c.agency_id === a && c.active && c.level === 1);
    const mine = drafts.data!.filter((d) => d.agency_id === a);
    expect(mine.filter((d) => d.channel === 'whatsapp')).toHaveLength(l1.some((c) => c.phone) ? 1 : 0);
    expect(mine.filter((d) => d.channel === 'email')).toHaveLength(l1.some((c) => c.email) ? 1 : 0);
  }
  const emailCount = drafts.data!.filter((d) => d.channel === 'email').length;
  const waCount = drafts.data!.filter((d) => d.channel === 'whatsapp').length;
  expect(emailCount).toBeGreaterThan(0);
  expect(waCount).toBe(agencyIds.length);

  // Send all emails (EMAIL_MODE=dryrun → marked sent server-side, no link to confirm)
  await page.getByRole('button', { name: new RegExp(`send all emails \\(${emailCount}\\)`, 'i') }).click();
  await expect.poll(async () => (await db.from('dispatches').select('id').eq('visit_id', visitId).eq('channel', 'email').eq('status', 'sent')).data?.length,
    { timeout: 30_000 }).toBe(emailCount);

  // WhatsApp: each "Send WhatsApp" opens a wa.me link (stubbed); then "I have sent it"
  for (let n = 0; n < waCount; n++) {
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: /send whatsapp/i }).first().click();
    const wa = await popup;
    expect(wa.url()).toMatch(/^https:\/\/wa\.me\/91900000\d{4}\?text=/);
    await wa.close();
    await page.getByRole('button', { name: /i have sent it/i }).click();
    await expect(page.getByRole('button', { name: /send whatsapp/i })).toHaveCount(waCount - n - 1);
  }

  // Database: every dispatch sent, visit sent, every pending item's reminder count went up by exactly 1
  const sent = await db.from('dispatches').select('status').eq('visit_id', visitId);
  expect(sent.data!.every((d) => d.status === 'sent')).toBe(true);
  expect((await db.from('site_visits').select('status').eq('id', visitId).single()).data?.status).toBe('sent');
  const afterItems = await db.from('dependency_items').select('id, reminder_count, last_reminded_visit_id').in('id', [...before.keys()]);
  for (const i of afterItems.data!) {
    expect(i.reminder_count, `item ${i.id}`).toBe(before.get(i.id)! + 1);
    expect(i.last_reminded_visit_id).toBe(visitId);
  }
});
