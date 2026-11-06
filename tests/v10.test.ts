import { describe, it, expect } from 'vitest';
import { formatBlockedBy, STEP_COLOURS } from '../lib/client/steps';
import { formatISTDate } from '../lib/pdf/boqComparisonReport';

describe('VTech Tracker v10 helpers', () => {
  it('formats responsible agency correctly according to rules', () => {
    // VTech teams
    expect(formatBlockedBy('VTech Installers')).toBe('Installer – VTech');
    expect(formatBlockedBy('VTech Programmers')).toBe('Programmer – VTech');
    expect(formatBlockedBy('VTECH PM')).toBe('PM – VTech');
    expect(formatBlockedBy('VTECH Sales')).toBe('Sales – VTech');
    expect(formatBlockedBy('VTECH Stock')).toBe('Stock – VTech');

    // External with company name
    expect(formatBlockedBy('Electrician', 'Apex Electricals')).toBe('Electrician – Apex Electricals');
    expect(formatBlockedBy('Carpenter', 'WoodWorks Inc')).toBe('Carpenter – WoodWorks Inc');

    // External without company name
    expect(formatBlockedBy('Electrician')).toBe('Electrician');
    expect(formatBlockedBy('PMC / Architect / Client person')).toBe('PMC / Architect / Client person');
  });

  it('contains expected v10 step colours', () => {
    // Grey 666666 = VTECH Sales
    expect(STEP_COLOURS['666666']).toBeDefined();
    expect(STEP_COLOURS['666666'].legend).toContain('VTECH Sales');

    // Magenta FF00FF = Client / Architect
    expect(STEP_COLOURS['FF00FF']).toBeDefined();
    expect(STEP_COLOURS['FF00FF'].legend).toContain('Client / Architect');

    // Orange F9CB9C = VTECH PM
    expect(STEP_COLOURS['F9CB9C']).toBeDefined();
    expect(STEP_COLOURS['F9CB9C'].legend).toContain('VTECH PM');

    // Green D9EAD3 = Readiness
    expect(STEP_COLOURS['D9EAD3']).toBeDefined();
  });

  it('formats IST date correctly for comparison PDF headers', () => {
    expect(formatISTDate(null)).toBe('—');
    expect(formatISTDate(undefined)).toBe('—');
    expect(formatISTDate('invalid-date')).toBe('—');

    // 2026-11-04 UTC converts to 04 Nov 2026 IST
    const formatted = formatISTDate('2026-11-04T10:00:00Z');
    expect(formatted).toMatch(/04 Nov 2026/);
  });
});
