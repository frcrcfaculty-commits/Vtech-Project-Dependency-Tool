import { describe, expect, it } from 'vitest';
import { levelForReminder, resolveRecipients, shouldCcManagement, type Contact } from '../lib/escalation';

const policy = { l2After: 3, l3After: 6, mgmtCcLevel: 3 };
const c = (id: string, level: 1 | 2 | 3, email: string | null, phone: string | null, active = true): Contact =>
  ({ id, name: id, designation: 'x', level, email, phone, active });

describe('levelForReminder', () => {
  it('reminders 1–3 → L1, 4–6 → L2, 7+ → L3', () => {
    expect([1, 2, 3, 4, 6, 7, 20].map((n) => levelForReminder(n, policy))).toEqual([1, 1, 1, 2, 2, 3, 3]);
  });
  it('escalation disabled stays L1', () => {
    expect(levelForReminder(50, policy, false)).toBe(1);
  });
});

describe('resolveRecipients', () => {
  const contacts = [c('jr', 1, 'jr@a.in', '9000000001'), c('mgr', 2, 'mgr@a.in', null), c('own', 3, null, '9000000003'), c('old', 2, 'old@a.in', '9', false)];
  it('L2 email: to manager, cc junior, skips inactive', () => {
    const r = resolveRecipients(contacts, 2, 'email');
    expect(r.to.map((x) => x.id)).toEqual(['mgr']);
    expect(r.cc.map((x) => x.id)).toEqual(['jr']);
    expect(r.effectiveLevel).toBe(2);
  });
  it('L3 email falls back to L2 when owner has no email', () => {
    expect(resolveRecipients(contacts, 3, 'email').effectiveLevel).toBe(2);
  });
  it('L2 whatsapp falls back to L1 when manager has no phone', () => {
    const r = resolveRecipients(contacts, 2, 'whatsapp');
    expect(r.effectiveLevel).toBe(1);
    expect(r.to.map((x) => x.id)).toEqual(['jr']);
  });
  it('no usable contacts → null level', () => {
    expect(resolveRecipients([c('x', 1, null, '9', false)], 1, 'whatsapp').effectiveLevel).toBeNull();
  });
});

describe('shouldCcManagement', () => {
  it('cc at/after threshold; 4 = never', () => {
    expect(shouldCcManagement(2, policy)).toBe(false);
    expect(shouldCcManagement(3, policy)).toBe(true);
    expect(shouldCcManagement(3, { ...policy, mgmtCcLevel: 4 })).toBe(false);
  });
});
