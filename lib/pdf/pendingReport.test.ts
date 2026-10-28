import { readFileSync } from 'node:fs';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildPendingPdf, formatDate, groupRows, roomLabel, wrap, type PdfFonts, type PdfRow } from './pendingReport';

const dir = path.join(__dirname, 'fonts');
const fonts: PdfFonts = {
  latin: readFileSync(path.join(dir, 'NotoSansLatin-Regular.ttf')), latinBold: readFileSync(path.join(dir, 'NotoSansLatin-Bold.ttf')),
  deva: readFileSync(path.join(dir, 'NotoSansDevanagari-Regular.ttf')), devaBold: readFileSync(path.join(dir, 'NotoSansDevanagari-Bold.ttf')),
};
const agencies = [['Electrician', 1, 'Sparks'], ['Carpenter', 2, 'Woodcraft'], ['Curtain Vendor', 7, 'Drapes & Blinds'], ['VTech', 8, 'VTech']] as const;
const row = (n: number, over: Partial<PdfRow> = {}): PdfRow => {
  const [agencyType, agencyTypeSort, company] = agencies[n % agencies.length];
  return { floorLabel: `${12 + (n % 3)}th Floor`, floorSort: 12 + (n % 3), roomName: ['Kitchen Area', 'Son Bedroom', 'Whole Floor'][n % 3],
    roomSort: n % 3, agencyType, agencyTypeSort, company, seq: n, text: 'Roller blind fabric installation pending.',
    note: n % 5 ? null : 'Lock given to carpenter for cutout.', firstRaisedOn: '2026-10-14', reminderCount: n % 8, ...over };
};
const input = (rows: PdfRow[]) => ({ projectName: 'Demo – Shah Residence', clientName: 'Shah family', siteAddress: 'Mumbai',
  generatedOn: '2026-10-28', terms: 'General terms and attention\n1. VTech needs 2–4 days.', rows });

describe('pending-items PDF', () => {
  it('groups by agency type order, numbers across groups, floor-only rooms show the floor', () => {
    const g = groupRows([row(1), row(2), row(4), row(3)]);
    expect(g.map((x) => x.title)).toEqual(['Electrician – Sparks', 'Carpenter – Woodcraft', 'Curtain Vendor – Drapes & Blinds', 'VTech – VTech']);
    expect(g.flatMap((x) => x.rows.map((r) => r.no))).toEqual([1, 2, 3, 4]);
    expect(roomLabel({ floorLabel: '13th Floor', roomName: 'Whole Floor' })).toBe('13th Floor');
    expect(roomLabel({ floorLabel: '12th Floor', roomName: 'Exit Area' })).toBe('12th Floor – Exit Area');
    expect(formatDate('2026-09-02')).toBe('02 Sep 2026');
  });

  it('renders 150 rows quickly and paginates', async () => {
    const t = performance.now();
    const bytes = await buildPendingPdf(input(Array.from({ length: 150 }, (_, n) => row(n))), fonts);
    const ms = performance.now() - t;
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(3);
    expect(ms).toBeLessThan(3000);
  });

  it('does not crash on Hindi/Marathi, emoji, CJK, control chars, very long words', async () => {
    const bytes = await buildPendingPdf(input([
      row(0, { roomName: 'मास्टर बेडरूम', floorLabel: 'बारावा मजला' }),
      row(1, { roomName: 'पूजा घर', text: 'पडदे बसवणे बाकी — Curtain पेंडिंग', note: 'टीप: भिंत तयार नाही' }),
      row(2, { roomName: 'Room 😀 漢字', text: 'x'.repeat(400), note: 'tab\there\u0007bell' }),
      row(3, { company: 'श्री गणेश इलेक्ट्रिकल्स' }),
    ]), fonts);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it('keeps the note on its own line (newline survives sanitising)', async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const face = { latin: await doc.embedFont(fonts.latin), deva: await doc.embedFont(fonts.deva) };
    expect(wrap('Face reader pending.\nWall not final.', face, 8.5, 500)).toEqual(['Face reader pending.', 'Wall not final.']);
  });

  it('empty project still renders', async () => {
    expect((await PDFDocument.load(await buildPendingPdf(input([]), fonts))).getPageCount()).toBe(1);
  });
});
