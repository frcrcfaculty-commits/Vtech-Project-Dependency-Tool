// Email delivery. Modes (env EMAIL_MODE):
//   compose_link (default until Workspace access) — returns a Gmail compose URL; PM sends from their own
//                 @vtechpl.com account, then confirms in-app. Plain-text body (Gmail compose can't take HTML).
//   gmail_api    — sends AS the PM via a Google Workspace service account with domain-wide delegation
//                 (scope gmail.send). Message lands in the PM's own Sent folder; replies come to the PM.
//   dryrun       — logs and pretends to send. Staging only.

import { JWT } from 'google-auth-library';
import type { Person } from '../report';

export interface OutgoingEmail {
  from: Person & { email: string };
  to: Person[];
  cc: Person[];
  subject: string;
  text: string;
  html: string;
}

const addr = (p: Person) => (p.name ? `"${p.name.replace(/"/g, '')}" <${p.email}>` : `${p.email}`);
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

export function buildMime(m: OutgoingEmail): string {
  const boundary = `b_${Math.random().toString(36).slice(2)}`;
  const lines = [
    `From: ${addr(m.from)}`,
    `To: ${m.to.map(addr).join(', ')}`,
    ...(m.cc.length ? [`Cc: ${m.cc.map(addr).join(', ')}`] : []),
    `Subject: ${encodeHeader(m.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(m.text, 'utf8').toString('base64'),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(m.html, 'utf8').toString('base64'),
    `--${boundary}--`,
  ];
  return lines.join('\r\n');
}

export function gmailComposeUrl(m: OutgoingEmail): string {
  const q = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: m.to.map((p) => p.email).join(','),
    cc: m.cc.map((p) => p.email).join(','),
    su: m.subject,
    body: m.text,
    authuser: m.from.email,
  });
  return `https://mail.google.com/mail/?${q.toString()}`;
}

export async function sendViaGmailApi(m: OutgoingEmail, serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson) as { client_email: string; private_key: string };
  const jwt = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    subject: m.from.email, // impersonate the PM (requires domain-wide delegation in Workspace admin)
  });
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error('Could not obtain Gmail access token');
  const raw = Buffer.from(buildMime(m), 'utf8').toString('base64url');
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  const json = (await res.json()) as { id?: string; error?: { message: string } };
  if (!res.ok || !json.id) throw new Error(json.error?.message ?? `Gmail API ${res.status}`);
  return json.id;
}
