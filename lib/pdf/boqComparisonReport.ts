// Pure function to build BOQ Comparison (Current vs Initial) PDF report.
// Reuses fontkit, Noto fonts (Devanagari-safe), and drawing helpers from pendingReport.
import 'regenerator-runtime/runtime.js';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import type { PdfFonts } from './pendingReport';
import { drawLogo, draw, wrap, sanitize, type Face, formatDate } from './pendingReport';

const A4: [number, number] = [595.28, 841.89];
const M = 36;
const FS = 8.5;
const LH = 11;
const PAD = 4;
const GREY = rgb(0.4, 0.42, 0.46);
const LINE = rgb(0.86, 0.87, 0.9);
const GREEN = rgb(0.08, 0.55, 0.25);
const RED = rgb(0.82, 0.15, 0.15);

export interface BoqComparisonItem {
  consoGroup: string;
  consoSort: number;
  productTitle: string;
  initialQuantity: number;
  currentQuantity: number;
  diff: number; // currentQuantity - initialQuantity
}

export interface BoqComparisonChangeEvent {
  at: string;
  event: 'added' | 'removed' | 'changed';
  product: string;
  floor: string | null;
  room: string | null;
  location: string | null;
  quantity: number | null;
  requestedBy: string;
  reason: string;
  referenceType: string | null;
  reference: string | null;
}

export interface BoqComparisonPdfInput {
  projectName: string;
  clientName: string | null;
  siteAddress: string | null;
  generatedOn: string;
  initialBoqDate?: string | null;
  currentBoqDate?: string | null;
  comparisonItems: BoqComparisonItem[];
  changeEvents: BoqComparisonChangeEvent[];
}

export function formatISTDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export async function buildBoqComparisonPdf(
  input: BoqComparisonPdfInput,
  fonts: PdfFonts
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`BOQ Comparison – ${input.projectName}`);
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
    page = doc.addPage(A4);
    pages.push(page);
    y = A4[1] - M;
  };

  newPage();
  drawLogo(page, A4[0] - M, y);
  draw(page, 'BOQ Comparison (Current ± Initial)', M, y - 16, bold, 16);
  y -= 22;
  draw(page, sanitize(input.projectName, body), M, y - 12, bold, 12);
  y -= 16;

  const sub = [input.clientName && `Client: ${input.clientName}`, input.siteAddress].filter(Boolean).join(' · ');
  const totalInitial = input.comparisonItems.reduce((acc, it) => acc + it.initialQuantity, 0);
  const totalCurrent = input.comparisonItems.reduce((acc, it) => acc + it.currentQuantity, 0);
  const netDiff = totalCurrent - totalInitial;
  const diffSign = netDiff > 0 ? `+${netDiff}` : `${netDiff}`;

  const meta = `${sub ? sub + ' · ' : ''}Initial: ${totalInitial} units · Current: ${totalCurrent} units (Net: ${diffSign}) · as of ${formatDate(input.generatedOn)}`;
  for (const l of wrap(meta, body, 9, A4[0] - 2 * M)) {
    draw(page, l, M, y - 10, body, 9, GREY);
    y -= 12;
  }
  y -= 8;

  // ── Table 1: Product Comparison (Conso order) ──
  draw(page, 'Product-wise Variance (in Conso Group Order)', M, y - 11, bold, 11);
  y -= 16;

  const initialHeaderLabel = input.initialBoqDate
    ? `Initial BOQ\n(${input.initialBoqDate})`
    : 'Initial BOQ';
  const currentHeaderLabel = input.currentBoqDate
    ? `Current\n(${input.currentBoqDate})`
    : 'Current';

  const compCols = [
    { key: 'no', title: 'No', w: 26, align: 'center' },
    { key: 'group', title: 'Conso Group', w: 105, align: 'left' },
    { key: 'product', title: 'Product Catalogue Title', w: 175, align: 'left' },
    { key: 'init', title: initialHeaderLabel, w: 55, align: 'center' },
    { key: 'curr', title: currentHeaderLabel, w: 55, align: 'center' },
    { key: 'diff', title: 'Diff', w: 57.28, align: 'center' },
  ] as const;

  const compHeader = () => {
    const headerHeight = 2 * LH + 2 * PAD;
    page.drawRectangle({
      x: M,
      y: y - headerHeight + 2,
      width: A4[0] - 2 * M,
      height: headerHeight,
      color: rgb(0.95, 0.96, 0.97),
    });
    let x = M;
    for (const c of compCols) {
      const lines = c.title.split('\n');
      let hy = lines.length === 1 ? y - LH - PAD / 2 : y - LH + 2;
      for (const line of lines) {
        if (c.align === 'center') {
          const tw = bold.latin.widthOfTextAtSize(line, FS);
          const cx = x + Math.max(0, (c.w - tw) / 2);
          draw(page, line, cx, hy, bold, FS, GREY);
        } else {
          draw(page, line, x + PAD, hy, bold, FS, GREY);
        }
        hy -= LH - 1;
      }
      x += c.w;
    }
    y -= headerHeight;
  };

  compHeader();

  const sortedComp = [...input.comparisonItems].sort(
    (a, b) => a.consoSort - b.consoSort || a.productTitle.localeCompare(b.productTitle)
  );

  if (sortedComp.length === 0) {
    draw(page, 'No items compared.', M + PAD, y - LH, body, FS, GREY);
    y -= LH + 2 * PAD;
  } else {
    sortedComp.forEach((item, idx) => {
      const diffText = item.diff > 0 ? `+${item.diff}` : item.diff < 0 ? `${item.diff}` : '0';
      const diffColor = item.diff > 0 ? GREEN : item.diff < 0 ? RED : GREY;

      const cells: Record<(typeof compCols)[number]['key'], string> = {
        no: String(idx + 1),
        group: item.consoGroup || 'Other',
        product: item.productTitle,
        init: String(item.initialQuantity),
        curr: String(item.currentQuantity),
        diff: diffText,
      };

      const wrapped = compCols.map((c) => wrap(cells[c.key], body, FS, c.w - 2 * PAD));
      const h = Math.max(...wrapped.map((l) => l.length)) * LH + 2 * PAD;

      if (y - h < bottom) {
        newPage();
        compHeader();
      }

      let x = M;
      compCols.forEach((c, colIdx) => {
        let cy = y - PAD - FS;
        const colColor = c.key === 'diff' ? diffColor : undefined;
        const fontFace = c.key === 'diff' && item.diff !== 0 ? bold : body;
        for (const line of wrapped[colIdx]) {
          if (c.align === 'center') {
            const tw = fontFace.latin.widthOfTextAtSize(line, FS);
            const cx = x + Math.max(0, (c.w - tw) / 2);
            draw(page, line, cx, cy, fontFace, FS, colColor);
          } else {
            draw(page, line, x + PAD, cy, fontFace, FS, colColor);
          }
          cy -= LH;
        }
        x += c.w;
      });

      page.drawLine({
        start: { x: M, y: y - h },
        end: { x: A4[0] - M, y: y - h },
        color: LINE,
        thickness: 0.5,
      });
      y -= h;
    });
  }

  y -= 16;

  // ── Table 2: BOQ Change History (Reasons & Approvals) ──
  if (y - 50 < bottom) {
    newPage();
  }

  draw(page, `BOQ Change History (Reasons & Approvals – ${input.changeEvents.length} changes)`, M, y - 11, bold, 11);
  y -= 16;

  const chgCols = [
    { key: 'no', title: 'No', w: 26 },
    { key: 'date', title: 'Date (IST)', w: 75 },
    { key: 'event', title: 'Action', w: 55 },
    { key: 'item', title: 'Product & Room', w: 140 },
    { key: 'requested', title: 'Requested By', w: 90 },
    { key: 'reason', title: 'Reason & Reference', w: 137.28 },
  ] as const;

  const chgHeader = () => {
    page.drawRectangle({
      x: M,
      y: y - LH - 2 * PAD + 2,
      width: A4[0] - 2 * M,
      height: LH + 2 * PAD,
      color: rgb(0.95, 0.96, 0.97),
    });
    let x = M;
    for (const c of chgCols) {
      draw(page, c.title, x + PAD, y - LH + 1, bold, FS, GREY);
      x += c.w;
    }
    y -= LH + 2 * PAD;
  };

  chgHeader();

  if (input.changeEvents.length === 0) {
    draw(page, 'No change requests logged for this project (initial placement omitted).', M + PAD, y - LH, body, FS, GREY);
    y -= LH + 2 * PAD;
  } else {
    input.changeEvents.forEach((ev, idx) => {
      const roomStr = [ev.floor, ev.room, ev.location].filter(Boolean).join(' · ');
      const itemStr = roomStr ? `${ev.product}\n(${roomStr})` : ev.product;
      const refStr = [ev.referenceType, ev.reference].filter(Boolean).join(': ');
      const reasonStr = refStr ? `${ev.reason}\nRef: ${refStr}` : ev.reason;

      const dateStr = ev.at
        ? new Date(ev.at).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'short',
            timeStyle: 'short',
          })
        : '—';

      const cells: Record<(typeof chgCols)[number]['key'], string> = {
        no: String(idx + 1),
        date: dateStr,
        event: (ev.event || '').toUpperCase(),
        item: itemStr,
        requested: ev.requestedBy || '—',
        reason: reasonStr || '—',
      };

      const wrapped = chgCols.map((c) => wrap(cells[c.key], body, FS, c.w - 2 * PAD));
      const h = Math.max(...wrapped.map((l) => l.length)) * LH + 2 * PAD;

      if (y - h < bottom) {
        newPage();
        chgHeader();
      }

      let x = M;
      chgCols.forEach((c, colIdx) => {
        let cy = y - PAD - FS;
        const isEvent = c.key === 'event';
        const eventColor =
          ev.event === 'added' ? GREEN : ev.event === 'removed' ? RED : undefined;
        const fontFace = isEvent ? bold : body;

        for (const line of wrapped[colIdx]) {
          draw(page, line, x + PAD, cy, fontFace, FS, eventColor);
          cy -= LH;
        }
        x += c.w;
      });

      page.drawLine({
        start: { x: M, y: y - h },
        end: { x: A4[0] - M, y: y - h },
        color: LINE,
        thickness: 0.5,
      });
      y -= h;
    });
  }

  // Footer on all pages
  const totalPages = pages.length;
  pages.forEach((p, idx) => {
    p.drawLine({
      start: { x: M, y: M + 14 },
      end: { x: A4[0] - M, y: M + 14 },
      color: LINE,
      thickness: 0.5,
    });
    draw(p, 'Confidential · VTech Project Dependency Tool', M, M + 4, body, 8, GREY);
    draw(p, `Page ${idx + 1} of ${totalPages}`, A4[0] - M - 55, M + 4, body, 8, GREY);
  });

  return doc.save();
}
