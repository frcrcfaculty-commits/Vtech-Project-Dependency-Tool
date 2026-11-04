'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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

interface AnalyticsItem {
  id: string;
  projectId: string;
  projectName: string;
  floorLabel: string;
  roomName: string;
  productTitle: string;
  agencyLabel: string;
  status: 'pending' | 'complete' | 'na';
  firstRaisedOn: string | null;
  completedOn: string | null;
  daysOpen: number;
  reminderCount: number;
  actionPlan: string | null;
}

export default function PortfolioDashboardPage() {
  const { profile, loading: authLoading } = useAuth();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [analyticsItems, setAnalyticsItems] = useState<AnalyticsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isSuperAdmin = profile?.role === 'super_admin';

  // Export states
  const [exporting, setExporting] = useState<string | null>(null);

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [dashRes, itemsRes] = await Promise.all([
        fetch('/api/dashboard'),
        supabaseBrowser()
          .from('dependency_items')
          .select(`
            id, project_id, status, first_raised_on, completed_on, reminder_count, action_plan,
            rooms(name, sort, floors(label, sort, projects(name))),
            project_dependencies(text),
            room_products(location, product_catalogue(title)),
            agencies(company_name, agency_types(name))
          `)
          .in('status', ['pending', 'complete'])
          .order('first_raised_on', { ascending: true }),
      ]);

      if (!dashRes.ok) throw new Error(`Failed to load portfolio dashboard (${dashRes.status})`);
      const json: DashboardResponse = await dashRes.json();
      setData(json);

      if (itemsRes.error) throw itemsRes.error;

      const now = Date.now();
      const rawList = itemsRes.data ?? [];
      const parsed: AnalyticsItem[] = rawList.map((i: any) => {
        const pName = i.rooms?.floors?.projects?.name ?? '—';
        const fLabel = i.rooms?.floors?.label ?? 'Floor';
        const rName = i.rooms?.name ?? 'Room';
        const prod = i.room_products?.product_catalogue?.title ?? i.project_dependencies?.text ?? '—';
        const agType = i.agencies?.agency_types?.name;
        const agComp = i.agencies?.company_name;
        const agLabel = agComp && agType ? `${agType} – ${agComp}` : agComp ?? agType ?? 'Unassigned';

        const raisedDate = i.first_raised_on ? new Date(i.first_raised_on).getTime() : now;
        const days = Math.max(0, Math.floor((now - raisedDate) / (1000 * 60 * 60 * 24)));

        return {
          id: i.id,
          projectId: i.project_id,
          projectName: pName,
          floorLabel: fLabel,
          roomName: rName,
          productTitle: prod,
          agencyLabel: agLabel,
          status: i.status,
          firstRaisedOn: i.first_raised_on,
          completedOn: i.completed_on,
          daysOpen: days,
          reminderCount: i.reminder_count || 0,
          actionPlan: i.action_plan ?? null,
        };
      });

      setAnalyticsItems(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && isSuperAdmin) {
      fetchDashboardData();
    }
  }, [authLoading, isSuperAdmin, fetchDashboardData]);

  // Derived Analytics (Requirement 16)
  const pendingItems = useMemo(
    () => analyticsItems.filter((i) => i.status === 'pending'),
    [analyticsItems]
  );
  const completedItems = useMemo(
    () => analyticsItems.filter((i) => i.status === 'complete'),
    [analyticsItems]
  );

  // 1. Pending by agency
  const pendingByAgency = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of pendingItems) {
      map.set(item.agencyLabel, (map.get(item.agencyLabel) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([agency, count]) => ({ agency, count }))
      .sort((a, b) => b.count - a.count);
  }, [pendingItems]);

  // 2. Pending by room
  const pendingByRoom = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of pendingItems) {
      map.set(item.roomName, (map.get(item.roomName) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([room, count]) => ({ room, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }, [pendingItems]);

  // 3. Pending by product
  const pendingByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of pendingItems) {
      map.set(item.productTitle, (map.get(item.productTitle) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([product, count]) => ({ product, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }, [pendingItems]);

  // 4. Oldest 20 pending items
  const oldest20Pending = useMemo(() => {
    return [...pendingItems]
      .sort((a, b) => b.daysOpen - a.daysOpen)
      .slice(0, 20);
  }, [pendingItems]);

  // 5. Items completed per week (last 8 weeks)
  const completedPerWeek = useMemo(() => {
    const weeks: { weekLabel: string; count: number }[] = [];
    const now = new Date();

    for (let w = 7; w >= 0; w--) {
      const end = new Date(now.getTime() - w * 7 * 24 * 3600 * 1000);
      const start = new Date(end.getTime() - 7 * 24 * 3600 * 1000);
      const startMs = start.getTime();
      const endMs = end.getTime();

      const label = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const count = completedItems.filter((i) => {
        if (!i.completedOn) return false;
        const d = new Date(i.completedOn).getTime();
        return d >= startMs && d <= endMs;
      }).length;

      weeks.push({ weekLabel: `Week to ${label}`, count });
    }
    return weeks;
  }, [completedItems]);

  // 6. Reminders sent per agency
  const remindersByAgency = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of analyticsItems) {
      if (item.reminderCount > 0) {
        map.set(item.agencyLabel, (map.get(item.agencyLabel) ?? 0) + item.reminderCount);
      }
    }
    return Array.from(map.entries())
      .map(([agency, count]) => ({ agency, count }))
      .sort((a, b) => b.count - a.count);
  }, [analyticsItems]);

  // Export Handlers
  const exportPendingCsv = () => {
    const headers = ['Project', 'Floor', 'Room', 'Product', 'Agency', 'Raised On', 'Days Open', 'Reminders', 'Action Plan'];
    const rows = pendingItems.map((i) => [
      i.projectName,
      i.floorLabel,
      i.roomName,
      i.productTitle,
      i.agencyLabel,
      i.firstRaisedOn ?? '—',
      i.daysOpen,
      i.reminderCount,
      i.actionPlan ?? '',
    ]);
    const dStr = new Date().toISOString().slice(0, 10);
    downloadCsv(`VTech_Reports_Pending_${dStr}`, headers, rows);
  };

  const exportCompletedCsv = () => {
    const headers = ['Project', 'Floor', 'Room', 'Product', 'Agency', 'Raised On', 'Completed On', 'Action Plan'];
    const rows = completedItems.map((i) => [
      i.projectName,
      i.floorLabel,
      i.roomName,
      i.productTitle,
      i.agencyLabel,
      i.firstRaisedOn ?? '—',
      i.completedOn ?? '—',
      i.actionPlan ?? '',
    ]);
    const dStr = new Date().toISOString().slice(0, 10);
    downloadCsv(`VTech_Reports_Completed_${dStr}`, headers, rows);
  };

  const exportAllBoqChanges = async () => {
    try {
      setExporting('boq_changes');
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
      setExporting(null);
    }
  };

  const exportAllBoqCatalogCsv = async () => {
    try {
      setExporting('all_boq_csv');
      const sb = supabaseBrowser();
      const { data, error: err } = await sb
        .from('room_products')
        .select(`
          location, make, model, quantity, note,
          product_catalogue(title),
          rooms(name, floors(label, projects(name)))
        `);
      if (err) throw err;

      const headers = ['Project', 'Floor', 'Room', 'Product', 'Location', 'Make', 'Model', 'Quantity', 'Note'];
      const rows = (data ?? []).map((rp: any) => [
        rp.rooms?.floors?.projects?.name ?? '—',
        rp.rooms?.floors?.label ?? '—',
        rp.rooms?.name ?? '—',
        rp.product_catalogue?.title ?? '—',
        rp.location ?? '—',
        rp.make ?? '—',
        rp.model ?? '—',
        rp.quantity || 1,
        rp.note ?? '',
      ]);
      const dateStr = new Date().toISOString().slice(0, 10);
      downloadCsv(`VTech_All_BOQ_Products_${dateStr}`, headers, rows);
    } catch (e: any) {
      alert(e?.message || 'Failed to export BOQ catalogue');
    } finally {
      setExporting(null);
    }
  };

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
              The portfolio dashboard & reports are reserved for VTech Super Administrators.
            </p>
            <div className="mt-4">
              <Link href="/hub" className="rounded-lg bg-danger px-4 py-2 text-xs font-semibold text-white">
                Back to Dashboard
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

  return (
    <div className="min-h-dvh bg-surface-alt pb-24">
      <AppHeader />

      <main className="mx-auto max-w-7xl px-4 pt-5 space-y-6">
        {/* Header & Export Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-text-primary">
              Management Reports & Analytics
            </h1>
            <p className="text-xs text-text-secondary mt-0.5">
              Portfolio health, contractor performance, and live operational intelligence as of {formatDate(data?.asOf ?? '')}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={fetchDashboardData}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary shadow-xs hover:bg-surface-alt transition-colors"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl bg-danger-light border border-danger/20 p-3 text-xs text-danger font-medium">
            {error}
          </div>
        )}

        {/* ───────────────────────── EXPORT ACTIONS BAR (Requirement 16) ───────────────────────── */}
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <h2 className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-3">
            Company-Wide Reports & Exports
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* 1. Pending Items */}
            <div className="rounded-xl border border-border/70 bg-surface-alt/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-text-primary">Pending Dependencies</span>
                <span className="text-[10px] font-bold text-danger bg-danger/10 px-1.5 py-0.5 rounded">
                  {pendingItems.length} items
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={exportPendingCsv}
                  className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-alt text-center"
                >
                  CSV
                </button>
                <a
                  href="/api/reports/pending.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-alt text-center"
                >
                  PDF
                </a>
              </div>
            </div>

            {/* 2. All Products BOQ */}
            <div className="rounded-xl border border-border/70 bg-surface-alt/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-text-primary">All Products (BOQ)</span>
                <span className="text-[10px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                  Across Sites
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={exporting === 'all_boq_csv'}
                  onClick={exportAllBoqCatalogCsv}
                  className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-alt text-center disabled:opacity-50"
                >
                  {exporting === 'all_boq_csv' ? 'Exporting…' : 'CSV'}
                </button>
                <a
                  href="/api/reports/boq.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-alt text-center"
                >
                  PDF
                </a>
              </div>
            </div>

            {/* 3. Completed Items */}
            <div className="rounded-xl border border-border/70 bg-surface-alt/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-text-primary">Completed Items</span>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                  {completedItems.length} items
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={exportCompletedCsv}
                  className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-alt text-center"
                >
                  CSV
                </button>
                <a
                  href="/api/reports/completed.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-alt text-center"
                >
                  PDF
                </a>
              </div>
            </div>

            {/* 4. BOQ Audit History */}
            <div className="rounded-xl border border-border/70 bg-surface-alt/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-text-primary">BOQ Change Audit</span>
                <span className="text-[10px] font-bold text-text-muted bg-surface px-1.5 py-0.5 rounded border border-border/60">
                  Audit Trail
                </span>
              </div>
              <button
                type="button"
                onClick={exportAllBoqChanges}
                disabled={exporting === 'boq_changes'}
                className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-alt text-center disabled:opacity-50"
              >
                {exporting === 'boq_changes' ? 'Exporting…' : 'BOQ Changes CSV'}
              </button>
            </div>
          </div>
        </div>

        {/* ───────────────────────── PORTFOLIO SUMMARY CARDS ───────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
            <p className="text-xs font-semibold text-text-secondary">Active Projects</p>
            <p className="text-2xl font-extrabold text-text-primary mt-1">{sections.length}</p>
            <p className="text-[11px] text-text-muted mt-0.5">Monitored weekly</p>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
            <p className="text-xs font-semibold text-text-secondary">Total Pending</p>
            <p className="text-2xl font-extrabold text-warning mt-1">{totalPending}</p>
            <p className="text-[11px] text-text-muted mt-0.5">Open contractor items</p>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
            <p className="text-xs font-semibold text-text-secondary">Closed in 7 Days</p>
            <p className="text-2xl font-extrabold text-success mt-1">{totalClosedWeek}</p>
            <p className="text-[11px] text-text-muted mt-0.5">Verified complete on site</p>
          </div>
        </div>

        {/* ───────────────────────── PORTFOLIO TABLE ───────────────────────── */}
        <div className="rounded-2xl border border-border bg-surface overflow-hidden shadow-xs">
          <div className="border-b border-border bg-surface-alt px-4 py-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
              Project Dependency Portfolio
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-surface-alt/50 border-b border-border">
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
                      <td className="p-3.5 font-bold text-text-primary">
                        <Link
                          href={`/projects/${s.project.id}`}
                          className="hover:text-accent transition-colors"
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

        {/* ───────────────────────── ANALYTICS: 6 DETAILED SECTIONS (Requirement 16) ───────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Section 1: Pending by Agency */}
          <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
              <h3 className="text-sm font-bold text-text-primary">Pending by Agency</h3>
              <span className="text-[11px] text-text-muted font-medium">{pendingByAgency.length} agencies</span>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-border/40">
              {pendingByAgency.length === 0 ? (
                <p className="py-4 text-center text-xs text-text-muted">No pending items.</p>
              ) : (
                pendingByAgency.map((item, idx) => {
                  const pct = pendingItems.length ? Math.round((item.count / pendingItems.length) * 100) : 0;
                  return (
                    <div key={idx} className="flex items-center justify-between py-2 text-xs">
                      <div className="space-y-0.5 max-w-[70%]">
                        <span className="font-semibold text-text-primary truncate block">{item.agency}</span>
                        <div className="w-36 h-1.5 rounded-full bg-surface-alt overflow-hidden">
                          <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-text-primary">{item.count} items</span>
                        <span className="text-[10px] text-text-muted ml-1.5">({pct}%)</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Section 2: Reminders Sent per Agency */}
          <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
              <h3 className="text-sm font-bold text-text-primary">Reminders Sent per Agency</h3>
              <span className="text-[11px] text-text-muted font-medium">Chasing volume</span>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-border/40">
              {remindersByAgency.length === 0 ? (
                <p className="py-4 text-center text-xs text-text-muted">No reminders dispatched yet.</p>
              ) : (
                remindersByAgency.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between py-2 text-xs">
                    <span className="font-semibold text-text-primary truncate max-w-[70%]">{item.agency}</span>
                    <span className="font-bold text-warning px-2 py-0.5 rounded bg-warning/10">
                      {item.count} reminders
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Section 3: Pending by Room */}
          <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
              <h3 className="text-sm font-bold text-text-primary">Pending by Room</h3>
              <span className="text-[11px] text-text-muted font-medium">Top rooms</span>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-border/40">
              {pendingByRoom.length === 0 ? (
                <p className="py-4 text-center text-xs text-text-muted">No pending items.</p>
              ) : (
                pendingByRoom.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between py-2 text-xs">
                    <span className="font-semibold text-text-primary truncate max-w-[70%]">{item.room}</span>
                    <span className="font-bold text-text-primary">{item.count} open</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Section 4: Pending by Product */}
          <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
              <h3 className="text-sm font-bold text-text-primary">Pending by Product</h3>
              <span className="text-[11px] text-text-muted font-medium">Top catalogue items</span>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-border/40">
              {pendingByProduct.length === 0 ? (
                <p className="py-4 text-center text-xs text-text-muted">No pending items.</p>
              ) : (
                pendingByProduct.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between py-2 text-xs">
                    <span className="font-semibold text-text-primary truncate max-w-[70%]">{item.product}</span>
                    <span className="font-bold text-text-primary">{item.count} open</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Section 5: Items Completed per Week (last 8 weeks) */}
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
            <div>
              <h3 className="text-sm font-bold text-text-primary">Items Completed per Week</h3>
              <p className="text-xs text-text-secondary mt-0.5">Trailing 8 weeks completion cadence</p>
            </div>
            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
              {completedItems.length} total completed
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {completedPerWeek.map((w, idx) => (
              <div key={idx} className="rounded-xl border border-border bg-surface-alt/50 p-3 text-center space-y-1">
                <span className="text-[10px] font-semibold text-text-muted block truncate">{w.weekLabel}</span>
                <p className="text-lg font-extrabold text-emerald-600">{w.count}</p>
                <span className="text-[10px] text-text-secondary">completed</span>
              </div>
            ))}
          </div>
        </div>

        {/* Section 6: Oldest 20 Pending Items Table */}
        <div className="rounded-2xl border border-border bg-surface overflow-hidden shadow-xs">
          <div className="border-b border-border bg-surface-alt px-5 py-3.5 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-text-primary">Oldest 20 Pending Dependencies</h3>
              <p className="text-xs text-text-secondary mt-0.5">Critical items requiring management intervention</p>
            </div>
            <span className="text-xs font-bold text-danger bg-danger/10 px-2.5 py-0.5 rounded-full">
              Escalation queue
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-surface-alt/40 border-b border-border text-[11px] font-bold text-text-secondary uppercase">
                  <th className="p-3 w-10 text-center">#</th>
                  <th className="p-3 min-w-[130px]">Project</th>
                  <th className="p-3 min-w-[120px]">Room</th>
                  <th className="p-3 min-w-[150px]">Product / Step</th>
                  <th className="p-3 min-w-[130px]">Agency</th>
                  <th className="p-3 min-w-[90px]">Raised</th>
                  <th className="p-3 min-w-[90px] text-center">Days Open</th>
                  <th className="p-3 min-w-[180px]">Action Plan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {oldest20Pending.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-xs text-text-muted">
                      No pending items currently open.
                    </td>
                  </tr>
                ) : (
                  oldest20Pending.map((item, idx) => (
                    <tr key={item.id} className="hover:bg-surface-alt/40 transition-colors">
                      <td className="p-3 text-center text-text-muted font-mono">{idx + 1}</td>
                      <td className="p-3 font-bold text-text-primary">{item.projectName}</td>
                      <td className="p-3">
                        <span className="font-semibold text-text-primary">{item.roomName}</span>
                        <span className="block text-[10px] text-text-muted">{item.floorLabel}</span>
                      </td>
                      <td className="p-3 font-medium text-text-primary">{item.productTitle}</td>
                      <td className="p-3 text-text-secondary">{item.agencyLabel}</td>
                      <td className="p-3 whitespace-nowrap text-text-secondary">
                        {item.firstRaisedOn ? formatDate(item.firstRaisedOn) : '—'}
                      </td>
                      <td className="p-3 text-center">
                        <span className="font-bold text-danger bg-danger/10 px-1.5 py-0.5 rounded text-[11px]">
                          {item.daysOpen}d
                        </span>
                      </td>
                      <td className="p-3 text-text-secondary">
                        {item.actionPlan ? (
                          <span className="font-medium text-text-primary">{item.actionPlan}</span>
                        ) : (
                          <span className="text-text-muted italic">No action plan</span>
                        )}
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
