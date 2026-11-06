'use client';

// VTech Dashboard (v8).
// 1. Every line always shows exactly one ✗ = the step being worked on now (the first open, non-done step).
//    Done steps show ✓. When marked done, ✗ moves automatically to the next open step.
// 2. Company-wide "being worked on" view across all active projects, grouped by project (project name bold 18px heavy).
//    Project tiles on top (click = filter to that project); 4 stat cards show stats for the selected project (or all active).
// 3. Location column: Room-wise has location main. Agency-wise and Product-wise have room name big, location small.
// 4. Floating buttons: "Send reminders" stacked 12px above "Add dependency" at bottom-right, no overlap.
// 5. No "Close project", no "Open in Hub", project names font-weight 800.

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
import { LEGEND_ORDER, STEP_COLOURS, isDone, lineStatus, stepColour, formatBlockedBy, type GateRow } from '@/lib/client/steps';

type ProjectStatus = 'active' | 'on_hold' | 'closed' | 'finished';
interface ProjectTile {
  id: string;
  name: string;
  client_name: string | null;
  site_address: string | null;
  status: ProjectStatus;
  pending: number;
  done: number;
  total: number;
}
interface Floor { id: string; project_id?: string; label: string; sort: number }
interface Room { id: string; project_id?: string; floor_id: string; name: string; sort: number }
interface Agency { id: string; project_id?: string; company_name: string; agency_types: { name: string; internal: boolean; active?: boolean } | null }
interface Line {
  id: string;
  project_id?: string;
  room_id: string;
  product_id: string | null;
  boq_title: string | null;
  location: string | null;
  quantity: number;
  brand: string | null;
  make: string | null;
  model: string | null;
  product_catalogue: { title: string; scope: string } | null;
}
type StatusFilter = 'open' | 'all' | 'stuck' | 'done';

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
  const [detailLoading, setDetailLoading] = useState(false);

  const [sortBy, setSortBy] = useState<SortBy>('room');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [agencyFilter, setAgencyFilter] = useState('all');
  const [search, setSearch] = useState('');

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

  const [stepAgencyTypes, setStepAgencyTypes] = useState<Map<string, string>>(new Map());
  const [responsibleMap, setResponsibleMap] = useState<Map<string, { responsible: string; via_reason: boolean }>>(new Map());

  // ── load all active data ──
  const loadAllData = useCallback(async () => {
    setDetailLoading(true);
    const sb = supabaseBrowser();
    const [f, r, a, l, g, ps, ir] = await Promise.all([
      sb.from('floors').select('id, project_id, label, sort').order('sort'),
      sb.from('rooms').select('id, project_id, floor_id, name, sort').order('sort'),
      sb.from('agencies').select('id, project_id, company_name, agency_types(name, internal, active)'),
      sb.from('room_products').select('id, project_id, room_id, product_id, boq_title, location, quantity, brand, make, model, product_catalogue(title, scope)'),
      sb.from('item_gate').select('*').order('seq'),
      sb.from('product_steps').select('id, agency_types(name)'),
      sb.from('item_responsible').select('item_id, responsible, via_reason'),
    ]);
    const err = [f, r, a, l, g, ps].find((x) => x.error)?.error;
    if (err) setError(err.message);
    setFloors((f.data ?? []) as Floor[]);
    setRooms((r.data ?? []) as Room[]);
    setAgencies((a.data ?? []) as unknown as Agency[]);
    setLines((l.data ?? []) as unknown as Line[]);
    setGate((g.data ?? []) as GateRow[]);
    const stepMap = new Map<string, string>();
    for (const s of (ps.data ?? []) as unknown as { id: string; agency_types: { name: string } | null }[]) {
      if (s.agency_types?.name) stepMap.set(s.id, s.agency_types.name);
    }
    setStepAgencyTypes(stepMap);

    const rMap = new Map<string, { responsible: string; via_reason: boolean }>();
    for (const row of ((ir?.data ?? []) as { item_id: string; responsible: string; via_reason: boolean }[])) {
      if (row.item_id) rMap.set(row.item_id, row);
    }
    setResponsibleMap(rMap);

    setDetailLoading(false);
  }, []);

  useEffect(() => {
    loadProjects().then((tiles) => {
      if (!tiles) return;
      const q = params.get('p');
      if (q && tiles.some((t) => t.id === q)) {
        setSelectedId(q);
      }
    });
    loadAllData();
  }, [loadProjects, loadAllData, params]);

  // Sync selectedId with URL params
  const handleSelectProject = (id: string) => {
    const next = selectedId === id ? '' : id;
    setSelectedId(next);
    const url = new URL(window.location.href);
    if (next) {
      url.searchParams.set('p', next);
    } else {
      url.searchParams.delete('p');
    }
    window.history.replaceState(null, '', url.toString());
  };

  const refresh = useCallback(async () => {
    await Promise.all([loadAllData(), loadProjects()]);
    window.dispatchEvent(new Event(DASHBOARD_CHANGED));
  }, [loadAllData, loadProjects]);

  useEffect(() => {
    const h = () => { loadAllData(); loadProjects(); };
    window.addEventListener('vtech:dependency-added', h);
    window.addEventListener(DASHBOARD_CHANGED, h);
    return () => { window.removeEventListener('vtech:dependency-added', h); window.removeEventListener(DASHBOARD_CHANGED, h); };
  }, [loadAllData, loadProjects]);

  // Deep links from notifications: ?steps=<line> opens "add dependencies", ?edit=1 opens edit
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
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
  const floorById = useMemo(() => new Map(floors.map((f) => [f.id, f])), [floors]);
  const agencyById = useMemo(() => new Map(agencies.map((a) => [a.id, a])), [agencies]);

  const gateByLine = useMemo(() => {
    const m = new Map<string, GateRow[]>();
    for (const g of gate) {
      const a = m.get(g.room_product_id) ?? [];
      a.push(g);
      m.set(g.room_product_id, a);
    }
    return m;
  }, [gate]);

  const relevantAgencies = useMemo(() => {
    if (selectedId) {
      return agencies.filter((a) => a.project_id === selectedId);
    }
    return agencies;
  }, [agencies, selectedId]);

  const agencyOptions: AgencyOption[] = useMemo(
    () => relevantAgencies
      .filter((a) => a.agency_types?.active !== false)
      .map((a) => ({ id: a.id, label: `${a.agency_types?.name ?? 'Agency'} – ${a.company_name}`, internal: !!a.agency_types?.internal, typeName: a.agency_types?.name ?? '' }))
      .sort((x, y) => x.label.localeCompare(y.label)),
    [relevantAgencies]
  );

  const where = (roomId: string) => {
    const r = roomById.get(roomId);
    const f = r ? floorById.get(r.floor_id) : undefined;
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
      if (tLower === 'vtech pm' || tLower.includes('sale') || tLower.includes('project manager') || sc === 'FF00FF' || sc === 'F9CB9C') {
        return 'PM – VTech';
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

  // ── active lines & gate ──
  // If selectedId is set, filter to selectedId. Otherwise include all visible (active/on_hold) projects.
  const activeLines = useMemo(() => {
    const allowedProjectIds = new Set(
      selectedId ? [selectedId] : visibleProjects.map((p) => p.id)
    );
    return lines.filter((l) => l.project_id && allowedProjectIds.has(l.project_id));
  }, [lines, selectedId, visibleProjects]);

  const activeGate = useMemo(() => {
    const allowedProjectIds = new Set(
      selectedId ? [selectedId] : visibleProjects.map((p) => p.id)
    );
    return gate.filter((g) => allowedProjectIds.has(g.project_id));
  }, [gate, selectedId, visibleProjects]);

  // ── totals for the 4 stat cards ──
  const totals = useMemo(() => {
    // 1. Products (line items): total · done · not done
    const totalLines = activeLines.length;
    let doneLines = 0;
    for (const l of activeLines) {
      const g = gateByLine.get(l.id) ?? [];
      if (lineStatus(g).allDone) {
        doneLines++;
      }
    }
    const notDoneLines = totalLines - doneLines;

    // 2. Other agency: pending items waiting on external agencies + client (red number)
    const otherAgencyPending = activeGate.filter(
      (g) => (g.responsibility === 'external' || g.responsibility === 'client') && g.status === 'pending'
    ).length;

    // 3. VTech Readiness: all green (D9EAD3) steps: total · done (green) · pending (red)
    const readinessSteps = activeGate.filter((g) => (g.sheet_colour ?? '').toUpperCase() === 'D9EAD3');
    const readinessTotal = readinessSteps.length;
    const readinessDone = readinessSteps.filter((g) => isDone(g.status)).length;
    const readinessPending = readinessSteps.filter((g) => g.status === 'pending').length;

    // 4. VTech Installer: total · done · pending of installer steps (sheet colour E06666)
    const installerSteps = activeGate.filter((g) => (g.sheet_colour ?? '').toUpperCase() === 'E06666');
    const installerTotal = installerSteps.length;
    const installerDone = installerSteps.filter((g) => isDone(g.status)).length;
    const installerPending = installerSteps.filter((g) => g.status === 'pending').length;

    // 5. VTech Programmer: total · done · pending of programmer steps (sheet colour F4CCCC)
    const programmerSteps = activeGate.filter((g) => (g.sheet_colour ?? '').toUpperCase() === 'F4CCCC');
    const programmerTotal = programmerSteps.length;
    const programmerDone = programmerSteps.filter((g) => isDone(g.status)).length;
    const programmerPending = programmerSteps.filter((g) => g.status === 'pending').length;

    const chaseable = activeGate.filter(
      (g) => !isDone(g.status) && !g.locked && g.status === 'pending' && !g.waits_on_client
    ).length;
    const needsSteps = activeLines.filter((l) => !l.product_id && !(gateByLine.get(l.id)?.length)).length;

    return {
      products: { total: totalLines, done: doneLines, notDone: notDoneLines },
      otherAgencyPending,
      readiness: { total: readinessTotal, done: readinessDone, pending: readinessPending },
      installer: { total: installerTotal, done: installerDone, pending: installerPending },
      programmer: { total: programmerTotal, done: programmerDone, pending: programmerPending },
      chaseable,
      needsSteps,
    };
  }, [activeLines, activeGate, gateByLine]);

  // ── matrix rows: only lines whose ✗ step is pending/open ──
  // The ✗ step = the first step (sheet order) that is open and not Done/N.A.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeLines
      .map((l) => {
        const g = gateByLine.get(l.id) ?? [];
        const ordered = [...g].sort((a, b) => a.seq - b.seq);
        const currentStep = ordered.find((r) => !isDone(r.status) && !r.locked);
        const st = lineStatus(g);

        const currentAgency = currentStep?.agency_id ? agencyById.get(currentStep.agency_id) : undefined;
        const currentDefType = currentStep?.step_id ? stepAgencyTypes.get(currentStep.step_id) : undefined;
        const resp = currentStep ? responsibleMap.get(currentStep.item_id) : null;
        const blockedBy = currentStep
          ? formatBlockedBy(resp?.responsible || currentAgency?.agency_types?.name || currentDefType, currentAgency?.company_name)
          : null;

        return { line: l, gate: g, st, currentStep, waitingOnAgency: blockedBy, blockedBy, project: projectById.get(l.project_id ?? '') };
      })
      .filter(({ line, gate: g, st, currentStep }) => {
        // Search filter
        if (q && !`${titleOf(line)} ${line.location ?? ''} ${where(line.room_id)} ${line.brand ?? ''} ${line.model ?? ''}`.toLowerCase().includes(q)) return false;
        // Agency filter
        if (agencyFilter !== 'all' && !g.some((x) => x.agency_id === agencyFilter && !isDone(x.status))) return false;

        // Status filter: by default 'open' (only lines whose ✗ step is pending/open)
        if (statusFilter === 'open') {
          return currentStep !== undefined;
        }
        if (statusFilter === 'stuck') {
          return currentStep?.status === 'pending';
        }
        if (statusFilter === 'done') {
          return st.allDone;
        }
        return true; // 'all'
      });
  }, [activeLines, gateByLine, search, agencyFilter, statusFilter, agencyById, stepAgencyTypes, projectById]);

  // ── Grouping: Company-wide by Project, then inside each project by SortBy ──
  const groupedProjects = useMemo(() => {
    const m = new Map<string, { project: ProjectTile; rows: typeof rows }>();
    for (const r of rows) {
      const p = r.project ?? { id: r.line.project_id ?? 'unknown', name: 'Other', client_name: null, site_address: null, status: 'active', pending: 0, done: 0, total: 0 };
      const gr = m.get(p.id) ?? { project: p, rows: [] };
      gr.rows.push(r);
      m.set(p.id, gr);
    }
    return [...m.values()].sort((a, b) => b.rows.length - a.rows.length || a.project.name.localeCompare(b.project.name));
  }, [rows]);

  // Sub-group helper within a set of rows
  const groupRows = useCallback((projectRows: typeof rows) => {
    const m = new Map<string, { key: string; label: string; sub?: string; order: (number | string)[]; rows: typeof rows }>();
    for (const r of projectRows) {
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
        // Agency-wise: type first, VTech without repeated name
        const key = r.waitingOnAgency || 'General – Unassigned';
        const label = key;
        const isVTech = label.endsWith('– VTech');
        const order = [isVTech ? 1 : 0, label];
        const gr = m.get(key) ?? { key, label, order, rows: [] as typeof rows };
        gr.rows.push(r);
        m.set(key, gr);
      } else {
        // Room-wise keeps floor as sub-label
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
  }, [sortBy, roomById, floorById]);

  // ── actions ──
  function sendReminders() {
    const targetId = selectedId || projects.find((p) => p.status === 'active')?.id;
    if (!targetId) return;
    router.push(`/projects/${targetId}/reminders`);
  }

  async function setProjectStatus(status: ProjectStatus) {
    if (!selected) return;
    setBusy('status');
    const { error: e } = await supabaseBrowser().from('projects').update({ status }).eq('id', selected.id);
    setBusy(null);
    if (e) { setError(e.message); return; }
    flash(status === 'active' ? 'Project reopened.' : 'Project status updated.');
    if (status === 'closed') setShowArchived(true);
    await loadProjects();
  }

  if (loading) return (<><AppHeader /><div className="flex min-h-[60dvh] items-center justify-center"><Spinner /></div></>);

  return (
    <div className="min-h-dvh pb-36">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
        {/* ── title + projects ── */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            <GlassIcon name="building" size={44} />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">VTech Dashboard</h1>
              <p className="text-sm text-text-secondary">
                {profile?.full_name ? `Hello, ${profile.full_name.split(' ')[0]}. ` : ''}
                {selectedId ? `Viewing lines for ${selected?.name}. Click tile again for company-wide view.` : 'Company-wide view: showing all lines currently being worked on.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {selectedId && (
              <button
                type="button"
                onClick={() => handleSelectProject('')}
                className="rounded-xl border border-accent bg-accent/10 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/20 transition"
              >
                ← Back to Company-wide
              </button>
            )}
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Show closed &amp; finished
            </label>
          </div>
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
                      <span className="font-extrabold text-text-primary">{f.project_name}</span>: add the{' '}
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

        {/* Project tiles on top */}
        <section aria-label="Projects" className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleProjects.length === 0 && <p className="col-span-full rounded-2xl border border-border bg-surface p-6 text-sm text-text-secondary">No projects yet. Use “Projects → New project” to import a BOQ.</p>}
          {visibleProjects.map((p) => {
            const pct = p.total ? Math.round((100 * p.done) / p.total) : 0;
            const active = p.id === selectedId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectProject(p.id)}
                aria-pressed={active}
                className={`group rounded-2xl border bg-surface p-4 text-left transition hover:-translate-y-0.5 ${active ? 'border-accent ring-2 ring-accent/25' : 'border-border'}`}
              >
                <h3 className="truncate text-base font-extrabold text-text-primary">{p.name}</h3>
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

        {/* Selected Project banner if filtered */}
        {selected && (
          <section aria-label={selected.name} className="mt-6 rounded-2xl border border-border bg-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex flex-wrap items-center gap-2 text-xl font-extrabold">
                  {selected.name}
                  <span className="rounded-md bg-surface-alt px-2 py-0.5 text-xs font-medium text-text-secondary">{activeLines.length} BOQ lines</span>
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
                    await loadProjects();
                    setSelectedId('');
                    flash(`Project "${name}" deleted.`);
                  }}
                />
              </div>
            </div>
          </section>
        )}

        {/* 5 stat cards in one line */}
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
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
            label="VTech Readiness"
            value={
              <>
                <span className="text-text-primary">{totals.readiness.total}</span>
                <span className="text-text-muted"> · </span>
                <span className="text-success">{totals.readiness.done}</span>
                <span className="text-text-muted"> · </span>
                <span className="text-danger">{totals.readiness.pending}</span>
              </>
            }
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
        <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
          <GroupingToggle value={sortBy} onChange={setSortBy} />
          <select aria-label="Status filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="w-full rounded-xl border border-border px-3 py-2 sm:w-auto">
            <option value="open">Being worked on ({rows.length})</option>
            <option value="all">All lines ({activeLines.length})</option>
            <option value="stuck">Stuck with a reason</option>
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
            ✓ = done
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-xs border-2 border-text-primary bg-surface" />
            ✗ = being worked on
          </span>
        </div>

        {/* ── Lines Matrix ── */}
        <div className="mt-4">
          <div className="hidden grid-cols-[minmax(200px,1.5fr)_minmax(120px,0.9fr)_56px_minmax(280px,2.6fr)] gap-4 border-b border-border px-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary md:grid">
            <span>Product</span><span>Location</span><span className="text-right">Qty</span><span>Status</span>
          </div>
          {detailLoading && <div className="flex justify-center py-10"><Spinner /></div>}
          {!detailLoading && rows.length === 0 && (
            <p className="py-10 text-center text-sm text-text-secondary">No lines matching these filters.</p>
          )}

          {!detailLoading && (
            <div className="space-y-6">
              {groupedProjects.map((pGroup) => {
                const subGroups = groupRows(pGroup.rows);
                return (
                  <div key={pGroup.project.id} className="mt-6 rounded-2xl border border-border bg-surface p-4 sm:p-5">
                    {/* Project group header: bold, 18px, heavy */}
                    <div className="flex items-center justify-between pb-3 border-b border-border/80">
                      <div className="flex items-center gap-2.5">
                        <GlassIcon name="building" size={26} tint="clear" />
                        <h2 className="text-[18px] font-extrabold text-text-primary">
                          {pGroup.project.name}
                        </h2>
                        <span className="rounded-md bg-surface-alt px-2 py-0.5 text-xs font-semibold text-text-secondary">
                          {pGroup.rows.length} {pGroup.rows.length === 1 ? 'line' : 'lines'}
                        </span>
                      </div>
                      {!selectedId && (
                        <button
                          type="button"
                          onClick={() => handleSelectProject(pGroup.project.id)}
                          className="text-xs font-semibold text-accent hover:underline"
                        >
                          Focus project →
                        </button>
                      )}
                    </div>

                    {/* Sub groups inside project */}
                    <div className="space-y-4 mt-3">
                      {subGroups.map((g) => (
                        <div key={g.key}>
                          <h3 className="flex items-center gap-2 px-1 text-sm font-semibold">
                            <GlassIcon name={sortBy === 'product' ? 'products' : sortBy === 'agency' ? 'agencies' : 'rooms'} size={20} tint="clear" />
                            {g.label}{g.sub ? <span className="font-normal text-text-secondary">· {g.sub}</span> : null}
                            <span className="text-xs font-normal text-text-muted">({g.rows.length})</span>
                          </h3>
                          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border">
                            {g.rows.map(({ line, gate: lg, currentStep, waitingOnAgency }) => {
                              const needsSteps = !line.product_id && lg.length === 0;
                              const spec = [line.brand, line.make, line.model].filter(Boolean).join(' · ');
                              const targetStep = currentStep ?? lg[0];
                              return (
                                <li
                                  key={line.id}
                                  data-line={line.id}
                                  onClick={() => { if (!needsSteps && targetStep) setStepRow(targetStep); }}
                                  className={`grid grid-cols-1 gap-3 bg-surface px-4 py-3 transition-colors hover:bg-surface-alt/40 md:grid-cols-[minmax(200px,1.5fr)_minmax(120px,0.9fr)_56px_minmax(280px,2.6fr)] md:items-center md:gap-4 ${!needsSteps && targetStep ? 'cursor-pointer' : ''}`}
                                >
                                  {/* Product column */}
                                  <div className="min-w-0">
                                    <p className="font-semibold text-text-primary">
                                      {titleOf(line)}
                                      {!line.product_id && <span className="ml-1.5 rounded bg-warning-light px-1 text-[10px] font-semibold uppercase text-warning">not in list</span>}
                                    </p>
                                    {spec && <p className="truncate text-xs text-text-muted">{spec}</p>}
                                    {waitingOnAgency && (
                                      <p className="mt-1 flex items-center gap-1 text-xs text-text-secondary" title={`Blocked by: ${waitingOnAgency}`}>
                                        <Glyph name="building" className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                                        <span className="truncate">Blocked by {waitingOnAgency}</span>
                                      </p>
                                    )}
                                  </div>

                                  {/* Location column: Room-wise has location main; Agency & Product have room big, location small */}
                                  <div className="min-w-0">
                                    {sortBy === 'room' ? (
                                      <p className="text-sm font-semibold text-text-primary truncate">
                                        {line.location || '—'}
                                      </p>
                                    ) : (
                                      <>
                                        <p className="text-sm font-semibold text-text-primary truncate">
                                          {roomById.get(line.room_id)?.name ?? '—'}
                                        </p>
                                        <p className="text-xs text-text-muted truncate">
                                          {line.location || '—'}
                                        </p>
                                      </>
                                    )}
                                  </div>

                                  {/* Qty column */}
                                  <div className="text-sm tabular-nums md:text-right">
                                    <span className="md:hidden text-xs text-text-muted">Qty: </span>{line.quantity}
                                  </div>

                                  {/* Status column: current step label + colour + SegmentedColorBar */}
                                  <div className="min-w-0">
                                    {needsSteps ? (
                                      <button type="button" onClick={(e) => { e.stopPropagation(); setCustomFor(line); }} className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white">
                                        <Glyph name="plus" /> Add dependencies
                                      </button>
                                    ) : (
                                      <div className="flex flex-col gap-1.5">
                                        {currentStep && (
                                          <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                                            <span
                                              className="h-2 w-2 rounded-full shrink-0"
                                              style={{ background: stepColour(currentStep.sheet_colour).bg, boxShadow: `0 0 0 1px ${stepColour(currentStep.sheet_colour).ring}` }}
                                            />
                                            <span className="truncate text-text-primary font-semibold">{currentStep.label}</span>
                                          </div>
                                        )}
                                        <SegmentedColorBar
                                          steps={lg}
                                          onOpen={(r) => setStepRow(r)}
                                        />
                                      </div>
                                    )}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Floating buttons: "Send reminders" stacked 12px above "Add dependency" at bottom-right */}
      <button
        type="button"
        onClick={sendReminders}
        disabled={busy === 'remind'}
        aria-label="Send reminders"
        className="fixed bottom-[82px] right-6 z-40 flex items-center gap-2 rounded-full bg-accent py-2 pl-3 pr-4 text-sm font-semibold text-white shadow-xl transition hover:scale-105 active:scale-95 disabled:opacity-50"
      >
        <Glyph name="send" className="h-4 w-4" />
        <span className="hidden sm:inline">Send reminders</span>
        <span className="sm:hidden text-xs">Reminders</span>
      </button>

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
          lines={activeLines.filter((l) => l.project_id === selected.id).map((l) => ({ id: l.id, title: titleOf(l), room: where(l.room_id), location: l.location, quantity: l.quantity, brand: l.brand, make: l.make, model: l.model }))}
          onClose={() => setEditing(false)}
          onSaved={async (msg) => { setEditing(false); flash(msg); await refresh(); }}
        />
      )}
    </div>
  );
}

/** Segmented colour bar: one segment per step, coloured by sheet_colour.
 * ✓ = done/N.A.
 * ✗ = open (not locked) and not done = the dependency being worked on now.
 * Locked / not started = blank (no mark). Red/orange etc. stay blank until they open.
 * The "being worked on" step keeps its dark outline.
 */
function SegmentedColorBar({ steps, onOpen }: { steps: GateRow[]; onOpen: (r: GateRow) => void }) {
  const ordered = [...steps].sort((a, b) => a.seq - b.seq);
  if (ordered.length === 0) return null;

  const doneCount = ordered.filter((r) => isDone(r.status)).length;
  // The first step (sheet order) that is open and not Done/N.A. (being worked on)
  const currentStep = ordered.find((r) => !isDone(r.status) && !r.locked);

  return (
    <div className="flex items-center gap-2">
      <div className="flex h-5 flex-1 items-center gap-1 min-w-[120px] max-w-xs" aria-label="Step progress">
        {ordered.map((r) => {
          const c = stepColour(r.sheet_colour);
          const done = isDone(r.status);
          const locked = r.locked && !done;
          const isOpen = !locked && !done;
          const isCurrent = currentStep ? r.item_id === currentStep.item_id : false;

          const tip = `${r.label}${done ? ' (done)' : isCurrent ? ` (being worked on${r.stuck_reason ? `: ${r.stuck_reason}` : ''})` : isOpen ? ` (open${r.stuck_reason ? `: ${r.stuck_reason}` : ''})` : ' (locked)'}`;
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
                backgroundColor: done || isOpen ? c.bg : 'transparent',
                borderColor: isCurrent ? '#0f172a' : isOpen ? c.ring : done ? c.ring : 'transparent',
                borderWidth: isCurrent ? '2px' : done ? '1px' : locked ? '0px' : '2px',
                borderStyle: 'solid',
                boxShadow: isCurrent ? '0 0 0 1px #0f172a' : undefined,
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
              ) : isOpen ? (
                // ✗ = open (not locked) and not done = the dependency being worked on now
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
