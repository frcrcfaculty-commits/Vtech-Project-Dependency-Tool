import { describe, it, expect } from 'vitest';
import { loadPdfFonts } from '../lib/pdf/fonts';
import {
  buildBoqRoomWisePdf,
  buildBoqConsoPdf,
  buildBoqHistoryPdf,
} from '../lib/pdf/boqReport';

describe('BOQ PDFs', () => {
  it('builds Room-wise BOQ PDF with Devanagari names', async () => {
    const fonts = await loadPdfFonts();
    const pdf = await buildBoqRoomWisePdf(
      {
        projectName: 'TEST – Sharma Villa (शर्मा विला)',
        clientName: 'राजेश शर्मा',
        siteAddress: '12, Juhu Tara Road, Mumbai',
        generatedOn: '2026-11-04',
        lines: [
          {
            floorLabel: 'Ground Floor',
            floorSort: 1,
            roomName: 'Living Room',
            roomSort: 1,
            productTitle: 'Keypad (कीपैड)',
            location: 'Entrance',
            make: 'Lutron',
            model: 'Palladiom',
            quantity: 2,
            note: 'Black finish',
          },
        ],
      },
      fonts
    );
    expect(pdf).toBeInstanceOf(Uint8Array);
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('builds Consolidated (Conso) BOQ PDF', async () => {
    const fonts = await loadPdfFonts();
    const pdf = await buildBoqConsoPdf(
      {
        projectName: 'TEST – Sharma Villa',
        clientName: 'Rajesh Sharma',
        siteAddress: 'Mumbai',
        generatedOn: '2026-11-04',
        items: [
          {
            productTitle: 'Keypad',
            make: 'Lutron',
            model: 'Palladiom',
            totalQuantity: 5,
            locations: 'Living Room - Entrance, Bedroom - Bedside',
          },
        ],
      },
      fonts
    );
    expect(pdf).toBeInstanceOf(Uint8Array);
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('builds BOQ History PDF with change requests', async () => {
    const fonts = await loadPdfFonts();
    const pdf = await buildBoqHistoryPdf(
      {
        projectName: 'TEST – Sharma Villa',
        clientName: 'Rajesh Sharma',
        siteAddress: 'Mumbai',
        generatedOn: '2026-11-04',
        history: [
          {
            at: new Date().toISOString(),
            event: 'added',
            product: 'Keypad',
            room: 'Living Room',
            floor: 'Ground Floor',
            requestedBy: 'Client – Rajesh',
            referenceType: 'email',
            reference: 'Email from Rajesh at 10am',
            reason: 'Added additional keypad near entrance for lighting control',
          },
        ],
      },
      fonts
    );
    expect(pdf).toBeInstanceOf(Uint8Array);
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
