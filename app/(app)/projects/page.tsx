'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/components/auth-provider';
import { AppHeader } from '@/components/app-header';
import { supabaseBrowser } from '@/lib/client/supabase';
import { Glyph } from '@/components/glass-icon';
import Link from 'next/link';

type ProjectStatus = 'active' | 'on_hold' | 'closed' | 'finished';

interface ProjectSummary {
  id: string;
  name: string;
  clientName: string | null;
  siteAddress: string | null;
  status: ProjectStatus;
  total: number;
  done: number;
  pending: number;
  closedThisWeek: number;
  oldestOpenDays: number | null;
  lastVisit: string | null;
  byAgency: [string, number][];
  createdAt: string | null;
}

interface DashboardSectionRaw {
  project: {
    id: string;
    name: string;
    lastVisit: string | null;
  };
  pending: number;
  closedThisWeek: number;
  oldest: number | null;
  byAgency: [string, number][];
}

type SortOption = 'pending' | 'name' | 'progress' | 'recent_visit';
type FilterStatus = 'all' | 'active' | 'on_hold' | 'closed';

export default function ProjectsPage() {
  const { profile, loading: authLoading } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search, filter & sort controls
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('active');
  const [sortBy, setSortBy] = useState<SortOption>('pending');

  const fetchProjects = useCallback(async () => {
    try {
      setError(null);
      const sb = supabaseBrowser();

      // Parallel fetch: dashboard metrics + project details + dependency item counts
      const [dashRes, { data: dbProjects, error: dbErr }, { data: items, error: itemsErr }] = await Promise.all([
        fetch('/api/dashboard'),
        sb.from('projects').select('id, name, client_name, site_address, status, created_at'),
        sb.from('dependency_items').select('project_id, status'),
      ]);

      if (!dashRes.ok) {
        throw new Error(`Failed to load dashboard (${dashRes.status})`);
      }
      if (dbErr) {
        throw new Error(dbErr.message);
      }
      if (itemsErr) {
        throw new Error(itemsErr.message);
      }

      const dashData = await dashRes.json();
      const sections: DashboardSectionRaw[] = dashData.sections ?? [];

      const sectionMap = new Map<string, DashboardSectionRaw>();
      for (const s of sections) {
        if (s.project?.id) {
          sectionMap.set(s.project.id, s);
        }
      }

      // Aggregate item status counts per project
      const statsMap = new Map<string, { total: number; done: number; pending: number }>();
      for (const i of (items ?? []) as { project_id: string; status: string }[]) {
        const s = statsMap.get(i.project_id) ?? { total: 0, done: 0, pending: 0 };
        s.total++;
        if (i.status === 'complete' || i.status === 'na') s.done++;
        if (i.status === 'pending') s.pending++;
        statsMap.set(i.project_id, s);
      }

      const combined: ProjectSummary[] = (dbProjects ?? []).map(
        (p: { id: string; name: string; client_name: string | null; site_address: string | null; status: string | null; created_at: string | null }) => {
          const sec = sectionMap.get(p.id);
          const st = statsMap.get(p.id) ?? { total: 0, done: 0, pending: 0 };
          return {
            id: p.id,
            name: p.name,
            clientName: p.client_name,
            siteAddress: p.site_address,
            status: ((p.status as ProjectStatus) || 'active'),
            total: st.total,
            done: st.done,
            pending: sec?.pending ?? st.pending,
            closedThisWeek: sec?.closedThisWeek ?? 0,
            oldestOpenDays: sec?.oldest ?? null,
            lastVisit: sec?.project?.lastVisit ?? null,
            byAgency: sec?.byAgency ?? [],
            createdAt: p.created_at,
          };
        }
      );

      setProjects(combined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && profile) {
      fetchProjects();
    }
  }, [authLoading, profile, fetchProjects]);

  // Auth redirect
  useEffect(() => {
    if (!authLoading && !profile) {
      window.location.href = '/login';
    }
  }, [authLoading, profile]);

  // Filtered and sorted projects
  const filteredProjects = useMemo(() => {
    return projects
      .filter((p) => {
        // Status filter
        if (statusFilter === 'active' && p.status !== 'active') return false;
        if (statusFilter === 'on_hold' && p.status !== 'on_hold') return false;
        if (statusFilter === 'closed' && p.status !== 'closed') return false;

        // Search query filter
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchName = p.name.toLowerCase().includes(q);
          const matchClient = p.clientName?.toLowerCase().includes(q) ?? false;
          const matchAddress = p.siteAddress?.toLowerCase().includes(q) ?? false;
          if (!matchName && !matchClient && !matchAddress) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'pending') {
          return b.pending - a.pending || a.name.localeCompare(b.name);
        }
        if (sortBy === 'name') {
          return a.name.localeCompare(b.name);
        }
        if (sortBy === 'progress') {
          const aPct = a.total > 0 ? a.done / a.total : 0;
          const bPct = b.total > 0 ? b.done / b.total : 0;
          return aPct - bPct || b.pending - a.pending;
        }
        if (sortBy === 'recent_visit') {
          const aVisit = a.lastVisit ? new Date(a.lastVisit).getTime() : 0;
          const bVisit = b.lastVisit ? new Date(b.lastVisit).getTime() : 0;
          return bVisit - aVisit || a.name.localeCompare(b.name);
        }
        return 0;
      });
  }, [projects, statusFilter, searchQuery, sortBy]);

  // Summary counts for badges
  const totalActive = useMemo(() => projects.filter((p) => p.status === 'active').length, [projects]);
  const totalOnHold = useMemo(() => projects.filter((p) => p.status === 'on_hold').length, [projects]);
  const totalClosed = useMemo(() => projects.filter((p) => p.status === 'closed').length, [projects]);

  if (authLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-alt">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-surface-alt pb-16">
      <AppHeader />

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-6 pb-12">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-text-primary">Projects</h1>
              <span className="inline-flex items-center rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent">
                {projects.length} {projects.length === 1 ? 'total' : 'total'}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-text-secondary mt-1">
              Portfolio overview of active project dependencies, progress and team follow-ups.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <Link
              href="/projects/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm
                         font-semibold text-white shadow-xs hover:bg-accent-hover active:bg-accent-hover
                         transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New project
            </Link>
          </div>
        </div>

        {/* Controls Bar: Search, Status Filters, and Sorting */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-3.5 rounded-xl border border-border bg-surface p-3 sm:p-3.5 shadow-xs">
          {/* Search box */}
          <div className="relative flex-1 min-w-[220px]">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by project, client, or location..."
              className="w-full rounded-lg border border-border bg-surface-alt/50 pl-9 pr-8 py-2 text-xs sm:text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary p-0.5 rounded"
                aria-label="Clear search"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Status Filter Buttons */}
            <div className="inline-flex rounded-lg border border-border bg-surface-alt/70 p-0.5">
              <button
                type="button"
                onClick={() => setStatusFilter('active')}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === 'active'
                    ? 'bg-surface text-text-primary shadow-xs font-semibold'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Active ({totalActive})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('on_hold')}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === 'on_hold'
                    ? 'bg-surface text-text-primary shadow-xs font-semibold'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                On Hold ({totalOnHold})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('closed')}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === 'closed'
                    ? 'bg-surface text-text-primary shadow-xs font-semibold'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Closed ({totalClosed})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === 'all'
                    ? 'bg-surface text-text-primary shadow-xs font-semibold'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                All ({projects.length})
              </button>
            </div>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs text-text-muted hidden sm:inline">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="rounded-lg border border-border bg-surface-alt/50 px-2.5 py-1.5 text-xs font-medium text-text-primary focus:border-accent focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="pending">Most pending</option>
                <option value="name">Name (A-Z)</option>
                <option value="progress">Lowest progress</option>
                <option value="recent_visit">Recently visited</option>
              </select>
            </div>
          </div>
        </div>

        {/* Content state */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Spinner />
            <p className="mt-3 text-xs text-text-muted">Loading projects portfolio...</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-danger/20 bg-danger-light p-4 text-sm text-danger max-w-xl mx-auto" role="alert">
            <p className="font-semibold">Failed to load projects</p>
            <p className="mt-1 text-xs">{error}</p>
            <button
              onClick={fetchProjects}
              className="mt-3 rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              Try again
            </button>
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface px-6 py-16 text-center shadow-xs max-w-lg mx-auto">
            <div className="mx-auto mb-3.5 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-alt text-text-muted">
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-text-primary">No projects assigned</h2>
            <p className="mt-1.5 text-xs text-text-secondary max-w-xs mx-auto">
              You haven&apos;t been assigned to any projects yet, or no projects have been created.
            </p>
            <div className="mt-6">
              <Link
                href="/projects/new"
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors"
              >
                Create a project
              </Link>
            </div>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface px-6 py-12 text-center shadow-xs max-w-md mx-auto">
            <p className="text-sm font-medium text-text-primary">No projects match your filter</p>
            <p className="mt-1 text-xs text-text-muted">Try adjusting your search query or status filter.</p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
              }}
              className="mt-4 inline-flex items-center rounded-lg border border-border bg-surface-alt px-3.5 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-alt/80 transition-colors"
            >
              Reset filters
            </button>
          </div>
        ) : (
          /* Multi-column responsive grid layout */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredProjects.map((p) => {
              const progressPct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
              const pendingPct = p.total > 0 ? Math.round((p.pending / p.total) * 100) : 0;
              const donePct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;

              return (
                <div
                  key={p.id}
                  className="group relative flex flex-col justify-between rounded-2xl border border-border bg-surface p-5 shadow-xs hover:border-accent/40 hover:shadow-md transition-all duration-150"
                >
                  {/* Top Header: Title, Client, Location, Status Badge */}
                  <div>
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/hub?p=${p.id}`}
                          className="text-base font-extrabold text-text-primary group-hover:text-accent transition-colors block truncate"
                          title={p.name}
                        >
                          {p.name}
                        </Link>
                        {p.clientName && (
                          <p className="mt-1 flex items-center gap-1.5 text-xs text-text-secondary truncate">
                            <Glyph name="building" className="h-3.5 w-3.5 text-text-muted shrink-0" />
                            <span className="truncate">Client: <span className="text-text-primary font-medium">{p.clientName}</span></span>
                          </p>
                        )}
                        {p.siteAddress && (
                          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted truncate">
                            <svg className="h-3.5 w-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <span className="truncate">{p.siteAddress}</span>
                          </p>
                        )}
                      </div>

                      {/* Status Pills */}
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        {p.status === 'closed' ? (
                          <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-surface-alt text-text-muted border border-border">
                            Closed
                          </span>
                        ) : p.status === 'on_hold' ? (
                          <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-500/10 text-amber-600 border border-amber-500/20">
                            On hold
                          </span>
                        ) : p.pending > 0 ? (
                          <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-warning-light text-warning">
                            {p.pending} pending
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-success-light text-success">
                            All clear
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Progress Section */}
                    <div className="mt-4 pt-3 border-t border-border/50">
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-text-secondary font-medium">Progress</span>
                        <span className="text-text-primary font-bold">
                          {progressPct}% <span className="font-normal text-text-muted">({p.done}/{p.total} items)</span>
                        </span>
                      </div>

                      {/* Segmented Progress Bar */}
                      <div className="h-2 w-full rounded-full bg-surface-alt overflow-hidden flex gap-0.5" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
                        {p.total > 0 ? (
                          <>
                            <div
                              style={{ width: `${donePct}%` }}
                              className="h-full bg-success transition-all duration-300"
                              title={`${p.done} completed / N.A.`}
                            />
                            <div
                              style={{ width: `${pendingPct}%` }}
                              className="h-full bg-warning transition-all duration-300"
                              title={`${p.pending} pending`}
                            />
                          </>
                        ) : (
                          <div className="h-full w-full bg-border/40" title="No dependencies added yet" />
                        )}
                      </div>
                    </div>

                    {/* 3-Cell Metric Grid */}
                    <div className="mt-3.5 grid grid-cols-3 gap-2 rounded-xl bg-surface-alt/70 p-2.5 text-center border border-border/40">
                      <div>
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted">Pending</span>
                        <span className={`text-sm font-bold ${p.pending > 0 ? 'text-warning' : 'text-text-primary'}`}>
                          {p.pending}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted">Closed (7d)</span>
                        <span className="text-sm font-bold text-text-primary">
                          {p.closedThisWeek}
                        </span>
                      </div>
                      <div className="truncate">
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted truncate">
                          {p.oldestOpenDays !== null ? 'Oldest' : 'Last Visit'}
                        </span>
                        <span className="text-sm font-bold text-text-primary truncate block" title={p.lastVisit ? formatDate(p.lastVisit) : undefined}>
                          {p.oldestOpenDays !== null ? `${p.oldestOpenDays}d` : (p.lastVisit ? formatDate(p.lastVisit) : '—')}
                        </span>
                      </div>
                    </div>

                    {/* Bottleneck Agencies (if any pending) */}
                    {p.byAgency.length > 0 ? (
                      <div className="mt-3 flex items-center gap-1.5 text-xs overflow-hidden">
                        <span className="text-[11px] font-medium text-text-muted shrink-0">Stuck at:</span>
                        <div className="flex flex-wrap gap-1.5 items-center">
                          {p.byAgency.slice(0, 2).map(([agency, count]) => (
                            <span
                              key={agency}
                              className="inline-flex items-center gap-1 rounded-md bg-warning/10 text-warning px-1.5 py-0.5 text-[11px] font-medium"
                              title={`${agency}: ${count} pending`}
                            >
                              <span className="truncate max-w-[120px]">{agency}</span>
                              <span className="font-bold">({count})</span>
                            </span>
                          ))}
                          {p.byAgency.length > 2 && (
                            <span className="text-[10px] text-text-muted">+{p.byAgency.length - 2} more</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 flex items-center gap-1 text-xs text-text-muted">
                        <Glyph name="check" className="h-3 w-3 text-success shrink-0" />
                        <span>No active agency bottlenecks</span>
                      </div>
                    )}
                  </div>

                  {/* Bottom Action Row */}
                  <div className="mt-4 pt-3.5 border-t border-border/60 flex items-center gap-2">
                    {/* Primary Dashboard Link */}
                    <Link
                      href={`/hub?p=${p.id}`}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                      </svg>
                      Dashboard
                    </Link>

                    {/* Quick Link: Reminders */}
                    <Link
                      href={`/projects/${p.id}/reminders`}
                      title="Send Reminders"
                      className="inline-flex items-center justify-center rounded-lg border border-border bg-surface px-2.5 py-2 text-xs font-medium text-text-secondary hover:bg-surface-alt hover:text-text-primary transition-colors"
                    >
                      <Glyph name="send" className="h-3.5 w-3.5" />
                    </Link>

                    {/* Quick Link: Agencies & Contacts */}
                    <Link
                      href={`/projects/${p.id}?tab=agencies`}
                      title="Agencies & Contacts"
                      className="inline-flex items-center justify-center rounded-lg border border-border bg-surface px-2.5 py-2 text-xs font-medium text-text-secondary hover:bg-surface-alt hover:text-text-primary transition-colors"
                    >
                      <Glyph name="agencies" className="h-3.5 w-3.5" />
                    </Link>

                    {/* Quick Link: Project Details / Setup */}
                    <Link
                      href={`/projects/${p.id}`}
                      title="Project Details & Settings"
                      className="inline-flex items-center justify-center rounded-lg border border-border bg-surface px-2.5 py-2 text-xs font-medium text-text-secondary hover:bg-surface-alt hover:text-text-primary transition-colors"
                    >
                      <Glyph name="edit" className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
  } catch {
    return iso;
  }
}

function Spinner() {
  return (
    <svg className="h-6 w-6 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
