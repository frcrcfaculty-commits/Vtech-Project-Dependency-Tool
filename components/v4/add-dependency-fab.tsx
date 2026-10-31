'use client';

// The floating "+ Add dependency" button (v4 item 14), on every page.
//  • Add a product to a room — any name: a product in VTech's list brings its own dependency chain from the sheet;
//    any other BOQ name is kept as typed and its dependencies are added by hand.
//  • Add a dependency to a product already in a room — it follows the same rule as the sheet's steps
//    (before installation = green, open with the other greens; otherwise one at a time) and can be marked not done now.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/client/supabase';
import { GlassIcon, Glyph } from '@/components/glass-icon';
import { useEscape } from '@/lib/client/use-escape';
import { DASHBOARD_CHANGED } from './notifications-bell';

interface Project { id: string; name: string }
interface Room { id: string; name: string; floor: string; sort: number }
interface Catalogue { id: string; title: string; scope: string; location_options: string[] }
interface Line { id: string; room_id: string; title: string; location: string | null }
interface Agency { id: string; label: string; internal: boolean }

export function AddDependencyFab() {
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'product' | 'step'>('product');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState('');
  const [catalogue, setCatalogue] = useState<Catalogue[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // product tab
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [qty, setQty] = useState(1);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  // step tab
  const [lineId, setLineId] = useState('');
  const [label, setLabel] = useState('');
  const [phase, setPhase] = useState<1 | 2>(1);
  const [owner, setOwner] = useState<'external' | 'internal'>('external');
  const [agencyId, setAgencyId] = useState('');
  const [notDoneNow, setNotDoneNow] = useState(true);
  const [reason, setReason] = useState('');

  useEscape(() => setOpen(false), saving);

  const hidden = pathname.startsWith('/login');

  const openModal = useCallback(async () => {
    setOpen(true); setError(null);
    const sb = supabaseBrowser();
    const [{ data: ps }, { data: cat }] = await Promise.all([
      sb.from('projects').select('id, name').in('status', ['active', 'on_hold']).order('name'),
      sb.from('product_catalogue').select('id, title, scope, location_options').eq('active', true).order('sort'),
    ]);
    setProjects((ps ?? []) as Project[]);
    setCatalogue((cat ?? []) as Catalogue[]);
    const fromUrl = params.get('p') ?? pathname.match(/\/projects\/([0-9a-f-]{36})/i)?.[1] ?? '';
    setProjectId((cur) => cur || fromUrl || (ps?.[0]?.id ?? ''));
  }, [params, pathname]);

  useEffect(() => {
    if (!open || !projectId) return;
    const sb = supabaseBrowser();
    Promise.all([
      sb.from('rooms').select('id, name, sort, floors(label, sort)').eq('project_id', projectId),
      sb.from('room_products').select('id, room_id, location, boq_title, product_catalogue(title)').eq('project_id', projectId),
      sb.from('agencies').select('id, company_name, agency_types(name, internal)').eq('project_id', projectId),
    ]).then(([r, l, a]) => {
      type R = { id: string; name: string; sort: number; floors: { label: string; sort: number } | null };
      const rs = ((r.data ?? []) as unknown as R[])
        .sort((x, y) => (x.floors?.sort ?? 0) - (y.floors?.sort ?? 0) || x.sort - y.sort)
        .map((x) => ({ id: x.id, name: x.name, floor: x.floors?.label ?? '', sort: x.sort }));
      setRooms(rs);
      setRoomId((cur) => (rs.some((x) => x.id === cur) ? cur : rs[0]?.id ?? ''));
      type L = { id: string; room_id: string; location: string | null; boq_title: string | null; product_catalogue: { title: string } | null };
      setLines(((l.data ?? []) as unknown as L[]).map((x) => ({ id: x.id, room_id: x.room_id, location: x.location, title: x.product_catalogue?.title ?? x.boq_title ?? 'Product' })));
      type A = { id: string; company_name: string; agency_types: { name: string; internal: boolean } | null };
      setAgencies(((a.data ?? []) as unknown as A[]).map((x) => ({ id: x.id, label: `${x.agency_types?.name ?? 'Agency'} – ${x.company_name}`, internal: !!x.agency_types?.internal })));
    });
  }, [open, projectId]);

  const roomLines = useMemo(() => lines.filter((l) => l.room_id === roomId), [lines, roomId]);
  useEffect(() => { setLineId((cur) => (roomLines.some((l) => l.id === cur) ? cur : roomLines[0]?.id ?? '')); }, [roomLines]);
  const match = catalogue.find((c) => c.title.toLowerCase() === title.trim().toLowerCase());

  function done(msg: string) {
    setOpen(false);
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
    window.dispatchEvent(new Event('vtech:dependency-added'));
    window.dispatchEvent(new Event(DASHBOARD_CHANGED));
  }

  async function addProduct() {
    setError(null);
    if (!roomId || !title.trim()) { setError('Pick a room and type the product name.'); return; }
    setSaving(true);
    const { error: e } = await supabaseBrowser().rpc('add_boq_line', {
      p_project: projectId, p_room: match?.scope === 'project' ? null : roomId, p_title: title.trim(), p_location: location.trim() || null,
      p_quantity: Math.max(1, qty || 1), p_brand: brand.trim() || null, p_make: null, p_model: model.trim() || null,
    });
    setSaving(false);
    if (e) { setError(e.message); return; }
    setTitle(''); setLocation(''); setQty(1); setBrand(''); setModel('');
    done(match ? `${match.title} added with its dependencies from the sheet.` : `“${title.trim()}” added. It is not in VTech’s list: add its dependencies from the Dashboard.`);
  }

  async function addStep() {
    setError(null);
    if (!lineId || !label.trim()) { setError('Pick the product and type the dependency.'); return; }
    if (notDoneNow && !reason.trim()) { setError('Say why it is not done, or untick “Not done now”.'); return; }
    setSaving(true);
    const sb = supabaseBrowser();
    const { data: itemId, error: e } = await sb.rpc('add_custom_step', {
      p_room_product: lineId, p_label: label.trim(), p_phase: phase, p_responsibility: owner, p_agency: agencyId || null,
    });
    let warn = '';
    if (!e && notDoneNow && itemId) {
      const { error: e2 } = await sb.rpc('set_item_status', { p_item: itemId, p_status: 'pending', p_reason: reason.trim() });
      if (e2) warn = e2.message.startsWith('locked') ? ' It opens after the earlier steps, so it was saved as not started.' : ` (${e2.message})`;
    }
    setSaving(false);
    if (e) { setError(e.message); return; }
    setLabel(''); setReason('');
    done(`Dependency added.${warn}`);
  }

  if (hidden) return null;
  const input = 'mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm font-normal normal-case tracking-normal';
  const lab = 'block text-xs font-semibold uppercase tracking-wider text-text-secondary';

  return (
    <>
      <button
        type="button"
        aria-label="Add dependency"
        onClick={openModal}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-accent py-2 pl-2 pr-4 text-sm font-semibold text-white shadow-xl transition hover:scale-105 active:scale-95"
      >
        <GlassIcon name="plus" size={30} tint="clear" />
        <span className="hidden sm:inline">Add dependency</span>
      </button>

      {toast && (
        <div role="status" className="fixed bottom-20 right-6 z-50 max-w-sm rounded-xl border border-success/30 bg-success-light px-4 py-2.5 text-sm font-medium text-success shadow-lg">✓ {toast}</div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:px-4" onClick={() => !saving && setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="add-dep-title" className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 id="add-dep-title" className="text-lg font-semibold">Add</h2>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-alt"><Glyph name="cross" /></button>
            </div>
            <div role="tablist" className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-surface-alt p-1 text-sm">
              {([['product', 'Product to a room'], ['step', 'Dependency to a product']] as const).map(([k, t]) => (
                <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => { setTab(k); setError(null); }}
                  className={`rounded-lg px-3 py-2 font-medium ${tab === k ? 'bg-surface text-accent shadow-sm' : 'text-text-secondary'}`}>{t}</button>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={lab}>Project
                <select className={input} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className={lab}>Room
                <select className={input} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                  {rooms.length === 0 && <option value="">No rooms yet</option>}
                  {rooms.map((r) => <option key={r.id} value={r.id}>{r.floor ? `${r.floor} · ` : ''}{r.name}</option>)}
                </select>
              </label>
            </div>

            {tab === 'product' ? (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className={`${lab} sm:col-span-2`}>Product (as in the BOQ)
                  <input className={input} list="v4-catalogue" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Keypad" />
                  <datalist id="v4-catalogue">{catalogue.map((c) => <option key={c.id} value={c.title} />)}</datalist>
                  <span className="mt-1 block text-[11px] font-normal normal-case tracking-normal text-text-muted">
                    {title.trim() ? (match ? `In VTech’s list: its ${match.scope === 'project' ? 'project-wide ' : ''}dependencies come from the sheet.` : 'Not in VTech’s list: you will add its dependencies by hand.') : 'Pick from VTech’s list or type any BOQ name.'}
                  </span>
                </label>
                <label className={lab}>Location
                  <input className={input} list="v4-locations" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={match?.location_options?.[0] ?? 'e.g. Ceiling'} />
                  <datalist id="v4-locations">{(match?.location_options ?? []).map((o) => <option key={o} value={o} />)}</datalist>
                </label>
                <label className={lab}>Quantity<input type="number" min={1} className={input} value={qty} onChange={(e) => setQty(Number(e.target.value))} /></label>
                <label className={lab}>Brand / make<input className={input} value={brand} onChange={(e) => setBrand(e.target.value)} /></label>
                <label className={lab}>Model<input className={input} value={model} onChange={(e) => setModel(e.target.value)} /></label>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className={`${lab} sm:col-span-2`}>Product in this room
                  <select className={input} value={lineId} onChange={(e) => setLineId(e.target.value)}>
                    {roomLines.length === 0 && <option value="">No products in this room yet</option>}
                    {roomLines.map((l) => <option key={l.id} value={l.id}>{l.title}{l.location ? ` · ${l.location}` : ''}</option>)}
                  </select>
                </label>
                <label className={`${lab} sm:col-span-2`}>Dependency<input className={input} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. False ceiling opening for speaker" /></label>
                <label className={lab}>Stage
                  <select className={input} value={phase} onChange={(e) => setPhase(Number(e.target.value) as 1 | 2)}>
                    <option value={1}>Before installation (green)</option>
                    <option value={2}>Installation &amp; after</option>
                  </select>
                </label>
                <label className={lab}>Waiting on
                  <select className={input} value={`${owner}:${agencyId}`} onChange={(e) => { const [o, a] = e.target.value.split(':'); setOwner(o as 'external' | 'internal'); setAgencyId(a); }}>
                    <option value="external:">Another agency (assign later)</option>
                    {agencies.filter((a) => !a.internal).map((a) => <option key={a.id} value={`external:${a.id}`}>{a.label}</option>)}
                    <option value="internal:">VTech team (assign later)</option>
                    {agencies.filter((a) => a.internal).map((a) => <option key={a.id} value={`internal:${a.id}`}>{a.label}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={notDoneNow} onChange={(e) => setNotDoneNow(e.target.checked)} /> Not done now (raised today)</label>
                {notDoneNow && <label className={`${lab} sm:col-span-2`}>Why is it not done?<input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Work pending from electrician" /></label>}
              </div>
            )}

            {error && <div role="alert" className="mt-3 rounded-lg bg-danger-light px-3 py-2 text-sm text-danger">{error}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={saving} className="rounded-lg border border-border px-4 py-2.5 text-sm">Cancel</button>
              <button type="button" onClick={tab === 'product' ? addProduct : addStep} disabled={saving || !projectId} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {saving ? 'Saving…' : tab === 'product' ? 'Add product' : 'Add dependency'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
