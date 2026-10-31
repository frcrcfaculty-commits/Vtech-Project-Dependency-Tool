'use client';

// Top-right notifications (v4 items 8 and 11). Nothing is blocked; these only ask the PM to check by hand:
//  • a BOQ location that is not one of the usual locations for that product in the Hansal sheet → "Location is right" / fix it;
//  • a BOQ product that is not in the Hansal sheet and has no dependencies yet → add them by hand.
// The rule lives in the database view location_checks; this only lists what it reports for open projects.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/client/supabase';
import { GlassIcon, Glyph } from '@/components/glass-icon';

interface Notice {
  id: string; // room_product id
  kind: 'mismatch' | 'not_in_catalogue';
  projectId: string;
  projectName: string;
  title: string;
  location: string | null;
  usual: string[];
  where: string;
}

export const DASHBOARD_CHANGED = 'vtech:dashboard-changed';

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const { data: checks } = await sb
      .from('location_checks')
      .select('room_product_id, project_id, location, title, location_options, location_validated_at, check_result')
      .in('check_result', ['mismatch', 'not_in_catalogue']);
    const rows = (checks ?? []) as { room_product_id: string; project_id: string; location: string | null; title: string | null; location_options: string[] | null; location_validated_at: string | null; check_result: string }[];
    if (!rows.length) { setItems([]); return; }
    const ids = rows.map((r) => r.room_product_id);
    const [{ data: rps }, { data: projects }, { data: withSteps }] = await Promise.all([
      sb.from('room_products').select('id, boq_title, rooms(name, floors(label))').in('id', ids),
      sb.from('projects').select('id, name, status').in('id', [...new Set(rows.map((r) => r.project_id))]),
      sb.from('dependency_items').select('room_product_id').in('room_product_id', ids),
    ]);
    const hasSteps = new Set((withSteps ?? []).map((x: { room_product_id: string }) => x.room_product_id));
    type RpRow = { id: string; boq_title: string | null; rooms: { name: string; floors: { label: string } | null } | null };
    const open = new Map<string, string>((projects ?? []).filter((p: { status: string }) => p.status === 'active' || p.status === 'on_hold').map((p: { id: string; name: string }) => [p.id, p.name]));
    const rp = new Map<string, RpRow>(((rps ?? []) as unknown as RpRow[]).map((r) => [r.id, r]));
    const list: Notice[] = [];
    for (const r of rows) {
      if (!open.has(r.project_id)) continue;
      if (r.check_result === 'mismatch' && r.location_validated_at) continue;
      if (r.check_result === 'not_in_catalogue' && hasSteps.has(r.room_product_id)) continue;
      const x = rp.get(r.room_product_id);
      list.push({
        id: r.room_product_id,
        kind: r.check_result as Notice['kind'],
        projectId: r.project_id,
        projectName: open.get(r.project_id)!,
        title: r.title ?? x?.boq_title ?? 'Product',
        location: r.location,
        usual: r.location_options ?? [],
        where: x?.rooms ? `${x.rooms.floors?.label ?? ''} · ${x.rooms.name}` : '',
      });
    }
    setItems(list);
  }, []);

  useEffect(() => {
    load();
    const h = () => load();
    window.addEventListener(DASHBOARD_CHANGED, h);
    return () => window.removeEventListener(DASHBOARD_CHANGED, h);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  async function confirmLocation(id: string) {
    setBusy(id);
    const sb = supabaseBrowser();
    const { data: u } = await sb.auth.getUser();
    await sb.from('room_products').update({ location_validated_at: new Date().toISOString(), location_validated_by: u.user?.id }).eq('id', id);
    setBusy(null);
    await load();
    window.dispatchEvent(new Event(DASHBOARD_CHANGED));
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={`Notifications${items.length ? ` (${items.length})` : ''}`}
        className="relative rounded-xl p-0.5 transition hover:scale-105"
      >
        <GlassIcon name="bell" size={32} tint={items.length ? 'brand' : 'clear'} />
        {items.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {items.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[min(92vw,380px)] rounded-2xl border border-border bg-surface p-3 shadow-xl">
          <p className="px-1 text-sm font-semibold">Please check</p>
          {items.length === 0 ? (
            <p className="px-1 py-3 text-sm text-text-secondary">Nothing to check. BOQ locations match VTech’s usual locations.</p>
          ) : (
            <ul className="mt-2 max-h-[60vh] space-y-2 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id} className="rounded-xl border border-border p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <span className={n.kind === 'mismatch' ? 'text-warning' : 'text-danger'}><Glyph name="alert" /></span>
                    <div className="min-w-0">
                      <p className="font-medium">{n.title} <span className="font-normal text-text-secondary">· {n.projectName}</span></p>
                      <p className="text-xs text-text-secondary">{n.where}</p>
                      {n.kind === 'mismatch' ? (
                        <p className="mt-1 text-xs">BOQ location <strong>“{n.location}”</strong> is not a usual one ({n.usual.join(', ')}). Please confirm it.</p>
                      ) : (
                        <p className="mt-1 text-xs">Not in VTech’s product list — add its dependencies by hand.</p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {n.kind === 'mismatch' ? (
                          <>
                            <button type="button" disabled={busy === n.id} onClick={() => confirmLocation(n.id)} className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">Location is right</button>
                            <Link href={`/hub?p=${n.projectId}&edit=1`} onClick={() => setOpen(false)} className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium">Change it</Link>
                          </>
                        ) : (
                          <Link href={`/hub?p=${n.projectId}&steps=${n.id}`} onClick={() => setOpen(false)} className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-white">Add dependencies</Link>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
