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
    // Email-client-safe HTML: table layout, inline styles, bgcolor attributes (Outlook ignores CSS backgrounds
    // on some elements), system fonts only, no <style>, no web fonts, no images except the optional logo.
    const logoUrl = process.env.NEXT_PUBLIC_LOGO_URL;
    const F = 'font-family:Arial,Helvetica,sans-serif';
    const td = `${F};padding:8px 10px;border-bottom:1px solid #e4e7ec;font-size:13px;line-height:18px;vertical-align:top`;
    const th = `${F};padding:8px 10px;font-size:12px;line-height:16px;font-weight:bold;color:#475467;text-align:left;border-bottom:2px solid #d0d5dd`;
    const accent = level >= 2 ? '#b42318' : '#1d4ed8';
    const rows = withLevels.map((i, n) => `
            <tr>
              <td style="${td};color:#667085;width:24px">${n + 1}</td>
              <td style="${td};color:#1a1a1a">${esc(location(i))}</td>
              <td style="${td};color:#1a1a1a">${esc(i.text)}${i.note ? `<br><span style="${F};color:#667085;font-size:12px;line-height:16px">${esc(i.note)}</span>` : ''}</td>
              <td style="${td};color:#1a1a1a;white-space:nowrap">${formatDate(i.firstRaisedOn)}</td>
              <td align="center" style="${td};text-align:center;${i.level >= 2 ? 'color:#b42318;font-weight:bold' : 'color:#1a1a1a'}">#${i.reminderNo}</td>
            </tr>`).join('');
    const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f2f4f7" style="background-color:#f2f4f7;border-collapse:collapse">
  <tr><td align="center" style="padding:20px 8px">
    <table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:680px;background-color:#ffffff;border-collapse:collapse;border:1px solid #e4e7ec">
      <tr><td bgcolor="${accent}" style="background-color:${accent};height:4px;line-height:4px;font-size:4px">&nbsp;</td></tr>
      <tr><td style="padding:18px 24px 6px 24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
          <tr>
            ${logoUrl ? `<td width="140" valign="middle" style="padding-right:12px"><img src="${esc(logoUrl)}" alt="VTech Technologies" width="120" style="display:block;border:0;outline:none;width:120px;height:auto"></td>` : ''}
            <td valign="middle" style="${F};font-size:12px;line-height:16px;color:#667085">VTech Technologies · Site dependency report</td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:6px 24px 0 24px;${F};font-size:20px;line-height:26px;font-weight:bold;color:#101828">${esc(project.name)}</td></tr>
      <tr><td style="padding:2px 24px 14px 24px;${F};font-size:13px;line-height:18px;color:#475467">${esc(agency.typeName)} · ${esc(agency.companyName)} · ${withLevels.length} pending item${withLevels.length === 1 ? '' : 's'} · visit ${formatDate(visitDate)}</td></tr>
      ${level >= 2 ? `<tr><td style="padding:0 24px 14px 24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
          <tr><td bgcolor="#fef3f2" style="background-color:#fef3f2;border-left:4px solid #b42318;padding:10px 12px;${F};font-size:13px;line-height:18px;color:#b42318"><b>This is an escalation (level ${level}).</b> Some items have remained pending across multiple reminders.</td></tr>
        </table>
      </td></tr>` : ''}
      <tr><td style="padding:0 24px 12px 24px;${F};font-size:14px;line-height:20px;color:#1a1a1a">
        <p style="margin:0 0 10px 0">Dear ${esc(er.to.map((c) => c.name).join(', '))},</p>
        <p style="margin:0">At our site visit on <b>${formatDate(visitDate)}</b> at <b>${esc(project.name)}</b>${project.clientName ? ` (${esc(project.clientName)})` : ''},
          the following ${esc(agency.typeName.toLowerCase())} items were found pending. Please complete them at the earliest.</p>
      </td></tr>
      <tr><td style="padding:0 24px 8px 24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
          <thead><tr bgcolor="#f9fafb" style="background-color:#f9fafb">
            <th style="${th}">#</th><th style="${th}">Location</th><th style="${th}">Pending item</th>
            <th style="${th};white-space:nowrap">First raised</th><th style="${th};text-align:center">Reminder</th></tr></thead>
          <tbody>${rows}
          </tbody>
        </table>
      </td></tr>
      <tr><td style="padding:12px 24px 0 24px;${F};font-size:12px;line-height:17px;color:#475467;white-space:pre-line">${esc(project.terms)}</td></tr>
      <tr><td style="padding:16px 24px 22px 24px;${F};font-size:14px;line-height:20px;color:#1a1a1a">Regards,<br><b>${esc(pm.name)}</b><br>VTech Technologies${pm.phone ? ` | ${esc(pm.phone)}` : ''}</td></tr>
    </table>
  </td></tr>
</table>`;
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
