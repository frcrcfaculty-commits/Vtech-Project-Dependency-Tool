'use client';

// VTech Dashboard (v4). Project tiles on top; the selected project opens below with its filters, actions and a
// matrix of every BOQ line (Product · Location · Agency involved · Quantity · Status). Status shows the line's
// dependencies as ✓/✗ checkboxes in the sheet's colours: all green steps first, then one step at a time.
// Lock state comes only from the database view item_gate (see migration 0009).

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/client/supabase';
import { useAuth } from '@/components/auth-provider';
import { AppHeader } from '@/components/app-header';
import { DeleteProjectButton } from '@/components/delete-project-button';
import { GlassIcon, Glyph } from '@/components/glass-icon';
import { StepDialog, type AgencyOption } from '@/components/v4/step-dialog';
import { EditProjectDialog } from '@/components/v4/edit-project-dialog';
import { CustomStepsDialog } from '@/components/v4/custom-steps-dialog';
import { DASHBOARD_CHANGED } from '@/components/v4/notifications-bell';
import { isEscalated } from '@/lib/client/escalation';
import { LEGEND_ORDER, STEP_COLOURS, isDone, lineStatus, stepColour, triggerText, type GateRow } from '@/lib/client/steps';

type ProjectStatus = 'active' | 'on_hold' | 'closed' | 'finished';
interface ProjectTile {
  id: string; name: string; client_name: string | null; site_address: string | null; status: ProjectStatus;
  l2_after: number; l3_after: number; pending: number; escalated: number; done: number; total: number;
}
interface Floor { id: string; label: string; sort: number }
interface Room { id: string; floor_id: string; name: string; sort: number }
interface Agency { id: string; company_name: string; agency_types: { name: string; internal: boolean } | null }
interface Line {
  id: string; room_id: string; product_id: string | null; boq_title: string | null; location: string | null; quantity: number;
  brand: string | null; make: string | null; model: string | null; product_catalogue: { title: string; scope: string } | null;
}
type SortBy = 'room' | 'floor' | 'product';
type StatusFilter = 'all' | 'open' | 'stuck' | 'escalated' | 'done';

const STATUS_BADGE: Record<ProjectStatus, string> = { active: 'Active', on_hold: 'On hold', closed: 'Closed', finished: 'Finished' };

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center"><Spinner /></div>}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const { profile } = useAuth();

  const [projects, setProjects] = useState<ProjectTile[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [floors, setFloors] = useState<Floor[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [gate, setGate] = useState<GateRow[]>([]);
  const [progress, setProgress] = useState({ installation: 0, programming: 0 });
  const [detailLoading, setDetailLoading] = useState(false);

  const [sortBy, setSortBy] = useState<SortBy>('room');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [agencyFilter, setAgencyFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showAllSteps, setShowAllSteps] = useState(false);

  const [stepRow, setStepRow] = useState<GateRow | null>(null);
  const [customFor, setCustomFor] = useState<Line | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(null), 3500); };

  // ── projects ──
  const loadProjects = useCallback(async () => {
    setError(null);
    const sb = supabaseBrowser();
    const [{ data: ps, error: pErr }, { data: its, error: iErr }] = await Promise.all([
      sb.from('projects').select('id, name, client_name, site_address, status, l2_after, l3_after').order('name'),
      sb.from('dependency_items').select('project_id, status, reminder_count'),
    ]);
    if (pErr || iErr) { setError((pErr ?? iErr)!.message); setLoading(false); return; }
    const stats = new Map<string, { pending: number; escalated: number; done: number; total: number }>();
    const thresholds = new Map<string, number>((ps ?? []).map((p: { id: string; l2_after: number | null }) => [p.id, p.l2_after ?? 3]));
    for (const i of (its ?? []) as { project_id: string; status: string; reminder_count: number }[]) {
      const s = stats.get(i.project_id) ?? { pending: 0, escalated: 0, done: 0, total: 0 };
      s.total++;
      if (i.status === 'pending') { s.pending++; if (isEscalated(i.reminder_count, thresholds.get(i.project_id))) s.escalated++; }
      if (i.status === 'complete' || i.status === 'na') s.done++;
      stats.set(i.project_id, s);
    }
    const tiles: ProjectTile[] = (ps ?? []).map((p: { id: string; name: string; client_name: string | null; site_address: string | null; status: string; l2_after: number | null; l3_after: number | null }) => ({
      id: p.id, name: p.name, client_name: p.client_name, site_address: p.site_address, status: (p.status ?? 'active') as ProjectStatus,
      l2_after: p.l2_after ?? 3, l3_after: p.l3_after ?? 6, ...(stats.get(p.id) ?? { pending: 0, escalated: 0, done: 0, total: 0 }),
    }));
    tiles.sort((a, b) => b.escalated - a.escalated || b.pending - a.pending || a.name.localeCompare(b.name));
    setProjects(tiles);
    setLoading(false);
    return tiles;
  }, []);

  useEffect(() => {
    loadProjects().then((tiles) => {
      if (!tiles) return;
      const q = params.get('p');
      const chosen = (q && tiles.find((t) => t.id === q)) || tiles.find((t) => t.status === 'active' || t.status === 'on_hold') || tiles[0];
      if (chosen) {
        setSelectedId(chosen.id);
        if (chosen.status === 'closed' || chosen.status === 'finished') setShowArchived(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── selected project ──
  const loadDetails = useCallback(async (id: string) => {
    if (!id) return;
    setDetailLoading(true);
    const sb = supabaseBrowser();
    const [f, r, a, l, g, pr] = await Promise.all([
      sb.from('floors').select('id, label, sort').eq('project_id', id).order('sort'),
      sb.from('rooms').select('id, floor_id, name, sort').eq('project_id', id).order('sort'),
      sb.from('agencies').select('id, company_name, agency_types(name, internal)').eq('project_id', id),
      sb.from('room_products').select('id, room_id, product_id, boq_title, location, quantity, brand, make, model, product_catalogue(title, scope)').eq('project_id', id),
      sb.from('item_gate').select('*').eq('project_id', id).order('seq'),
      sb.from('project_progress').select('installation_pct, programming_pct').eq('project_id', id).maybeSingle(),
    ]);
    const err = [f, r, a, l, g, pr].find((x) => x.error)?.error;
    if (err) setError(err.message);
    setFloors((f.data ?? []) as Floor[]);
    setRooms((r.data ?? []) as Room[]);
    setAgencies((a.data ?? []) as unknown as Agency[]);
    setLines((l.data ?? []) as unknown as Line[]);
    setGate((g.data ?? []) as GateRow[]);
    setProgress({ installation: Number(pr.data?.installation_pct ?? 0), programming: Number(pr.data?.programming_pct ?? 0) });
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    loadDetails(selectedId);
    const url = new URL(window.location.href);
    if (url.searchParams.get('p') !== selectedId) {
      url.searchParams.set('p', selectedId);
      window.history.replaceState(null, '', url.toString());
    }
  }, [selectedId, loadDetails]);

  const refresh = useCallback(async () => {
    await Promise.all([loadDetails(selectedId), loadProjects()]);
    window.dispatchEvent(new Event(DASHBOARD_CHANGED));
  }, [selectedId, loadDetails, loadProjects]);

  useEffect(() => {
    const h = () => { loadDetails(selectedId); loadProjects(); };
    window.addEventListener('vtech:dependency-added', h);
    window.addEventListener(DASHBOARD_CHANGED, h);
    return () => { window.removeEventListener('vtech:dependency-added', h); window.removeEventListener(DASHBOARD_CHANGED, h); };
  }, [selectedId, loadDetails, loadProjects]);

  // Deep links from the notifications: ?steps=<line> opens "add dependencies", ?edit=1 opens edit.
  useEffect(() => {
    const stepsFor = params.get('steps');
    if (stepsFor && lines.length) {
      const l = lines.find((x) => x.id === stepsFor);
      if (l) setCustomFor(l);
    }
    if (params.get('edit') === '1' && lines.length) setEditing(true);
    if ((stepsFor || params.get('edit')) && lines.length) {
      const url = new URL(window.location.href);
      url.searchParams.delete('steps'); url.searchParams.delete('edit');
      window.history.replaceState(null, '', url.toString());
    }
  }, [params, lines]);

  const selected = projects.find((p) => p.id === selectedId);
  const visibleProjects = projects.filter((p) => showArchived || p.status === 'active' || p.status === 'on_hold');
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
  const floorById = useMemo(() => new Map(floors.map((f) => [f.id, f])), [floors]);
  const agencyById = useMemo(() => new Map(agencies.map((a) => [a.id, a])), [agencies]);
  const gateByLine = useMemo(() => {
    const m = new Map<string, GateRow[]>();
    for (const g of gate) { const a = m.get(g.room_product_id) ?? []; a.push(g); m.set(g.room_product_id, a); }
    return m;
  }, [gate]);
  const agencyOptions: AgencyOption[] = useMemo(
    () => agencies.map((a) => ({ id: a.id, label: `${a.agency_types?.name ?? 'Agency'} – ${a.company_name}`, internal: !!a.agency_types?.internal, typeName: a.agency_types?.name ?? '' }))
      .sort((x, y) => x.label.localeCompare(y.label)),
    [agencies]
  );

  const where = (roomId: string) => {
    const r = roomById.get(roomId); const f = r ? floorById.get(r.floor_id) : undefined;
    return [f?.label, r?.name].filter(Boolean).join(' · ');
  };
  const titleOf = (l: Line) => l.product_catalogue?.title ?? l.boq_title ?? 'Product';
  const agencyName = (id: string | null) => {
    const a = id ? agencyById.get(id) : undefined;
    return a ? a.company_name : null;
  };

  // ── matrix rows ──
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lines
      .map((l) => {
        const g = gateByLine.get(l.id) ?? [];
        const st = lineStatus(g);
        const shownSteps = showAllSteps ? [...g].sort((a, b) => a.seq - b.seq) : st.visible;
        const involved = [...new Set((st.visible.length ? st.visible : g.filter((x) => !isDone(x.status))).map((x) => agencyName(x.agency_id)).filter(Boolean))] as string[];
        return { line: l, gate: g, st, shownSteps, involved };
      })
      .filter(({ line, gate: g, st, involved }) => {
        if (q && !`${titleOf(line)} ${line.location ?? ''} ${where(line.room_id)} ${line.brand ?? ''} ${line.model ?? ''}`.toLowerCase().includes(q)) return false;
        if (agencyFilter !== 'all' && !g.some((x) => x.agency_id === agencyFilter && !isDone(x.status))) return false;
        if (statusFilter === 'done') return st.allDone;
        if (statusFilter === 'open') return !st.allDone;
        if (statusFilter === 'stuck') return st.visible.some((x) => x.status === 'pending');
        if (statusFilter === 'escalated') return g.some((x) => x.status === 'pending' && isEscalated(x.reminder_count, selected?.l2_after));
        void involved;
        return true;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, gateByLine, showAllSteps, search, agencyFilter, statusFilter, selected?.l2_after, roomById, floorById, agencyById]);

  const groups = useMemo(() => {
    const m = new Map<string, { key: string; label: string; sub?: string; order: number[]; rows: typeof rows }>();
    for (const r of rows) {
      const room = roomById.get(r.line.room_id); const floor = room ? floorById.get(room.floor_id) : undefined;
      const scope = r.line.product_catalogue?.scope;
      let key: string, label: string, sub: string | undefined, order: number[];
      if (sortBy === 'product') {
        key = titleOf(r.line).toLowerCase(); label = titleOf(r.line); order = [scope === 'project' ? 1 : 0, 0];
      } else if (sortBy === 'floor') {
        key = floor?.id ?? 'none'; label = floor?.label ?? 'No floor'; order = [floor?.sort ?? 9999, 0];
      } else {
        key = room?.id ?? 'none'; label = room?.name ?? 'No room'; sub = floor?.label; order = [floor?.sort ?? 9999, room?.sort ?? 0];
      }
      const gr = m.get(key) ?? { key, label, sub, order, rows: [] as typeof rows };
      gr.rows.push(r); m.set(key, gr);
    }
    const list = [...m.values()].sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.label.localeCompare(b.label));
    for (const g of list) {
      g.rows.sort((a, b) => sortBy === 'product'
        ? where(a.line.room_id).localeCompare(where(b.line.room_id))
        : titleOf(a.line).localeCompare(titleOf(b.line)) || (a.line.location ?? '').localeCompare(b.line.location ?? ''));
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortBy, roomById, floorById]);

  const totals = useMemo(() => {
    const open = gate.filter((g) => !isDone(g.status) && !g.locked);
    return {
      lines: lines.length,
      done: lines.filter((l) => lineStatus(gateByLine.get(l.id) ?? []).allDone).length,
      stuck: open.filter((g) => g.status === 'pending').length,
      chaseable: open.filter((g) => g.status === 'pending' && !g.waits_on_client).length,
      needsSteps: lines.filter((l) => !l.product_id && !(gateByLine.get(l.id)?.length)).length,
    };
  }, [gate, lines, gateByLine]);

  // ── actions ──
  async function sendReminders() {
    if (!selectedId) return;
    setBusy('remind'); setError(null);
    try {
      const res = await fetch(`/api/projects/${selectedId}/reminders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) throw new Error((await res.text()) || `Reminders failed (${res.status})`);
      const data = await res.json();
      if (data.visitId) router.push(`/projects/${selectedId}/visits/${data.visitId}/dispatches`);
      else flash(data.warnings?.length ? data.warnings.join(' ') : 'Nothing to chase right now: no step is marked not done.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Reminders failed'); } finally { setBusy(null); }
  }

  async function setProjectStatus(status: ProjectStatus) {
    if (!selected) return;
    if (status === 'closed' && !confirm(`Close "${selected.name}"? It leaves the active list but keeps all its records.`)) return;
    setBusy('status');
    const { error: e } = await supabaseBrowser().from('projects').update({ status }).eq('id', selected.id);
    setBusy(null);
    if (e) { setError(e.message); return; }
    flash(status === 'active' ? 'Project reopened.' : 'Project closed.');
    if (status === 'closed') setShowArchived(true);
    await loadProjects();
  }

  if (loading) return (<><AppHeader /><div className="flex min-h-[60dvh] items-center justify-center"><Spinner /></div></>);

  return (
    <div className="min-h-dvh pb-28">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
        {/* ── title + projects ── */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            <GlassIcon name="building" size={44} />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">VTech Dashboard</h1>
              <p className="text-sm text-text-secondary">{profile?.full_name ? `Hello, ${profile.full_name.split(' ')[0]}. ` : ''}Pick a project to see every product and what it is waiting on.</p>
            </div>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show closed &amp; finished
          </label>
        </div>

        {error && <div role="alert" className="mt-4 rounded-xl border border-danger/30 bg-danger-light px-4 py-3 text-sm text-danger">{error}</div>}
        {notice && <div role="status" className="mt-4 rounded-xl border border-success/30 bg-success-light px-4 py-3 text-sm text-success">{notice}</div>}

        <section aria-label="Projects" className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleProjects.length === 0 && <p className="col-span-full rounded-2xl border border-border bg-surface p-6 text-sm text-text-secondary">No projects yet. Use “Projects → New project” to import a BOQ.</p>}
          {visibleProjects.map((p) => {
            const pct = p.total ? Math.round((100 * p.done) / p.total) : 0;
            const active = p.id === selectedId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                aria-pressed={active}
                className={`group rounded-2xl border bg-surface p-4 text-left transition hover:-translate-y-0.5 ${active ? 'border-accent ring-2 ring-accent/25' : 'border-border'}`}
              >
                <div className="flex items-start gap-3">
                  <GlassIcon name="building" size={34} tint={p.status === 'active' ? 'brand' : p.status === 'finished' ? 'green' : 'slate'} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-semibold">{p.name}</h3>
                    <p className="truncate text-xs text-text-secondary">{p.client_name ?? 'No client name'}</p>
                  </div>
                  {p.status !== 'active' && <span className="rounded-md bg-surface-alt px-1.5 py-0.5 text-[10px] font-semibold uppercase text-text-secondary">{STATUS_BADGE[p.status]}</span>}
                  {p.escalated > 0 && <span className="rounded-md bg-danger-light px-1.5 py-0.5 text-[10px] font-semibold text-danger">{p.escalated} esc</span>}
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-alt"><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
                <p className="mt-1.5 text-xs text-text-secondary"><span className="font-semibold text-text-primary">{pct}%</span> done · {p.pending} not done</p>
              </button>
            );
          })}
        </section>

        {/* ── selected project ── */}
        {selected && (
          <section aria-label={selected.name} className="mt-8 rounded-2xl border border-border bg-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold">
                  {selected.name}
                  <span className="rounded-md bg-surface-alt px-2 py-0.5 text-xs font-medium text-text-secondary">{lines.length} BOQ lines</span>
                  {selected.status !== 'active' && <span className="rounded-md bg-warning-light px-2 py-0.5 text-xs font-semibold text-warning">{STATUS_BADGE[selected.status]}</span>}
                </h2>
                <p className="text-sm text-text-secondary">{[selected.client_name, selected.site_address].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ActionButton icon="send" onClick={sendReminders} disabled={busy === 'remind'} primary>
                  {busy === 'remind' ? 'Preparing…' : `Send reminders${totals.chaseable ? ` (${totals.chaseable})` : ''}`}
                </ActionButton>
                <ActionButton icon="edit" onClick={() => setEditing(true)}>Edit project details</ActionButton>
                {selected.status === 'closed' || selected.status === 'finished' ? (
                  <ActionButton icon="reopen" onClick={() => setProjectStatus('active')} disabled={busy === 'status'}>Reopen</ActionButton>
                ) : (
                  <ActionButton icon="archive" onClick={() => setProjectStatus('closed')} disabled={busy === 'status'} danger>Close project</ActionButton>
                )}
                <DeleteProjectButton
                  key={selected.id}
                  projectId={selected.id}
                  projectName={selected.name}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-danger px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
                  onDeleted={async () => {
                    const name = selected.name;
                    const tiles = (await loadProjects()) ?? [];
                    setSelectedId(tiles.find((t) => t.status === 'active')?.id ?? tiles[0]?.id ?? '');
                    flash(`Project "${name}" deleted.`);
                  }}
                />
              </div>
            </div>

            {/* progress + triggers */}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Lines done" value={`${totals.done}/${totals.lines}`} />
              <Stat label="Not done (stuck)" value={String(totals.stuck)} tone={totals.stuck ? 'danger' : undefined} />
              <Stat label="In installation" value={`${progress.installation}%`} hint="iPhone programming starts at 50%" />
              <Stat label="Programming done" value={`${progress.programming}%`} hint="Client side starts at 80%" />
            </div>
            {totals.needsSteps > 0 && (
              <div className="mt-3 rounded-xl border border-warning/30 bg-warning-light px-4 py-2.5 text-sm text-warning">
                {totals.needsSteps} BOQ product{totals.needsSteps === 1 ? ' is' : 's are'} not in VTech’s product list. Use “Add dependencies” on {totals.needsSteps === 1 ? 'its row' : 'their rows'}.
              </div>
            )}

            {/* filters (same as before) + sort */}
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <div role="radiogroup" aria-label="Sort" className="inline-flex rounded-xl border border-border bg-surface-alt p-1">
                {([['room', 'Room-wise', 'rooms'], ['floor', 'Floor-wise', 'floors'], ['product', 'Product-wise', 'products']] as const).map(([k, label, icon]) => (
                  <button key={k} type="button" role="radio" aria-checked={sortBy === k} onClick={() => setSortBy(k)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${sortBy === k ? 'bg-surface text-accent shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}>
                    <Glyph name={icon} /> {label}
                  </button>
                ))}
              </div>
              <select aria-label="Status filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="rounded-xl border border-border px-3 py-2">
                <option value="all">All lines ({lines.length})</option>
                <option value="open">Open lines</option>
                <option value="stuck">Not done (with a reason)</option>
                <option value="escalated">Escalated (L2+)</option>
                <option value="done">Fully done</option>
              </select>
              <select aria-label="Agency filter" value={agencyFilter} onChange={(e) => setAgencyFilter(e.target.value)} className="max-w-[16rem] rounded-xl border border-border px-3 py-2">
                <option value="all">All agencies</option>
                {agencyOptions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <input aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product, room, model…" className="min-w-0 flex-1 rounded-xl border border-border px-3 py-2 sm:max-w-xs" />
              <label className="inline-flex items-center gap-2 text-text-secondary">
                <input type="checkbox" checked={showAllSteps} onChange={(e) => setShowAllSteps(e.target.checked)} /> Show all steps
              </label>
            </div>

            {/* colour key */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
              {LEGEND_ORDER.map((c) => (
                <span key={c} className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: STEP_COLOURS[c].bg, boxShadow: `0 0 0 1px ${STEP_COLOURS[c].ring}` }} />
                  {STEP_COLOURS[c].legend}
                </span>
              ))}
              <span className="inline-flex items-center gap-1"><span className="font-bold text-success">✓</span> done</span>
              <span className="inline-flex items-center gap-1"><span className="font-bold text-danger">✗</span> not done — tap to give the reason</span>
            </div>

            {/* matrix */}
            <div className="mt-4">
              <div className="hidden grid-cols-[minmax(170px,1.3fr)_minmax(130px,1fr)_minmax(120px,1fr)_52px_minmax(240px,2.4fr)] gap-3 border-b border-border px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary md:grid">
                <span>Product</span><span>Location</span><span>Agency involved</span><span className="text-right">Qty</span><span>Status</span>
              </div>
              {detailLoading && <div className="flex justify-center py-10"><Spinner /></div>}
              {!detailLoading && groups.length === 0 && (
                <p className="py-10 text-center text-sm text-text-secondary">{lines.length ? 'No line matches these filters.' : 'This project has no BOQ lines yet.'}</p>
              )}
              {!detailLoading && groups.map((g) => (
                <div key={g.key} className="mt-4">
                  <h3 className="flex items-center gap-2 px-1 text-sm font-semibold">
                    <GlassIcon name={sortBy === 'product' ? 'products' : sortBy === 'floor' ? 'floors' : 'rooms'} size={24} tint="clear" />
                    {g.label}{g.sub ? <span className="font-normal text-text-secondary">· {g.sub}</span> : null}
                    <span className="text-xs font-normal text-text-muted">({g.rows.length})</span>
                  </h3>
                  <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border">
                    {g.rows.map(({ line, gate: lg, st, shownSteps, involved }) => {
                      const needsSteps = !line.product_id && lg.length === 0;
                      const spec = [line.brand, line.make, line.model].filter(Boolean).join(' · ');
                      return (
                        <li key={line.id} data-line={line.id} className="grid grid-cols-1 gap-2 bg-surface px-3 py-3 md:grid-cols-[minmax(170px,1.3fr)_minmax(130px,1fr)_minmax(120px,1fr)_52px_minmax(240px,2.4fr)] md:items-center md:gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold">{titleOf(line)}{!line.product_id && <span className="ml-1.5 rounded bg-warning-light px-1 text-[10px] font-semibold uppercase text-warning">not in list</span>}</p>
                            {spec && <p className="truncate text-xs text-text-muted">{spec}</p>}
                          </div>
                          <div className="text-sm">
                            <span className="md:hidden text-xs text-text-muted">Location: </span>{line.location ?? '—'}
                            {sortBy !== 'room' && <span className="block text-xs text-text-muted">{where(line.room_id)}</span>}
                          </div>
                          <div className="text-sm text-text-secondary"><span className="md:hidden text-xs text-text-muted">Agency: </span>{involved.length ? involved.join(', ') : '—'}</div>
                          <div className="text-sm tabular-nums md:text-right"><span className="md:hidden text-xs text-text-muted">Qty: </span>{line.quantity}</div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {needsSteps ? (
                              <button type="button" onClick={() => setCustomFor(line)} className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-white">
                                <Glyph name="plus" /> Add dependencies
                              </button>
                            ) : st.waitingTrigger && !showAllSteps ? (
                              <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-alt px-2.5 py-1.5 text-xs text-text-secondary">
                                <Glyph name="clock" /> {triggerText(lg[0]?.catalogue_title ?? null, progress)}
                              </span>
                            ) : st.allDone && !showAllSteps ? (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-success-light px-2.5 py-1.5 text-xs font-semibold text-success"><Glyph name="check" /> All {st.total} done</span>
                            ) : (
                              <>
                                {shownSteps.map((s) => <StepChip key={s.item_id} row={s} onClick={() => setStepRow(s)} />)}
                                {!showAllSteps && st.done > 0 && <span className="text-[11px] text-text-muted">✓ {st.done}/{st.total}</span>}
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {stepRow && (
        <StepDialog
          row={stepRow}
          context={where(stepRow.room_id)}
          agencies={agencyOptions}
          onClose={() => setStepRow(null)}
          onSaved={async () => { setStepRow(null); await refresh(); }}
        />
      )}
      {customFor && (
        <CustomStepsDialog
          roomProductId={customFor.id}
          title={titleOf(customFor)}
          context={where(customFor.room_id)}
          agencies={agencyOptions}
          onClose={() => setCustomFor(null)}
          onSaved={async () => { setCustomFor(null); flash('Dependencies added.'); await refresh(); }}
        />
      )}
      {editing && selected && (
        <EditProjectDialog
          project={{ id: selected.id, name: selected.name, client_name: selected.client_name, site_address: selected.site_address, status: selected.status, l2_after: selected.l2_after, l3_after: selected.l3_after }}
          lines={lines.map((l) => ({ id: l.id, title: titleOf(l), room: where(l.room_id), location: l.location, quantity: l.quantity, brand: l.brand, make: l.make, model: l.model }))}
          onClose={() => setEditing(false)}
          onSaved={async (msg) => { setEditing(false); flash(msg); await refresh(); }}
        />
      )}
    </div>
  );
}

function StepChip({ row, onClick }: { row: GateRow; onClick: () => void }) {
  const c = stepColour(row.sheet_colour);
  const done = isDone(row.status);
  const tip = done ? `${row.label}: done` : row.locked ? `${row.label}: opens later` : `${row.label}: not done${row.stuck_reason ? ` — ${row.stuck_reason}` : ''}`;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={row.locked && !done}
      title={tip}
      aria-label={tip}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-lg py-1 pl-1 pr-2 text-xs font-medium transition hover:brightness-95 disabled:cursor-not-allowed ${row.locked && !done ? 'opacity-45' : ''}`}
      style={{ background: c.bg, color: c.text, boxShadow: `inset 0 0 0 1px ${c.ring}` }}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[13px] font-bold ${done ? 'bg-success text-white' : row.locked ? 'bg-white/70 text-text-muted' : 'bg-white text-danger'}`}
        style={{ boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)' }}
      >
        {done ? '✓' : row.locked ? <Glyph name="lock" className="h-3 w-3" /> : '✗'}
      </span>
      <span className="truncate">{row.label}</span>
      {!done && row.stuck_reason && <span className="hidden truncate opacity-75 lg:inline">· {row.stuck_reason}</span>}
    </button>
  );
}

function ActionButton({ icon, children, onClick, disabled, primary, danger }: {
  icon: 'send' | 'edit' | 'archive' | 'reopen'; children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition disabled:opacity-50 ${
        primary ? 'bg-accent text-white' : danger ? 'border border-danger/30 bg-danger/5 text-danger hover:bg-danger/10' : 'border border-border bg-surface text-text-primary hover:bg-surface-alt'
      }`}
    >
      <Glyph name={icon} /> {children}
    </button>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'danger' }) {
  return (
    <div className="rounded-xl border border-border bg-surface-alt/60 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${tone === 'danger' ? 'text-danger' : ''}`}>{value}</p>
      {hint && <p className="text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-8 w-8 animate-spin text-accent" viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
