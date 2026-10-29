'use client';

import { Suspense, useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/client/supabase';
import { useAuth } from '@/components/auth-provider';
import { AppHeader } from '@/components/app-header';
import { compressImageToWebP } from '@/lib/client/image';
import { getEscalationLevel, isEscalated, formatEscalationLabel } from '@/lib/client/escalation';
import Link from 'next/link';

interface ProjectTile {
  id: string;
  name: string;
  client_name: string | null;
  site_address: string | null;
  status: 'active' | 'on_hold' | 'closed';
  l2_after: number;
  l3_after: number;
  updated_at: string;
  pendingCount: number;
  escalatedCount: number;
  completedCount: number;
  totalCount: number;
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

interface Agency {
  id: string;
  company_name: string;
  agency_types: { id: string; name: string } | null;
}

interface DependencyItem {
  id: string;
  project_id: string;
  room_id: string;
  agency_id: string | null;
  project_dependency_id: string;
  status: 'unchecked' | 'pending' | 'complete' | 'na';
  first_raised_on: string | null;
  completed_on: string | null;
  reminder_count: number;
  note: string | null;
  photo_path: string | null;
  updated_at: string;
  agencies: Agency | null;
  project_dependencies: {
    id: string;
    text: string;
    agency_types: { id: string; name: string } | null;
  } | null;
  rooms?: { name: string } | null;
}

interface ItemEvent {
  id: string;
  item_id: string;
  status: 'pending' | 'complete' | 'na';
  status_date: string;
  note: string | null;
  photo_path: string | null;
  source: 'office' | 'visit';
  created_at: string;
}

export default function HubPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-surface-alt">
          <Spinner />
        </div>
      }
    >
      <HubContent />
    </Suspense>
  );
}

function HubContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile, loading: authLoading } = useAuth();

  const [projects, setProjects] = useState<ProjectTile[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Selected project details
  const [floors, setFloors] = useState<Floor[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [projectAgencies, setProjectAgencies] = useState<Agency[]>([]);
  const [items, setItems] = useState<DependencyItem[]>([]);
  const [collapsedFloors, setCollapsedFloors] = useState<Set<string>>(new Set());

  // Filter states
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'escalated' | 'complete' | 'unchecked' | 'na'>('all');
  const [agencyFilter, setAgencyFilter] = useState<string>('all');

  // Status Sheet / Modal state
  const [statusTargetItem, setStatusTargetItem] = useState<{
    item: DependencyItem;
    targetStatus: 'complete' | 'pending' | 'na';
  } | null>(null);
  const [statusDate, setStatusDate] = useState<string>('');
  const [statusNote, setStatusNote] = useState<string>('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);

  // History Drawer state
  const [historyItem, setHistoryItem] = useState<DependencyItem | null>(null);
  const [historyEvents, setHistoryEvents] = useState<ItemEvent[]>([]);
  const [historySignedUrls, setHistorySignedUrls] = useState<Record<string, string>>({});
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Assign Agency Modal state
  const [assignTargetItem, setAssignTargetItem] = useState<DependencyItem | null>(null);
  const [selectedAgencyIdToAssign, setSelectedAgencyIdToAssign] = useState<string>('');
  const [savingAssign, setSavingAssign] = useState(false);

  // Sending reminders state
  const [sendingReminders, setSendingReminders] = useState(false);

  // Close / Reopen project status update state
  const [updatingProjectStatus, setUpdatingProjectStatus] = useState(false);

  // Show closed projects toggle (default false: closed projects hidden)
  const [showClosed, setShowClosed] = useState(false);

  // Preview Photo Modal
  const [viewingPhotoUrl, setViewingPhotoUrl] = useState<string | null>(null);

  const displayedProjects = useMemo(() => {
    return showClosed ? projects : projects.filter((p) => p.status !== 'closed');
  }, [projects, showClosed]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  // Fetch all accessible projects and high-level counts
  const loadProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const sb = supabaseBrowser();

      const [{ data: dbProjects, error: pErr }, { data: allItems, error: iErr }] = await Promise.all([
        sb
          .from('projects')
          .select('id, name, client_name, site_address, status, l2_after, l3_after, updated_at')
          .order('name'),
        sb.from('dependency_items').select('project_id, status, reminder_count'),
      ]);

      if (pErr) throw pErr;
      if (iErr) throw iErr;

      const projectItemsMap = new Map<string, { pending: number; escalated: number; complete: number; total: number }>();

      (allItems ?? []).forEach((item: { project_id: string; status: string; reminder_count: number }) => {
        const stats = projectItemsMap.get(item.project_id) ?? { pending: 0, escalated: 0, complete: 0, total: 0 };
        stats.total++;
        if (item.status === 'pending') {
          stats.pending++;
          // High-level threshold check (default 3)
          if (item.reminder_count > 3) stats.escalated++;
        } else if (item.status === 'complete') {
          stats.complete++;
        }
        projectItemsMap.set(item.project_id, stats);
      });

      const tiles: ProjectTile[] = (dbProjects ?? []).map(
        (p: {
          id: string;
          name: string;
          client_name: string | null;
          site_address: string | null;
          status: string | null;
          l2_after: number | null;
          l3_after: number | null;
          updated_at: string;
        }) => {
          const stats = projectItemsMap.get(p.id) ?? { pending: 0, escalated: 0, complete: 0, total: 0 };
          return {
            id: p.id,
            name: p.name,
            client_name: p.client_name,
            site_address: p.site_address,
            status: (p.status as 'active' | 'on_hold' | 'closed') ?? 'active',
            l2_after: p.l2_after ?? 3,
            l3_after: p.l3_after ?? 6,
            updated_at: p.updated_at,
            pendingCount: stats.pending,
            escalatedCount: stats.escalated,
            completedCount: stats.complete,
            totalCount: stats.total,
          };
        }
      );

      // Sort by escalated (descending), then pending (descending), then name
      tiles.sort((a, b) => b.escalatedCount - a.escalatedCount || b.pendingCount - a.pendingCount || a.name.localeCompare(b.name));
      setProjects(tiles);

      // Determine selected project from URL or first active project
      const queryP = searchParams.get('p');
      const activeTiles = tiles.filter((t) => t.status !== 'closed');
      if (queryP && tiles.some((t) => t.id === queryP)) {
        setSelectedProjectId(queryP);
        if (tiles.find((t) => t.id === queryP)?.status === 'closed') {
          setShowClosed(true);
        }
      } else if (activeTiles.length > 0) {
        setSelectedProjectId(activeTiles[0].id);
      } else if (tiles.length > 0) {
        setSelectedProjectId(tiles[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  // Load details for selected project
  const loadProjectDetails = useCallback(async (projId: string) => {
    if (!projId) return;
    try {
      const sb = supabaseBrowser();
      const [
        { data: fls, error: fErr },
        { data: rms, error: rErr },
        { data: ags, error: agErr },
        { data: depItems, error: itemsErr },
      ] = await Promise.all([
        sb.from('floors').select('id, label, sort').eq('project_id', projId).order('sort'),
        sb.from('rooms').select('id, floor_id, name, sort').eq('project_id', projId).order('sort'),
        sb.from('agencies').select('id, company_name, agency_types(id, name)').eq('project_id', projId),
        sb
          .from('dependency_items')
          .select(
            `id, project_id, room_id, agency_id, project_dependency_id, status, first_raised_on, completed_on, reminder_count, note, photo_path, updated_at,
             agencies(id, company_name, agency_types(id, name)),
             project_dependencies(id, text, agency_types(id, name)),
             rooms(name)`
          )
          .eq('project_id', projId),
      ]);

      if (fErr) throw fErr;
      if (rErr) throw rErr;
      if (agErr) throw agErr;
      if (itemsErr) throw itemsErr;

      setFloors(fls ?? []);
      setRooms(rms ?? []);
      setProjectAgencies((ags as unknown as Agency[]) ?? []);
      setItems((depItems as unknown as DependencyItem[]) ?? []);
    } catch (err) {
      console.error('Failed to load project details:', err);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Listen for global dependency additions to refresh counts & details
  useEffect(() => {
    const handleAdded = () => {
      loadProjects();
      if (selectedProjectId) loadProjectDetails(selectedProjectId);
    };
    window.addEventListener('vtech:dependency-added', handleAdded);
    return () => window.removeEventListener('vtech:dependency-added', handleAdded);
  }, [loadProjects, selectedProjectId, loadProjectDetails]);

  useEffect(() => {
    if (selectedProjectId) {
      loadProjectDetails(selectedProjectId);
    }
  }, [selectedProjectId, loadProjectDetails]);

  // Change selected project
  const handleSelectProject = (id: string) => {
    setSelectedProjectId(id);
    router.push(`/hub?p=${id}`);
  };

  // Toggle collapse for a floor
  const toggleFloorCollapse = (floorId: string) => {
    setCollapsedFloors((prev) => {
      const next = new Set(prev);
      if (next.has(floorId)) next.delete(floorId);
      else next.add(floorId);
      return next;
    });
  };

  // Open status sheet for an item
  const openStatusSheet = (item: DependencyItem, target: 'complete' | 'pending' | 'na') => {
    setStatusTargetItem({ item, targetStatus: target });
    setStatusDate(new Date().toISOString().slice(0, 10));
    setStatusNote(item.note ?? '');
    setPhotoFile(null);
    setPhotoPreview(null);
  };

  // Handle photo selection in status sheet
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const url = URL.createObjectURL(file);
    setPhotoPreview(url);
  };

  // Save status via set_item_status RPC
  const handleSaveStatus = async () => {
    if (!statusTargetItem) return;
    const { item, targetStatus } = statusTargetItem;

    try {
      setSavingStatus(true);
      setError(null);
      const sb = supabaseBrowser();

      let storagePath: string | null = item.photo_path;

      // Compress and upload photo if a new file was selected
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

      // Call set_item_status RPC
      const { data: updatedItem, error: rpcErr } = await sb.rpc('set_item_status', {
        p_item: item.id,
        p_status: targetStatus,
        p_date: statusDate || new Date().toISOString().slice(0, 10),
        p_note: statusNote.trim() || null,
        p_photo: storagePath,
      });

      if (rpcErr) throw rpcErr;

      // Update local state
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                status: targetStatus,
                note: statusNote.trim() || null,
                photo_path: storagePath,
                first_raised_on: updatedItem?.first_raised_on ?? i.first_raised_on,
                completed_on: updatedItem?.completed_on ?? i.completed_on,
                reminder_count: updatedItem?.reminder_count ?? i.reminder_count,
              }
            : i
        )
      );

      // Update project tile counts
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== item.project_id) return p;
          const deltaPending = (targetStatus === 'pending' ? 1 : 0) - (item.status === 'pending' ? 1 : 0);
          const deltaComplete = (targetStatus === 'complete' ? 1 : 0) - (item.status === 'complete' ? 1 : 0);
          return {
            ...p,
            pendingCount: Math.max(0, p.pendingCount + deltaPending),
            completedCount: Math.max(0, p.completedCount + deltaComplete),
          };
        })
      );

      setNotice(`Updated status to ${targetStatus.toUpperCase()}`);
      setTimeout(() => setNotice(null), 2500);
      setStatusTargetItem(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update item status');
    } finally {
      setSavingStatus(false);
    }
  };

  // Open History Drawer
  const openHistoryDrawer = async (item: DependencyItem) => {
    setHistoryItem(item);
    setLoadingHistory(true);
    try {
      const sb = supabaseBrowser();
      const { data: events, error: evErr } = await sb
        .from('item_events')
        .select('*')
        .eq('item_id', item.id)
        .order('created_at', { ascending: false });

      if (evErr) throw evErr;
      setHistoryEvents((events as ItemEvent[]) ?? []);

      // Generate signed URLs for event photos
      const paths = (events ?? []).map((e: ItemEvent) => e.photo_path).filter(Boolean) as string[];
      if (paths.length > 0) {
        const urlMap: Record<string, string> = {};
        await Promise.all(
          paths.map(async (path) => {
            const { data } = await sb.storage.from('evidence').createSignedUrl(path, 3600);
            if (data?.signedUrl) {
              urlMap[path] = data.signedUrl;
            }
          })
        );
        setHistorySignedUrls(urlMap);
      }
    } catch (err) {
      console.error('Failed to load item history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Open Photo Viewer
  const viewItemPhoto = async (photoPath: string) => {
    try {
      const sb = supabaseBrowser();
      const { data } = await sb.storage.from('evidence').createSignedUrl(photoPath, 3600);
      if (data?.signedUrl) {
        setViewingPhotoUrl(data.signedUrl);
      }
    } catch (err) {
      console.error('Failed to get signed photo URL:', err);
    }
  };

  // Assign Agency
  const handleAssignAgency = async () => {
    if (!assignTargetItem || !selectedAgencyIdToAssign) return;
    try {
      setSavingAssign(true);
      const sb = supabaseBrowser();
      const { error: assignErr } = await sb
        .from('dependency_items')
        .update({ agency_id: selectedAgencyIdToAssign })
        .eq('id', assignTargetItem.id);

      if (assignErr) throw assignErr;

      const assignedAgency = projectAgencies.find((a) => a.id === selectedAgencyIdToAssign) ?? null;
      setItems((prev) =>
        prev.map((i) => (i.id === assignTargetItem.id ? { ...i, agency_id: selectedAgencyIdToAssign, agencies: assignedAgency } : i))
      );

      setNotice('Contractor agency assigned');
      setTimeout(() => setNotice(null), 2500);
      setAssignTargetItem(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign agency');
    } finally {
      setSavingAssign(false);
    }
  };

  // Send reminders for selected project
  const handleSendProjectReminders = async () => {
    if (!selectedProjectId) return;
    try {
      setSendingReminders(true);
      setError(null);

      const res = await fetch(`/api/projects/${selectedProjectId}/reminders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to create reminders (${res.status})`);
      }

      const data = await res.json();
      if (data.visitId) {
        router.push(`/projects/${selectedProjectId}/visits/${data.visitId}/dispatches`);
      } else {
        setNotice('All clear: No pending items require reminders right now.');
        setTimeout(() => setNotice(null), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reminders');
    } finally {
      setSendingReminders(false);
    }
  };

  // Close Project handler (sets projects.status = 'closed')
  const handleCloseProject = async () => {
    if (!selectedProjectId || !selectedProject) return;
    if (!confirm(`Are you sure you want to close "${selectedProject.name}"? It will be hidden from the active Hub dashboard.`)) {
      return;
    }

    try {
      setUpdatingProjectStatus(true);
      setError(null);
      const sb = supabaseBrowser();
      const { error: updErr } = await sb
        .from('projects')
        .update({ status: 'closed' })
        .eq('id', selectedProjectId);

      if (updErr) throw updErr;

      setProjects((prev) =>
        prev.map((p) => (p.id === selectedProjectId ? { ...p, status: 'closed' } : p))
      );
      setNotice(`Project "${selectedProject.name}" closed.`);
      setTimeout(() => setNotice(null), 3000);

      // If closed projects are hidden, switch to another active project
      if (!showClosed) {
        const remaining = projects.filter((p) => p.id !== selectedProjectId && p.status !== 'closed');
        if (remaining.length > 0) {
          setSelectedProjectId(remaining[0].id);
        } else {
          setSelectedProjectId('');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close project');
    } finally {
      setUpdatingProjectStatus(false);
    }
  };

  // Reopen Project handler (sets projects.status = 'active')
  const handleReopenProject = async () => {
    if (!selectedProjectId || !selectedProject) return;

    try {
      setUpdatingProjectStatus(true);
      setError(null);
      const sb = supabaseBrowser();
      const { error: updErr } = await sb
        .from('projects')
        .update({ status: 'active' })
        .eq('id', selectedProjectId);

      if (updErr) throw updErr;

      setProjects((prev) =>
        prev.map((p) => (p.id === selectedProjectId ? { ...p, status: 'active' } : p))
      );
      setNotice(`Project "${selectedProject.name}" reopened.`);
      setTimeout(() => setNotice(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reopen project');
    } finally {
      setUpdatingProjectStatus(false);
    }
  };

  // Filtered dependency items
  const filteredItems = useMemo(() => {
    const l2 = selectedProject?.l2_after ?? 3;
    return items.filter((item) => {
      // Agency filter
      if (agencyFilter !== 'all') {
        if (agencyFilter === 'unassigned' && item.agency_id !== null) return false;
        if (agencyFilter !== 'unassigned' && item.agency_id !== agencyFilter) return false;
      }
      // Status filter
      if (statusFilter === 'all') return true;
      if (statusFilter === 'escalated') {
        return item.status === 'pending' && isEscalated(item.reminder_count, l2);
      }
      return item.status === statusFilter;
    });
  }, [items, agencyFilter, statusFilter, selectedProject]);

  // Overall metrics for selected project
  const selectedProjectMetrics = useMemo(() => {
    const l2 = selectedProject?.l2_after ?? 3;
    const pending = items.filter((i) => i.status === 'pending');
    const complete = items.filter((i) => i.status === 'complete');
    const escalated = pending.filter((i) => isEscalated(i.reminder_count, l2));
    const unassigned = items.filter((i) => !i.agency_id);
    return {
      total: items.length,
      pending: pending.length,
      complete: complete.length,
      escalated: escalated.length,
      unassigned: unassigned.length,
    };
  }, [items, selectedProject]);

  if (authLoading || loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-alt">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-surface-alt pb-16">
      <AppHeader />

      <main className="mx-auto max-w-6xl px-4 pt-5 space-y-6">
        {/* Alerts / Notices */}
        {notice && (
          <div className="rounded-xl border border-success/30 bg-success-light px-4 py-2.5 text-xs font-semibold text-success shadow-xs">
            {notice}
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-danger/30 bg-danger-light px-4 py-2.5 text-xs font-semibold text-danger shadow-xs">
            {error}
          </div>
        )}

        {/* ───────────────────────── SECTION 1: TOP PROJECT TILES ───────────────────────── */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-text-primary">Office Hub</h1>
              <p className="text-xs text-text-secondary mt-0.5">
                Central tracking dashboard for VTech Project Lead. Select a project to manage dependencies.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer text-xs text-text-secondary hover:text-text-primary">
                <input
                  type="checkbox"
                  checked={showClosed}
                  onChange={(e) => setShowClosed(e.target.checked)}
                  className="rounded border-border text-accent focus:ring-accent"
                />
                <span>Show closed</span>
              </label>
              <Link
                href="/projects/new"
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors"
              >
                + New Project
              </Link>
            </div>
          </div>

          {/* Project Tiles: Horizontal Scroll Strip on Mobile (390px), Grid on Desktop */}
          <div className="flex overflow-x-auto pb-3 gap-3 no-scrollbar sm:grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 sm:overflow-visible sm:pb-0">
            {displayedProjects.map((proj) => {
              const isSelected = proj.id === selectedProjectId;
              const isClosed = proj.status === 'closed';

              return (
                <div
                  key={proj.id}
                  onClick={() => handleSelectProject(proj.id)}
                  className={`w-[260px] shrink-0 sm:w-auto sm:shrink cursor-pointer rounded-2xl border p-4 shadow-xs transition-all select-none ${
                    isSelected
                      ? 'border-accent bg-surface ring-2 ring-accent/20'
                      : 'border-border bg-surface hover:border-accent/40 active:bg-surface-alt'
                  } ${isClosed ? 'opacity-60 bg-surface-alt/40' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-sm font-bold text-text-primary truncate">{proj.name}</h2>
                    <div className="flex items-center gap-1 shrink-0">
                      {isClosed && (
                        <span className="rounded bg-surface-alt border border-border px-1.5 py-0.2 text-[10px] font-bold text-text-muted">
                          Closed
                        </span>
                      )}
                      {proj.escalatedCount > 0 && !isClosed && (
                        <span className="rounded bg-danger-light px-1.5 py-0.2 text-[10px] font-bold text-danger">
                          {proj.escalatedCount} esc
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-text-secondary truncate mt-0.5">
                    {proj.client_name ? `Client: ${proj.client_name}` : proj.site_address ?? 'Site Project'}
                  </p>

                  <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`font-semibold ${
                          proj.pendingCount > 0 ? 'text-warning' : 'text-success'
                        }`}
                      >
                        {proj.pendingCount} pending
                      </span>
                      <span className="text-border">•</span>
                      <span className="text-text-muted">{proj.completedCount} done</span>
                    </div>

                    <span className="text-[10px] text-text-muted font-mono">
                      {formatTimeAgo(proj.updated_at)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ───────────────────────── SECTION 2: PROJECT OVERVIEW BAR ───────────────────────── */}
        {selectedProject && (
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-border/60 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-text-primary">{selectedProject.name}</h2>
                  {selectedProject.status === 'closed' && (
                    <span className="rounded-md bg-surface-alt px-2 py-0.5 text-xs text-text-muted font-bold border border-border">
                      Closed
                    </span>
                  )}
                  <span className="rounded-md bg-surface-alt px-2 py-0.5 text-xs text-text-secondary font-medium border border-border">
                    {selectedProjectMetrics.total} Items
                  </span>
                  {selectedProjectMetrics.unassigned > 0 && (
                    <span className="rounded-md bg-danger-light px-2 py-0.5 text-xs text-danger font-semibold">
                      {selectedProjectMetrics.unassigned} unassigned
                    </span>
                  )}
                </div>
                {selectedProject.site_address && (
                  <p className="text-xs text-text-muted mt-0.5">{selectedProject.site_address}</p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={sendingReminders || selectedProjectMetrics.pending === 0}
                  onClick={handleSendProjectReminders}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors disabled:opacity-50"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                  {sendingReminders ? 'Drafting…' : `Send Reminders (${selectedProjectMetrics.pending})`}
                </button>

                <Link
                  href={`/projects/${selectedProjectId}`}
                  className="rounded-lg bg-surface-alt border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-border transition-colors"
                >
                  Project Details
                </Link>

                <Link
                  href={`/projects/${selectedProjectId}/setup`}
                  className="rounded-lg bg-surface-alt border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-border transition-colors"
                >
                  Configure Wizard
                </Link>

                {/* Close / Reopen Project */}
                {selectedProject.status === 'closed' ? (
                  <button
                    type="button"
                    onClick={handleReopenProject}
                    disabled={updatingProjectStatus}
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors disabled:opacity-50"
                  >
                    {updatingProjectStatus ? 'Reopening…' : 'Reopen Project'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleCloseProject}
                    disabled={updatingProjectStatus}
                    className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
                  >
                    {updatingProjectStatus ? 'Closing…' : 'Close Project'}
                  </button>
                )}
              </div>
            </div>

            {/* Filter Controls Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-text-secondary">Filter by:</span>

                {/* Status Dropdown */}
                <select
                  aria-label="Filter dependencies by status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as unknown as typeof statusFilter)}
                  className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text-primary focus:border-accent"
                >
                  <option value="all">All Statuses ({items.length})</option>
                  <option value="pending">Pending ({selectedProjectMetrics.pending})</option>
                  <option value="escalated">Escalated ({selectedProjectMetrics.escalated})</option>
                  <option value="complete">Complete ({selectedProjectMetrics.complete})</option>
                  <option value="unchecked">Unchecked</option>
                  <option value="na">N.A.</option>
                </select>

                {/* Agency Dropdown */}
                <select
                  aria-label="Filter dependencies by contractor"
                  value={agencyFilter}
                  onChange={(e) => setAgencyFilter(e.target.value)}
                  className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text-primary focus:border-accent"
                >
                  <option value="all">All Contractors</option>
                  <option value="unassigned">⚠️ Unassigned ({selectedProjectMetrics.unassigned})</option>
                  {projectAgencies.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.agency_types?.name} – {a.company_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status Counters */}
              <div className="flex items-center gap-2">
                {selectedProjectMetrics.escalated > 0 && (
                  <span className="rounded-md bg-danger-light px-2 py-0.5 text-xs font-bold text-danger">
                    {selectedProjectMetrics.escalated} Escalated (L2+)
                  </span>
                )}
                <span className="rounded-md bg-warning-light px-2 py-0.5 text-xs font-semibold text-warning">
                  {selectedProjectMetrics.pending} Pending
                </span>
                <span className="rounded-md bg-success-light px-2 py-0.5 text-xs font-semibold text-success">
                  {selectedProjectMetrics.complete} Done
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ───────────────────────── SECTION 3: ROOMS GROUPED BY FLOOR ───────────────────────── */}
        <div className="space-y-4">
          {floors.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface p-12 text-center text-xs text-text-muted space-y-2">
              <p className="font-semibold text-text-primary text-sm">No floors or rooms configured</p>
              <p>Add floors and rooms in project setup to start tracking trade dependencies.</p>
              <div className="pt-2">
                <Link
                  href={`/projects/${selectedProjectId}/setup`}
                  className="inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs"
                >
                  Go to Project Setup →
                </Link>
              </div>
            </div>
          ) : (
            floors.map((floor) => {
              const floorRooms = rooms.filter((r) => r.floor_id === floor.id);
              const floorItems = filteredItems.filter((i) => floorRooms.some((r) => r.id === i.room_id));
              const isCollapsed = collapsedFloors.has(floor.id);

              const floorPending = floorItems.filter((i) => i.status === 'pending').length;
              const floorComplete = floorItems.filter((i) => i.status === 'complete').length;

              return (
                <div key={floor.id} className="rounded-2xl border border-border bg-surface shadow-xs overflow-hidden">
                  {/* Floor Header Bar (Collapsible Toggle) */}
                  <div
                    onClick={() => toggleFloorCollapse(floor.id)}
                    className="flex items-center justify-between bg-surface-alt/70 px-4 py-3 cursor-pointer select-none hover:bg-surface-alt transition-colors border-b border-border/70"
                  >
                    <div className="flex items-center gap-2.5">
                      <svg
                        className={`h-4 w-4 text-text-muted transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                      <h3 className="text-sm font-bold text-text-primary">{floor.label}</h3>
                      <span className="text-xs text-text-muted">({floorRooms.length} rooms)</span>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      {floorPending > 0 && (
                        <span className="rounded bg-warning-light px-2 py-0.5 font-bold text-warning">
                          {floorPending} pending
                        </span>
                      )}
                      <span className="rounded bg-success-light px-2 py-0.5 font-medium text-success">
                        {floorComplete} complete
                      </span>
                    </div>
                  </div>

                  {/* Floor Content: Rooms & Dependencies */}
                  {!isCollapsed && (
                    <div className="p-4 space-y-4">
                      {floorRooms.length === 0 ? (
                        <p className="text-xs text-text-muted italic py-2">No rooms on this floor.</p>
                      ) : (
                        floorRooms.map((room) => {
                          const roomItems = floorItems.filter((i) => i.room_id === room.id);
                          if (statusFilter !== 'all' && roomItems.length === 0) return null;

                          // Group room items by Agency / Trade
                          const agencyGroups = new Map<string, { agency: Agency | null; items: DependencyItem[] }>();
                          roomItems.forEach((item) => {
                            const key = item.agency_id ?? 'unassigned';
                            const existing = agencyGroups.get(key) ?? { agency: item.agencies, items: [] };
                            existing.items.push(item);
                            agencyGroups.set(key, existing);
                          });

                          return (
                            <div key={room.id} className="rounded-xl border border-border bg-surface-alt/30 p-3.5 space-y-3">
                              {/* Room Header */}
                              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                                <div className="flex items-center gap-2">
                                  <h4 className="text-sm font-bold text-text-primary">{room.name}</h4>
                                  <span className="text-[11px] text-text-muted font-mono">
                                    ({roomItems.length} deps)
                                  </span>
                                </div>

                                <Link
                                  href={`/projects/${selectedProjectId}/rooms/${room.id}/dependencies`}
                                  className="text-xs font-semibold text-accent hover:underline inline-flex items-center gap-0.5"
                                >
                                  + Add/Edit Deps
                                </Link>
                              </div>

                              {/* Dependencies Table/List */}
                              {roomItems.length === 0 ? (
                                <p className="text-xs text-text-muted italic py-1">No dependencies added to this room yet.</p>
                              ) : (
                                <div className="space-y-2">
                                  {Array.from(agencyGroups.entries()).map(([key, group]) => {
                                    const agencyName = group.agency?.company_name
                                      ? `${group.agency.agency_types?.name ?? ''} – ${group.agency.company_name}`
                                      : null;

                                    return (
                                      <div key={key} className="space-y-1.5">
                                        {/* Contractor Sub-header */}
                                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary">
                                          {agencyName ? (
                                            <span>Contractor: {agencyName}</span>
                                          ) : (
                                            <span className="text-danger font-bold">⚠️ Unassigned Trade</span>
                                          )}
                                        </div>

                                        {/* Items in this contractor group */}
                                        <div className="divide-y divide-border/60 rounded-lg border border-border bg-surface overflow-hidden">
                                          {group.items.map((item) => {
                                            const l2 = selectedProject?.l2_after ?? 3;
                                            const l3 = selectedProject?.l3_after ?? 6;
                                            const escalated = item.status === 'pending' && isEscalated(item.reminder_count, l2);
                                            const escLevel = getEscalationLevel(item.reminder_count, l2, l3);

                                            return (
                                              <div
                                                key={item.id}
                                                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 hover:bg-surface-alt/40 transition-colors"
                                              >
                                                {/* Left Column: Text & Badges */}
                                                <div className="min-w-0 flex-1 space-y-1">
                                                  <div className="flex flex-wrap items-center gap-2">
                                                    <p className="text-xs font-semibold text-text-primary">
                                                      {item.project_dependencies?.text ?? 'Dependency item'}
                                                    </p>

                                                    {/* Status Badge */}
                                                    <span
                                                      className={`inline-flex items-center rounded px-1.5 py-0.2 text-[10px] font-bold ${
                                                        item.status === 'complete'
                                                          ? 'bg-success-light text-success'
                                                          : item.status === 'pending'
                                                          ? escalated
                                                            ? 'bg-danger-light text-danger'
                                                            : 'bg-warning-light text-warning'
                                                          : item.status === 'na'
                                                          ? 'bg-surface-alt text-text-muted'
                                                          : 'bg-surface-alt text-text-secondary'
                                                      }`}
                                                    >
                                                      {item.status === 'pending' && escalated
                                                        ? escLevel === 3
                                                          ? 'L3 ESCALATION'
                                                          : 'L2 ESCALATION'
                                                        : item.status.toUpperCase()}
                                                    </span>

                                                    {/* Unassigned Warning Badge */}
                                                    {!item.agency_id && (
                                                      <button
                                                        type="button"
                                                        onClick={() => setAssignTargetItem(item)}
                                                        className="rounded bg-danger-light px-1.5 py-0.2 text-[10px] font-bold text-danger hover:underline"
                                                      >
                                                        No agency • Assign
                                                      </button>
                                                    )}
                                                  </div>

                                                  {/* History & Notes metadata line */}
                                                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
                                                    {item.first_raised_on && (
                                                      <span>Raised: {formatDate(item.first_raised_on)}</span>
                                                    )}
                                                    {item.reminder_count > 0 && (
                                                      <span className="rounded bg-warning-light px-1 py-0.2 text-[10px] font-bold text-warning font-mono">
                                                        {item.reminder_count} chased
                                                      </span>
                                                    )}
                                                    {item.completed_on && (
                                                      <span className="text-success font-medium">
                                                        Completed: {formatDate(item.completed_on)}
                                                      </span>
                                                    )}

                                                    {/* Note Preview */}
                                                    {item.note && (
                                                      <span className="text-text-primary bg-surface-alt px-1.5 py-0.5 rounded border border-border truncate max-w-xs">
                                                        📝 {item.note}
                                                      </span>
                                                    )}

                                                    {/* Photo Thumbnail / Viewer */}
                                                    {item.photo_path && (
                                                      <button
                                                        type="button"
                                                        onClick={() => viewItemPhoto(item.photo_path!)}
                                                        className="text-accent hover:underline flex items-center gap-0.5 font-medium"
                                                      >
                                                        📷 Photo
                                                      </button>
                                                    )}

                                                    {/* History Drawer Trigger */}
                                                    <button
                                                      type="button"
                                                      onClick={() => openHistoryDrawer(item)}
                                                      className="text-text-muted hover:text-text-primary hover:underline ml-1"
                                                    >
                                                      History
                                                    </button>
                                                  </div>
                                                </div>

                                                {/* Right Column: 3 Action Buttons (Done / Pending / N.A.) */}
                                                <div className="flex items-center gap-1.5 shrink-0">
                                                  <button
                                                    type="button"
                                                    onClick={() => openStatusSheet(item, 'complete')}
                                                    className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                                                      item.status === 'complete'
                                                        ? 'bg-success text-white shadow-xs ring-2 ring-success/30'
                                                        : 'bg-surface border border-border text-text-secondary hover:border-success hover:text-success'
                                                    }`}
                                                  >
                                                    ✓ Done
                                                  </button>

                                                  <button
                                                    type="button"
                                                    onClick={() => openStatusSheet(item, 'pending')}
                                                    className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                                                      item.status === 'pending'
                                                        ? 'bg-warning text-white shadow-xs ring-2 ring-warning/30'
                                                        : 'bg-surface border border-border text-text-secondary hover:border-warning hover:text-warning'
                                                    }`}
                                                  >
                                                    ⏳ Pending
                                                  </button>

                                                  <button
                                                    type="button"
                                                    onClick={() => openStatusSheet(item, 'na')}
                                                    className={`rounded-lg px-2 py-1 text-xs font-bold transition-all ${
                                                      item.status === 'na'
                                                        ? 'bg-text-secondary text-white shadow-xs ring-2 ring-text-secondary/30'
                                                        : 'bg-surface border border-border text-text-muted hover:border-text-secondary hover:text-text-primary'
                                                    }`}
                                                  >
                                                    N.A.
                                                  </button>
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
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ───────────────────────── MODAL: COMPACT STATUS SHEET ───────────────────────── */}
        {statusTargetItem && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
            onClick={() => setStatusTargetItem(null)}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between border-b border-border/60 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-text-primary">
                    Mark as{' '}
                    <span
                      className={`uppercase ${
                        statusTargetItem.targetStatus === 'complete'
                          ? 'text-success'
                          : statusTargetItem.targetStatus === 'pending'
                          ? 'text-warning'
                          : 'text-text-secondary'
                      }`}
                    >
                      {statusTargetItem.targetStatus === 'complete' ? 'Done' : statusTargetItem.targetStatus}
                    </span>
                  </h3>
                  <p className="text-xs text-text-secondary mt-0.5 leading-snug">
                    {statusTargetItem.item.project_dependencies?.text}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setStatusTargetItem(null)}
                  className="text-text-muted hover:text-text-primary text-base font-bold px-1"
                >
                  ×
                </button>
              </div>

              {/* Date Input */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1">
                  Status Date
                </label>
                <input
                  type="date"
                  value={statusDate}
                  onChange={(e) => setStatusDate(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-primary focus:border-accent"
                />
              </div>

              {/* Note Input */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1">
                  Note (optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Electrician confirmed conduit work will complete by Tuesday…"
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs placeholder:text-text-muted focus:border-accent"
                />
              </div>

              {/* Photo Upload Input */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1">
                  Photo Evidence (optional)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoSelect}
                  className="w-full text-xs text-text-secondary file:mr-2 file:rounded-md file:border-0 file:bg-surface-alt file:px-3 file:py-1 file:text-xs file:font-semibold file:text-text-primary hover:file:bg-border"
                />

                {photoPreview && (
                  <div className="mt-2 relative w-24 h-24 rounded-lg overflow-hidden border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>

              {/* Action Buttons */}
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
        )}

        {/* ───────────────────────── MODAL: ITEM HISTORY DRAWER ───────────────────────── */}
        {historyItem && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-end bg-black/40"
            onClick={() => setHistoryItem(null)}
          >
            <div
              className="h-full w-full max-w-md bg-surface border-l border-border p-5 shadow-2xl overflow-y-auto space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between border-b border-border/60 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-text-primary">Dependency History</h3>
                  <p className="text-xs text-text-secondary mt-0.5 leading-snug">
                    {historyItem.project_dependencies?.text}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryItem(null)}
                  className="text-text-muted hover:text-text-primary text-base font-bold px-1"
                >
                  ×
                </button>
              </div>

              {loadingHistory ? (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              ) : historyEvents.length === 0 ? (
                <p className="text-xs text-text-muted italic py-4">No logged history events for this item yet.</p>
              ) : (
                <div className="space-y-3">
                  {historyEvents.map((ev) => {
                    const photoUrl = ev.photo_path ? historySignedUrls[ev.photo_path] : null;
                    return (
                      <div key={ev.id} className="rounded-xl border border-border bg-surface-alt/40 p-3 text-xs space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span
                            className={`rounded px-1.5 py-0.2 text-[10px] font-bold uppercase ${
                              ev.status === 'complete'
                                ? 'bg-success-light text-success'
                                : ev.status === 'pending'
                                ? 'bg-warning-light text-warning'
                                : 'bg-surface-alt text-text-muted'
                            }`}
                          >
                            {ev.status}
                          </span>
                          <span className="text-[10px] text-text-muted font-mono">{formatTimeAgo(ev.created_at)}</span>
                        </div>

                        <p className="text-text-primary">
                          Effective date: <strong>{formatDate(ev.status_date)}</strong> • Source:{' '}
                          <span className="capitalize text-text-secondary">{ev.source}</span>
                        </p>

                        {ev.note && (
                          <p className="rounded bg-surface p-2 border border-border text-text-secondary text-xs">
                            {ev.note}
                          </p>
                        )}

                        {photoUrl && (
                          <div className="pt-1">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photoUrl}
                              alt="Evidence thumbnail"
                              onClick={() => setViewingPhotoUrl(photoUrl)}
                              className="w-20 h-20 rounded-md object-cover border border-border cursor-pointer hover:opacity-90 transition-opacity"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ───────────────────────── MODAL: ASSIGN AGENCY ───────────────────────── */}
        {assignTargetItem && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
            onClick={() => setAssignTargetItem(null)}
          >
            <div
              className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div>
                <h3 className="text-sm font-bold text-text-primary">Assign Contractor Agency</h3>
                <p className="text-xs text-text-secondary mt-0.5">
                  Assign &quot;{assignTargetItem.project_dependencies?.text}&quot; to one of this project&apos;s trade agencies.
                </p>
              </div>

              <div>
                <select
                  value={selectedAgencyIdToAssign}
                  onChange={(e) => setSelectedAgencyIdToAssign(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs focus:border-accent"
                >
                  <option value="">Select contractor agency…</option>
                  {projectAgencies.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.agency_types?.name} – {a.company_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
                <button
                  type="button"
                  onClick={() => setAssignTargetItem(null)}
                  className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-medium text-text-primary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!selectedAgencyIdToAssign || savingAssign}
                  onClick={handleAssignAgency}
                  className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors disabled:opacity-50"
                >
                  {savingAssign ? 'Assigning…' : 'Save Assignment'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ───────────────────────── MODAL: PHOTO VIEWER ───────────────────────── */}
        {viewingPhotoUrl && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4"
            onClick={() => setViewingPhotoUrl(null)}
          >
            <div className="relative max-w-2xl max-h-[90vh] p-2" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setViewingPhotoUrl(null)}
                className="absolute top-4 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white font-bold"
              >
                ×
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={viewingPhotoUrl}
                alt="Full photo evidence"
                className="max-h-[85vh] w-auto rounded-lg object-contain shadow-2xl"
              />
            </div>
          </div>
        )}
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

function formatTimeAgo(iso: string | null): string {
  if (!iso) return '—';
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const diffHours = Math.floor(diffMs / 3600000);
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
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
