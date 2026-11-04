'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/client/supabase';
import { useAuth } from '@/components/auth-provider';
import { AppHeader } from '@/components/app-header';
import { DeleteProjectButton } from '@/components/delete-project-button';
import { ProjectAgenciesForm } from '@/components/v5/project-agencies-form';
import Link from 'next/link';

interface Project {
  id: string;
  name: string;
  client_name: string | null;
  site_address: string | null;
  status: string;
  l2_after: number;
  l3_after: number;
  mgmt_cc_level: number;
  terms: string;
}

interface Floor {
  id: string;
  label: string;
  sort: number;
}

interface Room {
  id: string;
  floor_id: string;
  name: string;
  sort: number;
}

interface AgencyType {
  id: string;
  name: string;
  sort?: number;
  internal?: boolean;
}

interface Contact {
  id?: string;
  name: string;
  designation: string;
  level: number;
  phone: string | null;
  email: string | null;
}

interface Agency {
  id: string;
  agency_type_id?: string;
  company_name: string;
  escalation_enabled: boolean;
  agency_types: { id?: string; name: string; internal?: boolean } | null;
  agency_contacts: Contact[];
}

interface ProjectDep {
  id: string;
  text: string;
  agency_type_id: string;
}

interface DepItem {
  id: string;
  room_id: string;
  agency_id: string | null;
  project_dependency_id: string;
  status: 'unchecked' | 'pending' | 'complete' | 'na';
  first_raised_on: string | null;
  completed_on: string | null;
  reminder_count: number;
  note: string | null;
  photo_path: string | null;
  rooms?: { name: string; floor_id: string };
  project_dependencies?: { text: string; agency_type_id: string };
  agencies?: { company_name: string; agency_types: { name: string } | null };
}

interface SiteVisit {
  id: string;
  visit_date: string;
  status: 'draft' | 'finalized' | 'sent';
}

export default function ProjectHomePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile } = useAuth();

  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<'overview' | 'agencies' | 'settings'>(
    tabParam === 'agencies' ? 'agencies' : tabParam === 'settings' ? 'settings' : 'overview'
  );

  useEffect(() => {
    if (tabParam === 'agencies' || tabParam === 'settings' || tabParam === 'overview') {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data
  const [project, setProject] = useState<Project | null>(null);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [agencyTypes, setAgencyTypes] = useState<AgencyType[]>([]);
  const [projectDeps, setProjectDeps] = useState<ProjectDep[]>([]);
  const [items, setItems] = useState<DepItem[]>([]);
  const [visits, setVisits] = useState<SiteVisit[]>([]);

  // Add custom dependency modal state (mid-project)
  const [showAddCustomModal, setShowAddCustomModal] = useState(false);
  const [customDepTypeId, setCustomDepTypeId] = useState('');
  const [customDepText, setCustomDepText] = useState('');
  const [customDepRoomIds, setCustomDepRoomIds] = useState<Set<string>>(new Set());
  const [submittingCustom, setSubmittingCustom] = useState(false);

  // Item inspection modal
  const [inspectedItem, setInspectedItem] = useState<DepItem | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const sb = supabaseBrowser();

      const [
        { data: pData, error: pErr },
        { data: fData, error: fErr },
        { data: rData, error: rErr },
        { data: agData, error: agErr },
        { data: atData },
        { data: pdData, error: pdErr },
        { data: iData, error: iErr },
        { data: vData, error: vErr },
      ] = await Promise.all([
        sb.from('projects').select('*').eq('id', projectId).single(),
        sb.from('floors').select('*').eq('project_id', projectId).order('sort'),
        sb.from('rooms').select('*').eq('project_id', projectId).order('sort'),
        sb.from('agencies').select('*, agency_types(id, name, internal), agency_contacts(*)').eq('project_id', projectId),
        sb.from('agency_types').select('*').order('sort'),
        sb.from('project_dependencies').select('*').eq('project_id', projectId).order('seq'),
        sb.from('dependency_items').select(`
          id, room_id, agency_id, project_dependency_id, status, first_raised_on, completed_on,
          reminder_count, note, photo_path,
          rooms(name, floor_id),
          project_dependencies(text, agency_type_id),
          agencies(company_name, agency_types(name))
        `).eq('project_id', projectId),
        sb.from('site_visits').select('*').eq('project_id', projectId).order('visit_date', { ascending: false }),
      ]);

      if (pErr) throw new Error(pErr.message);
      if (fErr) throw new Error(fErr.message);
      if (rErr) throw new Error(rErr.message);
      if (agErr) throw new Error(agErr.message);
      if (pdErr) throw new Error(pdErr.message);
      if (iErr) throw new Error(iErr.message);
      if (vErr) throw new Error(vErr.message);

      setProject(pData as Project);
      setFloors(fData ?? []);
      setRooms(rData ?? []);
      setAgencies((agData as unknown as Agency[]) ?? []);
      setAgencyTypes(atData ?? []);
      setProjectDeps(pdData ?? []);
      setItems((iData as unknown as DepItem[]) ?? []);
      setVisits(vData ?? []);

      // Default select all rooms for custom dep modal
      const allRIds = new Set<string>(((rData ?? []) as Room[]).map((r) => r.id));
      setCustomDepRoomIds(allRIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project details');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle mid-project custom dependency submission
  async function handleAddCustomDependencyMidProject(e: React.FormEvent) {
    e.preventDefault();
    if (!customDepTypeId || !customDepText.trim()) return;
    setSubmittingCustom(true);
    try {
      const sb = supabaseBrowser();
      // 1. Insert into project_dependencies
      const { data: newDep, error: depErr } = await sb
        .from('project_dependencies')
        .insert({
          project_id: projectId,
          agency_type_id: customDepTypeId,
          text: customDepText.trim(),
          master_dependency_id: null,
        })
        .select('id')
        .single();

      if (depErr) throw depErr;

      // 2. Apply to selected rooms via RPC
      const roomIdsArray = Array.from(customDepRoomIds);
      if (roomIdsArray.length > 0) {
        const { error: applyErr } = await sb.rpc('apply_dependencies', {
          p_project: projectId,
          p_dep_ids: [newDep.id],
          p_room_ids: roomIdsArray,
        });
        if (applyErr) throw applyErr;
      }

      setShowAddCustomModal(false);
      setCustomDepText('');
      await loadData();
    } catch (err) {
      alert(`Failed to add custom dependency: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSubmittingCustom(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-alt">
        <Spinner />
      </div>
    );
  }

  // Metrics
  const pendingItems = items.filter((i) => i.status === 'pending');
  const completedItems = items.filter((i) => i.status === 'complete');

  // Pending breakdown by agency
  const pendingByAgency = new Map<string, number>();
  pendingItems.forEach((i) => {
    const name = i.agencies?.company_name
      ? `${i.agencies.agency_types?.name ?? ''} – ${i.agencies.company_name}`
      : 'Unassigned';
    pendingByAgency.set(name, (pendingByAgency.get(name) ?? 0) + 1);
  });

  // Pending breakdown by floor
  const pendingByFloor = new Map<string, number>();
  pendingItems.forEach((i) => {
    const room = rooms.find((r) => r.id === i.room_id);
    const floor = floors.find((f) => f.id === room?.floor_id);
    const label = floor?.label ?? 'Other';
    pendingByFloor.set(label, (pendingByFloor.get(label) ?? 0) + 1);
  });

  return (
    <div className="min-h-dvh bg-surface-alt pb-16">
      <AppHeader />

      <main className="mx-auto max-w-4xl px-4 pt-5">
        {/* Breadcrumb & Project Header */}
        <div className="mb-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-text-primary mb-2"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            All Projects
          </Link>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-text-primary">
                  {project?.name}
                </h1>
              </div>
              {project?.client_name && (
                <p className="text-xs text-text-secondary mt-0.5">
                  Client: <strong className="text-text-primary">{project.client_name}</strong>
                  {project.site_address && ` • ${project.site_address}`}
                </p>
              )}
            </div>

            <Link
              href={`/hub?p=${projectId}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-xs font-semibold text-white shadow-sm"
            >
              Open in Dashboard →
            </Link>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mb-5 flex items-center border-b border-border">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'agencies', label: 'Agencies' },
            { id: 'settings', label: 'Settings & Setup' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`px-4 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                activeTab === tab.id
                  ? 'border-accent text-accent font-bold'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <Link
            href={`/projects/${projectId}/reminders`}
            className="px-4 py-2 text-xs font-semibold border-b-2 -mb-px border-transparent text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors inline-flex items-center gap-1"
          >
            Reminders →
          </Link>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-danger-light border border-danger/20 p-3 text-xs text-danger font-medium">
            {error}
          </div>
        )}

        {/* ───────────────────────── TAB 1: OVERVIEW ───────────────────────── */}
        {activeTab === 'overview' && (
          <div className="space-y-5">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
                <p className="text-xs font-medium text-text-secondary">Pending Dependencies</p>
                <p className="text-2xl font-bold text-warning mt-1">{pendingItems.length}</p>
                <p className="text-[11px] text-text-muted mt-0.5">Across all rooms</p>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
                <p className="text-xs font-medium text-text-secondary">Completed Items</p>
                <p className="text-2xl font-bold text-success mt-1">{completedItems.length}</p>
                <p className="text-[11px] text-text-muted mt-0.5">Verified on site</p>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
                <p className="text-xs font-medium text-text-secondary">Site Visits Logged</p>
                <p className="text-2xl font-bold text-text-primary mt-1">{visits.length}</p>
                <p className="text-[11px] text-text-muted mt-0.5">
                  {visits[0] ? `Last: ${formatDate(visits[0].visit_date)}` : 'None yet'}
                </p>
              </div>
            </div>

            {/* Pending breakdown: By Agency & By Floor */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
                <h3 className="text-sm font-bold text-text-primary mb-3">Pending by Contractor</h3>
                {pendingByAgency.size === 0 ? (
                  <p className="text-xs text-text-muted italic">No pending dependencies! All clear.</p>
                ) : (
                  <div className="space-y-2">
                    {Array.from(pendingByAgency.entries()).map(([agency, count]) => (
                      <div key={agency} className="flex items-center justify-between text-xs py-1 border-b border-border/50">
                        <span className="font-medium text-text-primary truncate">{agency}</span>
                        <span className="rounded-md bg-warning-light px-2 py-0.5 font-bold text-warning">
                          {count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
                <h3 className="text-sm font-bold text-text-primary mb-3">Pending by Floor</h3>
                {pendingByFloor.size === 0 ? (
                  <p className="text-xs text-text-muted italic">No pending dependencies on any floor.</p>
                ) : (
                  <div className="space-y-2">
                    {Array.from(pendingByFloor.entries()).map(([floor, count]) => (
                      <div key={floor} className="flex items-center justify-between text-xs py-1 border-b border-border/50">
                        <span className="font-medium text-text-primary">{floor}</span>
                        <span className="rounded-md bg-warning-light px-2 py-0.5 font-bold text-warning">
                          {count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Recent Visits Section */}
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-text-primary">Reminder rounds</h3>
              </div>

              {visits.length === 0 ? (
                <p className="text-xs text-text-muted italic">
                  No reminders sent yet. Use “Send reminders” on the Dashboard.
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {visits.slice(0, 5).map((v) => (
                    <div key={v.id} className="flex items-center justify-between py-2.5 text-xs">
                      <div>
                        <p className="font-bold text-text-primary">{formatDate(v.visit_date)}</p>
                        <span className="text-[11px] text-text-muted capitalize">Status: {v.status}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        {(
                          <Link
                            href={`/projects/${projectId}/visits/${v.id}/dispatches`}
                            className="rounded-md bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
                          >
                            Dispatches
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ───────────────────────── TAB 2: AGENCIES ───────────────────────── */}
        {activeTab === 'agencies' && (
          <div className="space-y-4">
            <ProjectAgenciesForm
              projectId={projectId}
              onSaved={() => loadData()}
            />
          </div>
        )}

        {/* ───────────────────────── TAB 4: SETTINGS ───────────────────────── */}
        {activeTab === 'settings' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
              <h3 className="text-sm font-bold text-text-primary mb-2">Project Configuration</h3>
              <p className="text-xs text-text-secondary mb-4 leading-relaxed">
                You can revisit the project setup wizard anytime to add more floors, clone layouts, or configure new trades.
              </p>

              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/projects/${projectId}/setup`}
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors"
                >
                  Open Setup Wizard →
                </Link>
                <button
                  type="button"
                  onClick={() => setShowAddCustomModal(true)}
                  className="rounded-lg border border-border bg-surface-alt px-4 py-2 text-xs font-medium text-text-primary hover:bg-border transition-colors"
                >
                  + Add Custom Dependency
                </button>
              </div>
            </div>

            {/* Project Lifecycle Status */}
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
              <h3 className="text-sm font-bold text-text-primary mb-2">Project Lifecycle</h3>
              <p className="text-xs text-text-secondary mb-4 leading-relaxed">
                Current status: <strong className="text-text-primary uppercase">{project?.status ?? 'active'}</strong>.
                Closing a project hides it from the active Hub dashboard and routine follow-up queues.
              </p>
              {(project?.status === 'closed' || project?.status === 'finished') && (
                <button
                  type="button"
                  onClick={async () => {
                    const sb = supabaseBrowser();
                    await sb.from('projects').update({ status: 'active' }).eq('id', projectId);
                    setProject((prev) => (prev ? { ...prev, status: 'active' } : null));
                  }}
                  className="rounded-lg border border-border bg-surface px-4 py-2 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors"
                >
                  Reopen Project
                </button>
              )}
              {project && (
                <DeleteProjectButton
                  projectId={projectId}
                  projectName={project.name}
                  onDeleted={() => router.push('/hub')}
                  className="ml-2 rounded-lg border border-danger/40 bg-danger px-4 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity"
                />
              )}
            </div>
          </div>
        )}

        {/* ── Modal: Add Custom Dependency Mid-Project ── */}
        {showAddCustomModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-xl">
              <h3 className="text-base font-bold text-text-primary mb-2">
                Add Custom Dependency
              </h3>
              <p className="text-xs text-text-secondary mb-4">
                Add a new site-specific dependency mid-project and apply it to selected rooms immediately.
              </p>

              <form onSubmit={handleAddCustomDependencyMidProject} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">
                    Contractor Trade <span className="text-danger">*</span>
                  </label>
                  <select
                    required
                    value={customDepTypeId}
                    onChange={(e) => setCustomDepTypeId(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  >
                    <option value="">Select trade…</option>
                    {agencyTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">
                    Dependency Requirement <span className="text-danger">*</span>
                  </label>
                  <textarea
                    required
                    rows={3}
                    placeholder="e.g. Ensure 4-core speaker cable routed to balcony ceiling niche"
                    value={customDepText}
                    onChange={(e) => setCustomDepText(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  />
                </div>

                {/* Room selector */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-text-secondary">
                      Apply to Rooms ({customDepRoomIds.size} of {rooms.length})
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        if (customDepRoomIds.size === rooms.length) {
                          setCustomDepRoomIds(new Set());
                        } else {
                          setCustomDepRoomIds(new Set(rooms.map((r) => r.id)));
                        }
                      }}
                      className="text-xs text-accent hover:underline"
                    >
                      {customDepRoomIds.size === rooms.length ? 'Clear all' : 'Select all'}
                    </button>
                  </div>

                  <div className="max-h-36 overflow-y-auto rounded-lg border border-border bg-surface-alt p-2 space-y-1">
                    {rooms.map((r) => {
                      const isSelected = customDepRoomIds.has(r.id);
                      return (
                        <label key={r.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-surface p-1 rounded">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              const next = new Set(customDepRoomIds);
                              if (e.target.checked) next.add(r.id);
                              else next.delete(r.id);
                              setCustomDepRoomIds(next);
                            }}
                            className="rounded text-accent"
                          />
                          <span>{r.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setShowAddCustomModal(false)}
                    className="rounded-lg border border-border px-3.5 py-1.5 text-xs text-text-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingCustom}
                    className="rounded-lg bg-accent px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-accent-hover"
                  >
                    {submittingCustom ? 'Adding…' : 'Add & Apply'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Modal: Inspect Item Details ── */}
        {inspectedItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setInspectedItem(null)}>
            <div
              className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-sm font-bold text-text-primary mb-1">
                {inspectedItem.project_dependencies?.text}
              </h3>
              <p className="text-xs text-text-secondary mb-3">
                {inspectedItem.rooms?.name} • {inspectedItem.agencies?.company_name ?? 'Unassigned'}
              </p>

              <div className="space-y-2 text-xs bg-surface-alt p-3 rounded-xl mb-4">
                <div className="flex justify-between">
                  <span className="text-text-muted">Status:</span>
                  <span className="font-bold uppercase text-text-primary">{inspectedItem.status}</span>
                </div>
                {inspectedItem.first_raised_on && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">First raised:</span>
                    <span className="font-medium text-text-primary">{formatDate(inspectedItem.first_raised_on)}</span>
                  </div>
                )}
                {inspectedItem.completed_on && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">Completed:</span>
                    <span className="font-medium text-success">{formatDate(inspectedItem.completed_on)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-text-muted">Reminder count:</span>
                  <span className="font-bold text-text-primary">{inspectedItem.reminder_count}</span>
                </div>
                {inspectedItem.note && (
                  <div className="pt-2 border-t border-border">
                    <p className="text-text-muted mb-0.5">Note:</p>
                    <p className="text-text-primary font-sans">{inspectedItem.note}</p>
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setInspectedItem(null)}
                  className="rounded-lg bg-surface-alt border border-border px-4 py-1.5 text-xs font-semibold text-text-primary"
                >
                  Close
                </button>
              </div>
            </div>
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
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={2.5} />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
