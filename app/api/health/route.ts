// Liveness check for the Zo service and the GitHub monitor. Public, no data, no secrets.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ ok: true, sha: process.env.GIT_SHA ?? 'unknown' });
}
