import { describe, expect, it } from 'vitest';
import { loadPdfFonts } from '../lib/pdf/fonts';
import { buildCompletedPdf } from '../lib/pdf/completedReport';

describe('buildCompletedPdf', () => {
  it('generates a valid completed items PDF buffer with projects and items', async () => {
    const fonts = await loadPdfFonts();
    const pdfBytes = await buildCompletedPdf(
      {
        generatedOn: '2026-11-04',
        projects: [
          {
            name: 'TEST – Villa A',
            clientName: 'Mr Sharma',
            items: [
              {
                floorLabel: 'Ground Floor',
                floorSort: 1,
                roomName: 'Living Room',
                roomSort: 1,
                productTitle: 'Touch Panel 8-gang · Backbox installation',
                agencyType: 'Electrician',
                company: 'Apex Electricals',
                firstRaisedOn: '2026-10-15',
                completedOn: '2026-10-22',
                daysToComplete: 7,
                note: 'Verified with site engineer',
              },
            ],
          },
        ],
      },
      fonts
    );

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);
    // PDF Magic bytes '%PDF'
    const header = String.fromCharCode(...pdfBytes.subarray(0, 4));
    expect(header).toBe('%PDF');
  });

  it('handles empty projects array without error', async () => {
    const fonts = await loadPdfFonts();
    const pdfBytes = await buildCompletedPdf(
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
