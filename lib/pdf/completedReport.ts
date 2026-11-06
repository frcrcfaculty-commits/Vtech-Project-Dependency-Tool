// Completed-items PDF: every completed item across projects, grouped by project → agency.
// Columns: No · Floor – Room · Product / Dependency · Agency · Raised · Completed · Days to complete.
// Pure (data + font bytes in, PDF bytes out) and unit tested. Reuses font/text helpers of pendingReport.ts.
import 'regenerator-runtime/runtime.js';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import { draw, drawLogo, registerLogo, formatDate, roomLabel, sanitize, wrap, type Face, type PdfFonts } from './pendingReport';

export interface CompletedItem {
  floorLabel: string;
  floorSort: number;
  roomName: string;
  roomSort: number;
  productTitle: string;
  agencyType: string;
  company: string;
  firstRaisedOn: string | null;
  completedOn: string | null;
  daysToComplete: number | null;
  note: string | null;
}

export interface CompletedProject {
  name: string;
  clientName: string | null;
  items: CompletedItem[];
}

export interface CompletedPdfInput {
  generatedOn: string;
  projects: CompletedProject[];
}

const PAGE: [number, number] = [841.89, 595.28]; // A4 landscape
const M = 32, FS = 8.5, LH = 11, PAD = 4;
const GREY = rgb(0.4, 0.42, 0.46), LINE = rgb(0.86, 0.87, 0.9);

const COLS = [
  { key: 'no', title: 'No', w: 28 },
  { key: 'room', title: 'Floor – Room', w: 140 },
  { key: 'item', title: 'Product / Dependency', w: 269.89 },
  { key: 'agency', title: 'Agency', w: 150 },
  { key: 'raised', title: 'Raised', w: 62 },
  { key: 'completed', title: 'Completed', w: 68 },
  { key: 'days', title: 'Days', w: 60 },
] as const;

export async function buildCompletedPdf(input: CompletedPdfInput, fonts: PdfFonts): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  await registerLogo(doc);
  doc.registerFontkit(fontkit);
  doc.setTitle(`VTech – completed items – ${input.generatedOn}`);
  doc.setProducer('VTech Site Dependency Tracker');

  const body: Face = {
    latin: await doc.embedFont(fonts.latin, { subset: true }),
    deva: await doc.embedFont(fonts.deva, { subset: true }),
  };
  const bold: Face = {
    latin: await doc.embedFont(fonts.latinBold, { subset: true }),
    deva: await doc.embedFont(fonts.devaBold, { subset: true }),
  };

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const bottom = M + 18;
  const newPage = () => {
    page = doc.addPage(PAGE);
    pages.push(page);
    y = PAGE[1] - M;
  };
  const fullW = PAGE[0] - 2 * M;

  // ── Cover page: totals per project ──
  newPage();
  drawLogo(page, PAGE[0] - M, y);
  const total = input.projects.reduce((sum, p) => sum + p.items.length, 0);
  draw(page, 'Completed dependencies', M, y - 18, bold, 18);
  y -= 26;
  draw(
    page,
    `${total} completed across ${input.projects.length} project${
      input.projects.length === 1 ? '' : 's'
    } · as of ${formatDate(input.generatedOn)}`,
    M,
    y - 11,
    body,
    10,
    GREY
  );
  y -= 26;

  const CC = [
    { t: 'Project', w: 380 },
    { t: 'Completed Items', w: 140 },
    { t: 'Avg Days to Complete', w: 160 },
    { t: 'Agencies', w: fullW - 680 },
  ];

  const coverRow = (
    cells: string[],
    face: Face,
    bg?: ReturnType<typeof rgb>,
    colors: (ReturnType<typeof rgb> | undefined)[] = []
  ) => {
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
  for (const p of input.projects) {
    const daysArr = p.items.map((i) => i.daysToComplete).filter((d): d is number => d !== null);
    const avgDays = daysArr.length ? Math.round(daysArr.reduce((a, b) => a + b, 0) / daysArr.length) : '—';
    const agenciesCount = new Set(p.items.map((i) => `${i.agencyType}|${i.company}`)).size;
    coverRow([p.name, String(p.items.length), String(avgDays), String(agenciesCount)], body);
  }
  if (!input.projects.length) {
    draw(page, 'No completed items found.', M, y - 12, body, 10);
    y -= 20;
  }

  // ── Detail rows per project ──
  const drawTableHeader = () => {
    page.drawRectangle({ x: M, y: y - LH - 2 * PAD + 2, width: fullW, height: LH + 2 * PAD, color: rgb(0.95, 0.96, 0.97) });
    let x = M;
    for (const c of COLS) {
      draw(page, c.title, x + PAD, y - LH + 1, bold, FS, GREY);
      x += c.w;
    }
    y -= LH + 2 * PAD;
  };

  for (const p of input.projects) {
    if (!p.items.length) continue;
    newPage();
    draw(page, sanitize(p.name, bold), M, y - 14, bold, 14);
    y -= 18;
    draw(
      page,
      sanitize(
        `${p.clientName ? `Client: ${p.clientName} · ` : ''}${p.items.length} items verified complete`,
        body
      ),
      M,
      y - 10,
      body,
      9,
      GREY
    );
    y -= 20;
    drawTableHeader();

    let no = 1;
    for (const item of p.items) {
      const roomStr = roomLabel({ floorLabel: item.floorLabel, roomName: item.roomName });
      const agencyStr = `${item.agencyType} – ${item.company}`;
      const descLines = wrap(item.note ? `${item.productTitle}\nNote: ${item.note}` : item.productTitle, body, FS, COLS[2].w - 2 * PAD);
      const rowHeight = Math.max(LH + 2 * PAD, descLines.length * LH + 2 * PAD);

      if (y - rowHeight < bottom) {
        newPage();
        draw(page, sanitize(`${p.name} (continued)`, bold), M, y - 12, bold, 11);
        y -= 18;
        drawTableHeader();
      }

      let x = M;
      draw(page, String(no++), x + PAD, y - LH + 1, body, FS, GREY);
      x += COLS[0].w;

      draw(page, sanitize(roomStr, body), x + PAD, y - LH + 1, body, FS);
      x += COLS[1].w;

      descLines.forEach((ln, lIdx) => {
        draw(page, sanitize(ln, body), x + PAD, y - (lIdx + 1) * LH + 1, body, FS);
      });
      x += COLS[2].w;

      draw(page, sanitize(agencyStr, body), x + PAD, y - LH + 1, body, FS);
      x += COLS[3].w;

      draw(page, formatDate(item.firstRaisedOn), x + PAD, y - LH + 1, body, FS);
      x += COLS[4].w;

      draw(page, formatDate(item.completedOn), x + PAD, y - LH + 1, body, FS);
      x += COLS[5].w;

      draw(page, item.daysToComplete !== null ? `${item.daysToComplete}d` : '—', x + PAD, y - LH + 1, body, FS);

      y -= rowHeight;
      page.drawLine({ start: { x: M, y }, end: { x: M + fullW, y }, thickness: 0.5, color: LINE });
    }
  }

  // ── Page numbers ──
  pages.forEach((p, idx) => {
    draw(
      p,
      `Page ${idx + 1} of ${pages.length} · VTech Site Dependency Tracker`,
      M,
      M - 6,
      body,
      8,
      GREY
    );
  });

  return doc.save();
}
