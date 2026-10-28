'use client';

import { useState, useEffect, useCallback, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/client/supabase';
import { compressImageToWebP } from '@/lib/client/image';
import {
  saveVisitCheck,
  getOfflineQueue,
  syncOfflineQueue,
  type VisitCheckPayload,
} from '@/lib/client/visit-sync';
import Link from 'next/link';

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
  agency_types: { name: string } | null;
}

interface DepItem {
  id: string;
  room_id: string;
  agency_id: string | null;
  status: 'unchecked' | 'pending' | 'complete' | 'na';
  first_raised_on: string | null;
  reminder_count: number;
  note: string | null;
  photo_path: string | null;
  project_dependencies: {
    text: string;
    agency_type_id: string;
  } | null;
  agencies: {
    company_name: string;
    agency_types: { name: string } | null;
  } | null;
}

interface VisitCheck {
  id?: string;
  item_id: string;
  status: 'pending' | 'complete' | 'na';
  status_date: string;
  note: string | null;
  photo_path: string | null;
}

interface VisitData {
  id: string;
  project_id: string;
  visit_date: string;
  status: 'draft' | 'finalized' | 'sent';
  projects: { name: string } | null;
}

export default function SiteVisitPage({
  params,
}: {
  params: Promise<{ projectId: string; visitId: string }>;
}) {
  const { projectId, visitId } = use(params);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  // Core data
  const [visit, setVisit] = useState<VisitData | null>(null);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [items, setItems] = useState<DepItem[]>([]);
  const [checks, setChecks] = useState<Map<string, VisitCheck>>(new Map());

  // Navigation state (Phone UI: Floor -> Room)
  const [selectedFloorId, setSelectedFloorId] = useState<string>('');
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');

  // Offline sync queue state
  const [unsavedCount, setUnsavedCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState(false);

  // Active item expanded for photo / note / completion date modal
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhotoFor, setUploadingPhotoFor] = useState<string | null>(null);

  // Load visit and project hierarchy
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const sb = supabaseBrowser();

      const [
        { data: vData, error: vErr },
        { data: fData, error: fErr },
        { data: rData, error: rErr },
        { data: iData, error: iErr },
        { data: cData, error: cErr },
      ] = await Promise.all([
        sb.from('site_visits').select('id, project_id, visit_date, status, projects(name)').eq('id', visitId).single(),
        sb.from('floors').select('id, label, sort').eq('project_id', projectId).order('sort'),
        sb.from('rooms').select('id, floor_id, name, sort').eq('project_id', projectId).order('sort'),
        sb.from('dependency_items').select(`
          id, room_id, agency_id, status, first_raised_on, reminder_count, note, photo_path,
          project_dependencies(text, agency_type_id),
          agencies(company_name, agency_types(name))
        `).eq('project_id', projectId),
        sb.from('visit_checks').select('id, item_id, status, status_date, note, photo_path').eq('visit_id', visitId),
      ]);

      if (vErr) throw new Error(vErr.message);
      if (fErr) throw new Error(fErr.message);
      if (rErr) throw new Error(rErr.message);
      if (iErr) throw new Error(iErr.message);
      if (cErr) throw new Error(cErr.message);

      setVisit(vData as unknown as VisitData);
      setFloors(fData ?? []);
      setRooms(rData ?? []);
      setItems((iData as unknown as DepItem[]) ?? []);

      // Build checks map
      const checksMap = new Map<string, VisitCheck>();
      ((cData ?? []) as unknown as VisitCheck[]).forEach((c) => checksMap.set(c.item_id, c));

      // Merge with any local offline queue
      const offline = getOfflineQueue(visitId);
      setUnsavedCount(offline.length);
      offline.forEach((c) => {
        checksMap.set(c.item_id, {
          item_id: c.item_id,
          status: c.status,
          status_date: c.status_date,
          note: c.note,
          photo_path: c.photo_path,
        });
      });

      setChecks(checksMap);

      // Default selected floor and room
      if (fData && fData.length > 0) {
        const firstFloor = fData[0] as Floor;
        setSelectedFloorId(firstFloor.id);
        const firstFloorRooms = ((rData ?? []) as Room[]).filter((r) => r.floor_id === firstFloor.id);
        if (firstFloorRooms.length > 0) {
          setSelectedRoomId(firstFloorRooms[0].id);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load site visit');
    } finally {
      setLoading(false);
    }
  }, [projectId, visitId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Network online listener for sync
  useEffect(() => {
    async function handleOnline() {
      setIsSyncing(true);
      await syncOfflineQueue(visitId, (remaining) => setUnsavedCount(remaining));
      setIsSyncing(false);
    }
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [visitId]);

  // Update room when floor changes
  function handleSelectFloor(floorId: string) {
    setSelectedFloorId(floorId);
    const floorRooms = rooms.filter((r) => r.floor_id === floorId);
    if (floorRooms.length > 0) {
      setSelectedRoomId(floorRooms[0].id);
    } else {
      setSelectedRoomId('');
    }
  }

  // Save check action
  async function handleSetStatus(
    item: DepItem,
    status: 'pending' | 'complete' | 'na',
    statusDate?: string,
    note?: string | null,
    photoPath?: string | null
  ) {
    if (!visit) return;
    const effectiveDate = statusDate || visit.visit_date;
    const existingCheck = checks.get(item.id);

    const payload: VisitCheckPayload = {
      project_id: projectId,
      visit_id: visitId,
      item_id: item.id,
      status,
      status_date: effectiveDate,
      note: note !== undefined ? note : existingCheck?.note ?? item.note ?? null,
      photo_path: photoPath !== undefined ? photoPath : existingCheck?.photo_path ?? item.photo_path ?? null,
    };

    // Update optimistic UI state immediately (zero delay)
    setChecks((prev) => {
      const next = new Map(prev);
      next.set(item.id, {
        item_id: item.id,
        status: payload.status,
        status_date: payload.status_date,
        note: payload.note,
        photo_path: payload.photo_path,
      });
      return next;
    });

    // Save live or offline
    const isLive = await saveVisitCheck(payload);
    setUnsavedCount(getOfflineQueue(visitId).length);
    if (!isLive) {
      // Unsaved badge updated
    }
  }

  // Copy last status shortcut for current room
  async function handleCopyLastStatusForRoom() {
    if (!visit || !selectedRoomId) return;
    const roomItems = items.filter((i) => i.room_id === selectedRoomId);
    for (const item of roomItems) {
      const targetStatus: 'pending' | 'complete' | 'na' =
        item.status === 'unchecked' ? 'complete' : item.status;
      await handleSetStatus(item, targetStatus, visit.visit_date);
    }
  }

  // Photo capture & compression
  async function handlePhotoCapture(file: File, item: DepItem) {
    try {
      setUploadingPhotoFor(item.id);
      const compressedBlob = await compressImageToWebP(file, 1280, 0.7);
      const uuid = crypto.randomUUID();
      const storagePath = `${projectId}/${item.id}/${uuid}.webp`;

      const sb = supabaseBrowser();
      const { error: uploadErr } = await sb.storage
        .from('evidence')
        .upload(storagePath, compressedBlob, {
          contentType: 'image/webp',
          upsert: true,
        });

      if (uploadErr) throw uploadErr;

      const currentCheck = checks.get(item.id);
      await handleSetStatus(
        item,
        currentCheck?.status ?? 'pending',
        currentCheck?.status_date ?? visit?.visit_date,
        currentCheck?.note,
        storagePath
      );
    } catch (err) {
      alert(`Photo upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setUploadingPhotoFor(null);
    }
  }

  // Finalize visit
  async function handleFinalize() {
    if (unsavedCount > 0) {
      const proceed = confirm(
        `You have ${unsavedCount} unsaved check(s) queued offline. Reconnecting and syncing is recommended before finalizing. Finalize now anyway?`
      );
      if (!proceed) return;
    }

    setFinalizing(true);
    setError(null);
    try {
      const res = await fetch(`/api/visits/${visitId}/finalize`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to finalize visit (${res.status})`);
      }

      router.push(`/projects/${projectId}/visits/${visitId}/dispatches`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finalize visit');
      setFinalizing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-alt">
        <Spinner />
      </div>
    );
  }

  const currentFloor = floors.find((f) => f.id === selectedFloorId);
  const floorRooms = rooms.filter((r) => r.floor_id === selectedFloorId);
  const currentRoom = rooms.find((r) => r.id === selectedRoomId);
  const currentRoomItems = items.filter((i) => i.room_id === selectedRoomId);

  // Group current room items by agency
  const agencyGroups = new Map<string, { agencyName: string; items: DepItem[] }>();
  currentRoomItems.forEach((item) => {
    const key = item.agencies?.company_name
      ? `${item.agencies.agency_types?.name ?? ''} – ${item.agencies.company_name}`
      : 'Unassigned';
    if (!agencyGroups.has(key)) {
      agencyGroups.set(key, { agencyName: key, items: [] });
    }
    agencyGroups.get(key)!.items.push(item);
  });

  // Calculate overall progress: checked items vs total items
  const totalItemCount = items.length;
  const checkedItemCount = items.filter((i) => checks.has(i.id)).length;
  const progressPercent = totalItemCount > 0 ? Math.round((checkedItemCount / totalItemCount) * 100) : 0;

  return (
    <div className="min-h-dvh bg-surface-alt pb-24">
      {/* ── Sticky Top Header (High Information Density for One-Thumb Use) ── */}
      <header className="sticky top-0 z-30 border-b border-border bg-surface px-4 py-2.5 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <Link
              href={`/projects/${projectId}`}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-text-secondary hover:text-text-primary"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              {visit?.projects?.name ?? 'Project'}
            </Link>
            <h1 className="text-sm font-bold text-text-primary truncate">
              Site Visit: {formatDate(visit?.visit_date ?? '')}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {/* Unsaved / Offline badge */}
            {unsavedCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-warning-light px-2 py-0.5 text-[11px] font-semibold text-warning animate-pulse">
                {isSyncing ? 'Syncing…' : `${unsavedCount} unsaved`}
              </span>
            )}

            {/* Finalize Button */}
            <button
              onClick={handleFinalize}
              disabled={finalizing}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {finalizing ? 'Finalizing…' : 'Finalize Visit →'}
            </button>
          </div>
        </div>

        {/* Overall progress bar */}
        <div className="mt-2.5 flex items-center justify-between text-[11px] text-text-secondary">
          <span>
            Progress: <strong className="text-text-primary">{checkedItemCount}</strong> / {totalItemCount} checked
          </span>
          <span className="font-semibold">{progressPercent}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </header>

      {error && (
        <div className="mx-4 mt-3 rounded-xl bg-danger-light p-3 text-xs text-danger font-medium border border-danger/20">
          {error}
        </div>
      )}

      {/* ── Floor & Room Horizontal Picker (Mobile-First Thumb-Scroll) ── */}
      <div className="sticky top-[73px] z-20 border-b border-border bg-surface/95 backdrop-blur-xs px-4 py-2 space-y-1.5">
        {/* Floors horizontal list */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none py-0.5">
          {floors.map((f) => {
            const isSelected = f.id === selectedFloorId;
            const floorRoomsList = rooms.filter((r) => r.floor_id === f.id);
            const floorItems = items.filter((i) =>
              floorRoomsList.some((r) => r.id === i.room_id)
            );
            const floorChecked = floorItems.filter((i) => checks.has(i.id)).length;
            const isAllDone = floorItems.length > 0 && floorChecked === floorItems.length;

            return (
              <button
                key={f.id}
                onClick={() => handleSelectFloor(f.id)}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                  isSelected
                    ? 'bg-text-primary text-white font-semibold'
                    : 'bg-surface-alt text-text-secondary hover:text-text-primary'
                }`}
              >
                {f.label}
                {isAllDone && <span className="text-success text-[10px]">✓</span>}
              </button>
            );
          })}
        </div>

        {/* Rooms horizontal list with completion tick marks */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none py-0.5">
          {floorRooms.map((r) => {
            const isSelected = r.id === selectedRoomId;
            const roomItemsList = items.filter((i) => i.room_id === r.id);
            const roomCheckedCount = roomItemsList.filter((i) => checks.has(i.id)).length;
            const isRoomComplete =
              roomItemsList.length > 0 && roomCheckedCount === roomItemsList.length;

            return (
              <button
                key={r.id}
                onClick={() => setSelectedRoomId(r.id)}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs whitespace-nowrap transition-colors border ${
                  isSelected
                    ? 'bg-accent text-white border-accent font-semibold shadow-xs'
                    : isRoomComplete
                    ? 'bg-success-light text-success border-success/30'
                    : 'bg-surface text-text-secondary border-border hover:bg-surface-alt'
                }`}
              >
                {r.name}
                {isRoomComplete ? (
                  <span className="text-[10px] font-bold">✓</span>
                ) : (
                  <span className="text-[10px] opacity-75">
                    ({roomCheckedCount}/{roomItemsList.length})
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Main Checklist Content ── */}
      <main className="mx-auto max-w-lg px-4 pt-3">
        {/* Room Header & "Copy Last Status" Shortcut */}
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-text-primary">
              {currentRoom?.name ?? 'Select Room'}
            </h2>
            <p className="text-xs text-text-muted">
              {currentFloor?.label} • {currentRoomItems.length} items
            </p>
          </div>

          {currentRoomItems.length > 0 && (
            <button
              onClick={handleCopyLastStatusForRoom}
              className="inline-flex items-center gap-1 rounded-md bg-surface border border-border px-2.5 py-1 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-alt transition-colors"
              title="Mark all items in this room with their previous statuses"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
              </svg>
              Copy last status
            </button>
          )}
        </div>

        {currentRoomItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center text-xs text-text-muted">
            No dependency items applied to this room.
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from(agencyGroups.entries()).map(([groupKey, group]) => (
              <div key={groupKey} className="space-y-2">
                {/* Agency Group Header */}
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                    {group.agencyName}
                  </span>
                  <div className="h-px flex-1 bg-border/60" />
                </div>

                {/* Items in this Agency */}
                <div className="space-y-2.5">
                  {group.items.map((item) => {
                    const check = checks.get(item.id);
                    const currentStatus = check?.status ?? null;
                    const hasNote = Boolean(check?.note || item.note);
                    const hasPhoto = Boolean(check?.photo_path || item.photo_path);

                    return (
                      <div
                        key={item.id}
                        className={`rounded-2xl border p-3.5 shadow-xs transition-colors ${
                          currentStatus === 'complete'
                            ? 'border-success/30 bg-success-light/20'
                            : currentStatus === 'pending'
                            ? 'border-warning/30 bg-warning-light/20'
                            : currentStatus === 'na'
                            ? 'border-border bg-surface-alt/50 opacity-75'
                            : 'border-border bg-surface'
                        }`}
                      >
                        {/* Dependency text & history info */}
                        <div className="mb-3">
                          <p className="text-sm font-semibold text-text-primary leading-snug">
                            {item.project_dependencies?.text ?? 'Dependency item'}
                          </p>

                          {/* Historical Pending Information */}
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
                            {item.first_raised_on && (
                              <span>Raised: {formatDate(item.first_raised_on)}</span>
                            )}
                            {item.reminder_count > 0 && (
                              <span className="rounded-sm bg-warning-light px-1.5 py-0.2 text-[10px] font-semibold text-warning">
                                {item.reminder_count} chased
                              </span>
                            )}
                            {item.status && item.status !== 'unchecked' && !check?.status && (
                              <span className="text-text-muted">
                                Last: <span className="font-medium text-text-secondary capitalize">{item.status}</span>
                              </span>
                            )}
                            {check?.status_date && currentStatus === 'complete' && (
                              <span className="text-success font-medium">
                                Completed: {formatDate(check.status_date)}
                              </span>
                            )}
                          </div>

                          {/* Existing note preview */}
                          {(check?.note || item.note) && (
                            <p className="mt-1 text-xs text-text-secondary bg-surface p-1.5 rounded-md border border-border">
                              📝 {check?.note || item.note}
                            </p>
                          )}
                        </div>

                        {/* ── 3 Big Tap Targets (Done / Pending / N.A.) ── */}
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => handleSetStatus(item, 'complete')}
                            className={`flex min-h-[44px] items-center justify-center rounded-xl font-bold text-xs uppercase tracking-wider transition-all active:scale-[0.98] ${
                              currentStatus === 'complete'
                                ? 'bg-success text-white shadow-xs ring-2 ring-success/30'
                                : 'bg-surface border border-border text-text-secondary hover:border-success hover:text-success'
                            }`}
                          >
                            ✓ Done
                          </button>

                          <button
                            type="button"
                            onClick={() => handleSetStatus(item, 'pending')}
                            className={`flex min-h-[44px] items-center justify-center rounded-xl font-bold text-xs uppercase tracking-wider transition-all active:scale-[0.98] ${
                              currentStatus === 'pending'
                                ? 'bg-warning text-white shadow-xs ring-2 ring-warning/30'
                                : 'bg-surface border border-border text-text-secondary hover:border-warning hover:text-warning'
                            }`}
                          >
                            ⏳ Pending
                          </button>

                          <button
                            type="button"
                            onClick={() => handleSetStatus(item, 'na')}
                            className={`flex min-h-[44px] items-center justify-center rounded-xl font-bold text-xs uppercase tracking-wider transition-all active:scale-[0.98] ${
                              currentStatus === 'na'
                                ? 'bg-text-secondary text-white shadow-xs ring-2 ring-text-secondary/30'
                                : 'bg-surface border border-border text-text-muted hover:border-text-secondary hover:text-text-primary'
                            }`}
                          >
                            N.A.
                          </button>
                        </div>

                        {/* Optional photo & note action bar */}
                        <div className="mt-2.5 pt-2 border-t border-border/50 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            {/* Photo button */}
                            <label className="inline-flex items-center gap-1 cursor-pointer rounded-md px-2 py-1 bg-surface border border-border text-text-secondary hover:text-text-primary transition-colors">
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              <span>
                                {uploadingPhotoFor === item.id
                                  ? 'Compressing…'
                                  : hasPhoto
                                  ? 'Photo added ✓'
                                  : 'Photo'}
                              </span>
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                disabled={uploadingPhotoFor === item.id}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handlePhotoCapture(file, item);
                                }}
                              />
                            </label>

                            {/* Note button */}
                            <button
                              type="button"
                              onClick={() => setEditingItemId(item.id)}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 bg-surface border border-border text-text-secondary hover:text-text-primary transition-colors"
                            >
                              <span>{hasNote ? 'Edit note' : '+ Note'}</span>
                            </button>
                          </div>

                          {currentStatus && (
                            <span className="text-[11px] text-text-muted">
                              Saved
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* ── Modal for Note & Details ── */}
      {editingItemId && (() => {
        const item = items.find((i) => i.id === editingItemId);
        if (!item) return null;
        const check = checks.get(item.id);
        return (
          <ItemDetailsModal
            item={item}
            check={check}
            visitDate={visit?.visit_date ?? ''}
            onClose={() => setEditingItemId(null)}
            onSave={(note, date) => {
              handleSetStatus(
                item,
                check?.status ?? (item.status === 'unchecked' ? 'pending' : item.status),
                date,
                note
              );
              setEditingItemId(null);
            }}
          />
        );
      })()}
    </div>
  );
}

function ItemDetailsModal({
  item,
  check,
  visitDate,
  onClose,
  onSave,
}: {
  item: DepItem;
  check?: VisitCheck;
  visitDate: string;
  onClose: () => void;
  onSave: (note: string, date: string) => void;
}) {
  const [note, setNote] = useState(check?.note ?? item.note ?? '');
  const [date, setDate] = useState(check?.status_date ?? visitDate);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-text-primary mb-1">
          {item.project_dependencies?.text}
        </h3>
        <p className="text-xs text-text-secondary mb-3">Add notes or edit verification date.</p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">
              Date observed / completed
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">
              Site Note
            </label>
            <textarea
              rows={3}
              placeholder="e.g. Electrician promised completion by Thursday morning"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs focus:border-accent"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-alt"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSave(note, date)}
              className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
            >
              Save Details
            </button>
          </div>
        </div>
      </div>
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
