import { describe, expect, it } from 'vitest';
import { loadPdfFonts } from '../lib/pdf/fonts';
import { buildAllBoqPdf } from '../lib/pdf/allBoqReport';

describe('buildAllBoqPdf', () => {
  it('generates a valid all-BOQ PDF buffer with projects and line items', async () => {
    const fonts = await loadPdfFonts();
    const pdfBytes = await buildAllBoqPdf(
      {
        generatedOn: '2026-11-04',
        projects: [
          {
            name: 'TEST – Villa A',
            clientName: 'Mr Sharma',
            lines: [
              {
                floorLabel: '1st Floor',
                floorSort: 2,
                roomName: 'Master Bedroom',
                roomSort: 1,
                productTitle: 'Touch Panel 8-gang',
                location: 'Bedside Right',
                make: 'VTech Pro',
                model: 'TP-8G-BLK',
                quantity: 2,
                note: 'Custom matte finish',
              },
            ],
          },
        ],
      },
      fonts
    );

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);
    const header = String.fromCharCode(...pdfBytes.subarray(0, 4));
    expect(header).toBe('%PDF');
  });

  it('handles empty projects array gracefully', async () => {
    const fonts = await loadPdfFonts();
    const pdfBytes = await buildAllBoqPdf(
      {
        generatedOn: '2026-11-04',
        projects: [],
      },
      fonts
    );
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(500);
  });
});
