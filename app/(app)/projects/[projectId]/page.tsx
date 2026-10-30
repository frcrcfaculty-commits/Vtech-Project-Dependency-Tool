'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/client/supabase';
import { useAuth } from '@/components/auth-provider';
import { AppHeader } from '@/components/app-header';
import { DeleteProjectButton } from '@/components/delete-project-button';
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
  const { profile } = useAuth();

  // Active Tab: 'overview' | 'grid' | 'agencies' | 'settings'
  const [activeTab, setActiveTab] = useState<'overview' | 'grid' | 'agencies' | 'settings'>('overview');

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

  // Add agency modal states (Agencies tab)
  const [showAddAgencyModal, setShowAddAgencyModal] = useState(false);
  const [agencyModalMode, setAgencyModalMode] = useState<'external' | 'internal'>('external');
  const [newAgencyTypeId, setNewAgencyTypeId] = useState('');
  const [newAgencyCompany, setNewAgencyCompany] = useState('');
  const [newAgencyEscalation, setNewAgencyEscalation] = useState(true);
  const [newAgencyContacts, setNewAgencyContacts] = useState<
    Array<{ name: string; designation: string; level: number; phone: string; email: string }>
  >([{ name: '', designation: '', level: 1, phone: '', email: '' }]);
  const [savingAgency, setSavingAgency] = useState(false);
  const [agencyActionError, setAgencyActionError] = useState<string | null>(null);
  const [agencySuccessMsg, setAgencySuccessMsg] = useState<string | null>(null);

  // Grid filter states
  const [gridAgencyFilter, setGridAgencyFilter] = useState<string>('all');
  const [gridStatusFilter, setGridStatusFilter] = useState<string>('all');

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

  // One-click Add VTech Team from pre-suggestions
  async function handleAddSuggestedVtechTeam(t: AgencyType) {
    setSavingAgency(true);
    setAgencyActionError(null);
    try {
      const sb = supabaseBrowser();
      const { data: newAg, error: agErr } = await sb
        .from('agencies')
        .insert({
          project_id: projectId,
          agency_type_id: t.id,
          company_name: t.name,
          escalation_enabled: true,
        })
        .select('id')
        .single();
      if (agErr) throw agErr;

      const { error: contErr } = await sb.from('agency_contacts').insert({
        project_id: projectId,
        agency_id: newAg.id,
        name: profile?.full_name || 'VTech Office Lead',
        designation: t.name.replace('VTech ', '') + ' Lead',
        level: 1,
        phone: profile?.phone || '+91 98200 00000',
        email: profile?.email || 'office@vtechpl.com',
      });
      if (contErr) console.warn('Could not add contact for internal team:', contErr);

      await loadData();
      setAgencySuccessMsg(`Added ${t.name}`);
      setTimeout(() => setAgencySuccessMsg(null), 3000);
    } catch (err) {
      setAgencyActionError(err instanceof Error ? err.message : `Failed to add ${t.name}`);
    } finally {
      setSavingAgency(false);
    }
  }

  // Add all unadded canonical VTech teams
  async function handleAddAllVtechTeams(teams: AgencyType[]) {
    if (teams.length === 0) return;
    setSavingAgency(true);
    setAgencyActionError(null);
    try {
      const sb = supabaseBrowser();
      for (const t of teams) {
        const { data: newAg, error: agErr } = await sb
          .from('agencies')
          .insert({
            project_id: projectId,
            agency_type_id: t.id,
            company_name: t.name,
            escalation_enabled: true,
          })
          .select('id')
          .single();
        if (agErr) throw agErr;

        await sb.from('agency_contacts').insert({
          project_id: projectId,
          agency_id: newAg.id,
          name: profile?.full_name || 'VTech Office Lead',
          designation: t.name.replace('VTech ', '') + ' Lead',
          level: 1,
          phone: profile?.phone || '+91 98200 00000',
          email: profile?.email || 'office@vtechpl.com',
        });
      }
      await loadData();
      setAgencySuccessMsg(`Added ${teams.length} VTech team(s)`);
      setTimeout(() => setAgencySuccessMsg(null), 3000);
    } catch (err) {
      setAgencyActionError(err instanceof Error ? err.message : 'Failed to add VTech teams');
    } finally {
      setSavingAgency(false);
    }
  }

  // Save new agency from modal
  async function handleSaveNewAgency(e: React.FormEvent) {
    e.preventDefault();
    if (!newAgencyTypeId) return;
    setSavingAgency(true);
    setAgencyActionError(null);
    try {
      const sb = supabaseBrowser();
      const { data: newAg, error: agErr } = await sb
        .from('agencies')
        .insert({
          project_id: projectId,
          agency_type_id: newAgencyTypeId,
          company_name: newAgencyCompany.trim(),
          escalation_enabled: newAgencyEscalation,
        })
        .select('id')
        .single();
      if (agErr) throw agErr;

      const validContacts = newAgencyContacts.filter((c) => c.name.trim() !== '');
      if (validContacts.length > 0) {
        const { error: cErr } = await sb.from('agency_contacts').insert(
          validContacts.map((c) => ({
            project_id: projectId,
            agency_id: newAg.id,
            name: c.name.trim(),
            designation: c.designation.trim() || 'Site Representative',
            level: c.level,
            phone: c.phone.trim() || null,
            email: c.email.trim() || null,
          }))
        );
        if (cErr) throw cErr;
      }

      setShowAddAgencyModal(false);
      setNewAgencyTypeId('');
      setNewAgencyCompany('');
      setNewAgencyContacts([{ name: '', designation: '', level: 1, phone: '', email: '' }]);
      await loadData();
      setAgencySuccessMsg(agencyModalMode === 'internal' ? 'Internal team added' : 'Agency added');
      setTimeout(() => setAgencySuccessMsg(null), 3000);
    } catch (err) {
      setAgencyActionError(err instanceof Error ? err.message : 'Failed to save agency');
    } finally {
      setSavingAgency(false);
    }
  }

  async function handleDeleteAgency(agencyId: string, companyName: string) {
    if (!confirm(`Are you sure you want to remove "${companyName}"? This will unlink it from this project.`)) return;
    setSavingAgency(true);
    try {
      const sb = supabaseBrowser();
      const { error: delErr } = await sb.from('agencies').delete().eq('id', agencyId);
      if (delErr) throw delErr;
      await loadData();
      setAgencySuccessMsg(`Removed ${companyName}`);
      setTimeout(() => setAgencySuccessMsg(null), 3000);
    } catch (err) {
      setAgencyActionError(err instanceof Error ? err.message : 'Failed to remove agency');
    } finally {
      setSavingAgency(false);
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
  const escalatedItems = pendingItems.filter(
    (i) => i.reminder_count > (project?.l2_after ?? 3)
  );

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
                {escalatedItems.length > 0 && (
                  <span className="inline-flex items-center rounded-md bg-danger-light px-2 py-0.5 text-xs font-bold text-danger">
                    {escalatedItems.length} Escalated
                  </span>
                )}
              </div>
              {project?.client_name && (
                <p className="text-xs text-text-secondary mt-0.5">
                  Client: <strong className="text-text-primary">{project.client_name}</strong>
                  {project.site_address && ` • ${project.site_address}`}
                </p>
              )}
            </div>

            {/* Quick Action: Site visit (classic) & Start Site Visit */}
            <div className="flex items-center gap-2">
              <Link
                href={`/projects/${projectId}/visits/new`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-surface-alt hover:text-text-primary transition-colors"
              >
                Site visit (classic)
              </Link>
              <Link
                href={`/projects/${projectId}/visits/new`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-accent-hover transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Start Site Visit
              </Link>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mb-5 flex border-b border-border">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'grid', label: `Grid (${items.length})` },
            { id: 'agencies', label: `Agencies (${agencies.length})` },
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
                <p className="text-xs font-medium text-text-secondary">Pending Dependencies</p>
                <p className="text-2xl font-bold text-warning mt-1">{pendingItems.length}</p>
                <p className="text-[11px] text-text-muted mt-0.5">Across all rooms</p>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
                <p className="text-xs font-medium text-text-secondary">Escalated (L2+)</p>
                <p className="text-2xl font-bold text-danger mt-1">{escalatedItems.length}</p>
                <p className="text-[11px] text-text-muted mt-0.5">Threshold &gt; {project?.l2_after}</p>
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
                <h3 className="text-sm font-bold text-text-primary">Recent Site Visits</h3>
                <Link
                  href={`/projects/${projectId}/visits/new`}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  + New Visit
                </Link>
              </div>

              {visits.length === 0 ? (
                <p className="text-xs text-text-muted italic">
                  No visits recorded yet. Click &quot;Start Site Visit&quot; above to log your first inspection.
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
                        <Link
                          href={`/projects/${projectId}/visits/${v.id}`}
                          className="rounded-md bg-surface-alt px-2.5 py-1 text-xs font-medium text-text-primary hover:bg-border transition-colors"
                        >
                          Checklist
                        </Link>
                        {v.status !== 'draft' && (
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

        {/* ───────────────────────── TAB 2: GRID MATRIX ───────────────────────── */}
        {activeTab === 'grid' && (
          <div className="space-y-4">
            {/* Filters Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-surface p-3 shadow-xs">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={gridAgencyFilter}
                  onChange={(e) => setGridAgencyFilter(e.target.value)}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-xs focus:border-accent"
                >
                  <option value="all">All Contractors ({agencies.length})</option>
                  {agencies.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.agency_types?.name} – {a.company_name}
                    </option>
                  ))}
                </select>

                <select
                  value={gridStatusFilter}
                  onChange={(e) => setGridStatusFilter(e.target.value)}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-xs focus:border-accent"
                >
                  <option value="all">All Statuses ({items.length})</option>
                  <option value="pending">Pending ({pendingItems.length})</option>
                  <option value="escalated">Escalated ({escalatedItems.length})</option>
                  <option value="complete">Complete ({completedItems.length})</option>
                  <option value="unchecked">Unchecked</option>
                  <option value="na">N.A.</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => setShowAddCustomModal(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-accent-hover transition-colors"
              >
                + Add Custom Dependency
              </button>
            </div>

            {/* Grid Table */}
            <div className="rounded-2xl border border-border bg-surface overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-surface-alt border-b border-border">
                      <th className="p-3 font-bold text-text-secondary">Dependency Item</th>
                      <th className="p-3 font-bold text-text-secondary">Contractor</th>
                      <th className="p-3 font-bold text-text-secondary">Room</th>
                      <th className="p-3 font-bold text-text-secondary">Status</th>
                      <th className="p-3 font-bold text-text-secondary text-right">Chased</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {items
                      .filter((i) => {
                        if (gridAgencyFilter !== 'all' && i.agency_id !== gridAgencyFilter) return false;
                        if (gridStatusFilter === 'escalated') {
                          return i.status === 'pending' && i.reminder_count > (project?.l2_after ?? 3);
                        }
                        if (gridStatusFilter !== 'all' && i.status !== gridStatusFilter) return false;
                        return true;
                      })
                      .map((item) => (
                        <tr
                          key={item.id}
                          onClick={() => setInspectedItem(item)}
                          className="hover:bg-surface-alt/70 cursor-pointer transition-colors"
                        >
                          <td className="p-3 font-medium text-text-primary max-w-xs truncate">
                            {item.project_dependencies?.text ?? '—'}
                          </td>
                          <td className="p-3 text-text-secondary truncate">
                            {item.agencies?.company_name ?? 'Unassigned'}
                          </td>
                          <td className="p-3 text-text-secondary">
                            {item.rooms?.name ?? '—'}
                          </td>
                          <td className="p-3">
                            <span
                              className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold ${
                                item.status === 'complete'
                                  ? 'bg-success-light text-success'
                                  : item.status === 'pending'
                                  ? item.reminder_count > (project?.l2_after ?? 3)
                                    ? 'bg-danger-light text-danger'
                                    : 'bg-warning-light text-warning'
                                  : item.status === 'na'
                                  ? 'bg-surface-alt text-text-muted'
                                  : 'bg-surface-alt text-text-secondary'
                              }`}
                            >
                              {item.status === 'pending' && item.reminder_count > (project?.l2_after ?? 3)
                                ? 'escalated'
                                : item.status}
                            </span>
                          </td>
                          <td className="p-3 text-right text-text-muted font-mono">
                            {item.reminder_count > 0 ? `${item.reminder_count}×` : '—'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ───────────────────────── TAB 3: AGENCIES ───────────────────────── */}
        {activeTab === 'agencies' && (() => {
          const externalAgencies = agencies.filter((a) => {
            const type = agencyTypes.find((t) => t.id === a.agency_type_id);
            return !(a.agency_types?.internal ?? type?.internal ?? false);
          });
          const internalAgencies = agencies.filter((a) => {
            const type = agencyTypes.find((t) => t.id === a.agency_type_id);
            return !!(a.agency_types?.internal ?? type?.internal ?? false);
          });

          const canonicalNames = ['VTech Installers', 'VTech Programmers', 'VTech Project Managers'];
          const vtechTypes = agencyTypes.filter((t) => t.internal && canonicalNames.includes(t.name));
          const unaddedVtechTeams = vtechTypes.filter(
            (t) => !agencies.some((a) => a.agency_type_id === t.id || a.agency_types?.name === t.name)
          );

          return (
            <div className="space-y-6">
              {/* Header & actions */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-text-primary">
                    Project Agencies &amp; Teams
                  </h3>
                  <p className="text-xs text-text-secondary mt-0.5">
                    External contractors and internal VTech execution teams for this site.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAgencyModalMode('external');
                      setNewAgencyTypeId('');
                      setNewAgencyCompany('');
                      setNewAgencyEscalation(true);
                      setNewAgencyContacts([{ name: '', designation: '', level: 1, phone: '', email: '' }]);
                      setShowAddAgencyModal(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors"
                  >
                    + Add External Agency
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAgencyModalMode('internal');
                      setNewAgencyTypeId('');
                      setNewAgencyCompany('');
                      setNewAgencyEscalation(true);
                      setNewAgencyContacts([{ name: '', designation: '', level: 1, phone: '', email: '' }]);
                      setShowAddAgencyModal(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors"
                  >
                    + Add Internal Team
                  </button>
                </div>
              </div>

              {agencyActionError && (
                <div className="rounded-lg bg-danger/10 border border-danger/20 p-3 text-xs font-medium text-danger">
                  {agencyActionError}
                </div>
              )}
              {agencySuccessMsg && (
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs font-medium text-emerald-700">
                  {agencySuccessMsg}
                </div>
              )}

              {/* ──────────────── SECTION 1: EXTERNAL AGENCIES ──────────────── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-text-primary flex items-center gap-2">
                    <span>External Agencies</span>
                    <span className="rounded-full bg-surface-alt border border-border px-2 py-0.2 text-xs font-semibold text-text-secondary">
                      {externalAgencies.length}
                    </span>
                  </h4>
                  <span className="text-xs text-text-secondary hidden sm:inline">
                    Contractors &amp; vendors (Electrician, Carpenter, Painter, AC, Architect, Client, etc.)
                  </span>
                </div>

                {externalAgencies.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-surface p-6 text-center text-xs text-text-muted">
                    No external agencies added yet. Click &quot;+ Add External Agency&quot; to configure contractors.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {externalAgencies.map((agency) => {
                      const type = agencyTypes.find((t) => t.id === agency.agency_type_id);
                      return (
                        <div key={agency.id} className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <span className="inline-block rounded-md bg-surface-alt border border-border px-2 py-0.5 text-xs font-semibold text-text-secondary mb-1">
                                {agency.agency_types?.name ?? type?.name ?? 'Agency'}
                              </span>
                              <h5 className="text-base font-bold text-text-primary">{agency.company_name}</h5>
                              <p className="text-xs text-text-secondary mt-0.5">
                                Escalation: {agency.escalation_enabled ? 'Enabled' : 'Disabled'}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteAgency(agency.id, agency.company_name)}
                              className="text-text-muted hover:text-danger text-xs font-medium px-2 py-1 rounded hover:bg-danger-light/30 transition-colors"
                            >
                              Remove
                            </button>
                          </div>

                          <div className="mt-3 pt-3 border-t border-border/60 space-y-1.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                              Contacts ({agency.agency_contacts.length}):
                            </p>
                            {agency.agency_contacts.map((c, i) => (
                              <div key={c.id ?? i} className="text-xs bg-surface-alt p-2 rounded-lg flex items-center justify-between">
                                <div>
                                  <span className="font-bold text-text-primary">{c.name}</span>
                                  <span className="text-text-muted ml-1">({c.designation})</span>
                                  <span className="ml-1.5 rounded-sm bg-border px-1 py-0.2 text-[10px] font-bold text-text-secondary">
                                    L{c.level}
                                  </span>
                                </div>
                                <div className="text-text-secondary text-[11px]">
                                  {c.phone || c.email}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ──────────────── SECTION 2: INTERNAL TEAM (VTECH) ──────────────── */}
              <div className="space-y-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-text-primary flex items-center gap-2">
                    <span>Internal Team (VTech)</span>
                    <span className="rounded-full bg-accent/10 border border-accent/20 px-2 py-0.2 text-xs font-semibold text-accent">
                      {internalAgencies.length}
                    </span>
                  </h4>
                  <span className="text-xs text-text-secondary hidden sm:inline">
                    Execution teams responsible for installation, programming, and management
                  </span>
                </div>

                {/* Pre-suggestions for the 3 VTech teams */}
                {unaddedVtechTeams.length > 0 && (
                  <div className="rounded-xl border border-accent/20 bg-accent/5 p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
                      <div>
                        <p className="text-xs font-bold text-accent">Suggested VTech Teams (1-Click Setup)</p>
                        <p className="text-[11px] text-text-secondary">
                          Add canonical teams required for product installation and programming tracking.
                        </p>
                      </div>
                      {unaddedVtechTeams.length > 1 && (
                        <button
                          type="button"
                          disabled={savingAgency}
                          onClick={() => handleAddAllVtechTeams(unaddedVtechTeams)}
                          className="self-start sm:self-auto rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors disabled:opacity-50"
                        >
                          + Add all {unaddedVtechTeams.length} VTech teams
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {unaddedVtechTeams.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          disabled={savingAgency}
                          onClick={() => handleAddSuggestedVtechTeam(t)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-surface px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
                        >
                          <span>+ Add {t.name}</span>
                          <span className="text-[10px] text-text-muted">
                            ({t.name.includes('Installers') ? 'Dark Red' : t.name.includes('Programmers') ? 'Light Red' : 'Orange'})
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {internalAgencies.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-surface p-6 text-center text-xs text-text-muted">
                    No internal VTech teams configured yet. Use the buttons above to add them with one click.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {internalAgencies.map((agency) => {
                      const type = agencyTypes.find((t) => t.id === agency.agency_type_id);
                      return (
                        <div key={agency.id} className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className="inline-block rounded-md bg-accent/15 text-accent border border-accent/20 px-2 py-0.5 text-xs font-semibold">
                                  {agency.agency_types?.name ?? type?.name ?? 'Internal Team'}
                                </span>
                                <span className="rounded bg-surface-alt px-1.5 py-0.2 text-[10px] font-bold text-text-muted uppercase">
                                  [Internal]
                                </span>
                              </div>
                              <h5 className="text-base font-bold text-text-primary">{agency.company_name}</h5>
                              <p className="text-xs text-text-secondary mt-0.5">
                                Escalation: {agency.escalation_enabled ? 'Enabled' : 'Disabled'}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteAgency(agency.id, agency.company_name)}
                              className="text-text-muted hover:text-danger text-xs font-medium px-2 py-1 rounded hover:bg-danger-light/30 transition-colors"
                            >
                              Remove
                            </button>
                          </div>

                          <div className="mt-3 pt-3 border-t border-border/60 space-y-1.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                              Contacts ({agency.agency_contacts.length}):
                            </p>
                            {agency.agency_contacts.map((c, i) => (
                              <div key={c.id ?? i} className="text-xs bg-surface-alt p-2 rounded-lg flex items-center justify-between">
                                <div>
                                  <span className="font-bold text-text-primary">{c.name}</span>
                                  <span className="text-text-muted ml-1">({c.designation})</span>
                                  <span className="ml-1.5 rounded-sm bg-border px-1 py-0.2 text-[10px] font-bold text-text-secondary">
                                    L{c.level}
                                  </span>
                                </div>
                                <div className="text-text-secondary text-[11px]">
                                  {c.phone || c.email}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ───────────────────────── TAB 4: SETTINGS ───────────────────────── */}
        {activeTab === 'settings' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
              <h3 className="text-sm font-bold text-text-primary mb-2">Project Configuration</h3>
              <p className="text-xs text-text-secondary mb-4 leading-relaxed">
                You can revisit the full 6-step project wizard anytime to add more floors, clone layouts, configure new trades, or edit escalation terms.
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
              {project?.status === 'closed' ? (
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
              ) : (
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm('Close this project? It will be hidden from the active Hub view.')) return;
                    const sb = supabaseBrowser();
                    await sb.from('projects').update({ status: 'closed' }).eq('id', projectId);
                    setProject((prev) => (prev ? { ...prev, status: 'closed' } : null));
                  }}
                  className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-2 text-xs font-semibold text-danger hover:bg-danger/10 transition-colors"
                >
                  Close Project
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

            {/* Current Escalation Policy Summary */}
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
              <h3 className="text-sm font-bold text-text-primary mb-2">Escalation Policy</h3>
              <div className="grid grid-cols-3 gap-3 text-center text-xs">
                <div className="rounded-xl bg-surface-alt p-3">
                  <p className="text-text-muted">L2 Threshold</p>
                  <p className="text-lg font-bold text-text-primary mt-1">{project?.l2_after} reminders</p>
                </div>
                <div className="rounded-xl bg-surface-alt p-3">
                  <p className="text-text-muted">L3 Threshold</p>
                  <p className="text-lg font-bold text-text-primary mt-1">{project?.l3_after} reminders</p>
                </div>
                <div className="rounded-xl bg-surface-alt p-3">
                  <p className="text-text-muted">CC Management</p>
                  <p className="text-lg font-bold text-text-primary mt-1">Level &ge; {project?.mgmt_cc_level}</p>
                </div>
              </div>
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

        {/* ── Modal: Add Agency / Internal Team ── */}
        {showAddAgencyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-text-primary">
                  {agencyModalMode === 'internal' ? 'Add Internal Team' : 'Add External Agency'}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAddAgencyModal(false)}
                  className="text-text-muted hover:text-text-primary text-sm font-bold p-1"
                >
                  ✕
                </button>
              </div>

              {/* Mode switch tabs */}
              <div className="flex rounded-lg bg-surface-alt p-1 mb-4 border border-border">
                <button
                  type="button"
                  onClick={() => {
                    setAgencyModalMode('external');
                    setNewAgencyTypeId('');
                    setNewAgencyCompany('');
                  }}
                  className={`flex-1 rounded-md py-1.5 text-xs font-semibold text-center transition-colors ${
                    agencyModalMode === 'external'
                      ? 'bg-surface text-text-primary shadow-xs'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  External Agency
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAgencyModalMode('internal');
                    setNewAgencyTypeId('');
                    setNewAgencyCompany('');
                  }}
                  className={`flex-1 rounded-md py-1.5 text-xs font-semibold text-center transition-colors ${
                    agencyModalMode === 'internal'
                      ? 'bg-surface text-text-primary shadow-xs'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  Internal Team (VTech)
                </button>
              </div>

              <form onSubmit={handleSaveNewAgency} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">
                    {agencyModalMode === 'internal' ? 'VTech Team Type' : 'Agency Type'} <span className="text-danger">*</span>
                  </label>
                  <select
                    required
                    value={newAgencyTypeId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewAgencyTypeId(val);
                      if (agencyModalMode === 'internal') {
                        const matchedType = agencyTypes.find((t) => t.id === val);
                        if (matchedType && !newAgencyCompany) {
                          setNewAgencyCompany(matchedType.name);
                        }
                      }
                    }}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  >
                    <option value="">Select type…</option>
                    {agencyTypes
                      .filter((t) => (agencyModalMode === 'internal' ? t.internal : !t.internal))
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">
                    {agencyModalMode === 'internal' ? 'Team Name / Label' : 'Company Name'} <span className="text-danger">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={agencyModalMode === 'internal' ? 'e.g. VTech Installers' : 'e.g. Omkar Electricals'}
                    value={newAgencyCompany}
                    onChange={(e) => setNewAgencyCompany(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="escToggleAg"
                    checked={newAgencyEscalation}
                    onChange={(e) => setNewAgencyEscalation(e.target.checked)}
                    className="rounded text-accent focus:ring-accent"
                  />
                  <label htmlFor="escToggleAg" className="text-xs text-text-primary">
                    Enable structured escalation for this agency
                  </label>
                </div>

                {/* Contacts */}
                <div className="border-t border-border pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-text-primary">Contacts</span>
                    <button
                      type="button"
                      onClick={() =>
                        setNewAgencyContacts([
                          ...newAgencyContacts,
                          { name: '', designation: '', level: 1, phone: '', email: '' },
                        ])
                      }
                      className="text-xs text-accent hover:underline"
                    >
                      + Add contact
                    </button>
                  </div>

                  {newAgencyContacts.map((c, idx) => (
                    <div key={idx} className="space-y-2 rounded-lg bg-surface-alt p-3 mb-2 border border-border">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          required
                          placeholder="Contact Name"
                          value={c.name}
                          onChange={(e) => {
                            const updated = [...newAgencyContacts];
                            updated[idx].name = e.target.value;
                            setNewAgencyContacts(updated);
                          }}
                          className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                        />
                        <input
                          type="text"
                          placeholder="Designation"
                          value={c.designation}
                          onChange={(e) => {
                            const updated = [...newAgencyContacts];
                            updated[idx].designation = e.target.value;
                            setNewAgencyContacts(updated);
                          }}
                          className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <select
                          value={c.level}
                          onChange={(e) => {
                            const updated = [...newAgencyContacts];
                            updated[idx].level = parseInt(e.target.value, 10) as 1 | 2 | 3;
                            setNewAgencyContacts(updated);
                          }}
                          className="rounded-md border border-border bg-surface px-1 py-1 text-xs"
                        >
                          <option value={1}>L1 (Site)</option>
                          <option value={2}>L2 (Manager)</option>
                          <option value={3}>L3 (Owner)</option>
                        </select>
                        <input
                          type="tel"
                          placeholder="Phone"
                          value={c.phone}
                          onChange={(e) => {
                            const updated = [...newAgencyContacts];
                            updated[idx].phone = e.target.value;
                            setNewAgencyContacts(updated);
                          }}
                          className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                        />
                        <input
                          type="email"
                          placeholder="Email"
                          value={c.email}
                          onChange={(e) => {
                            const updated = [...newAgencyContacts];
                            updated[idx].email = e.target.value;
                            setNewAgencyContacts(updated);
                          }}
                          className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddAgencyModal(false)}
                    className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingAgency}
                    className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors disabled:opacity-50"
                  >
                    {savingAgency ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
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
