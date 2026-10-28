import { buildDigest, loadDigestRows } from '@/lib/digest';
import { sendViaGmailApi } from '@/lib/channels/email';
import { env } from '@/lib/env';

// Vercel Cron (see vercel.json): Mondays 08:00 IST. Vercel sends "Authorization: Bearer $CRON_SECRET".
export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${env.cronSecret()}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const asOf = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const rows = await loadDigestRows(env.cronSecret());
  const digest = buildDigest(rows.projects, rows.items, asOf);
  const to = rows.recipients;

  if (env.emailMode() !== 'gmail_api' || !to.length) {
    console.log('[weekly-digest] not emailed (mode or no recipients)\n' + digest.text);
    return Response.json({ emailed: false, subject: digest.subject, projects: digest.sections.length });
  }
  const id = await sendViaGmailApi(
    { from: { name: 'VTech Tracker', email: env.digestSender() }, to, cc: [], subject: digest.subject, text: digest.text, html: digest.html },
    env.googleServiceAccountJson(),
  );
  return Response.json({ emailed: true, id, recipients: to.length });
}
