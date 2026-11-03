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
  project: { name: 'Shah Residence', clientName: 'Mr Shah', terms: 'General terms and attention\n1. Two to four days.' },
  visitDate: '2026-10-31',
  agency: {
    companyName: 'Sparks Electricals', typeName: 'Electrician',
    contacts: [
      { id: 'a', name: 'Ramesh', designation: 'Supervisor', email: 'ramesh@sparks.in', phone: '98765 43210', active: true },
      { id: 'b', name: 'Mr Kapoor', designation: 'Owner', email: 'owner@sparks.in', phone: '+91 98200 00000', active: true },
    ],
  },
  pm: { name: 'Amit PM', email: 'amit@vtechpl.com', phone: '9000000000' },
  items,
});

describe('buildAgencyReport', () => {
  it('v5: every active contact receives it, no CC, items sorted by floor/room/seq', () => {
    const r = buildAgencyReport(base([
      item({ itemId: 'b', floorLabel: '13th Floor', floorSort: 13 }),
      item({ itemId: 'a', seq: 4, text: 'Ceiling fan not yet installed.' }),
      item({ itemId: 'c' }),
    ]));
    expect(r.email!.to.map((p) => p.email)).toEqual(['ramesh@sparks.in', 'owner@sparks.in']);
    expect(r.email!.cc).toEqual([]);
    expect(r.items.map((i) => i.itemId)).toEqual(['c', 'a', 'b']);
    expect(r.items.every((i) => i.reminderNo === 1)).toBe(true);
    expect(r.email!.subject).toContain('3 pending items for Electrician');
    expect(r.email!.text).toContain('General terms and attention');
  });

  it('v5: no escalation and no emoji, even after many reminders', () => {
    const r = buildAgencyReport(base([item({ reminderCount: 9 }), item({ itemId: 'x', reminderCount: 0 })]));
    expect(r.email!.cc).toEqual([]);
    expect(r.email!.subject).not.toMatch(/ESCALATION/i);
    expect(r.email!.html).not.toMatch(/escalation/i);
    expect(r.whatsapp!.text).not.toMatch(/escalation/i);
    const pict = /\p{Extended_Pictographic}/u;
    expect(pict.test(r.whatsapp!.text)).toBe(false);
    expect(pict.test(r.email!.text)).toBe(false);
    expect(pict.test(r.email!.subject)).toBe(false);
    expect(r.items.find((i) => i.itemId === 'x')!.reminderNo).toBe(1);
  });

  it('v5: inactive contacts are skipped', () => {
    const input = base([item()]);
    input.agency.contacts = input.agency.contacts.map((c, n) => ({ ...c, active: n === 0 }));
    expect(buildAgencyReport(input).email!.to.map((p) => p.email)).toEqual(['ramesh@sparks.in']);
  });

  it('v5: category wording lists items and who they wait on', () => {
    const r = buildAgencyReport({ ...base([item({ owner: 'Carpenter' })]), occasion: 'follow_up', category: 'All dependencies' });
    expect(r.email!.subject).toContain('1 pending item – All dependencies');
    expect(r.email!.text).toContain('are still pending (All dependencies)');
    expect(r.email!.text).toContain('waiting on Carpenter');
    expect(r.whatsapp!.text).toContain('All dependencies, status as of');
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
  it('summarises pending, reminded, closed-this-week, oldest', () => {
    const d = buildDigest(
      [{ id: 'p1', name: 'Shah Residence', lastVisit: '2026-10-31' }],
      [
        { projectId: 'p1', agency: 'Electrician – Sparks', status: 'pending', firstRaisedOn: '2026-10-01', completedOn: null, reminderCount: 4 },
        { projectId: 'p1', agency: 'Electrician – Sparks', status: 'pending', firstRaisedOn: '2026-10-24', completedOn: null, reminderCount: 1 },
        { projectId: 'p1', agency: 'Carpenter – Wood', status: 'complete', firstRaisedOn: '2026-10-01', completedOn: '2026-10-30', reminderCount: 2 },
      ],
      '2026-11-02',
    );
    const s = d.sections[0];
    expect([s.pending, s.reminded, s.closedThisWeek, s.oldest]).toEqual([2, 2, 1, 32]);
    expect(d.text).not.toMatch(/escalat/i);
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

describe('internal team reminders', () => {
  it('internal: [Internal] subject, no agency terms footer', () => {
    const input = base([item()]);
    const r = buildAgencyReport({ ...input, agency: { ...input.agency, internal: true } });
    expect(r.email!.subject.startsWith('[Internal]')).toBe(true);
    expect(r.email!.text).not.toContain('General terms and attention');
    expect(r.whatsapp!.text).not.toContain('protect installed automation devices');
  });
  it('external keeps the terms footer', () => {
    const r = buildAgencyReport(base([item()]));
    expect(r.email!.subject.startsWith('[Internal]')).toBe(false);
    expect(r.email!.text).toContain('General terms and attention');
  });
});

describe('v4 polite wording', () => {
  it('greets the agency and its team, thanks them, asks kindly; internal stays short', () => {
    const r = buildAgencyReport({ ...base([item({ note: 'Work pending from electrician' })]), occasion: 'follow_up' });
    expect(r.email!.text).toContain('Dear Ramesh, Mr Kapoor and the Sparks Electricals team,');
    expect(r.email!.text).toContain('Greetings from VTech Technologies');
    expect(r.email!.text).toContain('We would be grateful if you could take these up');
    expect(r.email!.text).toContain('Warm regards,');
    expect(r.email!.text).toContain('Work pending from electrician');
    expect(r.email!.text).not.toContain('at the earliest');
    expect(r.email!.html).toContain('the Sparks Electricals team');
    expect(r.whatsapp!.text.startsWith('Hello Ramesh, Mr Kapoor, greetings from VTech.')).toBe(true);
    const i = buildAgencyReport({ ...base([item()]), agency: { ...base([]).agency, internal: true } });
    expect(i.email!.text).toContain('Dear Ramesh, Mr Kapoor,');
    expect(i.email!.text).not.toContain('Greetings from VTech');
  });
});
