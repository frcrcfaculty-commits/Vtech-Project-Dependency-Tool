// All-projects BOQ PDF: lists all products / line items across projects.
// Reuses Noto Sans Latin + Devanagari fonts via fontkit and drawing helpers.
import 'regenerator-runtime/runtime.js';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import type { PdfFonts } from './pendingReport';
import { drawLogo, draw, wrap, sanitize, type Face, formatDate } from './pendingReport';

export interface BoqProjectLine {
  floorLabel: string;
  floorSort: number;
  roomName: string;
  roomSort: number;
  productTitle: string;
  location: string | null;
  make: string | null;
  model: string | null;
  quantity: number;
  note: string | null;
}

export interface BoqProjectGroup {
  name: string;
  clientName: string | null;
  lines: BoqProjectLine[];
}

export interface AllBoqPdfInput {
  generatedOn: string;
  projects: BoqProjectGroup[];
}

const PAGE: [number, number] = [595.28, 841.89]; // A4 Portrait
const M = 36, FS = 8.5, LH = 11, PAD = 4;
const GREY = rgb(0.4, 0.42, 0.46), LINE = rgb(0.86, 0.87, 0.9);

const COLS = [
  { key: 'no', title: 'No', w: 26 },
  { key: 'room', title: 'Floor – Room', w: 120 },
  { key: 'product', title: 'Product', w: 157.28 },
  { key: 'location', title: 'Location', w: 85 },
  { key: 'makeModel', title: 'Make / Model', w: 95 },
  { key: 'qty', title: 'Qty', w: 40 },
] as const;

export async function buildAllBoqPdf(input: AllBoqPdfInput, fonts: PdfFonts): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`VTech – All Products (BOQ) – ${input.generatedOn}`);
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
  const bottom = M + 20;
  const newPage = () => {
    page = doc.addPage(PAGE);
    pages.push(page);
    y = PAGE[1] - M;
  };
  const fullW = PAGE[0] - 2 * M;

  // ── Cover page: summary per project ──
  newPage();
  drawLogo(page, PAGE[0] - M, y);
  const totalProducts = input.projects.reduce(
    (sum, p) => sum + p.lines.reduce((s, l) => s + (l.quantity || 1), 0),
    0
  );
  draw(page, 'All Products (BOQ Report)', M, y - 18, bold, 18);
  y -= 26;
  draw(
    page,
    `${totalProducts} total units across ${input.projects.length} project${
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
    { t: 'Project', w: 260 },
    { t: 'Line Items', w: 90 },
    { t: 'Total Units', w: 90 },
    { t: 'Rooms', w: fullW - 440 },
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
    const qtySum = p.lines.reduce((s, l) => s + (l.quantity || 1), 0);
    const roomsCount = new Set(p.lines.map((l) => `${l.floorLabel}|${l.roomName}`)).size;
    coverRow([p.name, String(p.lines.length), String(qtySum), String(roomsCount)], body);
  }
  if (!input.projects.length) {
    draw(page, 'No products found across projects.', M, y - 12, body, 10);
    y -= 20;
  }

  // ── Project detail pages ──
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
    if (!p.lines.length) continue;
    newPage();
    draw(page, sanitize(p.name, bold), M, y - 14, bold, 14);
    y -= 18;
    const units = p.lines.reduce((s, l) => s + (l.quantity || 1), 0);
    draw(
      page,
      sanitize(
        `${p.clientName ? `Client: ${p.clientName} · ` : ''}${p.lines.length} lines · ${units} units`,
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
    for (const line of p.lines) {
      const roomStr = `${line.floorLabel} – ${line.roomName}`;
      const makeModel = [line.make, line.model].filter(Boolean).join(' / ') || '—';
      const prodText = line.note ? `${line.productTitle}\nNote: ${line.note}` : line.productTitle;
      const descLines = wrap(prodText, body, FS, COLS[2].w - 2 * PAD);
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

      draw(page, sanitize(line.location || '—', body), x + PAD, y - LH + 1, body, FS);
      x += COLS[3].w;

      draw(page, sanitize(makeModel, body), x + PAD, y - LH + 1, body, FS);
      x += COLS[4].w;

      draw(page, String(line.quantity || 1), x + PAD, y - LH + 1, body, FS);

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
