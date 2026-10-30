'use client';

import { Suspense, useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/client/supabase';
import { useAuth } from '@/components/auth-provider';
import { AppHeader } from '@/components/app-header';
import { compressImageToWebP } from '@/lib/client/image';
import { getEscalationLevel, isEscalated, formatEscalationLabel } from '@/lib/client/escalation';
import { getStepDotColor } from '@/components/room-product-picker';
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
  agency_types: { id: string; name: string; internal?: boolean } | null;
}

interface DependencyItem {
  id: string;
  project_id: string;
  room_id: string;
  agency_id: string | null;
  project_dependency_id: string;
  room_product_id?: string | null;
  step_id?: string | null;
  responsibility?: 'external' | 'internal' | 'client' | null;
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
    agency_types: { id: string; name: string; internal?: boolean } | null;
  } | null;
  rooms?: { name: string } | null;
}

interface ItemGateRow {
  item_id: string;
  project_id: string;
  room_id: string;
  room_product_id: string | null;
  status: 'unchecked' | 'pending' | 'complete' | 'na';
  step_id: string;
  seq: number;
  label: string;
  phase: number;
  responsibility: 'external' | 'internal' | 'client';
  gate: string;
  title: string;
  location: string | null;
  waits_on_client: boolean;
  locked: boolean;
}

interface RoomProduct {
  id: string;
  project_id: string;
  room_id: string;
  product_id: string;
  location: string | null;
  quantity: number;
  note: string | null;
  product_catalogue?: {
    id: string;
    title: string;
    scope: string;
  };
}

interface ProductStepInfo {
  id: string;
  product_id: string;
  seq: number;
  label: string;
  phase: number;
  responsibility: 'external' | 'internal' | 'client';
  gate: string;
  sheet_colour: string | null;
  default_agency_type_id: string;
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

  // Product tracking states (v3)
  const [roomProducts, setRoomProducts] = useState<RoomProduct[]>([]);
  const [itemGateRows, setItemGateRows] = useState<ItemGateRow[]>([]);
  const [productSteps, setProductSteps] = useState<ProductStepInfo[]>([]);
  const [actionableOnly, setActionableOnly] = useState<boolean>(true);
  const [collapsedProducts, setCollapsedProducts] = useState<Set<string>>(new Set());
  const [waitingOnAgencyId, setWaitingOnAgencyId] = useState<string>('');

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
        { data: rpData, error: rpErr },
        { data: gateData, error: gateErr },
        { data: stepsData, error: stepsErr },
      ] = await Promise.all([
        sb.from('floors').select('id, label, sort').eq('project_id', projId).order('sort'),
        sb.from('rooms').select('id, floor_id, name, sort').eq('project_id', projId).order('sort'),
        sb.from('agencies').select('id, company_name, agency_types(id, name, internal)').eq('project_id', projId),
        sb
          .from('dependency_items')
          .select(
            `id, project_id, room_id, agency_id, project_dependency_id, room_product_id, step_id, responsibility, status, first_raised_on, completed_on, reminder_count, note, photo_path, updated_at,
             agencies(id, company_name, agency_types(id, name, internal)),
             project_dependencies(id, text, agency_types(id, name, internal)),
             rooms(name)`
          )
          .eq('project_id', projId),
        sb.from('room_products').select('*, product_catalogue(*)').eq('project_id', projId),
        sb.from('item_gate').select('*').eq('project_id', projId).order('seq'),
        sb.from('product_steps').select('*').order('seq'),
      ]);

      if (fErr) throw fErr;
      if (rErr) throw rErr;
      if (agErr) throw agErr;
      if (itemsErr) throw itemsErr;
      if (rpErr) throw rpErr;
      if (gateErr) throw gateErr;
      if (stepsErr) throw stepsErr;

      setFloors(fls ?? []);
      setRooms(rms ?? []);
      setProjectAgencies((ags as unknown as Agency[]) ?? []);
      setItems((depItems as unknown as DependencyItem[]) ?? []);
      setRoomProducts((rpData as unknown as RoomProduct[]) ?? []);
      setItemGateRows((gateData as unknown as ItemGateRow[]) ?? []);
      setProductSteps((stepsData as unknown as ProductStepInfo[]) ?? []);
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
    setWaitingOnAgencyId(item.agency_id ?? '');
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

      // If agency was changed in the modal, update dependency_items.agency_id
      if (waitingOnAgencyId !== (item.agency_id ?? '')) {
        const { error: agUpdErr } = await sb
          .from('dependency_items')
          .update({ agency_id: waitingOnAgencyId || null })
          .eq('id', item.id);
        if (agUpdErr) console.warn('Could not update agency_id:', agUpdErr);
      }

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
                agency_id: waitingOnAgencyId || null,
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

      // Re-fetch project details so item_gate re-evaluates all locks immediately
      if (selectedProjectId) {
        loadProjectDetails(selectedProjectId);
      }

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
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('locked:')) {
        setError('Cannot update: finish the external (green) steps of this product first.');
      } else {
        setError(msg || 'Failed to update item status');
      }
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
                      {a.agency_types?.name} – {a.company_name} {a.agency_types?.internal ? '[Internal]' : ''}
                    </option>
                  ))}
                </select>

                {/* Actionable Only Toggle */}
                <button
                  type="button"
                  onClick={() => setActionableOnly(!actionableOnly)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    actionableOnly
                      ? 'border-accent bg-accent/10 text-accent ring-1 ring-accent/30'
                      : 'border-border bg-surface text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <span>{actionableOnly ? '⚡ What’s Actionable Now' : 'Show All Steps'}</span>
                  <span className="text-[10px] text-text-muted">
                    {actionableOnly ? '(locked hidden)' : '(incl. locked)'}
                  </span>
                </button>
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

            {/* Sheet Colour Key (Legend) */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-surface-alt/70 p-3 rounded-xl border border-border/80 text-[11px] text-text-secondary">
              <span className="font-bold text-text-primary">Colour Legend:</span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#D9EAD3] border border-[#B7D7B0]" />
                <span>green = Other agencies</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#C9DAF8] border border-[#A4C2F4]" />
                <span>blue = Other agencies (after greens)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#E06666] border border-[#CC0000]" />
                <span>dark red = Installers</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#F4CCCC] border border-[#EA9999]" />
                <span>light red = Programmers</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#F9CB9C] border border-[#F6B26B]" />
                <span>orange = Project managers</span>
              </span>
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
                          const roomProds = roomProducts.filter((rp) => rp.room_id === room.id);
                          const roomItems = floorItems.filter((i) => i.room_id === room.id);
                          const productItemIds = new Set(itemGateRows.map((g) => g.item_id));
                          const otherItems = roomItems.filter((i) => !i.room_product_id && !productItemIds.has(i.id));

                          if (statusFilter !== 'all' && roomItems.length === 0 && roomProds.length === 0) return null;

                          return (
                            <div key={room.id} className="rounded-xl border border-border bg-surface-alt/30 p-3.5 space-y-3">
                              {/* Room Header */}
                              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                                <div className="flex items-center gap-2">
                                  <h4 className="text-sm font-bold text-text-primary">{room.name}</h4>
                                  <span className="text-[11px] text-text-muted font-mono">
                                    ({roomProds.length > 0 ? `${roomProds.length} products · ` : ''}{roomItems.length} deps)
                                  </span>
                                </div>

                                <Link
                                  href={`/projects/${selectedProjectId}/rooms/${room.id}/dependencies`}
                                  className="text-xs font-semibold text-accent hover:underline inline-flex items-center gap-0.5"
                                >
                                  + Add/Edit Products &amp; Deps
                                </Link>
                              </div>

                              {/* ── 1. ROOM PRODUCTS (v3) ── */}
                              {roomProds.length > 0 && (
                                <div className="space-y-3">
                                  {roomProds.map((rp) => {
                                    const prodGateRows = itemGateRows.filter((g) => g.room_product_id === rp.id);

                                    // Filter steps according to active agency and status filters
                                    const matchingGateRows = prodGateRows.filter((g) => {
                                      if (agencyFilter !== 'all') {
                                        const itm = items.find((i) => i.id === g.item_id);
                                        if (agencyFilter === 'unassigned' && itm?.agency_id !== null) return false;
                                        if (agencyFilter !== 'unassigned' && itm?.agency_id !== agencyFilter) return false;
                                      }
                                      if (statusFilter !== 'all') {
                                        const l2 = selectedProject?.l2_after ?? 3;
                                        const itm = items.find((i) => i.id === g.item_id);
                                        const isEsc = itm?.status === 'pending' && isEscalated(itm?.reminder_count ?? 0, l2);
                                        if (statusFilter === 'escalated') return isEsc;
                                        if (statusFilter === 'pending') return g.status === 'pending' && !isEsc;
                                        return g.status === statusFilter;
                                      }
                                      return true;
                                    });

                                    // Skip product if a filter is active and nothing matches
                                    if ((statusFilter !== 'all' || agencyFilter !== 'all') && matchingGateRows.length === 0) {
                                      return null;
                                    }

                                    const isProductCollapsed = collapsedProducts.has(rp.id);
                                    const completedStepsCount = prodGateRows.filter((g) => g.status === 'complete' || g.status === 'na').length;
                                    const totalStepsCount = prodGateRows.length;

                                    // Visible steps based on actionableOnly toggle
                                    const visibleSteps = prodGateRows.filter((g) => {
                                      if (actionableOnly && g.locked) return false;
                                      if (statusFilter !== 'all' || agencyFilter !== 'all') {
                                        return matchingGateRows.some((m) => m.item_id === g.item_id);
                                      }
                                      return true;
                                    });

                                    // Open green steps for unlock reasons
                                    const openGreenSteps = prodGateRows.filter(
                                      (g) => g.phase === 1 && g.status !== 'complete' && g.status !== 'na'
                                    );
                                    const unlockReason =
                                      openGreenSteps.length > 0
                                        ? openGreenSteps.map((g) => g.label).join(', ')
                                        : 'external green steps';

                                    return (
                                      <div
                                        key={rp.id}
                                        className="rounded-xl border border-border bg-surface overflow-hidden shadow-2xs"
                                      >
                                        {/* Product Card Header with Progress Bar */}
                                        <div
                                          onClick={() => {
                                            setCollapsedProducts((prev) => {
                                              const next = new Set(prev);
                                              if (next.has(rp.id)) next.delete(rp.id);
                                              else next.add(rp.id);
                                              return next;
                                            });
                                          }}
                                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-surface hover:bg-surface-alt/50 transition-colors cursor-pointer select-none border-b border-border/60"
                                        >
                                          <div className="flex items-center gap-2">
                                            <svg
                                              className={`h-3.5 w-3.5 text-text-muted transition-transform ${isProductCollapsed ? '' : 'rotate-90'}`}
                                              fill="none"
                                              viewBox="0 0 24 24"
                                              stroke="currentColor"
                                              strokeWidth={2.5}
                                            >
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                            </svg>
                                            <h5 className="text-sm font-bold text-text-primary">
                                              {rp.product_catalogue?.title ?? 'Product'}
                                              {rp.location && (
                                                <span className="ml-1.5 font-normal text-text-secondary">
                                                  · {rp.location}
                                                </span>
                                              )}
                                            </h5>
                                            {rp.quantity > 1 && (
                                              <span className="rounded bg-accent/10 px-1.5 py-0.2 text-[10px] font-bold text-accent">
                                                Qty: {rp.quantity}
                                              </span>
                                            )}
                                          </div>

                                          {/* Step Progress Bar */}
                                          <div className="flex items-center gap-3">
                                            <div className="flex items-center gap-1 w-32 sm:w-44">
                                              {prodGateRows.map((st) => {
                                                const stepInfo = productSteps.find((ps) => ps.id === st.step_id);
                                                const col = getStepDotColor(stepInfo?.sheet_colour);
                                                const isDone = st.status === 'complete' || st.status === 'na';
                                                return (
                                                  <div
                                                    key={st.item_id}
                                                    title={`Step ${st.seq}: ${st.label} (${st.status.toUpperCase()}) - ${col.label}`}
                                                    className="h-2 flex-1 rounded-sm border transition-all"
                                                    style={{
                                                      backgroundColor: isDone ? col.bg : 'transparent',
                                                      borderColor: col.border,
                                                      opacity: isDone ? 1 : 0.35,
                                                    }}
                                                  />
                                                );
                                              })}
                                            </div>
                                            <span className="text-[11px] font-semibold text-text-secondary min-w-[55px] text-right">
                                              {completedStepsCount}/{totalStepsCount} done
                                            </span>
                                          </div>
                                        </div>

                                        {/* Product Steps List (When Expanded) */}
                                        {!isProductCollapsed && (
                                          <div className="divide-y divide-border/60 bg-surface">
                                            {visibleSteps.length === 0 ? (
                                              <div className="p-3 text-center text-xs text-text-muted italic">
                                                {actionableOnly && prodGateRows.some((g) => g.locked)
                                                  ? `All remaining steps are locked waiting on: ${unlockReason}. Toggle "Show all steps" to inspect.`
                                                  : 'No steps match current filters.'}
                                              </div>
                                            ) : (
                                              visibleSteps.map((st) => {
                                                const item = items.find((i) => i.id === st.item_id);
                                                const stepInfo = productSteps.find((ps) => ps.id === st.step_id);
                                                const col = getStepDotColor(stepInfo?.sheet_colour);
                                                const l2 = selectedProject?.l2_after ?? 3;
                                                const l3 = selectedProject?.l3_after ?? 6;
                                                const escalated = item?.status === 'pending' && isEscalated(item?.reminder_count ?? 0, l2);
                                                const escLevel = getEscalationLevel(item?.reminder_count ?? 0, l2, l3);
                                                const isLocked = st.locked;

                                                const assignedAgency = item?.agencies;
                                                const isInternal = st.responsibility === 'internal';

                                                return (
                                                  <div
                                                    key={st.item_id}
                                                    className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 transition-colors ${
                                                      isLocked ? 'bg-surface-alt/40 opacity-70' : 'hover:bg-surface-alt/30'
                                                    }`}
                                                  >
                                                    {/* Left: Step dot, Seq, Label, Owner badge, Status badge */}
                                                    <div className="min-w-0 flex-1 space-y-1">
                                                      <div className="flex flex-wrap items-center gap-2">
                                                        {/* Sheet colour dot */}
                                                        <span
                                                          title={col.label}
                                                          className="inline-block h-3 w-3 rounded-full border shadow-2xs shrink-0 cursor-help"
                                                          style={{
                                                            backgroundColor: col.bg,
                                                            borderColor: col.border,
                                                          }}
                                                        />

                                                        <p className="text-xs font-semibold text-text-primary">
                                                          <span className="text-text-muted font-mono mr-1">#{st.seq}</span>
                                                          {st.label}
                                                        </p>

                                                        {/* Owner badge */}
                                                        {st.waits_on_client ? (
                                                          <span className="rounded bg-amber-500/10 text-amber-700 border border-amber-500/20 px-1.5 py-0.2 text-[10px] font-bold">
                                                            Client
                                                          </span>
                                                        ) : assignedAgency ? (
                                                          <span className="rounded bg-surface-alt border border-border px-1.5 py-0.2 text-[10px] font-semibold text-text-secondary">
                                                            {assignedAgency.company_name}
                                                            {assignedAgency.agency_types?.internal && (
                                                              <span className="ml-1 text-[9px] font-bold text-accent">[Internal]</span>
                                                            )}
                                                          </span>
                                                        ) : (
                                                          <button
                                                            type="button"
                                                            onClick={() => item && setAssignTargetItem(item)}
                                                            className="rounded bg-danger-light px-1.5 py-0.2 text-[10px] font-bold text-danger hover:underline"
                                                          >
                                                            {isInternal ? 'VTech Team' : 'Contractor'} • Assign
                                                          </button>
                                                        )}

                                                        {/* Status badge */}
                                                        <span
                                                          className={`inline-flex items-center rounded px-1.5 py-0.2 text-[10px] font-bold ${
                                                            st.status === 'complete'
                                                              ? 'bg-success-light text-success'
                                                              : st.status === 'pending'
                                                              ? escalated
                                                                ? 'bg-danger-light text-danger'
                                                                : 'bg-warning-light text-warning'
                                                              : st.status === 'na'
                                                              ? 'bg-surface-alt text-text-muted'
                                                              : 'bg-surface-alt text-text-secondary'
                                                          }`}
                                                        >
                                                          {st.status === 'pending' && escalated
                                                            ? escLevel === 3
                                                              ? 'L3 ESCALATION'
                                                              : 'L2 ESCALATION'
                                                            : st.status.toUpperCase()}
                                                        </span>

                                                        {/* Locked badge if step is locked */}
                                                        {isLocked && (
                                                          <span
                                                            title={`Finish external (green) steps first: ${unlockReason}`}
                                                            className="inline-flex items-center gap-1 rounded bg-surface border border-border px-1.5 py-0.2 text-[10px] font-medium text-text-muted italic"
                                                          >
                                                            🔒 Locked · Unlocks after: {unlockReason}
                                                          </span>
                                                        )}
                                                      </div>

                                                      {/* Metadata line: First raised, note, photo, history */}
                                                      {item && (
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
                                                              Done: {formatDate(item.completed_on)}
                                                            </span>
                                                          )}
                                                          {item.note && (
                                                            <span className="text-text-primary bg-surface-alt px-1.5 py-0.5 rounded border border-border truncate max-w-xs">
                                                              📝 {item.note}
                                                            </span>
                                                          )}
                                                          {item.photo_path && (
                                                            <button
                                                              type="button"
                                                              onClick={() => viewItemPhoto(item.photo_path!)}
                                                              className="text-accent hover:underline flex items-center gap-0.5 font-medium"
                                                            >
                                                              📷 Photo
                                                            </button>
                                                          )}
                                                          <button
                                                            type="button"
                                                            onClick={() => openHistoryDrawer(item)}
                                                            className="text-text-muted hover:text-text-primary hover:underline ml-1"
                                                          >
                                                            History
                                                          </button>
                                                        </div>
                                                      )}
                                                    </div>

                                                    {/* Right: Actions */}
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                      {isLocked ? (
                                                        <span
                                                          title="Locked until green external steps complete"
                                                          className="text-[11px] font-semibold text-text-muted px-2 py-1 rounded bg-surface-alt border border-border cursor-not-allowed"
                                                        >
                                                          🔒 Locked
                                                        </span>
                                                      ) : (
                                                        item && (
                                                          <>
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
                                                          </>
                                                        )
                                                      )}
                                                    </div>
                                                  </div>
                                                );
                                              })
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* ── 2. OTHER DEPENDENCIES (Legacy master list / custom) ── */}
                              {otherItems.length > 0 && (() => {
                                // Group room items by Agency / Trade
                                const agencyGroups = new Map<string, { agency: Agency | null; items: DependencyItem[] }>();
                                otherItems.forEach((item) => {
                                  const key = item.agency_id ?? 'unassigned';
                                  const existing = agencyGroups.get(key) ?? { agency: item.agencies, items: [] };
                                  existing.items.push(item);
                                  agencyGroups.set(key, existing);
                                });

                                return (
                                  <div className="space-y-2 pt-2 border-t border-border/60">
                                    <h5 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                                      Other Dependencies ({otherItems.length})
                                    </h5>
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

                                                        {item.note && (
                                                          <span className="text-text-primary bg-surface-alt px-1.5 py-0.5 rounded border border-border truncate max-w-xs">
                                                            📝 {item.note}
                                                          </span>
                                                        )}

                                                        {item.photo_path && (
                                                          <button
                                                            type="button"
                                                            onClick={() => viewItemPhoto(item.photo_path!)}
                                                            className="text-accent hover:underline flex items-center gap-0.5 font-medium"
                                                          >
                                                            📷 Photo
                                                          </button>
                                                        )}

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
                                  </div>
                                );
                              })()}
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

              {/* Waiting on Agency Selector (Pending) */}
              {statusTargetItem.targetStatus === 'pending' && (() => {
                const isInternal =
                  statusTargetItem.item.responsibility === 'internal' ||
                  itemGateRows.find((g) => g.item_id === statusTargetItem.item.id)?.responsibility === 'internal';

                const availableAgencies = projectAgencies.filter((a) => {
                  const isAgInternal = Boolean(a.agency_types?.internal);
                  return isInternal ? isAgInternal : !isAgInternal;
                });

                return (
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1">
                      Waiting on ({isInternal ? 'Internal VTech Team' : 'External Contractor'})
                    </label>
                    <select
                      value={waitingOnAgencyId}
                      onChange={(e) => setWaitingOnAgencyId(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary focus:border-accent"
                    >
                      <option value="">Select contractor / team…</option>
                      {availableAgencies.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.agency_types?.name} – {a.company_name} {a.agency_types?.internal ? '[Internal]' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })()}

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
