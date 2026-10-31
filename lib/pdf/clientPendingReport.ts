// "Waiting on client" PDF: steps that wait on the Client agency (never chased by reminder, only reported), grouped
// project → room → product, with the step, since-date and note. A4 landscape.
// Pure (data + font bytes in, PDF bytes out) and unit tested. Reuses the text/font helpers of pendingReport.ts.
import 'regenerator-runtime/runtime.js';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import { daysOpen } from '../report';
import { draw, drawLogo, formatDate, sanitize, width, wrap, type Face, type PdfFonts } from './pendingReport';

export interface ClientItem {
  floorLabel: string; floorSort: number; roomName: string; roomSort: number;
  product: string | null;          // "Keypad (Entrance)"; null for a legacy (non-product) dependency
  seq: number; step: string;       // step label, or the dependency text for legacy items
  state: 'pending' | 'ready';      // ready = unchecked but unlocked (the client can act on it now)
  since: string | null;            // pending: first raised; ready: when it unlocked (best known date)
  note: string | null;
}
export interface ClientProject { name: string; clientName: string | null; items: ClientItem[] }
export interface ClientInput { generatedOn: string; projects: ClientProject[] }

/** Stable order: floor → room → product → step; legacy items (no product) last within a room. */
export function sortClientItems(items: ClientItem[]): ClientItem[] {
  return [...items].sort((a, b) => a.floorSort - b.floorSort || a.floorLabel.localeCompare(b.floorLabel) ||
    a.roomSort - b.roomSort || a.roomName.localeCompare(b.roomName) ||
    (a.product === null ? 1 : 0) - (b.product === null ? 1 : 0) || (a.product ?? '').localeCompare(b.product ?? '') ||
    a.seq - b.seq || a.step.localeCompare(b.step));
}

const PAGE: [number, number] = [841.89, 595.28]; // A4 landscape
const M = 32, FS = 8.5, LH = 11, PAD = 4;
const COLS = [
  { key: 'no', title: 'No', w: 28 },
  { key: 'product', title: 'Product', w: 170 },
  { key: 'step', title: 'Step waiting on client', w: 200 },
  { key: 'state', title: 'Status', w: 70 },
  { key: 'since', title: 'Since', w: 62 },
  { key: 'days', title: 'Days', w: 40 },
  { key: 'note', title: 'Note', w: 207.89 },
] as const;
const GREY = rgb(0.4, 0.42, 0.46), LINE = rgb(0.86, 0.87, 0.9), AMBER = rgb(0.71, 0.33, 0.04), BAND = rgb(0.95, 0.96, 0.97);

export async function buildClientPendingPdf(input: ClientInput, fonts: PdfFonts): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`VTech – waiting on client – ${input.generatedOn}`);
  doc.setProducer('VTech Site Dependency Tracker');
  const body: Face = { latin: await doc.embedFont(fonts.latin, { subset: true }), deva: await doc.embedFont(fonts.deva, { subset: true }) };
  const bold: Face = { latin: await doc.embedFont(fonts.latinBold, { subset: true }), deva: await doc.embedFont(fonts.devaBold, { subset: true }) };
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const bottom = M + 18;
  const fullW = PAGE[0] - 2 * M;
  const newPage = () => { page = doc.addPage(PAGE); pages.push(page); y = PAGE[1] - M; };
  const header = () => {
    page.drawRectangle({ x: M, y: y - LH - 2 * PAD + 2, width: fullW, height: LH + 2 * PAD, color: BAND });
    let x = M;
    for (const c of COLS) { draw(page, c.title, x + PAD, y - LH + 1, bold, FS, GREY); x += c.w; }
    y -= LH + 2 * PAD;
  };

  newPage();
  drawLogo(page, page.getWidth() - M, y);
  const projects = input.projects.filter((p) => p.items.length);
  const total = projects.reduce((s, p) => s + p.items.length, 0);
  draw(page, 'Waiting on client', M, y - 18, bold, 18); y -= 26;
  draw(page, `${total} step${total === 1 ? '' : 's'} waiting on the client across ${projects.length} project${projects.length === 1 ? '' : 's'} · ` +
    `as of ${formatDate(input.generatedOn)} · reported only, never chased by reminder`, M, y - 11, body, 10, GREY);
  y -= 24;
  if (!projects.length) draw(page, 'Nothing is waiting on the client.', M, y - 12, body, 10);

  for (const p of projects) {
    if (y - 70 < bottom) newPage();
    y -= 6;
    draw(page, sanitize(p.name, bold), M, y - 14, bold, 14); y -= 18;
    const ready = p.items.filter((i) => i.state === 'ready').length;
    draw(page, sanitize(`${p.clientName ? `Client: ${p.clientName} · ` : ''}${p.items.length} waiting (${p.items.length - ready} pending, ${ready} ready to start)`, body),
      M, y - 10, body, 9, GREY);
    y -= 18;
    let lastRoom = '';
    let lastProduct: string | null | undefined;
    let no = 0;
    for (const i of sortClientItems(p.items)) {
      const room = i.floorLabel ? `${i.floorLabel} – ${i.roomName}` : i.roomName;
      const cells: Record<(typeof COLS)[number]['key'], string> = {
        no: String(++no), product: i.product ?? 'Other dependency', step: i.step,
        state: i.state === 'pending' ? 'Pending' : 'Ready to start', since: formatDate(i.since),
        days: String(daysOpen(i.since, input.generatedOn) ?? '—'), note: i.note ?? '',
      };
      const newRoom = room !== lastRoom;
      if (!newRoom && i.product === lastProduct) cells.product = '';
      const wrapped = COLS.map((c) => wrap(cells[c.key], body, FS, c.w - 2 * PAD));
      const h = Math.max(1, ...wrapped.map((l) => l.length)) * LH + 2 * PAD;
      if (y - h - (newRoom ? 18 + LH + 2 * PAD : 0) < bottom) {
        newPage();
        draw(page, sanitize(`${p.name} (continued)`, bold), M, y - 11, bold, 10, GREY); y -= 16;
        draw(page, sanitize(room, bold), M, y - 11, bold, 10.5); y -= 16; header();
        if (!newRoom) { cells.product = i.product ?? 'Other dependency'; wrapped[1] = wrap(cells.product, body, FS, COLS[1].w - 2 * PAD); }
      } else if (newRoom) {
        y -= 4; draw(page, sanitize(room, bold), M, y - 11, bold, 10.5); y -= 16; header();
      }
      lastRoom = room;
      lastProduct = i.product;
      let x = M;
      COLS.forEach((c, ci) => {
        const face = c.key === 'product' ? bold : body;
        const color = c.key === 'state' && i.state === 'ready' ? AMBER : c.key === 'note' ? GREY : undefined;
        wrapped[ci].forEach((l, li) => draw(page, l, x + PAD, y - PAD - (li + 1) * LH + 2.5, face, FS, color));
        x += c.w;
      });
      y -= h;
      page.drawLine({ start: { x: M, y }, end: { x: M + fullW, y }, thickness: 0.5, color: LINE });
    }
  }

  pages.forEach((pg, n) => {
    draw(pg, `VTech – waiting on client · generated ${formatDate(input.generatedOn)}`, M, M - 4, body, 7.5, GREY);
    const t = `Page ${n + 1} of ${pages.length}`;
    draw(pg, t, PAGE[0] - M - width(t, body, 7.5), M - 4, body, 7.5, GREY);
  });
  return doc.save();
}
