import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildPortfolioPdf, levelOf, summarise, type PortfolioItem, type PortfolioProject } from './portfolioReport';
import type { PdfFonts } from './pendingReport';

const dir = path.join(__dirname, 'fonts');
const fonts: PdfFonts = {
  latin: readFileSync(path.join(dir, 'NotoSansLatin-Regular.ttf')), latinBold: readFileSync(path.join(dir, 'NotoSansLatin-Bold.ttf')),
  deva: readFileSync(path.join(dir, 'NotoSansDevanagari-Regular.ttf')), devaBold: readFileSync(path.join(dir, 'NotoSansDevanagari-Bold.ttf')),
};
const policy = { l2After: 3, l3After: 6, mgmtCcLevel: 3 };
const item = (n: number, over: Partial<PortfolioItem> = {}): PortfolioItem => ({
  floorLabel: 'पहिला मजला', floorSort: 1, roomName: ['मास्टर बेडरूम', 'पूजा घर', 'Living Room'][n % 3], roomSort: n % 3,
  agencyType: ['Electrician', 'Carpenter', 'AV Vendor'][n % 3], agencyTypeSort: n % 3, company: ['श्री गणेश इलेक्ट्रिकल्स', 'Woodcraft', 'SoundStage'][n % 3],
  seq: n, text: 'Regular ceiling lights not yet installed.', note: n % 6 ? null : 'भिंत तयार नाही (wall not final)',
  firstRaisedOn: '2026-09-15', reminderCount: n % 9, ...over,
});
const project = (name: string, n: number): PortfolioProject => ({ name, clientName: 'पाटील कुटुंब', policy, items: Array.from({ length: n }, (_, i) => item(i)) });

describe('portfolio PDF', () => {
  it('level follows the escalation policy; never-reminded = none; escalation off stays L1', () => {
    const p = project('A', 0);
    expect([0, 1, 3, 4, 6, 7].map((r) => levelOf(item(0, { reminderCount: r }), p))).toEqual([null, 1, 1, 2, 2, 3]);
    expect(levelOf(item(0, { reminderCount: 9, company: 'X' }), { ...p, escalationByAgency: { X: false } })).toBe(1);
  });

  it('cover totals per project', () => {
    const s = summarise({ generatedOn: '2026-10-29', projects: [project('A', 9), project('B', 0)] });
    expect(s[0]).toMatchObject({ name: 'A', pending: 9, escalated: 5, l3: 2, oldest: 44, agencies: 3 });
    expect(s[1]).toMatchObject({ name: 'B', pending: 0, escalated: 0 });
  });

  it('3 projects × 100 items (Devanagari) render in under 4 s', async () => {
    const t = performance.now();
    const bytes = await buildPortfolioPdf({ generatedOn: '2026-10-29', projects: [project('TEST – one', 100), project('दुसरा प्रकल्प', 100), project('Third', 100)] }, fonts);
    expect(performance.now() - t).toBeLessThan(4000);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(6);
  });

  it('no projects still renders a cover', async () => {
    expect((await PDFDocument.load(await buildPortfolioPdf({ generatedOn: '2026-10-29', projects: [] }, fonts))).getPageCount()).toBe(1);
  });
});
