import { describe, it, expect } from 'vitest';
import { formatBlockedBy, STEP_COLOURS } from '../lib/client/steps';

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
});
