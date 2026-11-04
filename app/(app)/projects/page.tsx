'use client';

// Projects & BOQ Page (v8) — Managers only (super_admin, pm_lead).
// Per project: Initial BOQ · BOQ history · Print history / Current BOQ · Print room-wise · Print conso.
// Add / modify BOQ uses EditProjectDialog with mandatory change request block (reason >= 10 words).
// Filters: Active · Finished · All (no "On hold", no "Close").
// Includes placeholder: "BOQ by Head PM (Raju) — coming soon; details arrive in 3 days."

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { AppHeader } from '@/components/app-header';
import { supabaseBrowser } from '@/lib/client/supabase';
import { GlassIcon, Glyph } from '@/components/glass-icon';
import { EditProjectDialog, type EditableLine } from '@/components/v4/edit-project-dialog';
import { BoqHistoryTab } from '@/components/v7/boq-history-tab';
import Link from 'next/link';

type ProjectStatus = 'active' | 'finished' | 'closed' | 'on_hold';
type FilterStatus = 'active' | 'finished' | 'all';
type BoqViewTab = 'current' | 'conso' | 'initial' | 'history';

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
  product_catalogue: { id: string; title: string; scope: string } | null;
  rooms: { id: string; name: string; sort: number; floors: { id: string; label: string; sort: number } | null } | null;
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
      const [{ data: pData, error: pErr }, { data: rData, error: rErr }] = await Promise.all([
        sb
          .from('room_products')
          .select('id, project_id, room_id, product_id, boq_title, location, quantity, brand, make, model, note, created_at, product_catalogue(id, title, scope), rooms(id, name, sort, floors(id, label, sort))')
          .eq('project_id', projId),
        sb
          .from('rooms')
          .select('id, name, sort, floors(id, label, sort)')
          .eq('project_id', projId)
          .order('sort'),
      ]);
      if (pErr) throw pErr;
      if (rErr) throw rErr;
      setProducts((pData ?? []) as unknown as RoomProductRow[]);

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

  // Consolidated count per product (+ make/model) across the project
  const consolidatedBoq = useMemo(() => {
    const map = new Map<string, { productTitle: string; make: string | null; model: string | null; totalQty: number; locations: Set<string> }>();
    for (const p of products) {
      const title = p.product_catalogue?.title ?? p.boq_title ?? 'Product';
      const make = p.make || p.brand || null;
      const model = p.model || null;
      const key = `${title}__${make ?? ''}__${model ?? ''}`.toLowerCase();
      const existing = map.get(key) ?? {
        productTitle: title,
        make,
        model,
        totalQty: 0,
        locations: new Set<string>(),
      };
      existing.totalQty += p.quantity || 1;
      const roomDesc = [p.rooms?.name, p.location].filter(Boolean).join(' - ');
      if (roomDesc) existing.locations.add(roomDesc);
      map.set(key, existing);
    }
    return [...map.values()].sort((a, b) => b.totalQty - a.totalQty || a.productTitle.localeCompare(b.productTitle));
  }, [products]);

  // Room-wise grouping for Current BOQ
  const roomWiseBoq = useMemo(() => {
    const map = new Map<string, { roomName: string; floorLabel: string; items: RoomProductRow[] }>();
    for (const p of products) {
      const roomId = p.room_id || 'project_wide';
      const rName = p.rooms?.name ?? 'Project-wide';
      const fLabel = p.rooms?.floors?.label ?? 'General';
      const existing = map.get(roomId) ?? { roomName: rName, floorLabel: fLabel, items: [] };
      existing.items.push(p);
      map.set(roomId, existing);
    }
    return [...map.values()];
  }, [products]);

  // Initial BOQ: sorted earliest created items or initial baseline
  const initialBoq = useMemo(() => {
    return [...products].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
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
              View current room-wise BOQ, consolidated counts, BOQ change history, and export official prints.
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

        {/* Clearly marked placeholder banner */}
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

        {/* Filter and Search Bar: Active · Finished · All (no on_hold, no close) */}
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
                  <h4 className="text-sm font-extrabold text-text-primary truncate">{p.name}</h4>
                  <p className="text-[11px] text-text-secondary truncate mt-0.5">
                    {[p.client_name, p.site_address].filter(Boolean).join(' · ') || 'No details'}
                  </p>
                  <span className={`inline-block mt-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                    p.status === 'active' ? 'bg-success-light text-success' : 'bg-surface-alt text-text-muted'
                  }`}>
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
                {/* Project Title Block & Action Buttons */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-border/80 pb-4">
                  <div>
                    <h2 className="text-xl font-extrabold text-text-primary">
                      {selectedProject.name}
                    </h2>
                    <p className="text-xs text-text-secondary mt-1">
                      {[selectedProject.client_name && `Client: ${selectedProject.client_name}`, selectedProject.site_address].filter(Boolean).join(' · ')}
                    </p>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      {products.length} BOQ items placed · Status: <span className="font-semibold uppercase">{selectedProject.status}</span>
                    </p>
                  </div>

                  {/* Actions & Prints */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingBoq(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors"
                    >
                      <Glyph name="edit" />
                      Add / modify BOQ
                    </button>
                    <a
                      href={`/api/reports/projects/${selectedProject.id}/boq-room-wise.pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors"
                    >
                      Print room-wise
                    </a>
                    <a
                      href={`/api/reports/projects/${selectedProject.id}/boq-conso.pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors"
                    >
                      Print conso
                    </a>
                    <a
                      href={`/api/reports/projects/${selectedProject.id}/boq-history.pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors"
                    >
                      Print history
                    </a>
                  </div>
                </div>

                {/* Tabs from Project Page: Initial BOQ · BOQ history · Current BOQ (Room-wise) · Conso */}
                <div className="flex flex-wrap gap-1 border-b border-border text-xs sm:text-sm mt-4">
                  {[
                    { id: 'current', label: `Current BOQ (${products.length})` },
                    { id: 'conso', label: `Conso (${consolidatedBoq.length})` },
                    { id: 'initial', label: 'Initial BOQ' },
                    { id: 'history', label: 'BOQ history' },
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
                    /* Current Room-wise BOQ */
                    <div className="space-y-4">
                      {roomWiseBoq.length === 0 ? (
                        <p className="text-xs text-text-muted py-8 text-center">No BOQ items placed yet.</p>
                      ) : (
                        roomWiseBoq.map((rm) => (
                          <div key={rm.roomName} className="rounded-xl border border-border overflow-hidden">
                            <div className="bg-surface-alt px-3.5 py-2 text-xs font-bold text-text-primary flex items-center justify-between">
                              <span>{rm.roomName} <span className="font-normal text-text-muted">({rm.floorLabel})</span></span>
                              <span className="text-[11px] font-normal text-text-muted">{rm.items.length} items</span>
                            </div>
                            <div className="divide-y divide-border/60">
                              {rm.items.map((it) => {
                                const specStr = [it.make || it.brand, it.model].filter(Boolean).join(' · ');
                                return (
                                  <div key={it.id} className="p-3 text-xs flex flex-wrap items-center justify-between gap-2 hover:bg-surface-alt/30 transition-colors">
                                    <div className="min-w-0 flex-1">
                                      <p className="font-bold text-text-primary">{it.product_catalogue?.title ?? it.boq_title ?? 'Product'}</p>
                                      {specStr && <p className="text-[11px] text-text-muted mt-0.5">{specStr}</p>}
                                      {it.note && <p className="text-[11px] text-text-secondary italic mt-0.5">Note: {it.note}</p>}
                                    </div>
                                    <div className="text-right shrink-0">
                                      <span className="rounded bg-surface-alt px-2 py-0.5 text-xs font-semibold text-text-secondary">
                                        {it.location || 'Entrance'}
                                      </span>
                                      <p className="text-xs font-bold text-text-primary mt-1">Qty: {it.quantity || 1}</p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  ) : activeTab === 'conso' ? (
                    /* Consolidated Count per Product (+ Make/Model) */
                    <div className="rounded-xl border border-border overflow-hidden">
                      <div className="grid grid-cols-[1.5fr_1fr_60px_1.5fr] gap-3 bg-surface-alt px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-secondary border-b border-border">
                        <span>Product</span>
                        <span>Make / Model</span>
                        <span className="text-right">Qty</span>
                        <span>Locations</span>
                      </div>
                      <div className="divide-y divide-border/60">
                        {consolidatedBoq.length === 0 ? (
                          <p className="p-6 text-center text-xs text-text-muted">No products consolidated.</p>
                        ) : (
                          consolidatedBoq.map((c, i) => (
                            <div key={i} className="grid grid-cols-[1.5fr_1fr_60px_1.5fr] gap-3 p-3 text-xs items-center hover:bg-surface-alt/30 transition-colors">
                              <span className="font-bold text-text-primary">{c.productTitle}</span>
                              <span className="text-text-muted">{[c.make, c.model].filter(Boolean).join(' / ') || '—'}</span>
                              <span className="text-right font-bold tabular-nums text-text-primary">{c.totalQty}</span>
                              <span className="text-[11px] text-text-secondary truncate" title={[...c.locations].join(', ')}>
                                {[...c.locations].join(', ') || '—'}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ) : activeTab === 'initial' ? (
                    /* Initial BOQ Baseline */
                    <div className="rounded-xl border border-border overflow-hidden">
                      <div className="grid grid-cols-[1.5fr_1fr_1fr_60px] gap-3 bg-surface-alt px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-secondary border-b border-border">
                        <span>Product</span>
                        <span>Room</span>
                        <span>Location</span>
                        <span className="text-right">Qty</span>
                      </div>
                      <div className="divide-y divide-border/60">
                        {initialBoq.length === 0 ? (
                          <p className="p-6 text-center text-xs text-text-muted">No initial BOQ baseline.</p>
                        ) : (
                          initialBoq.map((it) => (
                            <div key={it.id} className="grid grid-cols-[1.5fr_1fr_1fr_60px] gap-3 p-3 text-xs items-center hover:bg-surface-alt/30 transition-colors">
                              <span className="font-bold text-text-primary">{it.product_catalogue?.title ?? it.boq_title ?? 'Product'}</span>
                              <span className="text-text-secondary">{it.rooms?.name ?? 'Project-wide'}</span>
                              <span className="text-text-muted">{it.location || 'Entrance'}</span>
                              <span className="text-right font-bold tabular-nums">{it.quantity || 1}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ) : (
                    /* BOQ History (using BoqHistoryTab component) */
                    <BoqHistoryTab
                      projectId={selectedProject.id}
                      projectName={selectedProject.name}
                      rooms={rooms.map((r) => ({ id: r.id, name: r.name }))}
                      isSuperAdmin={profile?.role === 'super_admin'}
                    />
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
