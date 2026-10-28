'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/components/auth-provider';
import { AppHeader } from '@/components/app-header';
import { supabaseBrowser } from '@/lib/client/supabase';
import Link from 'next/link';

interface ProjectSummary {
  id: string;
  name: string;
  clientName: string | null;
  siteAddress: string | null;
  pending: number;
  escalated: number;
  closedThisWeek: number;
  oldestOpenDays: number | null;
  lastVisit: string | null;
  byAgency: [string, number][];
}

interface DashboardSectionRaw {
  project: {
    id: string;
    name: string;
    l2After: number;
    l3After: number;
    lastVisit: string | null;
  };
  pending: number;
  closedThisWeek: number;
  escalated: number;
  oldest: number | null;
  byAgency: [string, number][];
}

export default function ProjectsPage() {
  const { profile, loading: authLoading } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      setError(null);
      const sb = supabaseBrowser();

      // Parallel fetch: dashboard metrics + project details (client_name, site_address)
      const [dashRes, { data: dbProjects, error: dbErr }] = await Promise.all([
        fetch('/api/dashboard'),
        sb.from('projects').select('id, name, client_name, site_address').neq('status', 'closed'),
      ]);

      if (!dashRes.ok) {
        throw new Error(`Failed to load dashboard (${dashRes.status})`);
      }
      if (dbErr) {
        throw new Error(dbErr.message);
      }

      const dashData = await dashRes.json();
      const sections: DashboardSectionRaw[] = dashData.sections ?? [];

      const sectionMap = new Map<string, DashboardSectionRaw>();
      for (const s of sections) {
        if (s.project?.id) {
          sectionMap.set(s.project.id, s);
        }
      }

      const combined: ProjectSummary[] = (dbProjects ?? []).map((p: { id: string; name: string; client_name: string | null; site_address: string | null }) => {
        const sec = sectionMap.get(p.id);
        return {
          id: p.id,
          name: p.name,
          clientName: p.client_name,
          siteAddress: p.site_address,
          pending: sec?.pending ?? 0,
          escalated: sec?.escalated ?? 0,
          closedThisWeek: sec?.closedThisWeek ?? 0,
          oldestOpenDays: sec?.oldest ?? null,
          lastVisit: sec?.project?.lastVisit ?? null,
          byAgency: sec?.byAgency ?? [],
        };
      });

      // Sort by escalated (descending), then pending (descending), then name
      combined.sort((a, b) => b.escalated - a.escalated || b.pending - a.pending || a.name.localeCompare(b.name));

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

  if (authLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-alt">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-surface-alt pb-12">
      <AppHeader />

      <main className="mx-auto max-w-xl px-4 pt-5 pb-8">
        {/* Page header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-text-primary">Projects</h1>
            <p className="text-xs text-text-secondary mt-0.5">
              {projects.length} {projects.length === 1 ? 'project' : 'projects'} active
            </p>
          </div>

          <Link
            href="/projects/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm
                       font-medium text-white shadow-sm hover:bg-accent-hover active:bg-accent-hover
                       transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New project
          </Link>
        </div>

        {/* Content state */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-danger/20 bg-danger-light p-4 text-sm text-danger" role="alert">
            <p className="font-medium">Failed to load projects</p>
            <p className="mt-1 text-xs">{error}</p>
            <button
              onClick={fetchProjects}
              className="mt-3 rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              Try again
            </button>
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface px-6 py-12 text-center shadow-xs">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-alt text-text-muted">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-text-primary">No projects assigned</h2>
            <p className="mt-1 text-xs text-text-secondary max-w-xs mx-auto">
              You haven&apos;t been assigned to any projects yet, or no projects have been created.
            </p>
            <div className="mt-5">
              <Link
                href="/projects/new"
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-accent-hover transition-colors"
              >
                Create a project
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="group relative block rounded-xl border border-border bg-surface p-4 shadow-xs
                           hover:border-accent/40 active:bg-surface-alt transition-all focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold text-text-primary group-hover:text-accent transition-colors truncate">
                      {p.name}
                    </h2>
                    {p.clientName && (
                      <p className="text-xs text-text-secondary truncate mt-0.5">
                        Client: <span className="text-text-primary">{p.clientName}</span>
                      </p>
                    )}
                    {p.siteAddress && (
                      <p className="text-xs text-text-muted truncate mt-0.5">
                        {p.siteAddress}
                      </p>
                    )}
                  </div>

                  {/* Status Pills */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {p.escalated > 0 ? (
                      <span className="inline-flex items-center rounded-md bg-danger-light px-2 py-0.5 text-xs font-semibold text-danger">
                        {p.escalated} esc
                      </span>
                    ) : null}
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                        p.pending > 0
                          ? 'bg-warning-light text-warning'
                          : 'bg-success-light text-success font-medium'
                      }`}
                    >
                      {p.pending > 0 ? `${p.pending} pending` : 'All clear'}
                    </span>
                  </div>
                </div>

                {/* Footer details: last visit, oldest pending, action buttons */}
                <div className="mt-3.5 pt-3 border-t border-border/60 flex items-center justify-between text-xs text-text-secondary">
                  <div className="flex items-center gap-2">
                    <span>
                      {p.lastVisit ? `Visit: ${formatDate(p.lastVisit)}` : 'No visits yet'}
                    </span>
                    {p.oldestOpenDays !== null && p.oldestOpenDays > 0 && (
                      <>
                        <span className="text-border">•</span>
                        <span>Oldest: {p.oldestOpenDays}d</span>
                      </>
                    )}
                  </div>

                  <span className="text-xs font-medium text-accent flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                    View
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                </div>
              </Link>
            ))}
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
