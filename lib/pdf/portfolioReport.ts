// Portfolio PDF for management: every pending item across all projects the user can see, grouped project → agency.
// Columns: No · Floor – Room · Dependency (+ note) · Raised · Days open · Reminder # · Level. Cover: totals per project.
// Pure (data + font bytes in, PDF bytes out) and unit tested. Reuses the text/font helpers of pendingReport.ts.
import 'regenerator-runtime/runtime.js';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import { levelForReminder, type EscalationPolicy } from '../escalation';
import { daysOpen } from '../report';
import { draw, formatDate, roomLabel, sanitize, width, wrap, type Face, type PdfFonts } from './pendingReport';

export interface PortfolioItem {
  floorLabel: string; floorSort: number; roomName: string; roomSort: number;
  agencyType: string; agencyTypeSort: number; company: string;
  seq: number; text: string; note: string | null;
  firstRaisedOn: string | null; reminderCount: number;
}
export interface PortfolioProject {
  name: string; clientName: string | null;
  policy: EscalationPolicy; escalationByAgency?: Record<string, boolean>; // company → escalation enabled (default true)
  items: PortfolioItem[];
}
export interface PortfolioInput { generatedOn: string; projects: PortfolioProject[] }

/** Escalation level of the last reminder sent (— when never reminded), same rule as the weekly digest. */
export function levelOf(i: PortfolioItem, p: PortfolioProject): number | null {
  if (i.reminderCount <= 0) return null;
  return levelForReminder(i.reminderCount, p.policy, p.escalationByAgency?.[i.company] ?? true);
}

export function summarise(input: PortfolioInput) {
  return input.projects.map((p) => {
    const levels = p.items.map((i) => levelOf(i, p) ?? 0);
    const ages = p.items.map((i) => daysOpen(i.firstRaisedOn, input.generatedOn) ?? 0);
    return {
      name: p.name, pending: p.items.length,
      escalated: levels.filter((l) => l >= 2).length, l3: levels.filter((l) => l === 3).length,
      oldest: ages.length ? Math.max(...ages) : 0,
      agencies: new Set(p.items.map((i) => `${i.agencyType}|${i.company}`)).size,
    };
  });
}

const PAGE: [number, number] = [841.89, 595.28]; // A4 landscape
const M = 32, FS = 8.5, LH = 11, PAD = 4;
const COLS = [
  { key: 'no', title: 'No', w: 28 },
  { key: 'room', title: 'Floor – Room', w: 150 },
  { key: 'dep', title: 'Dependency', w: 300 },
  { key: 'raised', title: 'Raised', w: 62 },
  { key: 'days', title: 'Days open', w: 52 },
  { key: 'rem', title: 'Reminder #', w: 56 },
  { key: 'lvl', title: 'Level', w: 129.89 },
] as const;
const GREY = rgb(0.4, 0.42, 0.46), LINE = rgb(0.86, 0.87, 0.9), RED = rgb(0.71, 0.14, 0.09), AMBER = rgb(0.71, 0.33, 0.04);

export async function buildPortfolioPdf(input: PortfolioInput, fonts: PdfFonts): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`VTech – all pending items – ${input.generatedOn}`);
  doc.setProducer('VTech Site Dependency Tracker');
  const body: Face = { latin: await doc.embedFont(fonts.latin, { subset: true }), deva: await doc.embedFont(fonts.deva, { subset: true }) };
  const bold: Face = { latin: await doc.embedFont(fonts.latinBold, { subset: true }), deva: await doc.embedFont(fonts.devaBold, { subset: true }) };
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const bottom = M + 18;
  const newPage = () => { page = doc.addPage(PAGE); pages.push(page); y = PAGE[1] - M; };
  const fullW = PAGE[0] - 2 * M;

  // ── Cover: totals per project ──
  newPage();
  const sum = summarise(input);
  const total = sum.reduce((s, x) => s + x.pending, 0);
  draw(page, 'All pending items', M, y - 18, bold, 18); y -= 26;
  draw(page, `${total} pending across ${sum.length} project${sum.length === 1 ? '' : 's'} · as of ${formatDate(input.generatedOn)}`, M, y - 11, body, 10, GREY);
  y -= 26;
  const CC = [{ t: 'Project', w: 360 }, { t: 'Pending', w: 80 }, { t: 'Escalated (L2+)', w: 110 }, { t: 'At L3', w: 70 }, { t: 'Oldest (days)', w: 90 }, { t: 'Agencies', w: fullW - 710 }];
  const coverRow = (cells: string[], face: Face, bg?: ReturnType<typeof rgb>, colors: (ReturnType<typeof rgb> | undefined)[] = []) => {
    if (y - (LH + 2 * PAD) < bottom) newPage();
    if (bg) page.drawRectangle({ x: M, y: y - LH - 2 * PAD + 2, width: fullW, height: LH + 2 * PAD, color: bg });
    let x = M;
    cells.forEach((c, i) => {
      const t = wrap(c, face, 9, CC[i].w - 2 * PAD)[0] ?? '';
      draw(page, t, x + PAD, y - LH + 1, face, 9, colors[i]);
      x += CC[i].w;
    });
    y -= LH + 2 * PAD;
    page.drawLine({ start: { x: M, y }, end: { x: M + fullW, y }, thickness: 0.5, color: LINE });
  };
  coverRow(CC.map((c) => c.t), bold, rgb(0.95, 0.96, 0.97), CC.map(() => GREY));
  for (const s of sum) {
    coverRow([s.name, String(s.pending), String(s.escalated), String(s.l3), String(s.oldest), String(s.agencies)], body, undefined,
      [undefined, undefined, s.escalated ? AMBER : undefined, s.l3 ? RED : undefined]);
  }
  if (!sum.length) { draw(page, 'No projects visible to you.', M, y - 12, body, 10); y -= 20; }

  // ── Detail: project → agency ──
  const header = () => {
    page.drawRectangle({ x: M, y: y - LH - 2 * PAD + 2, width: fullW, height: LH + 2 * PAD, color: rgb(0.95, 0.96, 0.97) });
    let x = M;
    for (const c of COLS) { draw(page, c.title, x + PAD, y - LH + 1, bold, FS, GREY); x += c.w; }
    y -= LH + 2 * PAD;
  };
  for (const p of input.projects) {
    if (!p.items.length) continue;
    newPage();
    draw(page, sanitize(p.name, bold), M, y - 14, bold, 14); y -= 18;
    const s = sum.find((x) => x.name === p.name)!;
    draw(page, sanitize(`${p.clientName ? `Client: ${p.clientName} · ` : ''}${s.pending} pending · ${s.escalated} escalated · oldest ${s.oldest} days`, body), M, y - 10, body, 9, GREY);
    y -= 20;
    const sorted = [...p.items].sort((a, b) => a.agencyTypeSort - b.agencyTypeSort || a.company.localeCompare(b.company) ||
      a.floorSort - b.floorSort || a.roomSort - b.roomSort || a.seq - b.seq || a.text.localeCompare(b.text));
    let lastGroup = '';
    let no = 0;
    for (const i of sorted) {
      const g = `${i.agencyType} – ${i.company}`;
      const lvl = levelOf(i, p);
      const cells: Record<(typeof COLS)[number]['key'], string> = {
        no: String(++no), room: roomLabel(i), dep: i.note ? `${i.text}\n${i.note}` : i.text,
        raised: formatDate(i.firstRaisedOn), days: String(daysOpen(i.firstRaisedOn, input.generatedOn) ?? '—'),
        rem: String(i.reminderCount), lvl: lvl ? `L${lvl}${lvl >= 2 ? ' escalation' : ''}` : '—',
      };
      const wrapped = COLS.map((c) => wrap(cells[c.key], body, FS, c.w - 2 * PAD));
      const h = Math.max(...wrapped.map((l) => l.length)) * LH + 2 * PAD;
      const needGroup = g !== lastGroup;
      if (y - h - (needGroup ? 18 + LH + 2 * PAD : 0) < bottom) {
        newPage();
        draw(page, sanitize(`${p.name} (continued)`, bold), M, y - 11, bold, 10, GREY); y -= 16;
        draw(page, sanitize(g, bold), M, y - 11, bold, 10.5); y -= 16; header();
      } else if (needGroup) {
        y -= 4; draw(page, sanitize(g, bold), M, y - 11, bold, 10.5); y -= 16; header();
      }
      lastGroup = g;
      let x = M;
      COLS.forEach((c, ci) => {
        const noteStart = c.key === 'dep' && i.note ? wrap(i.text, body, FS, c.w - 2 * PAD).length : Infinity;
        const color = c.key === 'lvl' && lvl === 3 ? RED : c.key === 'lvl' && lvl === 2 ? AMBER : undefined;
        wrapped[ci].forEach((l, li) => draw(page, l, x + PAD, y - PAD - (li + 1) * LH + 2.5, li >= noteStart ? body : (c.key === 'lvl' && lvl && lvl >= 2 ? bold : body),
          li >= noteStart ? FS - 0.5 : FS, li >= noteStart ? GREY : color));
        x += c.w;
      });
      y -= h;
      page.drawLine({ start: { x: M, y }, end: { x: M + fullW, y }, thickness: 0.5, color: LINE });
    }
  }

  pages.forEach((pg, n) => {
    draw(pg, `VTech – all pending items · generated ${formatDate(input.generatedOn)}`, M, M - 4, body, 7.5, GREY);
    const t = `Page ${n + 1} of ${pages.length}`;
    draw(pg, t, PAGE[0] - M - width(t, body, 7.5), M - 4, body, 7.5, GREY);
  });
  return doc.save();
}
