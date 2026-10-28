import { describe, expect, it } from 'vitest';
import { buildAgencyReport, daysOpen, WHATSAPP_MAX, type ReportInput, type ReportItem } from '../lib/report';
import { buildMime, gmailComposeUrl } from '../lib/channels/email';
import { normalizePhone, waLink } from '../lib/channels/whatsapp';
import { buildDigest } from '../lib/digest';

const item = (over: Partial<ReportItem> = {}): ReportItem => ({
  itemId: 'i1', floorLabel: '12th Floor', floorSort: 12, roomName: 'Living Room', roomSort: 1, seq: 1,
  text: 'Regular ceiling lights not yet installed.', firstRaisedOn: '2026-10-24', reminderCount: 0, note: null, ...over,
});

const base = (items: ReportItem[]): ReportInput => ({
  project: { name: 'Shah Residence', clientName: 'Mr Shah', terms: 'General terms and attention\n1. Two to four days.', policy: { l2After: 3, l3After: 6, mgmtCcLevel: 3 } },
  visitDate: '2026-10-31',
  agency: {
    companyName: 'Sparks Electricals', typeName: 'Electrician', escalationEnabled: true,
    contacts: [
      { id: 'a', name: 'Ramesh', designation: 'Supervisor', level: 1, email: 'ramesh@sparks.in', phone: '98765 43210', active: true },
      { id: 'b', name: 'Mr Kapoor', designation: 'Owner', level: 3, email: 'owner@sparks.in', phone: '+91 98200 00000', active: true },
    ],
  },
  pm: { name: 'Amit PM', email: 'amit@vtechpl.com', phone: '9000000000' },
  management: [{ name: 'Vipul Shah', email: 'vipul@vtechpl.com' }],
  items,
});

describe('buildAgencyReport', () => {
  it('first reminder: L1 recipient, no management CC, items sorted by floor/room/seq', () => {
    const r = buildAgencyReport(base([
      item({ itemId: 'b', floorLabel: '13th Floor', floorSort: 13 }),
      item({ itemId: 'a', seq: 4, text: 'Ceiling fan not yet installed.' }),
      item({ itemId: 'c' }),
    ]));
    expect(r.level).toBe(1);
    expect(r.email!.to.map((p) => p.email)).toEqual(['ramesh@sparks.in']);
    expect(r.email!.cc).toEqual([]);
    expect(r.items.map((i) => i.itemId)).toEqual(['c', 'a', 'b']);
    expect(r.items.every((i) => i.reminderNo === 1)).toBe(true);
    expect(r.email!.subject).toContain('3 pending items for Electrician');
    expect(r.email!.text).toContain('General terms and attention');
  });

  it('7th reminder escalates to L3 owner, CCs junior + Vipul, flags subject', () => {
    const r = buildAgencyReport(base([item({ reminderCount: 6 }), item({ itemId: 'x', reminderCount: 0 })]));
    expect(r.level).toBe(3);
    expect(r.email!.to.map((p) => p.email)).toEqual(['owner@sparks.in']);
    expect(r.email!.cc.map((p) => p.email)).toEqual(['ramesh@sparks.in', 'vipul@vtechpl.com']);
    expect(r.email!.subject.startsWith('[ESCALATION L3]')).toBe(true);
    expect(r.items.find((i) => i.itemId === 'x')!.level).toBe(1);
  });

  it('escapes HTML in user-entered text', () => {
    const r = buildAgencyReport(base([item({ text: '<script>x</script>', note: 'a & b' })]));
    expect(r.email!.html).not.toContain('<script>');
    expect(r.email!.html).toContain('&lt;script&gt;');
    expect(r.email!.html).toContain('a &amp; b');
  });

  it('WhatsApp truncates long lists and warns', () => {
    const many = Array.from({ length: 200 }, (_, n) => item({ itemId: `i${n}`, seq: n }));
    const r = buildAgencyReport(base(many));
    expect(r.whatsapp!.text.length).toBeLessThanOrEqual(WHATSAPP_MAX);
    expect(r.whatsapp!.text).toContain('full list sent by email');
    expect(r.warnings.some((w) => w.includes('truncated'))).toBe(true);
  });

  it('skips a channel when no contact has it', () => {
    const input = base([item()]);
    input.agency.contacts = input.agency.contacts.map((c) => ({ ...c, email: null }));
    const r = buildAgencyReport(input);
    expect(r.email).toBeNull();
    expect(r.whatsapp).not.toBeNull();
    expect(r.warnings[0]).toMatch(/No email contact/);
  });
});

describe('channels', () => {
  it('normalizes Indian phones', () => {
    expect(normalizePhone('98765 43210')).toBe('919876543210');
    expect(normalizePhone('+91 98200-00000')).toBe('919820000000');
    expect(normalizePhone('09876543210')).toBe('919876543210');
    expect(normalizePhone('123')).toBeNull();
    expect(waLink('9876543210', 'hi there')).toBe('https://wa.me/919876543210?text=hi%20there');
  });
  it('builds a MIME message with UTF-8 subject and both parts', () => {
    const mime = buildMime({ from: { name: 'Amit', email: 'a@vtechpl.com' }, to: [{ name: 'R', email: 'r@x.in' }], cc: [], subject: 'Reminder – 12th Floor', text: 't', html: '<b>h</b>' });
    expect(mime).toContain('Subject: =?UTF-8?B?');
    expect(mime).toContain('text/plain');
    expect(mime).toContain('text/html');
    expect(mime).not.toMatch(/^Cc:/m);
  });
  it('builds a Gmail compose link for the PM account', () => {
    const url = gmailComposeUrl({ from: { name: 'A', email: 'a@vtechpl.com' }, to: [{ name: 'R', email: 'r@x.in' }], cc: [{ name: 'V', email: 'v@vtechpl.com' }], subject: 's', text: 'b', html: '' });
    const q = new URL(url).searchParams;
    expect(q.get('to')).toBe('r@x.in');
    expect(q.get('cc')).toBe('v@vtechpl.com');
    expect(q.get('authuser')).toBe('a@vtechpl.com');
  });
});

describe('digest', () => {
  it('summarises pending, escalated, closed-this-week, oldest', () => {
    const d = buildDigest(
      [{ id: 'p1', name: 'Shah Residence', l2After: 3, l3After: 6, lastVisit: '2026-10-31' }],
      [
        { projectId: 'p1', agency: 'Electrician – Sparks', status: 'pending', firstRaisedOn: '2026-10-01', completedOn: null, reminderCount: 4 },
        { projectId: 'p1', agency: 'Electrician – Sparks', status: 'pending', firstRaisedOn: '2026-10-24', completedOn: null, reminderCount: 1 },
        { projectId: 'p1', agency: 'Carpenter – Wood', status: 'complete', firstRaisedOn: '2026-10-01', completedOn: '2026-10-30', reminderCount: 2 },
      ],
      '2026-11-02',
    );
    const s = d.sections[0];
    expect([s.pending, s.escalated, s.closedThisWeek, s.oldest]).toEqual([2, 1, 1, 32]);
    expect(daysOpen('2026-10-24', '2026-10-31')).toBe(7);
  });
});

describe('office follow-up wording', () => {
  it('follow_up says "still pending as of", site_visit says "At our site visit"', () => {
    const site = buildAgencyReport(base([item()]));
    const fu = buildAgencyReport({ ...base([item()]), occasion: 'follow_up' });
    expect(site.email!.text).toContain('At our site visit on');
    expect(fu.email!.text).toContain('are still pending');
    expect(fu.email!.text).not.toContain('site visit');
    expect(fu.email!.html).toContain('still pending');
    expect(fu.whatsapp!.text).toContain('Status as of');
    expect(site.whatsapp!.text).toContain('Site visit');
  });
});
