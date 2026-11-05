// Pure functions to build BOQ PDFs (Room-wise, Conso, and History).
// Reuses fontkit, Noto fonts (Devanagari-safe), and drawing helpers from pendingReport.
import 'regenerator-runtime/runtime.js';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { PdfFonts } from './pendingReport';
import { drawLogo, draw, wrap, sanitize, type Face, formatDate } from './pendingReport';

const A4: [number, number] = [595.28, 841.89];
const M = 36;
const FS = 8.5;
const LH = 11;
const PAD = 4;
const GREY = rgb(0.4, 0.42, 0.46);
const LINE = rgb(0.86, 0.87, 0.9);

export interface BoqLineItem {
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

export interface ConsoItem {
  productTitle: string;
  make: string | null;
  model: string | null;
  totalQuantity: number;
  locations: string;
  consoGroup?: string | null;
  consoSort?: number | null;
  roomsCount?: number;
}

export interface BoqHistoryItem {
  at: string;
  event: string;
  product: string;
  room: string | null;
  floor: string | null;
  requestedBy: string;
  referenceType: string | null;
  reference: string | null;
  reason: string;
}

export interface BoqPdfInput {
  projectName: string;
  clientName: string | null;
  siteAddress: string | null;
  generatedOn: string;
  lines: BoqLineItem[];
}

export interface ConsoPdfInput {
  projectName: string;
  clientName: string | null;
  siteAddress: string | null;
  generatedOn: string;
  items: ConsoItem[];
}

export interface HistoryPdfInput {
  projectName: string;
  clientName: string | null;
  siteAddress: string | null;
  generatedOn: string;
  history: BoqHistoryItem[];
}

// ─────────────────────────────────────────────
// 1. Build Room-wise BOQ PDF
// ─────────────────────────────────────────────
export async function buildBoqRoomWisePdf(input: BoqPdfInput, fonts: PdfFonts): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`BOQ (Room-wise) – ${input.projectName}`);
  doc.setProducer('VTech Site Dependency Tracker');

  const body: Face = { latin: await doc.embedFont(fonts.latin, { subset: true }), deva: await doc.embedFont(fonts.deva, { subset: true }) };
  const bold: Face = { latin: await doc.embedFont(fonts.latinBold, { subset: true }), deva: await doc.embedFont(fonts.devaBold, { subset: true }) };

  const cols = [
    { key: 'no', title: 'No', w: 26 },
    { key: 'room', title: 'Room (Floor)', w: 120 },
    { key: 'product', title: 'Product', w: 150 },
    { key: 'location', title: 'Location', w: 75 },
    { key: 'makeModel', title: 'Make / Model', w: 110 },
    { key: 'qty', title: 'Qty', w: 42.28 },
  ] as const;

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const bottom = M + 18;

  const newPage = () => {
    page = doc.addPage(A4);
    pages.push(page);
    y = A4[1] - M;
  };

  const tableHeader = () => {
    page.drawRectangle({ x: M, y: y - LH - 2 * PAD + 2, width: A4[0] - 2 * M, height: LH + 2 * PAD, color: rgb(0.95, 0.96, 0.97) });
    let x = M;
    for (const c of cols) {
      draw(page, c.title, x + PAD, y - LH + 1, bold, FS, GREY);
      x += c.w;
    }
    y -= LH + 2 * PAD;
  };

  newPage();
  drawLogo(page, A4[0] - M, y);
  draw(page, 'Current BOQ (Room-wise)', M, y - 16, bold, 16);
  y -= 22;
  draw(page, sanitize(input.projectName, body), M, y - 12, bold, 12);
  y -= 16;
  const sub = [input.clientName && `Client: ${input.clientName}`, input.siteAddress].filter(Boolean).join(' · ');
  const totalItems = input.lines.reduce((s, l) => s + l.quantity, 0);
  const meta = `${sub ? sub + ' · ' : ''}${input.lines.length} line items (${totalItems} units) · as of ${formatDate(input.generatedOn)}`;
  for (const l of wrap(meta, body, 9, A4[0] - 2 * M)) {
    draw(page, l, M, y - 10, body, 9, GREY);
    y -= 12;
  }
  y -= 8;

  tableHeader();

  const sortedLines = [...input.lines].sort(
    (a, b) => a.floorSort - b.floorSort || a.roomSort - b.roomSort || a.productTitle.localeCompare(b.productTitle)
  );

  sortedLines.forEach((r, idx) => {
    const makeModelStr = [r.make, r.model].filter(Boolean).join(' / ') || '—';
    const cells: Record<(typeof cols)[number]['key'], string> = {
      no: String(idx + 1),
      room: r.floorLabel ? `${r.roomName} (${r.floorLabel})` : r.roomName,
      product: r.note ? `${r.productTitle}\nNote: ${r.note}` : r.productTitle,
      location: r.location || '—',
      makeModel: makeModelStr,
      qty: String(r.quantity),
    };

    const wrapped = cols.map((c) => wrap(cells[c.key], body, FS, c.w - 2 * PAD));
    const h = Math.max(...wrapped.map((l) => l.length)) * LH + 2 * PAD;

    if (y - h < bottom) {
      newPage();
      tableHeader();
    }

    let x = M;
    cols.forEach((c, i) => {
      let cy = y - PAD - FS;
      for (const line of wrapped[i]) {
        draw(page, line, x + PAD, cy, body, FS);
        cy -= LH;
      }
      x += c.w;
    });

    page.drawLine({ start: { x: M, y: y - h }, end: { x: A4[0] - M, y: y - h }, color: LINE, thickness: 0.5 });
    y -= h;
  });

  // Footer page numbers
  pages.forEach((p, i) => {
    const foot = `Page ${i + 1} of ${pages.length} · VTech Site Tracker`;
    draw(p, foot, M, M, body, 8, GREY);
  });

  return doc.save();
}

// ─────────────────────────────────────────────
// 2. Build Consolidated BOQ (Conso) PDF
// ─────────────────────────────────────────────
export async function buildBoqConsoPdf(input: ConsoPdfInput, fonts: PdfFonts): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`BOQ (Consolidated) – ${input.projectName}`);
  doc.setProducer('VTech Site Dependency Tracker');

  const body: Face = { latin: await doc.embedFont(fonts.latin, { subset: true }), deva: await doc.embedFont(fonts.deva, { subset: true }) };
  const bold: Face = { latin: await doc.embedFont(fonts.latinBold, { subset: true }), deva: await doc.embedFont(fonts.devaBold, { subset: true }) };

  const cols = [
    { key: 'no', title: 'No', w: 26 },
    { key: 'product', title: 'Product Catalogue Title', w: 160 },
    { key: 'makeModel', title: 'Make / Model', w: 120 },
    { key: 'qty', title: 'Total Qty', w: 50 },
    { key: 'locations', title: 'Locations / Rooms', w: 167.28 },
  ] as const;

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const bottom = M + 18;

  const newPage = () => {
    page = doc.addPage(A4);
    pages.push(page);
    y = A4[1] - M;
  };

  const tableHeader = () => {
    page.drawRectangle({ x: M, y: y - LH - 2 * PAD + 2, width: A4[0] - 2 * M, height: LH + 2 * PAD, color: rgb(0.95, 0.96, 0.97) });
    let x = M;
    for (const c of cols) {
      draw(page, c.title, x + PAD, y - LH + 1, bold, FS, GREY);
      x += c.w;
    }
    y -= LH + 2 * PAD;
  };

  newPage();
  drawLogo(page, A4[0] - M, y);
  draw(page, 'Consolidated BOQ (Conso)', M, y - 16, bold, 16);
  y -= 22;
  draw(page, sanitize(input.projectName, body), M, y - 12, bold, 12);
  y -= 16;
  const sub = [input.clientName && `Client: ${input.clientName}`, input.siteAddress].filter(Boolean).join(' · ');
  const grandTotal = input.items.reduce((s, it) => s + it.totalQuantity, 0);
  const meta = `${sub ? sub + ' · ' : ''}${input.items.length} distinct products (${grandTotal} total units) · as of ${formatDate(input.generatedOn)}`;
  for (const l of wrap(meta, body, 9, A4[0] - 2 * M)) {
    draw(page, l, M, y - 10, body, 9, GREY);
    y -= 12;
  }
  y -= 8;

  tableHeader();

  // Group items by conso_group in conso_sort order
  const groupMap = new Map<string, { groupName: string; sort: number; items: ConsoItem[]; subtotal: number }>();

  input.items.forEach((it) => {
    const gName = it.consoGroup || 'Other';
    const gSort = it.consoSort ?? (gName === 'Other' ? 999 : 90);
    const existing = groupMap.get(gName) ?? { groupName: gName, sort: gSort, items: [], subtotal: 0 };
    existing.items.push(it);
    existing.subtotal += it.totalQuantity;
    groupMap.set(gName, existing);
  });

  const sortedGroups = [...groupMap.values()].sort((a, b) => a.sort - b.sort || a.groupName.localeCompare(b.groupName));

  let globalIndex = 0;

  sortedGroups.forEach((group) => {
    // Draw group section header if we have groups
    const gh = LH + 2 * PAD;
    if (y - gh < bottom) {
      newPage();
      tableHeader();
    }

    page.drawRectangle({
      x: M,
      y: y - LH - 2 * PAD + 2,
      width: A4[0] - 2 * M,
      height: LH + 2 * PAD,
      color: rgb(0.91, 0.93, 0.96),
    });
    const groupHeaderText = `${group.groupName.toUpperCase()} — Subtotal: ${group.subtotal} units (${group.items.length} products)`;
    draw(page, groupHeaderText, M + PAD, y - LH + 1, bold, FS, rgb(0.12, 0.22, 0.42));
    y -= gh;

    // Sort items within group by totalQuantity desc, then title
    const groupSortedItems = [...group.items].sort((a, b) => b.totalQuantity - a.totalQuantity || a.productTitle.localeCompare(b.productTitle));

    groupSortedItems.forEach((r) => {
      globalIndex++;
      const makeModelStr = [r.make, r.model].filter(Boolean).join(' / ') || '—';
      const roomsInfo = r.roomsCount ? ` (${r.roomsCount} rooms)` : '';
      const cells: Record<(typeof cols)[number]['key'], string> = {
        no: String(globalIndex),
        product: r.productTitle,
        makeModel: makeModelStr,
        qty: String(r.totalQuantity),
        locations: r.locations + roomsInfo,
      };

      const wrapped = cols.map((c) => wrap(cells[c.key], body, FS, c.w - 2 * PAD));
      const h = Math.max(...wrapped.map((l) => l.length)) * LH + 2 * PAD;

      if (y - h < bottom) {
        newPage();
        tableHeader();
      }

      let x = M;
      cols.forEach((c, i) => {
        let cy = y - PAD - FS;
        for (const line of wrapped[i]) {
          draw(page, line, x + PAD, cy, body, FS);
          cy -= LH;
        }
        x += c.w;
      });

      page.drawLine({ start: { x: M, y: y - h }, end: { x: A4[0] - M, y: y - h }, color: LINE, thickness: 0.5 });
      y -= h;
    });
  });

  pages.forEach((p, i) => {
    const foot = `Page ${i + 1} of ${pages.length} · VTech Site Tracker`;
    draw(p, foot, M, M, body, 8, GREY);
  });

  return doc.save();
}

// ─────────────────────────────────────────────
// 3. Build BOQ History PDF
// ─────────────────────────────────────────────
export async function buildBoqHistoryPdf(input: HistoryPdfInput, fonts: PdfFonts): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`BOQ History – ${input.projectName}`);
  doc.setProducer('VTech Site Dependency Tracker');

  const body: Face = { latin: await doc.embedFont(fonts.latin, { subset: true }), deva: await doc.embedFont(fonts.deva, { subset: true }) };
  const bold: Face = { latin: await doc.embedFont(fonts.latinBold, { subset: true }), deva: await doc.embedFont(fonts.devaBold, { subset: true }) };

  const cols = [
    { key: 'no', title: 'No', w: 26 },
    { key: 'date', title: 'Date (IST)', w: 75 },
    { key: 'event', title: 'Action', w: 55 },
    { key: 'item', title: 'Product & Room', w: 140 },
    { key: 'requested', title: 'Requested By', w: 90 },
    { key: 'reason', title: 'Reason & Ref', w: 137.28 },
  ] as const;

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const bottom = M + 18;

  const newPage = () => {
    page = doc.addPage(A4);
    pages.push(page);
    y = A4[1] - M;
  };

  const tableHeader = () => {
    page.drawRectangle({ x: M, y: y - LH - 2 * PAD + 2, width: A4[0] - 2 * M, height: LH + 2 * PAD, color: rgb(0.95, 0.96, 0.97) });
    let x = M;
    for (const c of cols) {
      draw(page, c.title, x + PAD, y - LH + 1, bold, FS, GREY);
      x += c.w;
    }
    y -= LH + 2 * PAD;
  };

  newPage();
  drawLogo(page, A4[0] - M, y);
  draw(page, 'BOQ Change History', M, y - 16, bold, 16);
  y -= 22;
  draw(page, sanitize(input.projectName, body), M, y - 12, bold, 12);
  y -= 16;
  const sub = [input.clientName && `Client: ${input.clientName}`, input.siteAddress].filter(Boolean).join(' · ');
  const meta = `${sub ? sub + ' · ' : ''}${input.history.length} logged change events · as of ${formatDate(input.generatedOn)}`;
  for (const l of wrap(meta, body, 9, A4[0] - 2 * M)) {
    draw(page, l, M, y - 10, body, 9, GREY);
    y -= 12;
  }
  y -= 8;

  if (input.history.length === 0) {
    draw(page, 'No BOQ change events recorded for this project.', M, y - 12, body, 10);
    return doc.save();
  }

  tableHeader();

  input.history.forEach((r, idx) => {
    const roomStr = [r.floor, r.room].filter(Boolean).join(' · ');
    const itemStr = roomStr ? `${r.product}\n(${roomStr})` : r.product;
    const refStr = [r.referenceType, r.reference].filter(Boolean).join(': ');
    const reasonStr = refStr ? `${r.reason}\nRef: ${refStr}` : r.reason;

    const cells: Record<(typeof cols)[number]['key'], string> = {
      no: String(idx + 1),
      date: new Date(r.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' }),
      event: r.event.toUpperCase(),
      item: itemStr,
      requested: r.requestedBy || '—',
      reason: reasonStr || '—',
    };

    const wrapped = cols.map((c) => wrap(cells[c.key], body, FS, c.w - 2 * PAD));
    const h = Math.max(...wrapped.map((l) => l.length)) * LH + 2 * PAD;

    if (y - h < bottom) {
      newPage();
      tableHeader();
    }

    let x = M;
    cols.forEach((c, i) => {
      let cy = y - PAD - FS;
      for (const line of wrapped[i]) {
        draw(page, line, x + PAD, cy, body, FS);
        cy -= LH;
      }
      x += c.w;
    });

    page.drawLine({ start: { x: M, y: y - h }, end: { x: A4[0] - M, y: y - h }, color: LINE, thickness: 0.5 });
    y -= h;
  });

  pages.forEach((p, i) => {
    const foot = `Page ${i + 1} of ${pages.length} · VTech Site Tracker`;
    draw(p, foot, M, M, body, 8, GREY);
  });

  return doc.save();
}
