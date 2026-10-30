import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildClientPendingPdf, sortClientItems, type ClientItem } from './clientPendingReport';
import type { PdfFonts } from './pendingReport';

const dir = path.join(__dirname, 'fonts');
const fonts: PdfFonts = {
  latin: readFileSync(path.join(dir, 'NotoSansLatin-Regular.ttf')), latinBold: readFileSync(path.join(dir, 'NotoSansLatin-Bold.ttf')),
  deva: readFileSync(path.join(dir, 'NotoSansDevanagari-Regular.ttf')), devaBold: readFileSync(path.join(dir, 'NotoSansDevanagari-Bold.ttf')),
};
const item = (over: Partial<ClientItem>): ClientItem => ({
  floorLabel: 'Ground Floor', floorSort: 1, roomName: 'Living Room', roomSort: 1, product: 'Keypad (Entrance)', seq: 2,
  step: 'Delivery pending client / VTECH', state: 'pending', since: '2026-10-15', note: null, ...over,
});

describe('client-pending PDF', () => {
  it('orders floor → room → product → step, legacy items last in a room', () => {
    const s = sortClientItems([
      item({ roomName: 'Kitchen', roomSort: 3 }),
      item({ product: null, step: 'Client to approve tile samples.' }),
      item({ product: 'Dimmer dali (Main DB location)', seq: 9, step: 'Scene setting' }),
      item({ floorLabel: 'First Floor', floorSort: 2, roomName: 'Master Bedroom' }),
      item({ product: 'Dimmer dali (Main DB location)', seq: 1 }),
    ]);
    expect(s.map((i) => `${i.floorSort}/${i.roomName}/${i.product ?? '-'}/${i.seq}`)).toEqual([
      '1/Living Room/Dimmer dali (Main DB location)/1', '1/Living Room/Dimmer dali (Main DB location)/9',
      '1/Living Room/-/2', '1/Kitchen/Keypad (Entrance)/2', '2/Master Bedroom/Keypad (Entrance)/2',
    ]);
  });

  it('renders title, empty state and Devanagari; 300 rows paginate quickly', async () => {
    const empty = await PDFDocument.load(await buildClientPendingPdf({ generatedOn: '2026-10-30', projects: [] }, fonts));
    expect(empty.getPageCount()).toBe(1);
    expect(empty.getTitle()).toContain('waiting on client');

    const rows = Array.from({ length: 300 }, (_, n) => item({
      roomName: ['बैठक', 'Kitchen', 'Master Bedroom'][n % 3], roomSort: n % 3, seq: n, state: n % 4 ? 'pending' : 'ready',
      note: n % 5 ? null : 'ग्राहकाने रंग निवडलेला नाही (client yet to choose)', since: n % 7 ? '2026-10-01' : null,
    }));
    const t = performance.now();
    const bytes = await buildClientPendingPdf({ generatedOn: '2026-10-30', projects: [{ name: 'TEST – गांधी', clientName: 'गांधी कुटुंब', items: rows }] }, fonts);
    expect(performance.now() - t).toBeLessThan(4000);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(5);
  });
});
