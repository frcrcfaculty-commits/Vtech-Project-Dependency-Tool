// Builds the per-agency report (email + WhatsApp text) from pending items. Pure, unit tested.
// Hermes owns the visual polish of the HTML (see docs/BRIEF_HERMES.md) but must keep this function's
// signature and the data it shows.

// v5: no escalation. Every active contact with the channel receives the message; nothing is CC'd automatically.
// No emoji anywhere (VTech, 2026-11-03).

export interface Contact {
  id?: string;
  name: string;
  designation?: string | null;
  email: string | null;
  phone: string | null;
  active: boolean;
}

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
  /** Who the item waits on (agency type), shown in category reminders. */
  owner?: string | null;
  /** True when the item waits on a VTech team (never shown to external recipients). */
  ownerInternal?: boolean;
}

export interface ReportInput {
  project: { name: string; clientName: string | null; terms: string };
  visitDate: string; // ISO date
  /** 'site_visit' (default): "At our site visit on …". 'follow_up': office reminder, "As of …, still pending". */
  occasion?: 'site_visit' | 'follow_up';
  /** internal = VTech's own team: subject marked [Internal], no agency terms footer. */
  agency: { companyName: string; typeName: string; contacts: Contact[]; internal?: boolean };
  pm: { name: string; email: string; phone: string | null };
  /** Reminder category label ("Only electrical dependency"…): the message lists the category's items, not "items from your side". */
  category?: string;
  items: ReportItem[];
}

export interface Person { name: string; email?: string; phone?: string }

export interface BuiltReport {
  items: { itemId: string; reminderNo: number }[];
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
const ownerTag = (i: ReportItem) => (i.owner ? ` – waiting on ${i.owner}` : '');
/** First name for WhatsApp; keeps a title with its name ("Mr Kapoor", "Dr Shah"). */
const shortName = (n: string) => { const w = n.trim().split(/\s+/); return /^(mr|mrs|ms|dr|shri|smt)\.?$/i.test(w[0]) && w[1] ? `${w[0]} ${w[1]}` : w[0]; };
const usable = (c: Contact, channel: 'email' | 'whatsapp') => c.active && (channel === 'email' ? !!c.email : !!c.phone);

export function buildAgencyReport(input: ReportInput): BuiltReport {
  const { project, agency, items, visitDate, pm } = input;
  const followUp = input.occasion === 'follow_up';
  const internal = !!input.agency.internal;
  const terms = internal ? '' : project.terms;
  const category = input.category;
  const warnings: string[] = [];

  const sorted = [...items].sort((a, b) =>
    a.floorSort - b.floorSort || a.roomSort - b.roomSort || a.seq - b.seq || a.text.localeCompare(b.text));

  const withLevels = sorted.map((i) => ({ ...i, reminderNo: i.reminderCount + 1 }));

  const plural = withLevels.length === 1 ? '' : 's';
  const subject =
    `${internal ? '[Internal] ' : ''}${project.name}: ${withLevels.length} pending item${plural} ` +
    (category ? `– ${category} ` : `for ${agency.typeName} (${agency.companyName}) `) +
    `– ${formatDate(visitDate)}`;
  const client = project.clientName ? ` (${project.clientName})` : '';
  const intro = category
    ? `As of ${formatDate(visitDate)}, the following items at ${project.name}${client} are still pending (${category}). `
    : followUp
      ? `As of ${formatDate(visitDate)}, the following ${agency.typeName.toLowerCase()} items at ${project.name}${client} are still pending from your side. `
      : `At our site visit on ${formatDate(visitDate)} at ${project.name}${client}, the following ${agency.typeName.toLowerCase()} items were found pending from your side. `;

  // ── email ──
  let email: BuiltReport['email'] = null;
  const er = { to: agency.contacts.filter((c) => usable(c, 'email')) };
  if (!er.to.length) {
    warnings.push(`No email contact for ${agency.companyName}; email skipped.`);
  } else {
    const cc: Person[] = [];
    const greeting = internal
      ? `${er.to.map((c) => c.name).join(', ')}`
      : `${er.to.map((c) => c.name).join(', ')} and the ${agency.companyName} team`;
    const closingAsk = internal
      ? 'Please take them up and update me once they are done.'
      : 'We would be grateful if you could take these up at your earliest convenience, so that our team can complete the automation work on schedule.';
    const thanks = internal
      ? 'Thank you.'
      : 'If any of these are already done, or if you need anything from us, please reply to this email and we will update our records. Thank you for your help.';
    const textLines = [
      `Dear ${greeting},`,
      '',
      internal ? `Hope you are doing well.` : `Greetings from VTech Technologies, and thank you for your continued support on ${project.name}.`,
      '',
      intro + closingAsk,
      '',
      ...withLevels.map((i, n) =>
        `${n + 1}. ${location(i)}: ${i.text}${ownerTag(i)} — pending since ${formatDate(i.firstRaisedOn)}, reminder #${i.reminderNo}` +
        (i.note ? ` (${i.note})` : '')),
      '',
      terms,
      '',
      thanks,
      '',
      `Warm regards,`,
      `${pm.name}`,
      `VTech Technologies${pm.phone ? ` | ${pm.phone}` : ''}`,
    ];
    // Email-client-safe HTML: table layout, inline styles, bgcolor attributes (Outlook ignores CSS backgrounds
    // on some elements), system fonts only, no <style>, no web fonts, no images except the optional logo.
    const logoUrl = process.env.NEXT_PUBLIC_LOGO_URL;
    const F = 'font-family:Arial,Helvetica,sans-serif';
    const td = `${F};padding:8px 6px;border-bottom:1px solid #e4e7ec;font-size:13px;line-height:18px;vertical-align:top`;
    const th = `${F};padding:8px 6px;font-size:12px;line-height:16px;font-weight:bold;color:#475467;text-align:left;border-bottom:2px solid #d0d5dd`;
    const accent = '#1d4ed8';
    const rows = withLevels.map((i, n) => `
            <tr>
              <td width="22" style="${td};color:#667085">${n + 1}</td>
              <td width="30%" style="${td};color:#1a1a1a">${esc(location(i))}</td>
              <td style="${td};color:#1a1a1a">${esc(i.text + ownerTag(i))}${i.note ? `<br><span style="${F};color:#667085;font-size:12px;line-height:16px">${esc(i.note)}</span>` : ''}</td>
              <td width="92" style="${td};color:#1a1a1a;white-space:nowrap">${formatDate(i.firstRaisedOn)}<br><span style="${F};font-size:12px;line-height:16px;color:#667085">Reminder #${i.reminderNo}</span></td>
            </tr>`).join('');
    const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f2f4f7" style="background-color:#f2f4f7;border-collapse:collapse">
  <tr><td align="center" style="padding:16px 4px">
    <table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:680px;background-color:#ffffff;border-collapse:collapse;border:1px solid #e4e7ec">
      <tr><td bgcolor="${accent}" style="background-color:${accent};height:4px;line-height:4px;font-size:4px">&nbsp;</td></tr>
      <tr><td style="padding:16px 16px 6px 16px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
          <tr>
            ${logoUrl ? `<td width="140" valign="middle" style="padding-right:12px"><img src="${esc(logoUrl)}" alt="VTech Technologies" width="120" style="display:block;border:0;outline:none;width:120px;height:auto"></td>` : ''}
            <td valign="middle" style="${F};font-size:12px;line-height:16px;color:#667085">VTech Technologies · Site dependency report</td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:6px 16px 0 16px;${F};font-size:20px;line-height:26px;font-weight:bold;color:#101828">${esc(project.name)}</td></tr>
      <tr><td style="padding:2px 16px 14px 16px;${F};font-size:13px;line-height:18px;color:#475467">${category ? `${esc(category)} · ` : ''}${esc(agency.typeName)} · ${esc(agency.companyName)}<br>${withLevels.length} pending item${plural} · ${followUp || category ? 'status as of' : 'site visit'} ${formatDate(visitDate)}</td></tr>
      <tr><td style="padding:0 16px 12px 16px;${F};font-size:14px;line-height:20px;color:#1a1a1a">
        <p style="margin:0 0 10px 0">Dear ${esc(greeting)},</p>
        <p style="margin:0 0 10px 0">${internal ? 'Hope you are doing well.' : `Greetings from VTech Technologies, and thank you for your continued support on <b>${esc(project.name)}</b>.`}</p>
        <p style="margin:0">${esc(intro + closingAsk)}</p>
      </td></tr>
      <tr><td style="padding:0 10px 8px 10px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
          <thead><tr bgcolor="#f9fafb" style="background-color:#f9fafb">
            <th style="${th}">#</th><th style="${th}">Location</th><th style="${th}">Pending item</th>
            <th style="${th};white-space:nowrap">First raised</th></tr></thead>
          <tbody>${rows}
          </tbody>
        </table>
      </td></tr>
      <tr><td style="padding:12px 16px 0 16px;${F};font-size:12px;line-height:17px;color:#344054;white-space:pre-line">${esc(terms)}</td></tr>
      <tr><td style="padding:14px 16px 0 16px;${F};font-size:14px;line-height:20px;color:#1a1a1a">${esc(thanks)}</td></tr>
      <tr><td style="padding:16px 16px 22px 16px;${F};font-size:14px;line-height:20px;color:#1a1a1a">Warm regards,<br><b>${esc(pm.name)}</b><br>VTech Technologies${pm.phone ? ` | ${esc(pm.phone)}` : ''}</td></tr>
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
  const wr = { to: agency.contacts.filter((c) => usable(c, 'whatsapp')) };
  if (!wr.to.length) {
    warnings.push(`No WhatsApp number for ${agency.companyName}; WhatsApp skipped.`);
  } else {
    const head =
      `Hello ${wr.to.map((c) => shortName(c.name)).join(', ')}, greetings from VTech.\n` +
      `*${project.name}*\n` +
      (category
        ? `${category}, status as of ${formatDate(visitDate)}: ${withLevels.length} pending item${plural}.\n\n`
        : `${followUp ? 'Status as of' : 'Site visit'} ${formatDate(visitDate)}: ${withLevels.length} pending ${agency.typeName.toLowerCase()} item${plural} (${agency.companyName}).\n\n`);
    const foot = internal
      ? `\n\nPlease close these at the earliest and update ${pm.name}.\n– ${pm.name}, VTech`
      : `\n\nWe would be grateful if you could take these up at your earliest convenience. Once they are done, VTech needs 2–4 days to finish the automation work. If anything is already done, just reply here. Thank you!\n– ${pm.name}, VTech`;
    let body = '';
    let shown = 0;
    for (const [n, i] of withLevels.entries()) {
      const line = `${n + 1}. ${location(i)}: ${i.text}${ownerTag(i)} (since ${formatDate(i.firstRaisedOn)}, reminder #${i.reminderNo})\n`;
      if (head.length + body.length + line.length + foot.length > WHATSAPP_MAX) break;
      body += line;
      shown++;
    }
    if (shown < withLevels.length) {
      body += `...and ${withLevels.length - shown} more - full list sent by email.\n`;
      warnings.push(`WhatsApp message truncated to ${shown} of ${withLevels.length} items.`);
    }
    whatsapp = { to: wr.to.map((c) => ({ name: c.name, phone: c.phone! })), text: head + body.trimEnd() + foot };
  }

  return {
    items: withLevels.map((i) => ({ itemId: i.itemId, reminderNo: i.reminderNo })),
    email,
    whatsapp,
    warnings,
  };
}
