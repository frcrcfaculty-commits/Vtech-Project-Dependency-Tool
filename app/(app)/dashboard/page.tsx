'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/auth-provider';
import { AppHeader } from '@/components/app-header';
import { supabaseBrowser } from '@/lib/client/supabase';
import { downloadCsv } from '@/lib/client/csv';
import Link from 'next/link';

interface DashboardProject {
  id: string;
  name: string;
  l2After: number;
  l3After: number;
  lastVisit: string | null;
}

interface DashboardSection {
  project: DashboardProject;
  pending: number;
  closedThisWeek: number;
  oldest: number | null;
  byAgency: [string, number][];
}

interface DashboardResponse {
  asOf: string;
  sections: DashboardSection[];
}

export default function PortfolioDashboardPage() {
  const { profile, loading: authLoading } = useAuth();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isSuperAdmin = profile?.role === 'super_admin';

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/dashboard');
      if (!res.ok) {
        throw new Error(`Failed to load portfolio dashboard (${res.status})`);
      }
      const json: DashboardResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && isSuperAdmin) {
      fetchDashboard();
    }
  }, [authLoading, isSuperAdmin, fetchDashboard]);

  if (authLoading || (loading && isSuperAdmin)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-alt">
        <Spinner />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="min-h-dvh bg-surface-alt">
        <AppHeader />
        <main className="mx-auto max-w-md px-4 py-16 text-center">
          <div className="rounded-2xl border border-danger/20 bg-danger-light p-6">
            <h1 className="text-base font-bold text-danger mb-1">Access Restricted</h1>
            <p className="text-xs text-danger/80">
              The portfolio dashboard is reserved for VTech Super Administrators.
            </p>
            <div className="mt-4">
              <Link href="/" className="rounded-lg bg-danger px-4 py-2 text-xs font-semibold text-white">
                Back to Projects
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const sections = data?.sections ?? [];
  const totalPending = sections.reduce((sum, s) => sum + s.pending, 0);
  const totalClosedWeek = sections.reduce((sum, s) => sum + s.closedThisWeek, 0);

  const [exportingBoq, setExportingBoq] = useState(false);

  const exportAllBoqChanges = async () => {
    try {
      setExportingBoq(true);
      const sb = supabaseBrowser();
      const { data: events, error: err } = await sb
        .from('boq_events')
        .select('*, projects(name), project_changes(requested_by, requested_at, reason, reference_type, reference)')
        .order('at', { ascending: false });

      if (err) throw err;

      const formatChangeDetails = (details: any) => {
        if (!details || typeof details !== 'object' || Object.keys(details).length === 0) return '—';
        return Object.entries(details)
          .map(([k, v]: [string, any]) => {
            const fromStr = v?.from === null || v?.from === undefined || v?.from === '' ? 'none' : String(v.from);
            const toStr = v?.to === null || v?.to === undefined || v?.to === '' ? 'none' : String(v.to);
            return `${k}: ${fromStr} → ${toStr}`;
          })
          .join('; ');
      };

      const headers = [
        'Project',
        'Date & Time',
        'Event',
        'Product',
        'Floor',
        'Room',
        'Location',
        'Quantity',
        'Change Details',
        'Requested By',
        'Reason',
        'Reference Type',
        'Reference',
      ];

      const rows = (events ?? []).map((e: any) => {
        const dt = new Date(e.at).toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const reqBy = e.project_changes?.requested_by ?? (e.change_id ? '—' : 'Initial BOQ');
        const reason = e.project_changes?.reason ?? (e.change_id ? '—' : 'Initial BOQ');
        const refType = e.project_changes?.reference_type ?? '';
        const ref = e.project_changes?.reference ?? '';
        const chgDetails = formatChangeDetails(e.details);
        const projName = e.projects?.name ?? '—';

        return [
          projName,
          dt,
          (e.event ?? '').toUpperCase(),
          e.product,
          e.floor ?? '—',
          e.room ?? '—',
          e.location ?? '—',
          e.quantity ?? 1,
          chgDetails,
          reqBy,
          reason,
          refType,
          ref,
        ];
      });

      const dateStr = new Date().toISOString().slice(0, 10);
      downloadCsv(`BOQ_Changes_All_Projects_${dateStr}`, headers, rows);
    } catch (e: any) {
      alert(e?.message || 'Failed to export BOQ changes');
    } finally {
      setExportingBoq(false);
    }
  };

  return (
    <div className="min-h-dvh bg-surface-alt pb-16">
      <AppHeader />

      <main className="mx-auto max-w-5xl px-4 pt-5">
        <div className="mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-text-primary">
              Portfolio Dashboard
            </h1>
            <p className="text-xs text-text-secondary mt-0.5">
              Weekly site dependency health across all active projects as of {formatDate(data?.asOf ?? '')}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={exportAllBoqChanges}
              disabled={exportingBoq}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary shadow-xs hover:bg-surface-alt transition-colors disabled:opacity-50"
            >
              {exportingBoq ? 'Exporting…' : 'BOQ changes – all projects (CSV)'}
            </button>
            <button
              type="button"
              onClick={fetchDashboard}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary shadow-xs hover:bg-surface-alt transition-colors"
            >
              ↻ Refresh Portfolio
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-danger-light border border-danger/20 p-3 text-xs text-danger font-medium">
            {error}
          </div>
        )}

        {/* Portfolio Summary Metrics */}
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
            <p className="text-xs font-semibold text-text-secondary">Active Projects</p>
            <p className="text-2xl font-bold text-text-primary mt-1">{sections.length}</p>
            <p className="text-[11px] text-text-muted mt-0.5">Monitored weekly</p>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
            <p className="text-xs font-semibold text-text-secondary">Total Pending</p>
            <p className="text-2xl font-bold text-warning mt-1">{totalPending}</p>
            <p className="text-[11px] text-text-muted mt-0.5">Open contractor items</p>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
            <p className="text-xs font-semibold text-text-secondary">Closed in 7 Days</p>
            <p className="text-2xl font-bold text-success mt-1">{totalClosedWeek}</p>
            <p className="text-[11px] text-text-muted mt-0.5">Verified complete on site</p>
          </div>
        </div>

        {/* Portfolio Table */}
        <div className="rounded-2xl border border-border bg-surface overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-surface-alt border-b border-border">
                  <th className="p-3.5 font-bold text-text-secondary">Project</th>
                  <th className="p-3.5 font-bold text-text-secondary text-center">Pending</th>
                  <th className="p-3.5 font-bold text-text-secondary text-center">Closed (7d)</th>
                  <th className="p-3.5 font-bold text-text-secondary text-center">Oldest Open</th>
                  <th className="p-3.5 font-bold text-text-secondary">Last Visit</th>
                  <th className="p-3.5 font-bold text-text-secondary">Pending by Contractor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {sections.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-xs text-text-muted">
                      No active projects to display in portfolio.
                    </td>
                  </tr>
                ) : (
                  sections.map((s) => (
                    <tr key={s.project.id} className="hover:bg-surface-alt/50 transition-colors">
                      <td className="p-3.5">
                        <Link
                          href={`/projects/${s.project.id}`}
                          className="font-bold text-text-primary hover:text-accent transition-colors"
                        >
                          {s.project.name}
                        </Link>
                      </td>

                      <td className="p-3.5 text-center">
                        <span
                          className={`inline-block rounded-md px-2 py-0.5 font-bold ${
                            s.pending > 0 ? 'bg-warning-light text-warning' : 'text-text-muted'
                          }`}
                        >
                          {s.pending}
                        </span>
                      </td>

                      <td className="p-3.5 text-center font-medium text-text-secondary">
                        {s.closedThisWeek}
                      </td>

                      <td className="p-3.5 text-center text-text-secondary">
                        {s.oldest !== null ? `${s.oldest}d` : '—'}
                      </td>

                      <td className="p-3.5 text-text-secondary whitespace-nowrap">
                        {formatDate(s.project.lastVisit)}
                      </td>

                      <td className="p-3.5 text-text-secondary max-w-xs truncate">
                        {s.byAgency.length > 0
                          ? s.byAgency.map(([agency, count]) => `${agency}: ${count}`).join(', ')
                          : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
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
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={2.5} />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
