// Pending-items PDF in the Specimen sheet layout: No · Room (Floor – Room) · Agency · Dependency · First raised · Reminder #,
// grouped by agency, project terms at the end. Pure (data + font bytes in, PDF bytes out) so it is unit tested.
// pdf-lib does no complex-script shaping: Devanagari renders with the right glyphs but some conjuncts/matras
// may sit slightly off. The requirement is that Hindi/Marathi names never crash the report; they don't.
// @pdf-lib/fontkit's Indic shaper is Babel-compiled and expects a global regeneratorRuntime.
import 'regenerator-runtime/runtime.js';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface PdfRow {
  floorLabel: string; floorSort: number;
  roomName: string; roomSort: number;
  agencyType: string; agencyTypeSort: number; company: string;
  seq: number; text: string; note: string | null;
  firstRaisedOn: string | null; // ISO date
  reminderCount: number;        // reminders already sent
}

export interface PdfInput {
  projectName: string;
  clientName: string | null;
  siteAddress: string | null;
  generatedOn: string; // ISO date (IST)
  terms: string;
  rows: PdfRow[];
}

export interface PdfFonts { latin: Uint8Array; latinBold: Uint8Array; deva: Uint8Array; devaBold: Uint8Array }

/** Room label as in the Specimen: "12th Floor – Kitchen Area", or just "13th Floor" for floor-wide items. */
export const roomLabel = (r: Pick<PdfRow, 'floorLabel' | 'roomName'>) =>
  /^whole floor$/i.test(r.roomName.trim()) ? r.floorLabel : `${r.floorLabel} – ${r.roomName}`;

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
}

/** Group by agency (agency type order, then company), rows sorted floor → room → seq. Numbering runs across the report. */
export function groupRows(rows: PdfRow[]) {
  const sorted = [...rows].sort((a, b) =>
    a.agencyTypeSort - b.agencyTypeSort || a.agencyType.localeCompare(b.agencyType) || a.company.localeCompare(b.company) ||
    a.floorSort - b.floorSort || a.roomSort - b.roomSort || a.seq - b.seq || a.text.localeCompare(b.text));
  const groups: { title: string; rows: (PdfRow & { no: number })[] }[] = [];
  sorted.forEach((r, i) => {
    const title = `${r.agencyType} – ${r.company}`;
    if (groups.at(-1)?.title !== title) groups.push({ title, rows: [] });
    groups.at(-1)!.rows.push({ ...r, no: i + 1 });
  });
  return groups;
}

// ───────────── text runs: pick a font per script ─────────────
const isIndic = (cp: number) => (cp >= 0x0900 && cp <= 0x097f) || (cp >= 0xa8e0 && cp <= 0xa8ff) || (cp >= 0x1cd0 && cp <= 0x1cff);
export interface Face { latin: PDFFont; deva: PDFFont }
type Run = { text: string; font: PDFFont };

function runs(text: string, face: Face): Run[] {
  const out: Run[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    // Joiners/danda stay with the Devanagari run; everything else is Latin.
    const font = isIndic(cp) || ((cp === 0x200c || cp === 0x200d) && out.at(-1)?.font === face.deva) ? face.deva : face.latin;
    if (out.at(-1)?.font === font) out.at(-1)!.text += ch; else out.push({ text: ch, font });
  }
  return out;
}

/** Replace characters neither font can draw, so pdf-lib never throws on odd input (emoji, CJK, control chars). */
function sanitize(text: string, face: Face): string {
  const latinSet = new Set(face.latin.getCharacterSet());
  const devaSet = new Set(face.deva.getCharacterSet());
  let s = '';
  for (const ch of text.replace(/[\r\t]/g, ' ')) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 && ch !== '\n') continue;
    s += cp === 0x0a || latinSet.has(cp) || devaSet.has(cp) || cp === 0x200c || cp === 0x200d ? ch : '?';
  }
  return s;
}

const width = (t: string, face: Face, size: number) => runs(t, face).reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0);

export function wrap(text: string, face: Face, size: number, max: number): string[] {
  const lines: string[] = [];
  for (const para of sanitize(text, face).split('\n')) {
    let line = '';
    for (const word of para.split(/ +/)) {
      const cand = line ? `${line} ${word}` : word;
      if (width(cand, face, size) <= max) { line = cand; continue; }
      if (line) lines.push(line);
      // A single word longer than the column: hard-break it by characters.
      line = '';
      for (const ch of word) {
        if (width(line + ch, face, size) > max && line) { lines.push(line); line = ''; }
        line += ch;
      }
    }
    lines.push(line);
  }
  return lines;
}

function draw(page: PDFPage, text: string, x: number, y: number, face: Face, size: number, color = rgb(0.1, 0.1, 0.1)) {
  for (const r of runs(text, face)) {
    page.drawText(r.text, { x, y, size, font: r.font, color });
    x += r.font.widthOfTextAtSize(r.text, size);
  }
}

// ───────────── layout ─────────────
const A4: [number, number] = [595.28, 841.89];
const M = 36;              // page margin
const FS = 8.5;            // body font size
const LH = 11;             // body line height
const PAD = 4;
const COLS = [
  { key: 'no', title: 'No', w: 26 },
  { key: 'room', title: 'Room', w: 130 },
  { key: 'agency', title: 'Agency', w: 82 },
  { key: 'dep', title: 'Dependency', w: 170 },
  { key: 'first', title: 'First raised', w: 61 },
  { key: 'rem', title: 'Reminder #', w: 54.28 },
] as const;
const GREY = rgb(0.4, 0.42, 0.46);
const LINE = rgb(0.86, 0.87, 0.9);

export async function buildPendingPdf(input: PdfInput, fonts: PdfFonts): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Pending items – ${input.projectName}`);
  doc.setProducer('VTech Site Dependency Tracker');
  const body: Face = { latin: await doc.embedFont(fonts.latin, { subset: true }), deva: await doc.embedFont(fonts.deva, { subset: true }) };
  const bold: Face = { latin: await doc.embedFont(fonts.latinBold, { subset: true }), deva: await doc.embedFont(fonts.devaBold, { subset: true }) };

  const groups = groupRows(input.rows);
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const bottom = M + 18; // room for the footer

  const newPage = () => {
    page = doc.addPage(A4);
    pages.push(page);
    y = A4[1] - M;
  };
  const tableHeader = () => {
    page.drawRectangle({ x: M, y: y - LH - 2 * PAD + 2, width: A4[0] - 2 * M, height: LH + 2 * PAD, color: rgb(0.95, 0.96, 0.97) });
    let x = M;
    for (const c of COLS) { draw(page, c.title, x + PAD, y - LH + 1, bold, FS, GREY); x += c.w; }
    y -= LH + 2 * PAD;
  };

  // Title block
  newPage();
  draw(page, 'Pending items', M, y - 16, bold, 16);
  y -= 22;
  draw(page, sanitize(input.projectName, body), M, y - 12, bold, 12);
  y -= 16;
  const sub = [input.clientName && `Client: ${input.clientName}`, input.siteAddress].filter(Boolean).join(' · ');
  for (const l of wrap(`${sub ? sub + ' · ' : ''}${input.rows.length} pending item${input.rows.length === 1 ? '' : 's'} · as of ${formatDate(input.generatedOn)}`, body, 9, A4[0] - 2 * M)) {
    draw(page, l, M, y - 10, body, 9, GREY); y -= 12;
  }
  y -= 8;

  if (!groups.length) { draw(page, 'No pending items.', M, y - 12, body, 10); y -= 20; }

  for (const g of groups) {
    // Keep the group title with at least its header and first row.
    if (y - 18 - (LH + 2 * PAD) * 2 < bottom) newPage();
    draw(page, sanitize(g.title, bold), M, y - 12, bold, 10.5);
    y -= 18;
    tableHeader();
    for (const r of g.rows) {
      const cells: Record<(typeof COLS)[number]['key'], string> = {
        no: String(r.no), room: roomLabel(r), agency: r.agencyType,
        dep: r.note ? `${r.text}\n${r.note}` : r.text,
        first: formatDate(r.firstRaisedOn), rem: String(r.reminderCount),
      };
      const wrapped = COLS.map((c) => wrap(cells[c.key], body, FS, c.w - 2 * PAD));
      const h = Math.max(...wrapped.map((l) => l.length)) * LH + 2 * PAD;
      if (y - h < bottom) {
        newPage();
        draw(page, sanitize(`${g.title} (continued)`, bold), M, y - 12, bold, 10.5);
        y -= 18;
        tableHeader();
      }
      let x = M;
      COLS.forEach((c, ci) => {
        const noteStart = c.key === 'dep' && r.note ? wrap(r.text, body, FS, c.w - 2 * PAD).length : Infinity;
        wrapped[ci].forEach((l, li) => draw(page, l, x + PAD, y - PAD - (li + 1) * LH + 2.5, body, li >= noteStart ? FS - 0.5 : FS, li >= noteStart ? GREY : undefined));
        x += c.w;
      });
      y -= h;
      page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.5, color: LINE });
    }
    y -= 14;
  }

  // Terms
  if (input.terms.trim()) {
    const lines = wrap(input.terms.trim(), body, 8.5, A4[0] - 2 * M);
    if (y - 14 - Math.min(lines.length, 4) * LH < bottom) newPage();
    draw(page, 'Terms', M, y - 11, bold, 10); y -= 16;
    for (const l of lines) {
      if (y - LH < bottom) newPage();
      draw(page, l, M, y - LH + 2, body, 8.5, rgb(0.2, 0.22, 0.25)); y -= LH;
    }
  }

  // Footer on every page
  pages.forEach((p, i) => {
    draw(p, sanitize(`${input.projectName} · generated ${formatDate(input.generatedOn)}`, body), M, M - 4, body, 7.5, GREY);
    const t = `Page ${i + 1} of ${pages.length}`;
    draw(p, t, A4[0] - M - width(t, body, 7.5), M - 4, body, 7.5, GREY);
  });

  return doc.save();
}
