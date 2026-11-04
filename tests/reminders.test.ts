import { describe, expect, it } from 'vitest';
import { parseRoundInput, planRound } from '../lib/reminders';
import type { ReportItem } from '../lib/report';

const item = (id: string, owner: string, ownerInternal = false): ReportItem => ({
  itemId: id, floorLabel: 'Ground', floorSort: 1, roomName: 'Living', roomSort: 1, seq: 1,
  text: `Step ${id}`, firstRaisedOn: '2026-10-20', reminderCount: 0, note: null, owner, ownerInternal,
});
const contact = (name: string, email: string | null, phone: string | null) => ({ name, email, phone, active: true });
const base = {
  project: { name: 'TEST – v5', clientName: 'Mr Shah', terms: 'General terms' },
  date: '2026-11-03', category: 'All dependencies',
  pm: { name: 'Amit PM', email: 'amit@vtechpl.com', phone: null },
  agencies: [
    { id: 'pmc1', companyName: 'Studio Axis', agencyTypeId: 'pmc', contacts: [contact('Arch A', 'a@x.in', '9876543210'), contact('Arch B', 'b@x.in', null)] },
    { id: 'pmc2', companyName: 'PMC Co', agencyTypeId: 'pmc', contacts: [contact('P', null, '9876500000')] },
    { id: 'sales1', companyName: 'VTech Sales', agencyTypeId: 'sales', contacts: [contact('S', 's@vtechpl.com', null)] },
    { id: 'ele1', companyName: 'Sparks', agencyTypeId: 'ele', contacts: [contact('E', 'e@x.in', null)] },
  ],
  items: [item('i1', 'Electrician'), item('i2', 'VTECH Sales Team', true), item('i3', 'Carpenter')],
};

describe('planRound', () => {
  it('one message per agency of each ticked group, each listing every item of the category', () => {
    const { messages } = planRound({ ...base, groups: [{ agencyTypeId: 'pmc', name: 'PMC / Architect / Client person', internal: false }] });
    expect(messages.map((m) => m.agencyId)).toEqual(['pmc1', 'pmc2']);
    expect(messages.every((m) => m.report.items.length === 2)).toBe(true); // i2 waits on VTech: hidden from external
    expect(messages[0].report.email!.to.map((p) => p.email)).toEqual(['a@x.in', 'b@x.in']);
    expect(messages[1].report.email).toBeNull();
    expect(messages[1].report.whatsapp!.to).toHaveLength(1);
  });

  it('unticked groups are not messaged; internal groups get [Internal] and no terms', () => {
    const { messages } = planRound({ ...base, groups: [{ agencyTypeId: 'sales', name: 'VTECH Sales Team', internal: true }] });
    expect(messages.map((m) => m.agencyId)).toEqual(['sales1']);
    expect(messages[0].report.email!.subject.startsWith('[Internal]')).toBe(true);
    expect(messages[0].report.email!.text).not.toContain('General terms');
  });

  it('VTech items go only to VTech groups, never to external ones', () => {
    const { messages } = planRound({ ...base, groups: [
      { agencyTypeId: 'pmc', name: 'PMC', internal: false }, { agencyTypeId: 'sales', name: 'VTECH Sales Team', internal: true }] });
    const ext = messages.find((m) => m.agencyId === 'pmc1')!, int = messages.find((m) => m.agencyId === 'sales1')!;
    expect(ext.report.items.map((i) => i.itemId)).not.toContain('i2');
    expect(ext.report.whatsapp!.text).not.toContain('VTECH Sales Team');
    expect(int.report.items.map((i) => i.itemId)).toContain('i2');
  });

  it('items show their own reminder number', () => {
    const { messages } = planRound({ ...base, items: [{ ...item('a', 'Electrician'), reminderCount: 1 }, item('b', 'Carpenter')],
      groups: [{ agencyTypeId: 'ele', name: 'Electrician', internal: false }] });
    const t = messages[0].report.whatsapp?.text ?? messages[0].report.email!.text;
    expect(t).toContain('reminder #2');
    expect(t).toContain('reminder #1');
    expect(messages[0].report.email!.subject).not.toMatch(/reminder #/);
  });

  it('warns when a ticked group has no agency in the project', () => {
    const { messages, warnings } = planRound({ ...base, groups: [{ agencyTypeId: 'carp', name: 'Carpenter', internal: false }] });
    expect(messages).toEqual([]);
    expect(warnings[0]).toMatch(/Carpenter: not added/);
  });

  it('messages carry no emoji', () => {
    const { messages } = planRound({ ...base, groups: [{ agencyTypeId: 'pmc', name: 'PMC', internal: false }] });
    for (const m of messages) for (const t of [m.report.email?.text, m.report.email?.subject, m.report.whatsapp?.text])
      expect(/\p{Extended_Pictographic}/u.test(t ?? '')).toBe(false);
  });
});

describe('parseRoundInput', () => {
  it('accepts a valid body and de-duplicates groups', () => {
    expect(parseRoundInput({ category: 'all', agencyTypeIds: ['a', 'a', 'b'], channel: 'email', preview: true }))
      .toEqual({ category: 'all', agencyTypeIds: ['a', 'b'], channel: 'email', preview: true });
  });
  it('rejects bad input with 400', () => {
    for (const b of [null, {}, { category: 'all', agencyTypeIds: [], channel: 'email' }, { category: 'all', agencyTypeIds: ['a'], channel: 'sms' }]) {
      expect(() => parseRoundInput(b)).toThrow();
      try { parseRoundInput(b); } catch (e) { expect((e as { status: number }).status).toBe(400); }
    }
  });
});
