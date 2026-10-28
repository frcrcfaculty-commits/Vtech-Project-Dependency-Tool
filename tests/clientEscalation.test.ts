import { describe, expect, it } from 'vitest';
import { getEscalationLevel, isEscalated, formatEscalationLabel } from '../lib/client/escalation';

describe('client escalation helpers', () => {
  it('correctly calculates escalation levels based on l2_after and l3_after', () => {
    // defaults: l2_after = 3, l3_after = 6
    expect(getEscalationLevel(0)).toBe(1);
    expect(getEscalationLevel(1)).toBe(1);
    expect(getEscalationLevel(3)).toBe(1);
    expect(getEscalationLevel(4)).toBe(2);
    expect(getEscalationLevel(6)).toBe(2);
    expect(getEscalationLevel(7)).toBe(3);
  });

  it('correctly determines isEscalated', () => {
    expect(isEscalated(0, 3)).toBe(false);
    expect(isEscalated(3, 3)).toBe(false);
    expect(isEscalated(4, 3)).toBe(true);
  });

  it('formats escalation labels according to Brief rules', () => {
    expect(formatEscalationLabel(1)).toBe('L1 · First notice');
    expect(formatEscalationLabel(4)).toBe('L2 Escalation');
    expect(formatEscalationLabel(8)).toBe('L3 Escalation');
  });
});
