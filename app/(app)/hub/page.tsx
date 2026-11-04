'use client';

// VTech Dashboard (v4). Project tiles on top; the selected project opens below with its filters, actions and a
// matrix of every BOQ line (Product · Location · Agency involved · Quantity · Status). Status shows the line's
// dependencies as checkboxes in the sheet's colours: all green steps first, then one step at a time.
// Lock state comes only from the database view item_gate (see migration 0009).

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/client/supabase';
import { useAuth } from '@/components/auth-provider';
import { AppHeader } from '@/components/app-header';
import { DeleteProjectButton } from '@/components/delete-project-button';
import { GlassIcon, Glyph } from '@/components/glass-icon';
import { StepDialog, type AgencyOption } from '@/components/v4/step-dialog';
import { EditProjectDialog } from '@/components/v4/edit-project-dialog';
import { CustomStepsDialog } from '@/components/v4/custom-steps-dialog';
import { DASHBOARD_CHANGED } from '@/components/v4/notifications-bell';
import { GroupingToggle, type SortBy } from '@/components/v6/grouping-toggle';
import { LEGEND_ORDER, STEP_COLOURS, isDone, lineStatus, stepColour, type GateRow } from '@/lib/client/steps';

type ProjectStatus = 'active' | 'on_hold' | 'closed' | 'finished';
interface ProjectTile {
  id: string; name: string; client_name: string | null; site_address: string | null; status: ProjectStatus;
  pending: number; done: number; total: number;
}
interface Floor { id: string; label: string; sort: number }
interface Room { id: string; floor_id: string; name: string; sort: number }
interface Agency { id: string; company_name: string; agency_types: { name: string; internal: boolean; active?: boolean } | null }
interface Line {
  id: string; room_id: string; product_id: string | null; boq_title: string | null; location: string | null; quantity: number;
  brand: string | null; make: string | null; model: string | null; product_catalogue: { title: string; scope: string } | null;
}
type StatusFilter = 'all' | 'open' | 'stuck' | 'done';

interface DueFollowup {
  id: string;
  project_id: string;
  project_name: string;
  agency_type_id: string;
  group_name: string;
  note: string | null;
  remind_on: string;
}

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

  // Due contact follow-ups
  const [dueFollowups, setDueFollowups] = useState<DueFollowup[]>([]);
  const [showFollowupsList, setShowFollowupsList] = useState(false);

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
    const [{ data: ps, error: pErr }, { data: its, error: iErr }, { data: followups }] = await Promise.all([
      sb.from('projects').select('id, name, client_name, site_address, status').order('name'),
      sb.from('dependency_items').select('project_id, status'),
      sb.from('contact_followups_due').select('id, project_id, project_name, agency_type_id, group_name, note, remind_on'),
    ]);
    if (pErr || iErr) { setError((pErr ?? iErr)!.message); setLoading(false); return; }
    setDueFollowups((followups ?? []) as DueFollowup[]);
    const stats = new Map<string, { pending: number; done: number; total: number }>();
    for (const i of (its ?? []) as { project_id: string; status: string }[]) {
      const s = stats.get(i.project_id) ?? { pending: 0, done: 0, total: 0 };
      s.total++;
      if (i.status === 'pending') s.pending++;
      if (i.status === 'complete' || i.status === 'na') s.done++;
      stats.set(i.project_id, s);
    }
    const tiles: ProjectTile[] = (ps ?? []).map((p: { id: string; name: string; client_name: string | null; site_address: string | null; status: string }) => ({
      id: p.id, name: p.name, client_name: p.client_name, site_address: p.site_address, status: (p.status ?? 'active') as ProjectStatus,
      ...(stats.get(p.id) ?? { pending: 0, done: 0, total: 0 }),
    }));
    tiles.sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name));
    setProjects(tiles);
    setLoading(false);
    return tiles;
  }, []);

  const snoozeFollowup = async (id: string) => {
    const remindDate = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    const sb = supabaseBrowser();
    const { error: e } = await sb.from('contact_followups').update({ remind_on: remindDate }).eq('id', id);
    if (!e) {
      setDueFollowups((prev) => prev.filter((f) => f.id !== id));
      flash('Reminder snoozed for 7 days.');
      window.dispatchEvent(new Event(DASHBOARD_CHANGED));
    }
  };

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

  const [stepAgencyTypes, setStepAgencyTypes] = useState<Map<string, string>>(new Map());

  // ── selected project ──
  const loadDetails = useCallback(async (id: string) => {
    if (!id) return;
    setDetailLoading(true);
    const sb = supabaseBrowser();
    const [f, r, a, l, g, pr, ps] = await Promise.all([
      sb.from('floors').select('id, label, sort').eq('project_id', id).order('sort'),
      sb.from('rooms').select('id, floor_id, name, sort').eq('project_id', id).order('sort'),
      sb.from('agencies').select('id, company_name, agency_types(name, internal, active)').eq('project_id', id),
      sb.from('room_products').select('id, room_id, product_id, boq_title, location, quantity, brand, make, model, product_catalogue(title, scope)').eq('project_id', id),
      sb.from('item_gate').select('*').eq('project_id', id).order('seq'),
      sb.from('project_progress').select('installation_pct, programming_pct').eq('project_id', id).maybeSingle(),
      sb.from('product_steps').select('id, agency_types(name)'),
    ]);
    const err = [f, r, a, l, g, pr, ps].find((x) => x.error)?.error;
    if (err) setError(err.message);
    setFloors((f.data ?? []) as Floor[]);
    setRooms((r.data ?? []) as Room[]);
    setAgencies((a.data ?? []) as unknown as Agency[]);
    setLines((l.data ?? []) as unknown as Line[]);
    setGate((g.data ?? []) as GateRow[]);
    setProgress({ installation: Number(pr.data?.installation_pct ?? 0), programming: Number(pr.data?.programming_pct ?? 0) });
    const stepMap = new Map<string, string>();
    for (const s of (ps.data ?? []) as unknown as { id: string; agency_types: { name: string } | null }[]) {
      if (s.agency_types?.name) stepMap.set(s.id, s.agency_types.name);
    }
    setStepAgencyTypes(stepMap);
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
    () => agencies
      .filter((a) => a.agency_types?.active !== false)
      .map((a) => ({ id: a.id, label: `${a.agency_types?.name ?? 'Agency'} – ${a.company_name}`, internal: !!a.agency_types?.internal, typeName: a.agency_types?.name ?? '' }))
      .sort((x, y) => x.label.localeCompare(y.label)),
    [agencies]
  );

  const where = (roomId: string) => {
    const r = roomById.get(roomId); const f = r ? floorById.get(r.floor_id) : undefined;
    return [f?.label, r?.name].filter(Boolean).join(' · ');
  };
  const titleOf = (l: Line) => l.product_catalogue?.title ?? l.boq_title ?? 'Product';

  const formatAgency = (
    agency?: { company_name: string; agency_types?: { name?: string | null; internal?: boolean | null } | null } | null,
    defaultTypeName?: string | null,
    sheetColour?: string | null
  ): string => {
    const typeName = agency?.agency_types?.name || defaultTypeName || '';
    const compName = agency?.company_name || '';
    const isInternal = agency?.agency_types?.internal === true ||
      compName.toLowerCase().includes('vtech') ||
      typeName.toLowerCase().includes('vtech');

    const sc = (sheetColour ?? '').toUpperCase();
    if (isInternal || sc === 'E06666' || sc === 'F4CCCC' || sc === 'FF00FF' || sc === 'F9CB9C') {
      const tLower = typeName.toLowerCase();
      if (tLower.includes('install') || sc === 'E06666') {
        return 'Installer – VTech';
      }
      if (tLower.includes('program') || sc === 'F4CCCC') {
        return 'Programmer – VTech';
      }
      if (tLower.includes('sale') || tLower.includes('project manager') || sc === 'FF00FF' || sc === 'F9CB9C') {
        return 'Sales – VTech';
      }
      return 'Installer – VTech';
    }

    if (agency) {
      const t = agency.agency_types?.name?.trim() || defaultTypeName?.trim() || 'Agency';
      return `${t} – ${agency.company_name.trim()}`;
    }

    if (defaultTypeName) {
      return `${defaultTypeName} – Unassigned`;
    }
    return 'General – Unassigned';
  };

  // ── matrix rows ──
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lines
      .map((l) => {
        const g = gateByLine.get(l.id) ?? [];
        const st = lineStatus(g);
        const shownSteps = showAllSteps ? [...g].sort((a, b) => a.seq - b.seq) : st.visible;
        const involved = [
          ...new Set(
            st.visible
              .filter((x) => !isDone(x.status))
              .map((x) => {
                const a = x.agency_id ? agencyById.get(x.agency_id) : undefined;
                const defType = x.step_id ? stepAgencyTypes.get(x.step_id) : undefined;
                return formatAgency(a, defType, x.sheet_colour);
              })
              .filter(Boolean)
          ),
        ] as string[];
        return { line: l, gate: g, st, shownSteps, involved };
      })
      .filter(({ line, gate: g, st, involved }) => {
        if (q && !`${titleOf(line)} ${line.location ?? ''} ${where(line.room_id)} ${line.brand ?? ''} ${line.model ?? ''}`.toLowerCase().includes(q)) return false;
        if (agencyFilter !== 'all' && !g.some((x) => x.agency_id === agencyFilter && !isDone(x.status))) return false;
        if (statusFilter === 'done') return st.allDone;
        if (statusFilter === 'open') return !st.allDone;
        if (statusFilter === 'stuck') return st.visible.some((x) => x.status === 'pending');
        void involved;
        return true;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, gateByLine, showAllSteps, search, agencyFilter, statusFilter, roomById, floorById, agencyById, stepAgencyTypes]);

  const groups = useMemo(() => {
    const m = new Map<string, { key: string; label: string; sub?: string; order: (number | string)[]; rows: typeof rows }>();
    for (const r of rows) {
      const room = roomById.get(r.line.room_id);
      const floor = room ? floorById.get(room.floor_id) : undefined;
      const scope = r.line.product_catalogue?.scope;

      if (sortBy === 'product') {
        const key = titleOf(r.line).toLowerCase();
        const label = titleOf(r.line);
        const order = [scope === 'project' ? 1 : 0, label];
        const gr = m.get(key) ?? { key, label, order, rows: [] as typeof rows };
        gr.rows.push(r);
        m.set(key, gr);
      } else if (sortBy === 'agency') {
        // Agency-wise key = label (<Type> – <Company> or <Type> – VTech),
        // type first, VTech teams without duplicate name.
        const waitingSteps = r.st.visible.filter((x) => !isDone(x.status));
        const activeSteps = waitingSteps.length > 0 ? waitingSteps : r.gate.filter((x) => !isDone(x.status));
        const targetSteps = activeSteps.length > 0 ? activeSteps : (r.gate.length > 0 ? [r.gate[0]] : [{ agency_id: null, step_id: null, sheet_colour: null }]);
        const seenKeys = new Set<string>();
        for (const step of targetSteps) {
          const agency = step.agency_id ? agencyById.get(step.agency_id) : undefined;
          const defaultType = step.step_id ? stepAgencyTypes.get(step.step_id) : undefined;
          const label = formatAgency(agency, defaultType, 'sheet_colour' in step ? step.sheet_colour : null);
          const key = label;
          const isVTech = label.endsWith('– VTech');
          const order = [isVTech ? 1 : 0, label];

          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            const gr = m.get(key) ?? { key, label, order, rows: [] as typeof rows };
            gr.rows.push(r);
            m.set(key, gr);
          }
        }
      } else {
        // Room-wise keeps the floor as sub-label
        const key = room?.id ?? 'none';
        const label = room?.name ?? 'No room';
        const sub = floor?.label;
        const order = [floor?.sort ?? 9999, room?.sort ?? 0];
        const gr = m.get(key) ?? { key, label, sub, order, rows: [] as typeof rows };
        gr.rows.push(r);
        m.set(key, gr);
      }
    }
    const list = [...m.values()].sort((a, b) => {
      for (let i = 0; i < Math.max(a.order.length, b.order.length); i++) {
        const valA = a.order[i] ?? 0;
        const valB = b.order[i] ?? 0;
        if (typeof valA === 'number' && typeof valB === 'number') {
          if (valA !== valB) return valA - valB;
        } else {
          const cmp = String(valA).localeCompare(String(valB));
          if (cmp !== 0) return cmp;
        }
      }
      return a.label.localeCompare(b.label);
    });
    for (const g of list) {
      g.rows.sort((a, b) => {
        if (sortBy === 'product') {
          return where(a.line.room_id).localeCompare(where(b.line.room_id));
        }
        if (sortBy === 'agency') {
          return where(a.line.room_id).localeCompare(where(b.line.room_id)) || titleOf(a.line).localeCompare(titleOf(b.line));
        }
        return titleOf(a.line).localeCompare(titleOf(b.line)) || (a.line.location ?? '').localeCompare(b.line.location ?? '');
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortBy, roomById, floorById, agencyById, stepAgencyTypes]);

  const totals = useMemo(() => {
    // 1. Products (line items): total · done · not done
    const totalLines = lines.length;
    let doneLines = 0;
    for (const l of lines) {
      const g = gateByLine.get(l.id) ?? [];
      if (lineStatus(g).allDone) {
        doneLines++;
      }
    }
    const notDoneLines = totalLines - doneLines;

    // 2. Other agency: pending items waiting on external agencies + client (red number)
    const otherAgencyPending = gate.filter(
      (g) => (g.responsibility === 'external' || g.responsibility === 'client') && g.status === 'pending'
    ).length;

    // 3. VTech Installer: total · done · pending of installer steps (sheet colour E06666)
    const installerSteps = gate.filter((g) => (g.sheet_colour ?? '').toUpperCase() === 'E06666');
    const installerTotal = installerSteps.length;
    const installerDone = installerSteps.filter((g) => isDone(g.status)).length;
    const installerPending = installerSteps.filter((g) => g.status === 'pending').length;

    // 4. VTech Programmer: total · done · pending of programmer steps (sheet colour F4CCCC)
    const programmerSteps = gate.filter((g) => (g.sheet_colour ?? '').toUpperCase() === 'F4CCCC');
    const programmerTotal = programmerSteps.length;
    const programmerDone = programmerSteps.filter((g) => isDone(g.status)).length;
    const programmerPending = programmerSteps.filter((g) => g.status === 'pending').length;

    const chaseable = gate.filter(
      (g) => !isDone(g.status) && !g.locked && g.status === 'pending' && !g.waits_on_client
    ).length;
    const needsSteps = lines.filter((l) => !l.product_id && !(gateByLine.get(l.id)?.length)).length;

    return {
      products: { total: totalLines, done: doneLines, notDone: notDoneLines },
      otherAgencyPending,
      installer: { total: installerTotal, done: installerDone, pending: installerPending },
      programmer: { total: programmerTotal, done: programmerDone, pending: programmerPending },
      chaseable,
      needsSteps,
    };
  }, [lines, gate, gateByLine]);

  // ── actions ──
  function sendReminders() {
    if (!selectedId) return;
    router.push(`/projects/${selectedId}/reminders`);
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

        {dueFollowups.length > 0 && (
          <div className="mt-4 rounded-xl border border-warning/40 bg-warning-light p-3 text-xs text-warning">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Glyph name="bell" className="h-4 w-4 shrink-0 text-warning" />
                <span className="font-semibold text-warning">
                  {dueFollowups.length} contact{dueFollowups.length === 1 ? '' : 's'} still to add
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowFollowupsList(!showFollowupsList)}
                className="text-xs font-semibold underline hover:opacity-80"
              >
                {showFollowupsList ? 'Hide list' : 'View list'}
              </button>
            </div>

            {showFollowupsList && (
              <ul className="mt-3 divide-y divide-warning/20 border-t border-warning/20 pt-1 space-y-2">
                {dueFollowups.map((f) => (
                  <li key={f.id} className="pt-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-text-primary">{f.project_name}</span>: add the{' '}
                      <span className="font-semibold text-text-primary">{f.group_name}</span> contact
                      {f.note && <span className="text-text-muted italic ml-1">({f.note})</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => snoozeFollowup(f.id)}
                        className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors"
                      >
                        Remind me again in 7 days
                      </button>
                      <Link
                        href={`/projects/${f.project_id}?tab=agencies`}
                        className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-white hover:bg-accent-hover transition-colors"
                      >
                        Go to Agencies →
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

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
                <h3 className="truncate text-base font-semibold text-text-primary">{p.name}</h3>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-alt">
                  <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-2 text-xs text-text-secondary">
                  <span className="font-semibold text-text-primary">{pct}%</span> · {p.pending} pending
                </p>
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
                {(selected.status === 'closed' || selected.status === 'finished') && (
                  <ActionButton icon="reopen" onClick={() => setProjectStatus('active')} disabled={busy === 'status'}>Reopen</ActionButton>
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

            {/* 4 stat cards */}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="Products (line items)"
                value={
                  <>
                    <span className="text-text-primary">{totals.products.total}</span>
                    <span className="text-text-muted"> · </span>
                    <span className="text-success">{totals.products.done}</span>
                    <span className="text-text-muted"> · </span>
                    <span className="text-danger">{totals.products.notDone}</span>
                  </>
                }
              />
              <Stat
                label="Other agency"
                value={<span className="text-danger">{totals.otherAgencyPending}</span>}
              />
              <Stat
                label="VTech Installer"
                value={
                  <>
                    <span className="text-text-primary">{totals.installer.total}</span>
                    <span className="text-text-muted"> · </span>
                    <span className="text-success">{totals.installer.done}</span>
                    <span className="text-text-muted"> · </span>
                    <span className="text-danger">{totals.installer.pending}</span>
                  </>
                }
              />
              <Stat
                label="VTech Programmer"
                value={
                  <>
                    <span className="text-text-primary">{totals.programmer.total}</span>
                    <span className="text-text-muted"> · </span>
                    <span className="text-success">{totals.programmer.done}</span>
                    <span className="text-text-muted"> · </span>
                    <span className="text-danger">{totals.programmer.pending}</span>
                  </>
                }
              />
            </div>
            {totals.needsSteps > 0 && (
              <div className="mt-3 rounded-xl border border-warning/30 bg-warning-light px-4 py-2.5 text-sm text-warning">
                {totals.needsSteps} BOQ product{totals.needsSteps === 1 ? ' is' : 's are'} not in VTech’s product list. Use “Add dependencies” on {totals.needsSteps === 1 ? 'its row' : 'their rows'}.
              </div>
            )}

            {/* filters + sort */}
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <GroupingToggle value={sortBy} onChange={setSortBy} />
              <select aria-label="Status filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="w-full rounded-xl border border-border px-3 py-2 sm:w-auto">
                <option value="all">All lines ({lines.length})</option>
                <option value="open">Open lines</option>
                <option value="stuck">Not done (with a reason)</option>
                <option value="done">Fully done</option>
              </select>
              <select aria-label="Agency filter" value={agencyFilter} onChange={(e) => setAgencyFilter(e.target.value)} className="w-full rounded-xl border border-border px-3 py-2 sm:w-auto sm:max-w-[16rem]">
                <option value="all">All agencies</option>
                {agencyOptions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <input aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product, room, model…" className="w-full min-w-0 rounded-xl border border-border px-3 py-2 sm:w-auto sm:flex-1 sm:max-w-xs" />
            </div>

            {/* colour key */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
              {LEGEND_ORDER.map((c) => (
                <span key={c} className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: STEP_COLOURS[c].bg, boxShadow: `0 0 0 1px ${STEP_COLOURS[c].ring}` }} />
                  {STEP_COLOURS[c].legend}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-4 rounded-xs border border-text-muted bg-text-muted" />
                filled = done
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-4 rounded-xs border border-text-muted bg-transparent" />
                outlined = open
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-4 rounded-xs border-2 border-text-primary bg-surface" />
                dark outline = stuck
              </span>
            </div>

            {/* matrix */}
            <div className="mt-4">
              <div className="hidden grid-cols-[minmax(200px,1.5fr)_minmax(120px,0.9fr)_56px_minmax(280px,2.6fr)] gap-4 border-b border-border px-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary md:grid">
                <span>Product</span><span>Location</span><span className="text-right">Qty</span><span>Status</span>
              </div>
              {detailLoading && <div className="flex justify-center py-10"><Spinner /></div>}
              {!detailLoading && groups.length === 0 && (
                <p className="py-10 text-center text-sm text-text-secondary">{lines.length ? 'No line matches these filters.' : 'This project has no BOQ lines yet.'}</p>
              )}
              {!detailLoading && groups.map((g) => (
                <div key={g.key} className="mt-4">
                  <h3 className="flex items-center gap-2 px-1 text-sm font-semibold">
                    <GlassIcon name={sortBy === 'product' ? 'products' : sortBy === 'agency' ? 'agencies' : 'rooms'} size={24} tint="clear" />
                    {g.label}{g.sub ? <span className="font-normal text-text-secondary">· {g.sub}</span> : null}
                    <span className="text-xs font-normal text-text-muted">({g.rows.length})</span>
                  </h3>
                  <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border">
                    {g.rows.map(({ line, gate: lg, involved }) => {
                      const needsSteps = !line.product_id && lg.length === 0;
                      const spec = [line.brand, line.make, line.model].filter(Boolean).join(' · ');
                      const defaultStep = lg.find((r) => r.status === 'pending' && !r.locked)
                        ?? lg.find((r) => !isDone(r.status) && !r.locked)
                        ?? lg[0];
                      return (
                        <li
                          key={line.id}
                          data-line={line.id}
                          onClick={() => { if (!needsSteps && defaultStep) setStepRow(defaultStep); }}
                          className={`grid grid-cols-1 gap-3 bg-surface px-4 py-3 transition-colors hover:bg-surface-alt/40 md:grid-cols-[minmax(200px,1.5fr)_minmax(120px,0.9fr)_56px_minmax(280px,2.6fr)] md:items-center md:gap-4 ${!needsSteps && defaultStep ? 'cursor-pointer' : ''}`}
                        >
                          <div className="min-w-0">
                            <p className="font-semibold">{titleOf(line)}{!line.product_id && <span className="ml-1.5 rounded bg-warning-light px-1 text-[10px] font-semibold uppercase text-warning">not in list</span>}</p>
                            {spec && <p className="truncate text-xs text-text-muted">{spec}</p>}
                            {involved.length > 0 && (
                              <p className="mt-1 flex items-center gap-1 text-xs text-text-secondary" title={involved.join(', ')}>
                                <Glyph name="building" className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                                <span className="truncate">Waiting on {involved.slice(0, 2).join(', ')}{involved.length > 2 ? ` +${involved.length - 2}` : ''}</span>
                              </p>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-text-primary truncate">
                              {roomById.get(line.room_id)?.name ?? '—'}
                            </p>
                            <p className="text-xs text-text-muted truncate">
                              {line.location || '—'}
                            </p>
                          </div>
                          <div className="text-sm tabular-nums md:text-right"><span className="md:hidden text-xs text-text-muted">Qty: </span>{line.quantity}</div>
                          <div className="min-w-0">
                            {needsSteps ? (
                              <button type="button" onClick={(e) => { e.stopPropagation(); setCustomFor(line); }} className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white">
                                <Glyph name="plus" /> Add dependencies
                              </button>
                            ) : (
                              <SegmentedColorBar
                                steps={lg}
                                onOpen={(r) => setStepRow(r)}
                              />
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
          project={{ id: selected.id, name: selected.name, client_name: selected.client_name, site_address: selected.site_address, status: selected.status }}
          lines={lines.map((l) => ({ id: l.id, title: titleOf(l), room: where(l.room_id), location: l.location, quantity: l.quantity, brand: l.brand, make: l.make, model: l.model }))}
          onClose={() => setEditing(false)}
          onSaved={async (msg) => { setEditing(false); flash(msg); await refresh(); }}
        />
      )}
    </div>
  );
}

/** Segmented colour bar: one segment per step, coloured by sheet_colour; filled = done/N.A., outlined = open, faded = locked; the current stuck step has a 2px dark outline. Each segment shows a tiny ✓ or ✗ for done or pending/stuck. */
function SegmentedColorBar({ steps, onOpen }: { steps: GateRow[]; onOpen: (r: GateRow) => void }) {
  const ordered = [...steps].sort((a, b) => a.seq - b.seq);
  if (ordered.length === 0) return null;

  const doneCount = ordered.filter((r) => isDone(r.status)).length;

  return (
    <div className="flex items-center gap-2">
      <div className="flex h-5 flex-1 items-center gap-1 min-w-[120px] max-w-xs" aria-label="Step progress">
        {ordered.map((r) => {
          const c = stepColour(r.sheet_colour);
          const done = isDone(r.status);
          const locked = r.locked && !done;
          const isStuck = r.status === 'pending';

          const tip = `${r.label}${done ? ' (done)' : isStuck ? ` (stuck: ${r.stuck_reason || 'not done'})` : locked ? ' (locked)' : ' (open)'}`;
          const markColor = c.text === '#FFFFFF' ? '#ffffff' : '#0f172a';

          return (
            <button
              key={r.item_id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(r);
              }}
              title={tip}
              aria-label={tip}
              className={`h-4 min-w-[14px] flex-1 rounded-xs transition hover:scale-y-110 active:scale-95 flex items-center justify-center overflow-hidden ${
                locked ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'
              }`}
              style={{
                backgroundColor: done || isStuck ? c.bg : locked ? c.bg : 'transparent',
                borderColor: isStuck ? '#0f172a' : done ? c.ring : locked ? 'transparent' : c.ring,
                borderWidth: isStuck ? '2px' : done ? '1px' : locked ? '0px' : '2px',
                borderStyle: 'solid',
                boxShadow: isStuck ? '0 0 0 1px #0f172a' : undefined,
              }}
            >
              {done ? (
                <svg
                  viewBox="0 0 24 24"
                  width="10"
                  height="10"
                  className="h-2.5 w-2.5 shrink-0"
                  fill="none"
                  stroke={markColor}
                  strokeWidth={2.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : isStuck ? (
                <svg
                  viewBox="0 0 24 24"
                  width="10"
                  height="10"
                  className="h-2.5 w-2.5 shrink-0"
                  fill="none"
                  stroke={markColor}
                  strokeWidth={2.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              ) : null}
            </button>
          );
        })}
      </div>
      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-text-muted">
        {doneCount}/{ordered.length}
      </span>
    </div>
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

function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: 'danger' }) {
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
