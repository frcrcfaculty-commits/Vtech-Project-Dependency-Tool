// Builds the per-agency report (email + WhatsApp text) from pending items. Pure, unit tested.
// Hermes owns the visual polish of the HTML (see docs/BRIEF_HERMES.md) but must keep this function's
// signature and the data it shows.

import {
  levelForReminder, resolveRecipients, shouldCcManagement,
  type Contact, type EscalationPolicy, type Level,
} from './escalation';

export interface ReportItem {
  itemId: string;
  floorLabel: string;
  floorSort: number;
  roomName: string;
  roomSort: number;
  seq: number;
  text: string;
  firstRaisedOn: string | null; // ISO date
  reminderCount: number;        // reminders already sent
  note: string | null;
}

export interface ReportInput {
  project: { name: string; clientName: string | null; terms: string; policy: EscalationPolicy };
  visitDate: string; // ISO date
  agency: { companyName: string; typeName: string; escalationEnabled: boolean; contacts: Contact[] };
  pm: { name: string; email: string; phone: string | null };
  management: { name: string; email: string }[];
  items: ReportItem[];
}

export interface Person { name: string; email?: string; phone?: string }

export interface BuiltReport {
  level: Level;
  items: { itemId: string; reminderNo: number; level: Level }[];
  email: { to: Person[]; cc: Person[]; subject: string; text: string; html: string } | null;
  whatsapp: { to: Person[]; text: string } | null;
  warnings: string[];
}

export const WHATSAPP_MAX = 3800; // Meta text limit is 4096; keep headroom for footer

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00+05:30`);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

export function daysOpen(firstRaisedOn: string | null, asOf: string): number | null {
  if (!firstRaisedOn) return null;
  const ms = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${firstRaisedOn}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const location = (i: ReportItem) => `${i.floorLabel} – ${i.roomName}`;

export function buildAgencyReport(input: ReportInput): BuiltReport {
  const { project, agency, items, visitDate, pm } = input;
  const policy = project.policy;
  const warnings: string[] = [];

  const sorted = [...items].sort((a, b) =>
    a.floorSort - b.floorSort || a.roomSort - b.roomSort || a.seq - b.seq || a.text.localeCompare(b.text));

  const withLevels = sorted.map((i) => {
    const reminderNo = i.reminderCount + 1;
    return { ...i, reminderNo, level: levelForReminder(reminderNo, policy, agency.escalationEnabled) };
  });
  const level = withLevels.reduce<Level>((m, i) => (i.level > m ? i.level : m), 1);
  const maxReminder = withLevels.reduce((m, i) => Math.max(m, i.reminderNo), 1);

  const tag = level >= 2 ? ` [ESCALATION L${level}]` : '';
  const subject =
    `${tag ? tag.trim() + ' ' : ''}${project.name}: ${withLevels.length} pending item${withLevels.length === 1 ? '' : 's'} ` +
    `for ${agency.typeName} (${agency.companyName}) – reminder #${maxReminder} – ${formatDate(visitDate)}`;

  // ── email ──
  let email: BuiltReport['email'] = null;
  const er = resolveRecipients(agency.contacts, level, 'email');
  if (er.effectiveLevel === null) {
    warnings.push(`No email contact for ${agency.companyName}; email skipped.`);
  } else {
    if (er.effectiveLevel < level) warnings.push(`No L${level} email contact for ${agency.companyName}; sent to L${er.effectiveLevel}.`);
    const cc: Person[] = er.cc.map((c) => ({ name: c.name, email: c.email! }));
    if (shouldCcManagement(level, policy)) {
      for (const m of input.management) if (!cc.some((c) => c.email === m.email)) cc.push({ name: m.name, email: m.email });
    }
    const textLines = [
      `Dear ${er.to.map((c) => c.name).join(', ')},`,
      '',
      `At our site visit on ${formatDate(visitDate)} at ${project.name}${project.clientName ? ` (${project.clientName})` : ''}, ` +
        `the following ${agency.typeName.toLowerCase()} items were found pending. Please complete them at the earliest.`,
      '',
      ...withLevels.map((i, n) =>
        `${n + 1}. ${location(i)}: ${i.text} — first raised ${formatDate(i.firstRaisedOn)}, reminder #${i.reminderNo}` +
        (i.note ? ` (${i.note})` : '')),
      '',
      project.terms,
      '',
      `Regards,`,
      `${pm.name}`,
      `VTech Technologies${pm.phone ? ` | ${pm.phone}` : ''}`,
    ];
    const rows = withLevels.map((i, n) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5;color:#666">${n + 1}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5">${esc(location(i))}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5">${esc(i.text)}${i.note ? `<br><span style="color:#666;font-size:12px">${esc(i.note)}</span>` : ''}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5;white-space:nowrap">${formatDate(i.firstRaisedOn)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5;text-align:center${i.level >= 2 ? ';color:#b42318;font-weight:600' : ''}">${i.reminderNo}</td>
      </tr>`).join('');
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;max-width:760px">
  <p>Dear ${esc(er.to.map((c) => c.name).join(', '))},</p>
  <p>At our site visit on <b>${formatDate(visitDate)}</b> at <b>${esc(project.name)}</b>${project.clientName ? ` (${esc(project.clientName)})` : ''},
     the following ${esc(agency.typeName.toLowerCase())} items were found pending. Please complete them at the earliest.</p>
  ${level >= 2 ? `<p style="color:#b42318"><b>This is an escalation (level ${level}).</b> Some items have remained pending across multiple reminders.</p>` : ''}
  <table style="border-collapse:collapse;width:100%;font-size:13px">
    <thead><tr style="background:#f4f4f4;text-align:left">
      <th style="padding:6px 8px">#</th><th style="padding:6px 8px">Location</th><th style="padding:6px 8px">Pending item</th>
      <th style="padding:6px 8px">First raised</th><th style="padding:6px 8px">Reminder</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="white-space:pre-line;color:#444;font-size:12px;margin-top:20px">${esc(project.terms)}</p>
  <p>Regards,<br>${esc(pm.name)}<br>VTech Technologies${pm.phone ? ` | ${esc(pm.phone)}` : ''}</p>
</div>`;
    email = {
      to: er.to.map((c) => ({ name: c.name, email: c.email! })),
      cc,
      subject,
      text: textLines.join('\n'),
      html,
    };
  }

  // ── WhatsApp ──
  let whatsapp: BuiltReport['whatsapp'] = null;
  const wr = resolveRecipients(agency.contacts, level, 'whatsapp');
  if (wr.effectiveLevel === null) {
    warnings.push(`No WhatsApp number for ${agency.companyName}; WhatsApp skipped.`);
  } else {
    const head =
      `*VTech – ${project.name}*${level >= 2 ? `  ⚠️ Escalation L${level}` : ''}\n` +
      `Site visit ${formatDate(visitDate)}: ${withLevels.length} pending ${agency.typeName.toLowerCase()} item${withLevels.length === 1 ? '' : 's'} (${agency.companyName}).\n\n`;
    const foot = `\n\nPlease complete at the earliest. Once addressed, VTech needs 2–4 days to finish automation work. Kindly protect installed automation devices.\n– ${pm.name}, VTech`;
    let body = '';
    let shown = 0;
    for (const [n, i] of withLevels.entries()) {
      const line = `${n + 1}. ${location(i)}: ${i.text} (since ${formatDate(i.firstRaisedOn)}, #${i.reminderNo})\n`;
      if (head.length + body.length + line.length + foot.length > WHATSAPP_MAX) break;
      body += line;
      shown++;
    }
    if (shown < withLevels.length) {
      body += `…and ${withLevels.length - shown} more — full list sent by email.\n`;
      warnings.push(`WhatsApp message truncated to ${shown} of ${withLevels.length} items.`);
    }
    whatsapp = { to: wr.to.map((c) => ({ name: c.name, phone: c.phone! })), text: head + body.trimEnd() + foot };
  }

  return {
    level,
    items: withLevels.map((i) => ({ itemId: i.itemId, reminderNo: i.reminderNo, level: i.level })),
    email,
    whatsapp,
    warnings,
  };
}
