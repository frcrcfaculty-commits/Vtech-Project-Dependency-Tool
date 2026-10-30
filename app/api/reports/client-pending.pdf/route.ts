// GET /api/reports/client-pending.pdf?project=<id, optional> — "Waiting on client": steps that wait on the Client agency
// (item_gate.waits_on_client), pending or unchecked-and-unlocked, plus legacy pending items whose agency type is Client.
// Grouped project → room → product. Runs as the signed-in user, so RLS decides what is visible.
import { handle, HttpError, requireUser } from '@/lib/auth';
import { buildClientPendingPdf, type ClientItem, type ClientProject } from '@/lib/pdf/clientPendingReport';
import { loadPdfFonts } from '@/lib/pdf/fonts';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = <T,>(x: unknown): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null)) as T | null;
const chunks = <T,>(a: T[], n = 200) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

type Gate = { item_id: string; project_id: string; room_product_id: string; status: string; phase: number; seq: number; label: string; title: string; location: string | null };
type Item = { id: string; project_id: string; room_product_id: string | null; first_raised_on: string | null; completed_on: string | null; note: string | null;
  rooms: unknown; project_dependencies: unknown };

export async function GET(req: Request) {
  return handle(async () => {
    const only = new URL(req.url).searchParams.get('project');
    if (only && !UUID.test(only)) throw new HttpError(400, 'Bad project id');
    const { db } = await requireUser();

    let pq = db.from('projects').select('id, name, client_name, status').order('name');
    pq = only ? pq.eq('id', only) : pq.neq('status', 'closed');
    const { data: projects, error: pErr } = await pq;
    if (pErr) throw pErr;
    if (only && !projects?.length) throw new HttpError(404, 'Project not found');
    const ids = (projects ?? []).map((p) => p.id);

    // 1. Product steps waiting on the client: pending, or unchecked and already unlocked.
    const gates: Gate[] = [];
    for (const part of chunks(ids)) {
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from('item_gate')
          .select('item_id, project_id, room_product_id, status, phase, seq, label, title, location')
          .in('project_id', part).eq('waits_on_client', true)
          .or('status.eq.pending,and(status.eq.unchecked,locked.eq.false)')
          .order('item_id').range(from, from + 999);
        if (error) throw error;
        gates.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
    }

    // 2. Legacy (non-product) pending items whose agency — or, if unassigned, whose dependency — is of type Client.
    const { data: clientType, error: tErr } = await db.from('agency_types').select('id').eq('name', 'Client').maybeSingle();
    if (tErr) throw tErr;
    const sel = 'id, project_id, room_product_id, first_raised_on, completed_on, note, rooms(name, sort, floors(label, sort)), project_dependencies(text, seq)';
    const items = new Map<string, Item>();
    const add = (rows: Item[] | null) => rows?.forEach((r) => items.set(r.id, r));
    for (const part of chunks(gates.map((g) => g.item_id))) {
      const { data, error } = await db.from('dependency_items').select(sel).in('id', part);
      if (error) throw error;
      add(data as Item[]);
    }
    if (clientType && ids.length) {
      for (const part of chunks(ids)) {
        const a = await db.from('dependency_items').select(`${sel}, agencies!inner(agency_type_id)`)
          .in('project_id', part).is('room_product_id', null).eq('status', 'pending').eq('agencies.agency_type_id', clientType.id);
        if (a.error) throw a.error;
        add(a.data as unknown as Item[]);
        const u = await db.from('dependency_items').select(`${sel.replace('project_dependencies(text, seq)', 'project_dependencies!inner(text, seq, agency_type_id)')}`)
          .in('project_id', part).is('room_product_id', null).is('agency_id', null).eq('status', 'pending')
          .eq('project_dependencies.agency_type_id', clientType.id);
        if (u.error) throw u.error;
        add(u.data as unknown as Item[]);
      }
    }

    // "Ready" steps have no raised date; "since" = when they unlocked. A green (phase 1) step, or a product without greens,
    // is open from the moment the product is placed; any other step opens when the product's last green closed.
    const readyRps = [...new Set(gates.filter((g) => g.status === 'unchecked').map((g) => g.room_product_id))];
    const placedOn = new Map<string, string>();
    const lastGreenOn = new Map<string, string>();
    for (const part of chunks(readyRps)) {
      const rp = await db.from('room_products').select('id, created_at').in('id', part);
      if (rp.error) throw rp.error;
      for (const r of rp.data ?? []) placedOn.set(r.id, new Date(new Date(r.created_at).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10));
      const gr = await db.from('item_gate').select('item_id, room_product_id').in('room_product_id', part).eq('phase', 1);
      if (gr.error) throw gr.error;
      const greenIds = (gr.data ?? []).map((g) => g.item_id);
      for (const ip of chunks(greenIds)) {
        const { data, error } = await db.from('dependency_items').select('room_product_id, completed_on').in('id', ip).not('completed_on', 'is', null);
        if (error) throw error;
        for (const r of data ?? []) {
          const cur = lastGreenOn.get(r.room_product_id!);
          if (!cur || r.completed_on! > cur) lastGreenOn.set(r.room_product_id!, r.completed_on!);
        }
      }
    }
    const unlockedOn = (g: Gate) => (g.phase === 1 ? null : lastGreenOn.get(g.room_product_id)) ?? placedOn.get(g.room_product_id) ?? null;

    const gateById = new Map(gates.map((g) => [g.item_id, g]));
    const byProject = new Map<string, ClientProject>((projects ?? []).map((p) => [p.id, { name: p.name, clientName: p.client_name, items: [] }]));
    for (const i of items.values()) {
      const room = one<{ name: string; sort: number; floors: unknown }>(i.rooms);
      const floor = one<{ label: string; sort: number }>(room?.floors);
      const dep = one<{ text: string; seq: number }>(i.project_dependencies);
      const g = gateById.get(i.id);
      const ready = g?.status === 'unchecked';
      const row: ClientItem = {
        floorLabel: floor?.label ?? '', floorSort: floor?.sort ?? 0, roomName: room?.name ?? '', roomSort: room?.sort ?? 0,
        product: g ? `${g.title}${g.location ? ` (${g.location})` : ''}` : null,
        seq: g?.seq ?? dep?.seq ?? 0, step: g?.label ?? dep?.text ?? '',
        state: ready ? 'ready' : 'pending',
        since: ready ? unlockedOn(g!) : i.first_raised_on,
        note: i.note,
      };
      byProject.get(i.project_id)?.items.push(row);
    }

    const generatedOn = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const list = [...byProject.values()].sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
    const pdf = await buildClientPendingPdf({ generatedOn, projects: list }, await loadPdfFonts());
    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="VTech_waiting_on_client_${generatedOn}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
}
