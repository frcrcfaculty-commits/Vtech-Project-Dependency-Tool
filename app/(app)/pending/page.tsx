'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/client/supabase';
import { compressImageToWebP } from '@/lib/client/image';
import { getEscalationLevel, isEscalated } from '@/lib/client/escalation';

interface PendingItem {
  id: string;
  project_id: string;
  room_id: string;
  agency_id: string | null;
  status: 'pending';
  first_raised_on: string | null;
  completed_on: string | null;
  reminder_count: number;
  last_reminded_on: string | null;
  note: string | null;
  photo_path: string | null;
  updated_at: string;
  projects: {
    id: string;
    name: string;
    client_name: string | null;
    l2_after: number | null;
    l3_after: number | null;
  } | null;
  rooms: {
    id: string;
    name: string;
    floors: {
      id: string;
      label: string;
    } | null;
  } | null;
  project_dependencies: {
    id: string;
    text: string;
    agency_types: {
      id: string;
      name: string;
    } | null;
  } | null;
  agencies: {
    id: string;
    company_name: string;
    agency_types: {
      id: string;
      name: string;
    } | null;
  } | null;
}

interface AgencyContact {
  id: string;
  agency_id: string;
  project_id: string;
  name: string;
  designation: string;
  level: number;
  phone: string | null;
  email: string | null;
  active: boolean;
}

interface ProjectQueueItem {
  projectId: string;
  projectName: string;
  itemIds: string[];
}

export default function PendingPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [items, setItems] = useState<PendingItem[]>([]);
  const [contacts, setContacts] = useState<AgencyContact[]>([]);

  // Selection
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  // Filters
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [agencyTypeFilter, setAgencyTypeFilter] = useState<string>('all');
  const [agencyFilter, setAgencyFilter] = useState<string>('all');
  const [escalatedOnly, setEscalatedOnly] = useState<boolean>(false);
  const [ageFilter, setAgeFilter] = useState<'all' | '7' | '14' | '30'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Status sheet modal (Done / N.A. / Edit)
  const [statusTargetItem, setStatusTargetItem] = useState<{
    item: PendingItem;
    targetStatus: 'complete' | 'pending' | 'na';
  } | null>(null);
  const [statusDate, setStatusDate] = useState<string>('');
  const [statusNote, setStatusNote] = useState<string>('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState<boolean>(false);

  // Photo viewer modal
  const [viewingPhotoUrl, setViewingPhotoUrl] = useState<string | null>(null);

  // Reminders queue modal (when multi-project is selected)
  const [queueProjects, setQueueProjects] = useState<ProjectQueueItem[] | null>(null);
  const [currentQueueIndex, setCurrentQueueIndex] = useState<number>(0);
  const [sendingReminders, setSendingReminders] = useState<boolean>(false);
  const [whatsAppRowLoadingId, setWhatsAppRowLoadingId] = useState<string | null>(null);

  // Load all pending items and active contacts
  const loadPendingData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const sb = supabaseBrowser();

      const [itemsRes, contactsRes] = await Promise.all([
        sb
          .from('dependency_items')
          .select(
            `id, project_id, room_id, agency_id, status, first_raised_on, completed_on, reminder_count, last_reminded_on, note, photo_path, updated_at,
             projects:project_id(id, name, client_name, l2_after, l3_after),
             rooms:room_id(id, name, floors:floor_id(id, label)),
             project_dependencies:project_dependency_id(id, text, agency_types:agency_type_id(id, name)),
             agencies:agency_id(id, company_name, agency_types:agency_type_id(id, name))`
          )
          .eq('status', 'pending')
          .order('first_raised_on', { ascending: true, nullsFirst: false }),
        sb
          .from('agency_contacts')
          .select('id, agency_id, project_id, name, designation, level, phone, email, active')
          .eq('active', true)
          .order('level', { ascending: true }),
      ]);

      if (itemsRes.error) throw itemsRes.error;
      if (contactsRes.error) throw contactsRes.error;

      // Type-safe cast of nested Supabase data
      const rawItems = (itemsRes.data ?? []) as unknown as PendingItem[];
      setItems(rawItems);
      setContacts((contactsRes.data ?? []) as AgencyContact[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pending dependencies');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPendingData();
  }, [loadPendingData]);

  // Listen for global dependency additions (O5: appear in pending list without reload)
  useEffect(() => {
    const handleAdded = () => {
      loadPendingData();
    };
    window.addEventListener('vtech:dependency-added', handleAdded);
    return () => window.removeEventListener('vtech:dependency-added', handleAdded);
  }, [loadPendingData]);

  // Map contacts by agency_id (sorted by level ASC: level 1 site engineer first)
  const contactsByAgency = useMemo(() => {
    const map = new Map<string, AgencyContact[]>();
    for (const c of contacts) {
      const list = map.get(c.agency_id) ?? [];
      list.push(c);
      map.set(c.agency_id, list);
    }
    return map;
  }, [contacts]);

  // Filter options derived from items
  const filterOptions = useMemo(() => {
    const projectsMap = new Map<string, { id: string; name: string; count: number }>();
    const agencyTypesSet = new Set<string>();
    const agenciesMap = new Map<string, { id: string; name: string }>();

    for (const item of items) {
      if (item.projects) {
        const cur = projectsMap.get(item.projects.id) ?? { id: item.projects.id, name: item.projects.name, count: 0 };
        cur.count++;
        projectsMap.set(item.projects.id, cur);
      }
      const typeName = item.project_dependencies?.agency_types?.name ?? item.agencies?.agency_types?.name;
      if (typeName) agencyTypesSet.add(typeName);
      if (item.agencies) {
        agenciesMap.set(item.agencies.id, { id: item.agencies.id, name: item.agencies.company_name });
      }
    }

    return {
      projects: Array.from(projectsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      agencyTypes: Array.from(agencyTypesSet).sort(),
      agencies: Array.from(agenciesMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [items]);

  // Filtered items
  const filteredItems = useMemo(() => {
    const now = Date.now();

    return items.filter((item) => {
      // Project filter
      if (projectFilter !== 'all' && item.project_id !== projectFilter) {
        return false;
      }

      // Agency type filter
      if (agencyTypeFilter !== 'all') {
        const typeName = item.project_dependencies?.agency_types?.name ?? item.agencies?.agency_types?.name;
        if (typeName !== agencyTypeFilter) return false;
      }

      // Agency filter
      if (agencyFilter !== 'all' && item.agency_id !== agencyFilter) {
        return false;
      }

      // Escalated only
      const l2After = item.projects?.l2_after ?? 3;
      if (escalatedOnly && !isEscalated(item.reminder_count, l2After)) {
        return false;
      }

      // Age filter
      if (ageFilter !== 'all') {
        if (!item.first_raised_on) return false;
        const raisedDate = new Date(item.first_raised_on).getTime();
        const daysOpen = Math.floor((now - raisedDate) / (1000 * 60 * 60 * 24));
        const minDays = parseInt(ageFilter, 10);
        if (daysOpen < minDays) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const text = item.project_dependencies?.text?.toLowerCase() ?? '';
        const room = item.rooms?.name?.toLowerCase() ?? '';
        const floor = item.rooms?.floors?.label?.toLowerCase() ?? '';
        const proj = item.projects?.name?.toLowerCase() ?? '';
        const agency = item.agencies?.company_name?.toLowerCase() ?? '';
        if (!text.includes(q) && !room.includes(q) && !floor.includes(q) && !proj.includes(q) && !agency.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [items, projectFilter, agencyTypeFilter, agencyFilter, escalatedOnly, ageFilter, searchQuery]);

  // Group filtered items by Project -> Agency
  interface GroupedProject {
    project: {
      id: string;
      name: string;
      client_name: string | null;
      l2_after: number | null;
      l3_after: number | null;
    };
    agencies: {
      agency: {
        id: string;
        company_name: string;
        agency_types: { id: string; name: string } | null;
      } | null;
      contacts: AgencyContact[];
      items: PendingItem[];
    }[];
    totalItems: number;
    escalatedCount: number;
  }

  const groupedData: GroupedProject[] = useMemo(() => {
    const projMap = new Map<string, GroupedProject>();

    for (const item of filteredItems) {
      const projId = item.project_id;
      const projData = item.projects ?? {
        id: projId,
        name: 'Untitled Project',
        client_name: null,
        l2_after: 3,
        l3_after: 6,
      };

      if (!projMap.has(projId)) {
        projMap.set(projId, {
          project: projData,
          agencies: [],
          totalItems: 0,
          escalatedCount: 0,
        });
      }

      const pGroup = projMap.get(projId)!;
      pGroup.totalItems++;
      if (isEscalated(item.reminder_count, projData.l2_after ?? 3)) {
        pGroup.escalatedCount++;
      }

      const agencyIdKey = item.agency_id ?? 'unassigned';
      let aGroup = pGroup.agencies.find((a) => (a.agency?.id ?? 'unassigned') === agencyIdKey);
      if (!aGroup) {
        aGroup = {
          agency: item.agencies ?? null,
          contacts: item.agency_id ? contactsByAgency.get(item.agency_id) ?? [] : [],
          items: [],
        };
        pGroup.agencies.push(aGroup);
      }
      aGroup.items.push(item);
    }

    return Array.from(projMap.values()).sort((a, b) => b.escalatedCount - a.escalatedCount || a.project.name.localeCompare(b.project.name));
  }, [filteredItems, contactsByAgency]);

  // Selection handlers
  const handleToggleItem = (itemId: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const handleToggleAgencyGroup = (agencyItems: PendingItem[]) => {
    const ids = agencyItems.map((i) => i.id);
    const allSelected = ids.every((id) => selectedItemIds.has(id));
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleToggleProjectGroup = (projectItems: GroupedProject) => {
    const allProjItemIds = projectItems.agencies.flatMap((a) => a.items.map((i) => i.id));
    const allSelected = allProjItemIds.every((id) => selectedItemIds.has(id));
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        allProjItemIds.forEach((id) => next.delete(id));
      } else {
        allProjItemIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    const allIds = filteredItems.map((i) => i.id);
    setSelectedItemIds(new Set(allIds));
  };

  const handleClearSelection = () => {
    setSelectedItemIds(new Set());
  };

  // Status Sheet Handlers (Done / N.A.)
  const handleOpenStatusSheet = (item: PendingItem, targetStatus: 'complete' | 'pending' | 'na') => {
    setStatusTargetItem({ item, targetStatus });
    setStatusDate(new Date().toISOString().slice(0, 10));
    setStatusNote(item.note ?? '');
    setPhotoFile(null);
    setPhotoPreview(null);
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const url = URL.createObjectURL(file);
    setPhotoPreview(url);
  };

  const handleSaveStatus = async () => {
    if (!statusTargetItem) return;
    const { item, targetStatus } = statusTargetItem;

    try {
      setSavingStatus(true);
      setError(null);
      const sb = supabaseBrowser();

      let storagePath: string | null = item.photo_path;

      if (photoFile) {
        const compressedBlob = await compressImageToWebP(photoFile, 1280, 0.7);
        const uuid = crypto.randomUUID();
        storagePath = `${item.project_id}/${item.id}/${uuid}.webp`;

        const { error: uploadErr } = await sb.storage.from('evidence').upload(storagePath, compressedBlob, {
          contentType: 'image/webp',
          upsert: true,
        });
        if (uploadErr) throw uploadErr;
      }

      const { error: rpcErr } = await sb.rpc('set_item_status', {
        p_item: item.id,
        p_status: targetStatus,
        p_date: statusDate || new Date().toISOString().slice(0, 10),
        p_note: statusNote.trim() || null,
        p_photo: storagePath,
      });

      if (rpcErr) throw rpcErr;

      // If status changed to complete or na, remove it from the pending list
      if (targetStatus !== 'pending') {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
        setSelectedItemIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        setNotice(`Item marked as ${targetStatus === 'complete' ? 'Completed' : 'N.A.'}`);
      } else {
        // If note or photo updated
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, note: statusNote.trim() || null, photo_path: storagePath } : i))
        );
        setNotice('Item updated');
      }

      setTimeout(() => setNotice(null), 3000);
      setStatusTargetItem(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update item status');
    } finally {
      setSavingStatus(false);
    }
  };

  // Open photo viewer
  const handleViewPhoto = async (photoPath: string) => {
    try {
      const sb = supabaseBrowser();
      const { data } = await sb.storage.from('evidence').createSignedUrl(photoPath, 3600);
      if (data?.signedUrl) {
        setViewingPhotoUrl(data.signedUrl);
      }
    } catch (err) {
      console.error('Failed to load signed photo url:', err);
    }
  };

  // Quick Action: WhatsApp Now for a single item
  const handleWhatsAppNow = async (item: PendingItem) => {
    try {
      setWhatsAppRowLoadingId(item.id);
      setError(null);

      const res = await fetch(`/api/projects/${item.project_id}/reminders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds: [item.id] }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to create follow-up reminder (${res.status})`);
      }

      const data = await res.json();
      if (data.visitId) {
        router.push(`/projects/${item.project_id}/visits/${data.visitId}/dispatches`);
      } else {
        setNotice('No reminder dispatch created for this item.');
        setTimeout(() => setNotice(null), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start WhatsApp reminder');
    } finally {
      setWhatsAppRowLoadingId(null);
    }
  };

  // Multi-select Action: Send Reminders
  const handleInitiateSendReminders = () => {
    if (selectedItemIds.size === 0) return;

    // Group selected items by project
    const projMap = new Map<string, { projectId: string; projectName: string; itemIds: string[] }>();

    for (const item of items) {
      if (selectedItemIds.has(item.id)) {
        const pId = item.project_id;
        const pName = item.projects?.name ?? 'Untitled Project';
        const cur = projMap.get(pId) ?? { projectId: pId, projectName: pName, itemIds: [] };
        cur.itemIds.push(item.id);
        projMap.set(pId, cur);
      }
    }

    const queueList = Array.from(projMap.values());
    if (queueList.length === 0) return;

    if (queueList.length === 1) {
      // Single project: process immediately
      processProjectReminders(queueList[0]);
    } else {
      // Multiple projects: show stepped queue modal
      setQueueProjects(queueList);
      setCurrentQueueIndex(0);
    }
  };

  const processProjectReminders = async (projQueue: ProjectQueueItem) => {
    try {
      setSendingReminders(true);
      setError(null);

      const res = await fetch(`/api/projects/${projQueue.projectId}/reminders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds: projQueue.itemIds }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to create reminders for ${projQueue.projectName} (${res.status})`);
      }

      const data = await res.json();
      if (data.visitId) {
        router.push(`/projects/${projQueue.projectId}/visits/${data.visitId}/dispatches`);
      } else {
        setNotice(`No new reminders needed for ${projQueue.projectName}.`);
        setTimeout(() => setNotice(null), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reminders');
    } finally {
      setSendingReminders(false);
    }
  };

  // Helper for age text
  const getDaysOpen = (dateStr: string | null) => {
    if (!dateStr) return 0;
    const raised = new Date(dateStr).getTime();
    return Math.max(0, Math.floor((Date.now() - raised) / (1000 * 60 * 60 * 24)));
  };

  const totalPending = items.length;
  const totalEscalated = items.filter((i) => isEscalated(i.reminder_count, i.projects?.l2_after ?? 3)).length;
  const totalProjects = filterOptions.projects.length;

  return (
    <div className="min-h-screen bg-surface-alt pb-28">
      {/* ───────────────────────── HEADER & STATS ───────────────────────── */}
      <div className="border-b border-border bg-surface px-4 py-5 shadow-xs">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-text-primary">Pending Dependencies</h1>
                <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-bold text-danger">
                  {totalPending} open
                </span>
              </div>
              <p className="mt-0.5 text-xs text-text-secondary">
                Cross-project actionable items requiring contractor follow-up
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={loadPendingData}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-surface-alt hover:text-text-primary disabled:opacity-50"
              >
                <svg
                  className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Refresh
              </button>
            </div>
          </div>

          {/* Quick Metrics Cards */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-border bg-surface-alt/60 p-2.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Total Pending</span>
              <p className="mt-0.5 text-lg font-extrabold text-text-primary">{totalPending}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface-alt/60 p-2.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Escalated (L2/L3)</span>
              <p className="mt-0.5 text-lg font-extrabold text-danger">{totalEscalated}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface-alt/60 p-2.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Active Projects</span>
              <p className="mt-0.5 text-lg font-extrabold text-text-primary">{totalProjects}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface-alt/60 p-2.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Selected</span>
              <p className="mt-0.5 text-lg font-extrabold text-accent">{selectedItemIds.size}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ───────────────────────── NOTICES / ERRORS ───────────────────────── */}
      <div className="mx-auto max-w-5xl px-4 pt-3">
        {error && (
          <div className="mb-3 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs font-semibold text-danger">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-3 rounded-lg border border-accent/30 bg-accent/10 p-3 text-xs font-semibold text-accent">
            {notice}
          </div>
        )}
      </div>

      {/* ───────────────────────── FILTERS BAR ───────────────────────── */}
      <div className="mx-auto max-w-5xl px-4 py-3">
        <div className="rounded-xl border border-border bg-surface p-3.5 shadow-xs space-y-3">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
            {/* Search */}
            <div className="lg:col-span-2">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">
                Search
              </label>
              <input
                type="text"
                placeholder="Search description, room, project, contractor…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-alt px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:bg-surface focus:outline-none"
              />
            </div>

            {/* Project Filter */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">
                Project
              </label>
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-alt px-2.5 py-1.5 text-xs text-text-primary focus:border-accent focus:bg-surface focus:outline-none"
              >
                <option value="all">All Projects ({totalPending})</option>
                {filterOptions.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.count})
                  </option>
                ))}
              </select>
            </div>

            {/* Agency Type Filter */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">
                Agency Type
              </label>
              <select
                value={agencyTypeFilter}
                onChange={(e) => setAgencyTypeFilter(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-alt px-2.5 py-1.5 text-xs text-text-primary focus:border-accent focus:bg-surface focus:outline-none"
              >
                <option value="all">All Types</option>
                {filterOptions.agencyTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            {/* Agency Filter */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">
                Agency Contractor
              </label>
              <select
                value={agencyFilter}
                onChange={(e) => setAgencyFilter(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-alt px-2.5 py-1.5 text-xs text-text-primary focus:border-accent focus:bg-surface focus:outline-none"
              >
                <option value="all">All Contractors</option>
                {filterOptions.agencies.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Secondary Row: Age Pills + Escalated Checkbox */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-2.5">
            <div className="flex flex-wrap items-center gap-3">
              {/* Age Filter */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-[11px] font-semibold text-text-secondary">Age:</span>
                {(['all', '7', '14', '30'] as const).map((age) => (
                  <button
                    key={age}
                    type="button"
                    onClick={() => setAgeFilter(age)}
                    className={`rounded-md px-2 py-0.5 text-xs font-semibold transition-colors ${
                      ageFilter === age
                        ? 'bg-text-primary text-surface'
                        : 'bg-surface-alt text-text-secondary hover:bg-border'
                    }`}
                  >
                    {age === 'all' ? 'All' : `> ${age}d`}
                  </button>
                ))}
              </div>

              {/* Escalated Toggle */}
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-text-primary">
                <input
                  type="checkbox"
                  checked={escalatedOnly}
                  onChange={(e) => setEscalatedOnly(e.target.checked)}
                  className="rounded border-border text-danger focus:ring-danger"
                />
                <span className={escalatedOnly ? 'text-danger font-bold' : ''}>Escalated only (L2/L3)</span>
              </label>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                className="text-xs font-semibold text-accent hover:underline"
              >
                Select all visible ({filteredItems.length})
              </button>
              {selectedItemIds.size > 0 && (
                <>
                  <span className="text-text-muted">·</span>
                  <button
                    type="button"
                    onClick={handleClearSelection}
                    className="text-xs font-semibold text-text-muted hover:text-text-primary"
                  >
                    Clear selection
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ───────────────────────── MAIN LIST ───────────────────────── */}
      <div className="mx-auto max-w-5xl px-4 pt-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <p className="mt-3 text-xs text-text-secondary">Loading pending dependencies…</p>
          </div>
        ) : groupedData.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface p-12 text-center">
            <svg
              className="mx-auto h-8 w-8 text-text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
            </svg>
            <h3 className="mt-2 text-sm font-bold text-text-primary">No pending dependencies found</h3>
            <p className="mt-1 text-xs text-text-secondary">
              {items.length === 0
                ? 'All clear! No items are currently marked as pending across your projects.'
                : 'No items match your active filter criteria.'}
            </p>
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setProjectFilter('all');
                  setAgencyTypeFilter('all');
                  setAgencyFilter('all');
                  setEscalatedOnly(false);
                  setAgeFilter('all');
                  setSearchQuery('');
                }}
                className="mt-3 inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-alt"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {groupedData.map((pGroup) => {
              const allProjIds = pGroup.agencies.flatMap((a) => a.items.map((i) => i.id));
              const isProjFullySelected = allProjIds.length > 0 && allProjIds.every((id) => selectedItemIds.has(id));
              const isProjPartiallySelected =
                allProjIds.some((id) => selectedItemIds.has(id)) && !isProjFullySelected;

              return (
                <div key={pGroup.project.id} className="rounded-xl border border-border bg-surface shadow-xs overflow-hidden">
                  {/* Project Header */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-alt/70 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isProjFullySelected}
                        ref={(el) => {
                          if (el) el.indeterminate = isProjPartiallySelected;
                        }}
                        onChange={() => handleToggleProjectGroup(pGroup)}
                        className="rounded border-border text-accent focus:ring-accent"
                        aria-label={`Select all items in project ${pGroup.project.name}`}
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/hub?p=${pGroup.project.id}`}
                            className="text-sm font-bold text-text-primary hover:text-accent transition-colors"
                          >
                            {pGroup.project.name}
                          </Link>
                          {pGroup.project.client_name && (
                            <span className="text-xs text-text-secondary">({pGroup.project.client_name})</span>
                          )}
                        </div>
                        <span className="text-[11px] text-text-muted">
                          {pGroup.totalItems} pending {pGroup.totalItems === 1 ? 'item' : 'items'}
                          {pGroup.escalatedCount > 0 && (
                            <span className="ml-1 text-danger font-semibold">
                              · {pGroup.escalatedCount} escalated
                            </span>
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Link
                        href={`/hub?p=${pGroup.project.id}`}
                        className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-text-secondary hover:text-text-primary"
                      >
                        Open in Hub →
                      </Link>
                    </div>
                  </div>

                  {/* Agencies under Project */}
                  <div className="divide-y divide-border/60">
                    {pGroup.agencies.map((aGroup) => {
                      const agencyIds = aGroup.items.map((i) => i.id);
                      const isAgencyFullySelected = agencyIds.every((id) => selectedItemIds.has(id));
                      const isAgencyPartiallySelected =
                        agencyIds.some((id) => selectedItemIds.has(id)) && !isAgencyFullySelected;

                      // Primary contact (Level 1 contact or first contact with phone)
                      const primaryContact = aGroup.contacts.find((c) => c.phone) ?? aGroup.contacts[0];

                      return (
                        <div key={aGroup.agency?.id ?? 'unassigned'} className="p-3.5 space-y-3">
                          {/* Agency Subheader */}
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-alt/40 px-3 py-2 border border-border/40">
                            <div className="flex items-center gap-2.5">
                              <input
                                type="checkbox"
                                checked={isAgencyFullySelected}
                                ref={(el) => {
                                  if (el) el.indeterminate = isAgencyPartiallySelected;
                                }}
                                onChange={() => handleToggleAgencyGroup(aGroup.items)}
                                className="rounded border-border text-accent focus:ring-accent"
                                aria-label={`Select all items for ${aGroup.agency?.company_name ?? 'Unassigned'}`}
                              />
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-text-primary">
                                    {aGroup.agency?.company_name ?? 'No Contractor Assigned'}
                                  </span>
                                  {aGroup.agency?.agency_types?.name && (
                                    <span className="rounded bg-border/60 px-1.5 py-0.2 text-[10px] font-semibold text-text-secondary">
                                      {aGroup.agency.agency_types.name}
                                    </span>
                                  )}
                                  <span className="text-[11px] text-text-muted">
                                    ({aGroup.items.length})
                                  </span>
                                </div>

                                {primaryContact && (
                                  <div className="flex items-center gap-2 text-[11px] text-text-secondary mt-0.5">
                                    <span>
                                      {primaryContact.name} ({primaryContact.designation})
                                    </span>
                                    {primaryContact.phone && (
                                      <a
                                        href={`tel:${primaryContact.phone}`}
                                        className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"
                                        title={`Call ${primaryContact.name}`}
                                      >
                                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                                          />
                                        </svg>
                                        {primaryContact.phone}
                                      </a>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Items Table / Row List */}
                          <div className="divide-y divide-border/40 border border-border/50 rounded-lg overflow-hidden bg-surface">
                            {aGroup.items.map((item) => {
                              const isSelected = selectedItemIds.has(item.id);
                              const daysOpen = getDaysOpen(item.first_raised_on);
                              const l2After = item.projects?.l2_after ?? 3;
                              const l3After = item.projects?.l3_after ?? 6;
                              const level = getEscalationLevel(item.reminder_count, l2After, l3After);
                              const escalated = isEscalated(item.reminder_count, l2After);

                              return (
                                <div
                                  key={item.id}
                                  className={`flex flex-col gap-2 p-3 text-xs transition-colors sm:flex-row sm:items-center sm:justify-between ${
                                    isSelected ? 'bg-accent/5' : 'hover:bg-surface-alt/40'
                                  }`}
                                >
                                  {/* Left: Checkbox + Location + Description */}
                                  <div className="flex items-start gap-3 sm:max-w-[55%]">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => handleToggleItem(item.id)}
                                      className="mt-0.5 rounded border-border text-accent focus:ring-accent"
                                      aria-label={`Select dependency: ${item.project_dependencies?.text}`}
                                    />
                                    <div className="space-y-1">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="rounded bg-surface-alt px-1.5 py-0.5 text-[10px] font-bold text-text-secondary border border-border/60">
                                          {item.rooms?.floors?.label ?? 'Floor'} · {item.rooms?.name ?? 'Room'}
                                        </span>

                                        {/* Escalation Level Badge */}
                                        <span
                                          className={`rounded px-1.5 py-0.2 text-[10px] font-bold uppercase tracking-wider ${
                                            level === 3
                                              ? 'bg-danger/15 text-danger'
                                              : level === 2
                                              ? 'bg-amber-500/15 text-amber-700'
                                              : 'bg-surface-alt text-text-muted'
                                          }`}
                                        >
                                          {level === 1 ? 'L1 · First notice' : `L${level} Escalation`}
                                        </span>

                                        {/* Age badge */}
                                        <span
                                          className={`text-[10px] font-medium ${
                                            daysOpen >= 14 ? 'text-danger font-semibold' : 'text-text-muted'
                                          }`}
                                        >
                                          {daysOpen}d open
                                        </span>

                                        {/* Reminder count */}
                                        <span className="text-[10px] text-text-muted">
                                          ({item.reminder_count} {item.reminder_count === 1 ? 'reminder' : 'reminders'})
                                        </span>
                                      </div>

                                      <p className="font-semibold text-text-primary leading-snug">
                                        {item.project_dependencies?.text}
                                      </p>

                                      {/* Attached Note / Photo */}
                                      {(item.note || item.photo_path) && (
                                        <div className="flex items-center gap-2 pt-0.5">
                                          {item.note && (
                                            <span className="inline-flex items-center gap-1 text-[11px] text-text-secondary italic">
                                              <svg className="h-3 w-3 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                                              </svg>
                                              &quot;{item.note}&quot;
                                            </span>
                                          )}
                                          {item.photo_path && (
                                            <button
                                              type="button"
                                              onClick={() => handleViewPhoto(item.photo_path!)}
                                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline"
                                            >
                                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                              </svg>
                                              View Photo
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Right: Quick Action Buttons */}
                                  <div className="flex flex-wrap items-center gap-1.5 pt-2 sm:pt-0">
                                    {/* Done button */}
                                    <button
                                      type="button"
                                      role="button"
                                      onClick={() => handleOpenStatusSheet(item, 'complete')}
                                      className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-text-primary hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 transition-colors"
                                      title="Mark Complete"
                                    >
                                      Done
                                    </button>

                                    {/* N.A. button */}
                                    <button
                                      type="button"
                                      role="button"
                                      onClick={() => handleOpenStatusSheet(item, 'na')}
                                      className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-surface-alt transition-colors"
                                      title="Mark Not Applicable"
                                    >
                                      N.A.
                                    </button>

                                    {/* WhatsApp Now */}
                                    <button
                                      type="button"
                                      disabled={whatsAppRowLoadingId === item.id}
                                      onClick={() => handleWhatsAppNow(item)}
                                      className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                                      title="Draft WhatsApp reminder for this item"
                                    >
                                      {whatsAppRowLoadingId === item.id ? (
                                        <span className="h-3 w-3 animate-spin rounded-full border border-emerald-800 border-t-transparent" />
                                      ) : (
                                        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                                          <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.007c.101.005.232-.038.361.275.144.346.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.087-.179.182-.077.357.101.173.449.742.965 1.201.664.591 1.224.774 1.397.86.173.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.144.39-.086s1.011.477 1.184.564.289.13.332.202c.043.073.043.419-.101.824z" />
                                        </svg>
                                      )}
                                      WhatsApp
                                    </button>

                                    {/* Call Contractor */}
                                    {primaryContact?.phone ? (
                                      <a
                                        href={`tel:${primaryContact.phone}`}
                                        className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors"
                                        title={`Call ${primaryContact.name}: ${primaryContact.phone}`}
                                      >
                                        <svg className="h-3 w-3 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                                          />
                                        </svg>
                                        Call
                                      </a>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ───────────────────────── STICKY ACTION BAR ───────────────────────── */}
      {selectedItemIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-surface px-4 py-3 shadow-lg">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
                {selectedItemIds.size}
              </span>
              <div>
                <p className="text-xs font-bold text-text-primary">
                  {selectedItemIds.size} {selectedItemIds.size === 1 ? 'item' : 'items'} selected
                </p>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="text-[11px] text-text-secondary hover:underline"
                >
                  Clear selection
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleInitiateSendReminders}
                disabled={sendingReminders}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {sendingReminders ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Preparing drafts…
                  </>
                ) : (
                  <>
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                    Send Reminders ({selectedItemIds.size})
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────── MODAL: MULTI-PROJECT REMINDER QUEUE ───────────────────────── */}
      {queueProjects && queueProjects.length > 1 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl space-y-4">
            <div className="border-b border-border/60 pb-3">
              <h3 className="text-sm font-bold text-text-primary">Send Reminders across Projects</h3>
              <p className="text-xs text-text-secondary mt-0.5">
                You selected items across {queueProjects.length} different projects. Review & send each project in sequence.
              </p>
            </div>

            <div className="space-y-2">
              {queueProjects.map((p, idx) => (
                <div
                  key={p.projectId}
                  className={`flex items-center justify-between rounded-xl border p-3 text-xs ${
                    idx === currentQueueIndex
                      ? 'border-accent bg-accent/5'
                      : 'border-border bg-surface-alt/40'
                  }`}
                >
                  <div>
                    <span className="font-bold text-text-primary">{p.projectName}</span>
                    <p className="text-[11px] text-text-secondary">
                      {p.itemIds.length} {p.itemIds.length === 1 ? 'item' : 'items'} selected
                    </p>
                  </div>
                  {idx === currentQueueIndex ? (
                    <span className="rounded bg-accent px-2 py-0.5 text-[10px] font-bold text-white">
                      Current
                    </span>
                  ) : idx < currentQueueIndex ? (
                    <span className="text-emerald-600 font-bold text-[11px]">✓ Processed</span>
                  ) : (
                    <span className="text-text-muted text-[11px]">Pending</span>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3">
              <button
                type="button"
                onClick={() => setQueueProjects(null)}
                className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-alt"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={sendingReminders}
                onClick={() => processProjectReminders(queueProjects[currentQueueIndex])}
                className="rounded-lg bg-accent px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {sendingReminders
                  ? 'Preparing drafts…'
                  : `Review & Send for ${queueProjects[currentQueueIndex].projectName} →`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────── MODAL: STATUS SHEET (DONE / N.A.) ───────────────────────── */}
      {statusTargetItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setStatusTargetItem(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-border/60 pb-3">
              <h3 className="text-sm font-bold text-text-primary">
                Update Dependency Status
              </h3>
              <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">
                {statusTargetItem.item.project_dependencies?.text}
              </p>
            </div>

            <div className="space-y-3">
              {/* Target Status Choice */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">
                  Status
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setStatusTargetItem((prev) => (prev ? { ...prev, targetStatus: 'complete' } : null))
                    }
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                      statusTargetItem.targetStatus === 'complete'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                        : 'border-border text-text-secondary hover:bg-surface-alt'
                    }`}
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setStatusTargetItem((prev) => (prev ? { ...prev, targetStatus: 'na' } : null))
                    }
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                      statusTargetItem.targetStatus === 'na'
                        ? 'border-border bg-text-primary text-surface'
                        : 'border-border text-text-secondary hover:bg-surface-alt'
                    }`}
                  >
                    N.A.
                  </button>
                </div>
              </div>

              {/* Date observed */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={statusDate}
                  onChange={(e) => setStatusDate(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                />
              </div>

              {/* Note */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">
                  Note (optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Verified on site with contractor…"
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
              </div>

              {/* Photo Evidence */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">
                  Photo Evidence (optional)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoSelect}
                  className="w-full text-xs text-text-secondary file:mr-2 file:rounded-md file:border-0 file:bg-surface-alt file:px-3 file:py-1 file:text-xs file:font-semibold file:text-text-primary hover:file:bg-border"
                />

                {photoPreview && (
                  <div className="mt-2 relative w-20 h-20 rounded-lg overflow-hidden border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
                <button
                  type="button"
                  onClick={() => setStatusTargetItem(null)}
                  className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-alt"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingStatus}
                  onClick={handleSaveStatus}
                  className="rounded-lg bg-accent px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-accent-hover transition-colors disabled:opacity-50"
                >
                  {savingStatus ? 'Saving…' : 'Save Status'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────── MODAL: PHOTO LIGHTBOX ───────────────────────── */}
      {viewingPhotoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setViewingPhotoUrl(null)}
        >
          <div className="relative max-w-2xl max-h-[90vh] overflow-hidden rounded-xl bg-black">
            <button
              type="button"
              onClick={() => setViewingPhotoUrl(null)}
              className="absolute top-2 right-2 rounded-full bg-black/60 px-2.5 py-1 text-xs font-bold text-white hover:bg-black/90"
            >
              ✕ Close
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={viewingPhotoUrl} alt="Evidence" className="max-h-[85vh] w-auto object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}
