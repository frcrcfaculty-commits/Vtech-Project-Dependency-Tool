'use client';

// Projects & BOQ Page (v9) — Managers only (super_admin, pm_lead).
// Tabs order: 1. Current BOQ · 2. BOQ History · 3. Initial BOQ · 4. Conso.
// Top toolbar (one aligned row): left = Modify BOQ; right = Print room-wise · Print conso · Print comparison · Print history.
// Current BOQ: room-wise (Floor → Room → Product · Location · Make · Model · Qty · status bar), left colour stripe by conso group (10 calm colours + legend), progress chip (done/total in green/amber/red).
// BOQ History: show only changes = boq_events with change_id is not null.
// Initial BOQ: room-wise, built from boq_events with event = 'added' and change_id is null.
// Conso: grouped by product_catalogue.conso_group in conso_sort order with group subtotals, make/model breakdown, rooms count, total qty.

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { AppHeader } from '@/components/app-header';
import { supabaseBrowser } from '@/lib/client/supabase';
import { GlassIcon, Glyph } from '@/components/glass-icon';
import { EditProjectDialog, type EditableLine } from '@/components/v4/edit-project-dialog';
import { BoqHistoryTab } from '@/components/v7/boq-history-tab';
import { CONSO_GROUPS, CONSO_ORDER, getConsoGroupMeta } from '@/lib/client/conso';
import { stepColour, isDone, type GateRow } from '@/lib/client/steps';
import Link from 'next/link';

function MiniCheckIcon({ color }: { color: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="10"
      height="10"
      className="h-2.5 w-2.5 shrink-0"
      fill="none"
      stroke={color}
      strokeWidth={2.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function MiniXIcon({ color }: { color: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="10"
      height="10"
      className="h-2.5 w-2.5 shrink-0"
      fill="none"
      stroke={color}
      strokeWidth={2.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

type ProjectStatus = 'active' | 'finished' | 'closed' | 'on_hold';
type FilterStatus = 'active' | 'finished' | 'all';
type BoqViewTab = 'current' | 'history' | 'initial' | 'conso';

interface ProjectRow {
  id: string;
  name: string;
  client_name: string | null;
  site_address: string | null;
  status: ProjectStatus;
  created_at: string;
}

interface RoomProductRow {
  id: string;
  project_id: string;
  room_id: string | null;
  product_id: string | null;
  boq_title: string | null;
  location: string | null;
  quantity: number;
  brand: string | null;
  make: string | null;
  model: string | null;
  note: string | null;
  created_at: string;
  product_catalogue: {
    id: string;
    title: string;
    scope: string;
    conso_group: string | null;
    conso_sort: number | null;
  } | null;
  rooms: {
    id: string;
    name: string;
    sort: number;
    floors: { id: string; label: string; sort: number } | null;
  } | null;
}

interface InitialBoqEventRow {
  id: string;
  product: string;
  floor: string | null;
  room: string | null;
  location: string | null;
  quantity: number | null;
}

interface RoomItem {
  id: string;
  name: string;
  floorLabel: string;
  floorSort: number;
  roomSort: number;
}

export default function ProjectsPage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();

  // Access control: managers only (super_admin, pm_lead)
  useEffect(() => {
    if (!authLoading && profile) {
      if (profile.role !== 'super_admin' && profile.role !== 'pm_lead') {
        router.replace('/hub');
      }
    }
  }, [authLoading, profile, router]);

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('active');
  const [activeTab, setActiveTab] = useState<BoqViewTab>('current');

  // Project details & products
  const [products, setProducts] = useState<RoomProductRow[]>([]);
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [gateRows, setGateRows] = useState<GateRow[]>([]);
  const [initialEvents, setInitialEvents] = useState<InitialBoqEventRow[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Edit BOQ Dialog modal state
  const [editingBoq, setEditingBoq] = useState(false);

  const flash = (m: string) => {
    setNotice(m);
    setTimeout(() => setNotice(null), 3500);
  };

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const sb = supabaseBrowser();
      const { data, error: err } = await sb
        .from('projects')
        .select('id, name, client_name, site_address, status, created_at')
        .order('name');
      if (err) throw err;
      const list = (data ?? []) as ProjectRow[];
      setProjects(list);
      if (list.length > 0 && !selectedProjectId) {
        const firstActive = list.find((p) => p.status === 'active') || list[0];
        setSelectedProjectId(firstActive.id);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (!authLoading && profile) {
      fetchProjects();
    }
  }, [authLoading, profile, fetchProjects]);

  const loadProjectBoq = useCallback(async (projId: string) => {
    if (!projId) return;
    try {
      setDetailsLoading(true);
      const sb = supabaseBrowser();
      const [
        { data: pData, error: pErr },
        { data: rData, error: rErr },
        { data: gData, error: gErr },
        { data: initData, error: initErr },
      ] = await Promise.all([
        sb
          .from('room_products')
          .select(
            'id, project_id, room_id, product_id, boq_title, location, quantity, brand, make, model, note, created_at, product_catalogue(id, title, scope, conso_group, conso_sort), rooms(id, name, sort, floors(id, label, sort))'
          )
          .eq('project_id', projId),
        sb
          .from('rooms')
          .select('id, name, sort, floors(id, label, sort)')
          .eq('project_id', projId)
          .order('sort'),
        sb
          .from('item_gate')
          .select('*')
          .eq('project_id', projId)
          .order('seq'),
        sb
          .from('boq_events')
          .select('id, product, floor, room, location, quantity')
          .eq('project_id', projId)
          .eq('event', 'added')
          .is('change_id', null)
          .order('floor')
          .order('room'),
      ]);

      if (pErr) throw pErr;
      if (rErr) throw rErr;
      if (gErr) throw gErr;
      if (initErr) throw initErr;

      setProducts((pData ?? []) as unknown as RoomProductRow[]);
      setGateRows((gData ?? []) as GateRow[]);
      setInitialEvents((initData ?? []) as InitialBoqEventRow[]);

      type RRaw = { id: string; name: string; sort: number; floors: { id: string; label: string; sort: number } | null };
      const rList: RoomItem[] = ((rData as unknown as RRaw[]) ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        floorLabel: r.floors?.label ?? 'General',
        floorSort: r.floors?.sort ?? 0,
        roomSort: r.sort ?? 0,
      }));
      setRooms(rList);
    } catch (e: any) {
      setError(e?.message || 'Failed to load BOQ details');
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      loadProjectBoq(selectedProjectId);
    }
  }, [selectedProjectId, loadProjectBoq]);

  // Index gate rows by room_product_id for quick lookup
  const productGateMap = useMemo(() => {
    const map = new Map<string, GateRow[]>();
    for (const g of gateRows) {
      const arr = map.get(g.room_product_id) ?? [];
      arr.push(g);
      map.set(g.room_product_id, arr);
    }
    return map;
  }, [gateRows]);

  // Filtered projects list (Active · Finished · All)
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (statusFilter === 'active' && p.status !== 'active') return false;
      if (statusFilter === 'finished' && p.status !== 'finished') return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = p.name.toLowerCase().includes(q);
        const matchClient = p.client_name?.toLowerCase().includes(q) ?? false;
        const matchAddress = p.site_address?.toLowerCase().includes(q) ?? false;
        if (!matchName && !matchClient && !matchAddress) return false;
      }
      return true;
    });
  }, [projects, statusFilter, searchQuery]);

  const selectedProject = useMemo(() => {
    return projects.find((p) => p.id === selectedProjectId) ?? filteredProjects[0] ?? null;
  }, [projects, selectedProjectId, filteredProjects]);

  // ── 1. Current BOQ: Room-wise Grouping (Floor → Room → Products) ──
  const roomWiseCurrentBoq = useMemo(() => {
    type RoomGroup = {
      roomId: string;
      roomName: string;
      floorLabel: string;
      floorSort: number;
      roomSort: number;
      items: RoomProductRow[];
    };

    const roomMap = new Map<string, RoomGroup>();

    for (const p of products) {
      const roomId = p.room_id || 'project_wide';
      const rName = p.rooms?.name ?? 'Project-wide';
      const fLabel = p.rooms?.floors?.label ?? 'General';
      const fSort = p.rooms?.floors?.sort ?? 999;
      const rSort = p.rooms?.sort ?? 999;

      const existing = roomMap.get(roomId) ?? {
        roomId,
        roomName: rName,
        floorLabel: fLabel,
        floorSort: fSort,
        roomSort: rSort,
        items: [],
      };
      existing.items.push(p);
      roomMap.set(roomId, existing);
    }

    // Group rooms by floor
    type FloorGroup = {
      floorLabel: string;
      floorSort: number;
      rooms: RoomGroup[];
      totalUnits: number;
    };

    const floorMap = new Map<string, FloorGroup>();
    for (const rGroup of roomMap.values()) {
      const existing = floorMap.get(rGroup.floorLabel) ?? {
        floorLabel: rGroup.floorLabel,
        floorSort: rGroup.floorSort,
        rooms: [],
        totalUnits: 0,
      };
      existing.rooms.push(rGroup);
      existing.totalUnits += rGroup.items.reduce((sum, item) => sum + (item.quantity || 1), 0);
      floorMap.set(rGroup.floorLabel, existing);
    }

    // Sort floors and rooms
    const sortedFloors = [...floorMap.values()].sort((a, b) => a.floorSort - b.floorSort || a.floorLabel.localeCompare(b.floorLabel));
    sortedFloors.forEach((f) => {
      f.rooms.sort((a, b) => a.roomSort - b.roomSort || a.roomName.localeCompare(b.roomName));
    });

    return sortedFloors;
  }, [products]);

  // ── 2. Initial BOQ: Room-wise Grouping (built from boq_events where change_id is null) ──
  const roomWiseInitialBoq = useMemo(() => {
    type InitialItem = InitialBoqEventRow;
    type InitialRoomGroup = {
      roomName: string;
      floorLabel: string;
      items: InitialItem[];
      totalUnits: number;
    };

    const roomMap = new Map<string, InitialRoomGroup>();

    for (const ev of initialEvents) {
      const fLabel = ev.floor || 'General';
      const rName = ev.room || 'Project-wide';
      const key = `${fLabel}___${rName}`;

      const existing = roomMap.get(key) ?? {
        roomName: rName,
        floorLabel: fLabel,
        items: [],
        totalUnits: 0,
      };
      existing.items.push(ev);
      existing.totalUnits += ev.quantity || 1;
      roomMap.set(key, existing);
    }

    // Group by floor
    type InitialFloorGroup = {
      floorLabel: string;
      rooms: InitialRoomGroup[];
      totalUnits: number;
    };

    const floorMap = new Map<string, InitialFloorGroup>();
    for (const rGroup of roomMap.values()) {
      const existing = floorMap.get(rGroup.floorLabel) ?? {
        floorLabel: rGroup.floorLabel,
        rooms: [],
        totalUnits: 0,
      };
      existing.rooms.push(rGroup);
      existing.totalUnits += rGroup.totalUnits;
      floorMap.set(rGroup.floorLabel, existing);
    }

    return [...floorMap.values()].sort((a, b) => a.floorLabel.localeCompare(b.floorLabel));
  }, [initialEvents]);

  // ── 3. Conso Tab: Grouped by product_catalogue.conso_group in conso_sort order ──
  const consoGroupedData = useMemo(() => {
    type ConsoProductSummary = {
      productTitle: string;
      makeModelBreakdown: Map<string, number>;
      rooms: Set<string>;
      totalQuantity: number;
      consoGroup: string;
      consoSort: number;
    };

    const productMap = new Map<string, ConsoProductSummary>();

    for (const p of products) {
      const title = p.product_catalogue?.title ?? p.boq_title ?? 'Product';
      const make = p.make || p.brand || null;
      const model = p.model || null;
      const mmKey = [make, model].filter(Boolean).join(' / ') || 'Standard';
      const consoGroup = p.product_catalogue?.conso_group || 'Other';
      const consoSort = p.product_catalogue?.conso_sort ?? (consoGroup === 'Other' ? 999 : 90);

      const key = `${consoGroup}___${title}`.toLowerCase();
      const existing = productMap.get(key) ?? {
        productTitle: title,
        makeModelBreakdown: new Map<string, number>(),
        rooms: new Set<string>(),
        totalQuantity: 0,
        consoGroup,
        consoSort,
      };

      const currMM = existing.makeModelBreakdown.get(mmKey) ?? 0;
      existing.makeModelBreakdown.set(mmKey, currMM + (p.quantity || 1));
      existing.totalQuantity += p.quantity || 1;
      if (p.rooms?.name) existing.rooms.add(p.rooms.name);
      productMap.set(key, existing);
    }

    // Group summaries into Conso groups
    type ConsoGroupSection = {
      groupName: string;
      meta: (typeof CONSO_GROUPS)[string];
      items: {
        productTitle: string;
        makeModelSummary: string;
        roomsCount: number;
        totalQuantity: number;
      }[];
      subtotalUnits: number;
    };

    const groupMap = new Map<string, ConsoGroupSection>();

    for (const summary of productMap.values()) {
      const gName = summary.consoGroup || 'Other';
      const meta = getConsoGroupMeta(gName);

      const existing = groupMap.get(gName) ?? {
        groupName: gName,
        meta,
        items: [],
        subtotalUnits: 0,
      };

      // Format make/model breakdown string
      const mmPairs = [...summary.makeModelBreakdown.entries()].map(([spec, count]) =>
        spec === 'Standard' ? `${count} units` : `${spec} (${count})`
      );

      existing.items.push({
        productTitle: summary.productTitle,
        makeModelSummary: mmPairs.join(', ') || '—',
        roomsCount: summary.rooms.size,
        totalQuantity: summary.totalQuantity,
      });

      existing.subtotalUnits += summary.totalQuantity;
      groupMap.set(gName, existing);
    }

    // Sort groups in CONSO_ORDER
    const orderedGroups: ConsoGroupSection[] = [];
    for (const grpName of CONSO_ORDER) {
      const grp = groupMap.get(grpName);
      if (grp && grp.items.length > 0) {
        grp.items.sort((a, b) => b.totalQuantity - a.totalQuantity || a.productTitle.localeCompare(b.productTitle));
        orderedGroups.push(grp);
      }
    }

    // Include any groups not in CONSO_ORDER if they exist
    for (const [k, grp] of groupMap.entries()) {
      if (!CONSO_ORDER.includes(k as any) && grp.items.length > 0) {
        grp.items.sort((a, b) => b.totalQuantity - a.totalQuantity || a.productTitle.localeCompare(b.productTitle));
        orderedGroups.push(grp);
      }
    }

    const grandTotalUnits = orderedGroups.reduce((acc, g) => acc + g.subtotalUnits, 0);
    const totalDistinctProducts = orderedGroups.reduce((acc, g) => acc + g.items.length, 0);

    return {
      groups: orderedGroups,
      grandTotalUnits,
      totalDistinctProducts,
    };
  }, [products]);

  const editableLines: EditableLine[] = useMemo(() => {
    return products.map((l) => ({
      id: l.id,
      title: l.product_catalogue?.title ?? l.boq_title ?? 'Product',
      room: l.rooms?.name ?? 'Project-wide',
      location: l.location,
      quantity: l.quantity,
      brand: l.brand,
      make: l.make,
      model: l.model,
    }));
  }, [products]);

  if (authLoading || (profile && profile.role !== 'super_admin' && profile.role !== 'pm_lead')) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-alt">
        <svg className="h-8 w-8 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-surface-alt pb-20">
      <AppHeader />

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-6">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-3">
              <GlassIcon name="products" size={36} />
              <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">Projects &amp; BOQ</h1>
              <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent">
                Managers Only
              </span>
            </div>
            <p className="text-xs sm:text-sm text-text-secondary mt-1">
              View current room-wise BOQ, audit change history, initial baseline, and consolidated equipment groups.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <Link
              href="/projects/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors"
            >
              <Glyph name="plus" />
              New project
            </Link>
          </div>
        </div>

        {/* Informative placeholder banner */}
        <div className="mb-6 rounded-2xl border border-accent/30 bg-accent/5 p-4 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white font-bold text-base shadow-xs">
                📋
              </span>
              <div>
                <h3 className="text-sm font-bold text-text-primary">BOQ by Head PM (Raju) — coming soon</h3>
                <p className="text-xs text-text-muted mt-0.5">
                  Standardised item templates, bill rate analysis, and master procurement workflows (details arrive in 3 days).
                </p>
              </div>
            </div>
            <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
              In Development · 3 Days
            </span>
          </div>
        </div>

        {notice && (
          <div role="status" className="mb-4 rounded-xl border border-success/30 bg-success-light px-4 py-2.5 text-xs font-semibold text-success">
            {notice}
          </div>
        )}
        {error && (
          <div role="alert" className="mb-4 rounded-xl border border-danger/30 bg-danger-light px-4 py-2.5 text-xs font-semibold text-danger">
            {error}
          </div>
        )}

        {/* Filter and Search Bar: Active · Finished · All */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3.5 shadow-xs">
          <div className="relative flex-1 min-w-[240px]">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects by name, client, site address…"
              className="w-full rounded-xl border border-border bg-surface-alt/50 pl-3.5 pr-8 py-2 text-xs sm:text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div className="inline-flex rounded-xl border border-border bg-surface-alt/70 p-1">
            <button
              type="button"
              onClick={() => setStatusFilter('active')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === 'active'
                  ? 'bg-surface text-text-primary shadow-xs font-bold'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Active ({projects.filter((p) => p.status === 'active').length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('finished')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === 'finished'
                  ? 'bg-surface text-text-primary shadow-xs font-bold'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Finished ({projects.filter((p) => p.status === 'finished').length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === 'all'
                  ? 'bg-surface text-text-primary shadow-xs font-bold'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              All ({projects.length})
            </button>
          </div>
        </div>

        {/* Main Layout: Project List Sidebar & Selected Project BOQ */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Projects Selector List (4 cols) */}
          <div className="lg:col-span-4 rounded-2xl border border-border bg-surface p-4 shadow-xs space-y-2 max-h-[75vh] overflow-y-auto">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary px-1 mb-2">
              Select Project ({filteredProjects.length})
            </h3>
            {filteredProjects.length === 0 && (
              <p className="text-xs text-text-muted py-4 text-center">No projects match filter.</p>
            )}
            {filteredProjects.map((p) => {
              const active = p.id === selectedProjectId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedProjectId(p.id)}
                  className={`w-full text-left rounded-xl p-3 transition border ${
                    active
                      ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
                      : 'border-border bg-surface hover:bg-surface-alt/60'
                  }`}
                >
                  <h4 className="text-sm font-[800] text-text-primary truncate">{p.name}</h4>
                  <p className="text-[11px] text-text-secondary truncate mt-0.5">
                    {[p.client_name, p.site_address].filter(Boolean).join(' · ') || 'No details'}
                  </p>
                  <span
                    className={`inline-block mt-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      p.status === 'active' ? 'bg-success-light text-success' : 'bg-surface-alt text-text-muted'
                    }`}
                  >
                    {p.status}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Project BOQ View (8 cols) */}
          <div className="lg:col-span-8 space-y-5">
            {selectedProject ? (
              <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
                {/* Project Header Block & Top Toolbar (One aligned row) */}
                <div className="border-b border-border/80 pb-4 space-y-3">
                  <div>
                    <h2 className="text-xl font-[800] text-text-primary">
                      {selectedProject.name}
                    </h2>
                    <p className="text-xs text-text-secondary mt-1">
                      {[selectedProject.client_name && `Client: ${selectedProject.client_name}`, selectedProject.site_address]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      {products.length} Current BOQ lines · Status:{' '}
                      <span className="font-semibold uppercase">{selectedProject.status}</span>
                    </p>
                  </div>

                  {/* Top Toolbar (One aligned row: left = Modify BOQ; right = 4 Print buttons) */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => setEditingBoq(true)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors min-w-[120px] shrink-0"
                    >
                      <Glyph name="edit" />
                      Modify BOQ
                    </button>

                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`/api/reports/projects/${selectedProject.id}/boq-room-wise.pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors min-w-[110px] text-center shadow-2xs"
                      >
                        Print room-wise
                      </a>
                      <a
                        href={`/api/reports/projects/${selectedProject.id}/boq-conso.pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors min-w-[110px] text-center shadow-2xs"
                      >
                        Print conso
                      </a>
                      <a
                        href={`/api/reports/projects/${selectedProject.id}/boq-comparison.pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors min-w-[110px] text-center shadow-2xs"
                      >
                        Print comparison
                      </a>
                      <a
                        href={`/api/reports/projects/${selectedProject.id}/boq-history.pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors min-w-[110px] text-center shadow-2xs"
                      >
                        Print history
                      </a>
                    </div>
                  </div>
                </div>

                {/* Tabs Order: 1. Current BOQ · 2. BOQ History · 3. Initial BOQ · 4. Conso */}
                <div className="flex flex-wrap gap-1 border-b border-border text-xs sm:text-sm mt-4">
                  {[
                    { id: 'current', label: `1. Current BOQ (${products.length})` },
                    { id: 'history', label: '2. BOQ History' },
                    { id: 'initial', label: `3. Initial BOQ (${initialEvents.length})` },
                    { id: 'conso', label: `4. Conso (${consoGroupedData.totalDistinctProducts})` },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setActiveTab(t.id as BoqViewTab)}
                      className={`-mb-px border-b-2 px-3.5 py-2 font-semibold transition-colors ${
                        activeTab === t.id
                          ? 'border-accent text-accent'
                          : 'border-transparent text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* Tab Contents */}
                <div className="mt-4">
                  {detailsLoading ? (
                    <div className="flex justify-center py-12">
                      <svg className="h-7 w-7 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    </div>
                  ) : activeTab === 'current' ? (
                    /* ── 1. Current BOQ: Room-wise table with 10 Conso colours stripe & step status bar ── */
                    <div className="space-y-4">
                      {/* Conso Group Palette Legend */}
                      <div className="rounded-xl border border-border bg-surface-alt/40 p-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                            Conso Group Palette (Left Colour Stripe)
                          </span>
                          <span className="text-[11px] text-text-muted">
                            10 Subsystem Categories
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                          {CONSO_ORDER.map((grpName) => {
                            const meta = CONSO_GROUPS[grpName];
                            return (
                              <div key={grpName} className="flex items-center gap-1.5">
                                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                                <span className="text-text-primary font-medium text-[11px]">{meta.name}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Floor → Room Table */}
                      {roomWiseCurrentBoq.length === 0 ? (
                        <p className="text-xs text-text-muted py-8 text-center">No BOQ items placed yet.</p>
                      ) : (
                        roomWiseCurrentBoq.map((fl) => (
                          <div key={fl.floorLabel} className="space-y-3">
                            <div className="flex items-center justify-between border-b border-border/70 pb-1.5">
                              <h3 className="text-xs font-extrabold uppercase tracking-wider text-text-primary">
                                {fl.floorLabel} ({fl.rooms.length} rooms · {fl.totalUnits} units)
                              </h3>
                            </div>

                            {fl.rooms.map((rm) => (
                              <div key={rm.roomId} className="rounded-xl border border-border overflow-hidden bg-surface shadow-2xs">
                                <div className="bg-surface-alt/70 px-3.5 py-2 text-xs font-bold text-text-primary flex items-center justify-between border-b border-border">
                                  <span>
                                    {rm.roomName} <span className="font-normal text-text-muted">({rm.floorLabel})</span>
                                  </span>
                                  <span className="text-[11px] font-normal text-text-muted">
                                    {rm.items.length} line items
                                  </span>
                                </div>

                                <div className="divide-y divide-border/60">
                                  {rm.items.map((it) => {
                                    const cGroup = it.product_catalogue?.conso_group || 'Other';
                                    const meta = getConsoGroupMeta(cGroup);
                                    const specStr = [it.make || it.brand, it.model].filter(Boolean).join(' · ');
                                    const steps = productGateMap.get(it.id) ?? [];
                                    const doneCount = steps.filter((s) => isDone(s.status)).length;
                                    const totalCount = steps.length;

                                    return (
                                      <div
                                        key={it.id}
                                        className="relative flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 text-xs hover:bg-surface-alt/30 transition-colors border-l-4"
                                        style={{ borderLeftColor: meta.color }}
                                      >
                                        {/* Product & Conso info */}
                                        <div className="min-w-0 flex-1 space-y-1">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-bold text-text-primary text-[13px]">
                                              {it.product_catalogue?.title ?? it.boq_title ?? 'Product'}
                                            </p>
                                            <span
                                              className="rounded-full px-2 py-0.5 text-[10px] font-semibold border"
                                              style={{
                                                backgroundColor: meta.light,
                                                color: meta.text,
                                                borderColor: meta.border,
                                              }}
                                            >
                                              {meta.name}
                                            </span>
                                          </div>

                                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-text-secondary">
                                            {it.location && (
                                              <span>
                                                Location: <strong className="text-text-primary font-semibold">{it.location}</strong>
                                              </span>
                                            )}
                                            {specStr && (
                                              <span>
                                                Make/Model: <strong className="text-text-primary font-semibold">{specStr}</strong>
                                              </span>
                                            )}
                                          </div>

                                          {it.note && (
                                            <p className="text-[11px] text-text-muted italic">Note: {it.note}</p>
                                          )}
                                        </div>

                                        {/* Quantity, Progress Chip, and Mini Status Bar */}
                                        <div className="flex flex-wrap items-center md:items-end justify-between md:justify-end gap-3 shrink-0">
                                          <div className="flex items-center gap-2">
                                            <span className="rounded bg-surface-alt px-2 py-1 text-xs font-bold text-text-primary">
                                              Qty: {it.quantity || 1}
                                            </span>

                                            {/* Progress Chip: green / amber / red */}
                                            {totalCount > 0 && (
                                              <span
                                                className={`rounded px-2 py-1 text-[11px] font-bold border ${
                                                  doneCount === totalCount
                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                    : doneCount > 0
                                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                    : 'bg-rose-50 text-rose-700 border-rose-200'
                                                }`}
                                              >
                                                {doneCount}/{totalCount} done
                                              </span>
                                            )}
                                          </div>

                                          {/* Mini Status Bar with check / cross */}
                                          {steps.length > 0 && (
                                            <div
                                              className="flex h-3.5 w-full md:w-36 overflow-hidden rounded bg-surface-alt ring-1 ring-border"
                                              title={`${doneCount} of ${totalCount} steps completed`}
                                            >
                                              {steps.map((r) => {
                                                const c = stepColour(r.sheet_colour);
                                                const done = isDone(r.status);
                                                const isStuck = r.status === 'pending';
                                                return (
                                                  <div
                                                    key={r.item_id}
                                                    className="relative flex flex-1 items-center justify-center transition-all"
                                                    style={{ backgroundColor: c.bg }}
                                                    title={`${r.label}: ${r.status}`}
                                                  >
                                                    {done && <MiniCheckIcon color={c.text} />}
                                                    {isStuck && <MiniXIcon color={c.text} />}
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        ))
                      )}
                    </div>
                  ) : activeTab === 'history' ? (
                    /* ── 2. BOQ History: Only Changes (change_id is not null) ── */
                    <BoqHistoryTab
                      projectId={selectedProject.id}
                      projectName={selectedProject.name}
                      rooms={rooms.map((r) => ({ id: r.id, name: r.name }))}
                      isSuperAdmin={profile?.role === 'super_admin'}
                    />
                  ) : activeTab === 'initial' ? (
                    /* ── 3. Initial BOQ: Room-wise baseline built from boq_events (event = 'added' and change_id is null) ── */
                    <div className="space-y-4">
                      <div className="rounded-xl border border-border bg-surface-alt/40 p-3">
                        <h3 className="text-xs font-bold text-text-primary">Initial Baseline (Original Contract BOQ)</h3>
                        <p className="text-[11px] text-text-secondary mt-0.5">
                          Extracted from baseline setup records (before any change requests were applied). Total baseline:{' '}
                          <strong>{initialEvents.reduce((s, it) => s + (it.quantity || 1), 0)} units</strong>.
                        </p>
                      </div>

                      {roomWiseInitialBoq.length === 0 ? (
                        <p className="text-xs text-text-muted py-8 text-center">No initial BOQ baseline recorded.</p>
                      ) : (
                        roomWiseInitialBoq.map((fl) => (
                          <div key={fl.floorLabel} className="space-y-3">
                            <div className="flex items-center justify-between border-b border-border/70 pb-1.5">
                              <h3 className="text-xs font-extrabold uppercase tracking-wider text-text-primary">
                                {fl.floorLabel} ({fl.rooms.length} rooms · {fl.totalUnits} units)
                              </h3>
                            </div>

                            {fl.rooms.map((rm, idx) => (
                              <div key={idx} className="rounded-xl border border-border overflow-hidden bg-surface shadow-2xs">
                                <div className="bg-surface-alt/70 px-3.5 py-2 text-xs font-bold text-text-primary flex items-center justify-between border-b border-border">
                                  <span>{rm.roomName}</span>
                                  <span className="text-[11px] font-normal text-text-muted">
                                    {rm.items.length} items · {rm.totalUnits} units
                                  </span>
                                </div>

                                <div className="divide-y divide-border/60">
                                  {rm.items.map((it) => (
                                    <div
                                      key={it.id}
                                      className="flex items-center justify-between p-3 text-xs hover:bg-surface-alt/30 transition-colors"
                                    >
                                      <div>
                                        <p className="font-bold text-text-primary">{it.product}</p>
                                        <p className="text-[11px] text-text-secondary mt-0.5">
                                          Location: <span className="font-medium">{it.location || 'Entrance'}</span>
                                        </p>
                                      </div>
                                      <div className="text-right">
                                        <span className="rounded bg-surface-alt px-2.5 py-1 text-xs font-bold text-text-primary">
                                          Qty: {it.quantity || 1}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    /* ── 4. Conso Tab: Grouped by product_catalogue.conso_group in conso_sort order ── */
                    <div className="space-y-4">
                      {/* Summary Stats */}
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-alt/40 p-3 text-xs">
                        <div>
                          <h3 className="font-bold text-text-primary">Consolidated Equipment Subsystems</h3>
                          <p className="text-[11px] text-text-secondary mt-0.5">
                            Grouped by official Conso categories in workflow order.
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="rounded-lg bg-surface px-3 py-1.5 font-bold border border-border text-text-primary shadow-2xs">
                            {consoGroupedData.totalDistinctProducts} Products
                          </span>
                          <span className="rounded-lg bg-accent px-3 py-1.5 font-bold text-white shadow-2xs">
                            {consoGroupedData.grandTotalUnits} Total Units
                          </span>
                        </div>
                      </div>

                      {consoGroupedData.groups.length === 0 ? (
                        <p className="text-xs text-text-muted py-8 text-center">No consolidated products found.</p>
                      ) : (
                        consoGroupedData.groups.map((group) => (
                          <div key={group.groupName} className="rounded-xl border border-border overflow-hidden bg-surface shadow-2xs">
                            {/* Group Header with dot and subtotal */}
                            <div
                              className="px-4 py-2.5 flex items-center justify-between border-b"
                              style={{
                                backgroundColor: group.meta.light,
                                borderColor: group.meta.border,
                              }}
                            >
                              <div className="flex items-center gap-2">
                                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: group.meta.color }} />
                                <h3 className="text-xs font-extrabold uppercase tracking-wider" style={{ color: group.meta.text }}>
                                  {group.groupName}
                                </h3>
                              </div>
                              <span className="text-[11px] font-bold" style={{ color: group.meta.text }}>
                                Subtotal: {group.subtotalUnits} units ({group.items.length} products)
                              </span>
                            </div>

                            {/* Table */}
                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-xs">
                                <thead>
                                  <tr className="border-b border-border bg-surface-alt/50 text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                                    <th className="py-2.5 px-3.5">Product</th>
                                    <th className="py-2.5 px-3">Make / Model Breakdown</th>
                                    <th className="py-2.5 px-3 text-center">Rooms</th>
                                    <th className="py-2.5 px-3.5 text-right">Total Qty</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border/60">
                                  {group.items.map((item, idx) => (
                                    <tr key={idx} className="hover:bg-surface-alt/30 transition-colors">
                                      <td className="py-2.5 px-3.5 font-bold text-text-primary">
                                        {item.productTitle}
                                      </td>
                                      <td className="py-2.5 px-3 text-text-secondary">
                                        {item.makeModelSummary}
                                      </td>
                                      <td className="py-2.5 px-3 text-center">
                                        <span className="rounded bg-surface-alt px-2 py-0.5 text-[11px] font-medium text-text-secondary">
                                          {item.roomsCount} {item.roomsCount === 1 ? 'room' : 'rooms'}
                                        </span>
                                      </td>
                                      <td className="py-2.5 px-3.5 text-right font-extrabold tabular-nums text-text-primary text-sm">
                                        {item.totalQuantity}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-surface p-12 text-center text-sm text-text-muted">
                Select a project on the left to view its BOQ details and history.
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Edit BOQ Dialog modal */}
      {editingBoq && selectedProject && (
        <EditProjectDialog
          project={{
            id: selectedProject.id,
            name: selectedProject.name,
            client_name: selectedProject.client_name,
            site_address: selectedProject.site_address,
            status: selectedProject.status,
          }}
          lines={editableLines}
          onClose={() => setEditingBoq(false)}
          onSaved={async (summary) => {
            setEditingBoq(false);
            flash(summary);
            await fetchProjects();
            await loadProjectBoq(selectedProject.id);
          }}
        />
      )}
    </div>
  );
}
