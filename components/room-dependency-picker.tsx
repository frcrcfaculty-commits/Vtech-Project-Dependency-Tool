'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabaseBrowser } from '@/lib/client/supabase';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export interface RoomDepPickerProps {
  projectId: string;
  roomId: string;
  onRoomChange?: (newRoomId: string) => void;
  onFinish?: () => void;
  isWizard?: boolean;
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
  sort: number;
}

interface MasterDep {
  id: string;
  agency_type_id: string;
  seq: number;
  text: string;
}

interface CustomDepItem {
  agency_type_id: string;
  text: string;
}

export function RoomDependencyPicker({
  projectId,
  roomId,
  onRoomChange,
  onFinish,
  isWizard = false,
}: RoomDepPickerProps) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Core metadata
  const [floors, setFloors] = useState<Floor[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [agencyTypes, setAgencyTypes] = useState<AgencyType[]>([]);
  const [masterDeps, setMasterDeps] = useState<MasterDep[]>([]);

  // Room item states
  const [roomDepCounts, setRoomDepCounts] = useState<Record<string, number>>({});
  const [existingMasterIds, setExistingMasterIds] = useState<Set<string>>(new Set());

  // Selections for this room
  const [selectedMasterIds, setSelectedMasterIds] = useState<Set<string>>(new Set());
  const [customList, setCustomList] = useState<CustomDepItem[]>([]);

  // UI helpers
  const [searchQuery, setSearchQuery] = useState('');
  const [copySourceRoomId, setCopySourceRoomId] = useState('');
  const [customAgencyTypeId, setCustomAgencyTypeId] = useState('');
  const [customText, setCustomText] = useState('');

  const currentRoom = useMemo(() => rooms.find((r) => r.id === roomId), [rooms, roomId]);
  const currentFloor = useMemo(
    () => floors.find((f) => f.id === currentRoom?.floor_id),
    [floors, currentRoom]
  );

  // Ordered list of all rooms across floors for "Next room"
  const allRoomsOrdered = useMemo(() => {
    const floorOrder = new Map(floors.map((f) => [f.id, f.sort]));
    return [...rooms].sort((a, b) => {
      const fDiff = (floorOrder.get(a.floor_id) ?? 0) - (floorOrder.get(b.floor_id) ?? 0);
      if (fDiff !== 0) return fDiff;
      return a.sort - b.sort;
    });
  }, [floors, rooms]);

  const nextRoom = useMemo(() => {
    const idx = allRoomsOrdered.findIndex((r) => r.id === roomId);
    if (idx !== -1 && idx < allRoomsOrdered.length - 1) {
      return allRoomsOrdered[idx + 1];
    }
    return null;
  }, [allRoomsOrdered, roomId]);

  // Load project floors, rooms, master catalogue, and room counts
  const loadInitialData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const sb = supabaseBrowser();

      const [
        { data: fls, error: fErr },
        { data: rms, error: rErr },
        { data: aTypes, error: atErr },
        { data: mDeps, error: mdErr },
        { data: allItems, error: itemsErr },
      ] = await Promise.all([
        sb.from('floors').select('id, label, sort').eq('project_id', projectId).order('sort'),
        sb.from('rooms').select('id, floor_id, name, sort').eq('project_id', projectId).order('sort'),
        sb.from('agency_types').select('id, name, sort').order('sort'),
        sb.from('master_dependencies').select('id, agency_type_id, seq, text').eq('active', true).order('seq'),
        sb.from('dependency_items').select('room_id').eq('project_id', projectId),
      ]);

      if (fErr) throw fErr;
      if (rErr) throw rErr;
      if (atErr) throw atErr;
      if (mdErr) throw mdErr;
      if (itemsErr) throw itemsErr;

      setFloors(fls ?? []);
      setRooms(rms ?? []);
      setAgencyTypes(aTypes ?? []);
      setMasterDeps(mDeps ?? []);

      // Calculate count of dependencies per room
      const counts: Record<string, number> = {};
      (allItems ?? []).forEach((item: { room_id: string }) => {
        counts[item.room_id] = (counts[item.room_id] ?? 0) + 1;
      });
      setRoomDepCounts(counts);

      if (aTypes && aTypes.length > 0) {
        setCustomAgencyTypeId(aTypes[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Load existing items for current room
  const loadRoomDependencies = useCallback(async (rId: string) => {
    if (!rId) return;
    try {
      const sb = supabaseBrowser();
      const { data: roomItems, error: rItemsErr } = await sb
        .from('dependency_items')
        .select('project_dependencies(master_dependency_id)')
        .eq('room_id', rId);

      if (rItemsErr) throw rItemsErr;

      const existingSet = new Set<string>();
      (roomItems ?? []).forEach((row: unknown) => {
        const pd = (row as { project_dependencies?: { master_dependency_id: string | null } | null })?.project_dependencies;
        if (pd?.master_dependency_id) {
          existingSet.add(pd.master_dependency_id);
        }
      });

      setExistingMasterIds(existingSet);
      setSelectedMasterIds(new Set()); // Reset new selections on room change
      setCustomList([]);
    } catch (err) {
      console.error('Failed to load room dependencies:', err);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (roomId) {
      loadRoomDependencies(roomId);
    }
  }, [roomId, loadRoomDependencies]);

  const handleRoomSelect = (newId: string) => {
    if (newId === roomId) return;
    if (onRoomChange) {
      onRoomChange(newId);
    } else {
      router.push(`/projects/${projectId}/rooms/${newId}/dependencies`);
    }
  };

  // Toggle selection for a single master dependency
  const toggleMaster = (id: string) => {
    if (existingMasterIds.has(id)) return;
    setSelectedMasterIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Grouped and filtered master dependencies
  const filteredMasterByAgency = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const result: { agencyType: AgencyType; items: MasterDep[] }[] = [];

    agencyTypes.forEach((type) => {
      const items = masterDeps.filter((m) => {
        if (m.agency_type_id !== type.id) return false;
        if (!q) return true;
        return m.text.toLowerCase().includes(q) || type.name.toLowerCase().includes(q);
      });
      if (items.length > 0) {
        result.push({ agencyType: type, items });
      }
    });

    return result;
  }, [agencyTypes, masterDeps, searchQuery]);

  // Select all items in an agency group (excluding already added)
  const handleSelectGroup = (items: MasterDep[]) => {
    const selectable = items.filter((i) => !existingMasterIds.has(i.id));
    const allSelected = selectable.every((i) => selectedMasterIds.has(i.id));

    setSelectedMasterIds((prev) => {
      const next = new Set(prev);
      selectable.forEach((i) => {
        if (allSelected) next.delete(i.id);
        else next.add(i.id);
      });
      return next;
    });
  };

  // Copy dependencies from another room
  const handleCopyFromRoom = async () => {
    if (!copySourceRoomId || copySourceRoomId === roomId) return;
    try {
      setSaving(true);
      const sb = supabaseBrowser();
      const { data: sourceItems, error: srcErr } = await sb
        .from('dependency_items')
        .select('project_dependencies(master_dependency_id)')
        .eq('room_id', copySourceRoomId);

      if (srcErr) throw srcErr;

      let addedCount = 0;
      setSelectedMasterIds((prev) => {
        const next = new Set(prev);
        (sourceItems ?? []).forEach((row: unknown) => {
          const pd = (row as { project_dependencies?: { master_dependency_id: string | null } | null })?.project_dependencies;
          if (pd?.master_dependency_id && !existingMasterIds.has(pd.master_dependency_id)) {
            next.add(pd.master_dependency_id);
            addedCount++;
          }
        });
        return next;
      });

      setNotice(`Preselected ${addedCount} item(s) from copied room`);
      setTimeout(() => setNotice(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy room dependencies');
    } finally {
      setSaving(false);
    }
  };

  // Add custom item
  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customText.trim();
    if (!trimmed || !customAgencyTypeId) return;

    setCustomList((prev) => [...prev, { agency_type_id: customAgencyTypeId, text: trimmed }]);
    setCustomText('');
  };

  const handleRemoveCustom = (idx: number) => {
    setCustomList((prev) => prev.filter((_, i) => i !== idx));
  };

  // Save via add_room_dependencies RPC
  const handleSave = async (andNext = false) => {
    if (selectedMasterIds.size === 0 && customList.length === 0) {
      if (andNext && nextRoom) {
        handleRoomSelect(nextRoom.id);
        return;
      }
      if (andNext && !nextRoom && onFinish) {
        onFinish();
        return;
      }
      setNotice('No new items selected to add');
      setTimeout(() => setNotice(null), 2500);
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const sb = supabaseBrowser();

      const { data: count, error: rpcErr } = await sb.rpc('add_room_dependencies', {
        p_room: roomId,
        p_master_ids: Array.from(selectedMasterIds),
        p_custom: customList,
      });

      if (rpcErr) throw rpcErr;

      setNotice(`Saved ${count ?? selectedMasterIds.size + customList.length} dependencies to ${currentRoom?.name}`);
      setTimeout(() => setNotice(null), 3000);

      // Refresh room counts and current room items
      setRoomDepCounts((prev) => ({
        ...prev,
        [roomId]: (prev[roomId] ?? 0) + (count ?? (selectedMasterIds.size + customList.length)),
      }));
      await loadRoomDependencies(roomId);

      if (andNext) {
        if (nextRoom) {
          handleRoomSelect(nextRoom.id);
        } else if (onFinish) {
          onFinish();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save dependencies');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <svg className="h-8 w-8 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Notifications / Alerts */}
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

      {/* ───────────────────────── SECTION 1: ROOM SWITCHER ───────────────────────── */}
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 pb-3 border-b border-border/60">
          <div>
            <h2 className="text-sm font-bold text-text-primary">
              Configuring: <span className="text-accent">{currentRoom?.name ?? 'Select Room'}</span>
            </h2>
            <p className="text-xs text-text-secondary mt-0.5">
              Floor: {currentFloor?.label ?? 'General'} • Current:{' '}
              <strong className="text-text-primary">{roomDepCounts[roomId] ?? 0} dependencies</strong>
            </p>
          </div>

          {/* Copy from another room convenience */}
          <div className="flex items-center gap-2">
            <select
              aria-label="Copy dependencies from another room"
              value={copySourceRoomId}
              onChange={(e) => setCopySourceRoomId(e.target.value)}
              className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text-secondary focus:border-accent"
            >
              <option value="">Copy items from room…</option>
              {allRoomsOrdered
                .filter((r) => r.id !== roomId && (roomDepCounts[r.id] ?? 0) > 0)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({roomDepCounts[r.id]} deps)
                  </option>
                ))}
            </select>
            <button
              type="button"
              disabled={!copySourceRoomId || saving}
              onClick={handleCopyFromRoom}
              className="rounded-lg bg-surface-alt px-3 py-1.5 text-xs font-medium text-text-primary border border-border hover:bg-border transition-colors disabled:opacity-50"
            >
              Copy
            </button>
          </div>
        </div>

        {/* Room Switcher Pills Grouped by Floor */}
        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
          {floors.map((fl) => {
            const floorRooms = rooms.filter((r) => r.floor_id === fl.id);
            if (floorRooms.length === 0) return null;
            return (
              <div key={fl.id} className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider w-20 shrink-0">
                  {fl.label}:
                </span>
                <div className="flex flex-wrap gap-1">
                  {floorRooms.map((r) => {
                    const isCurrent = r.id === roomId;
                    const depCount = roomDepCounts[r.id] ?? 0;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => handleRoomSelect(r.id)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                          isCurrent
                            ? 'bg-accent text-white shadow-xs font-bold'
                            : 'bg-surface-alt text-text-secondary border border-border hover:border-accent/40 hover:text-text-primary'
                        }`}
                      >
                        <span>{r.name}</span>
                        <span
                          className={`rounded-md px-1 py-0.2 text-[10px] font-mono ${
                            isCurrent ? 'bg-white/20 text-white' : 'bg-surface text-text-muted'
                          }`}
                        >
                          {depCount}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ───────────────────────── SECTION 2: MASTER CATALOGUE PICKER ───────────────────────── */}
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-text-primary">Master Dependency Catalogue</h3>
            <p className="text-xs text-text-secondary">
              Select standard dependencies that apply to <strong className="text-text-primary">{currentRoom?.name}</strong>.
            </p>
          </div>

          {/* Search box */}
          <div className="w-full sm:w-64">
            <input
              type="text"
              placeholder="Search dependencies or trade…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-xs placeholder:text-text-muted focus:border-accent"
            />
          </div>
        </div>

        {/* Master items grouped by Agency Type */}
        <div className="space-y-4 pt-1">
          {filteredMasterByAgency.length === 0 ? (
            <p className="text-xs text-text-muted italic py-4 text-center">
              No matching dependencies found for &quot;{searchQuery}&quot;.
            </p>
          ) : (
            filteredMasterByAgency.map(({ agencyType, items }) => {
              const selectable = items.filter((i) => !existingMasterIds.has(i.id));
              const allGroupSelected =
                selectable.length > 0 && selectable.every((i) => selectedMasterIds.has(i.id));

              return (
                <div key={agencyType.id} className="rounded-xl border border-border bg-surface-alt/40 p-3.5 space-y-2">
                  <div className="flex items-center justify-between border-b border-border/60 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-text-primary">{agencyType.name}</span>
                      <span className="rounded-md bg-surface px-1.5 py-0.5 text-[10px] text-text-muted font-mono border border-border">
                        {items.length} items
                      </span>
                    </div>

                    {selectable.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleSelectGroup(items)}
                        className="text-xs font-medium text-accent hover:underline"
                      >
                        {allGroupSelected ? 'Deselect all' : 'Select all'}
                      </button>
                    )}
                  </div>

                  {/* Checklist */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                    {items.map((dep) => {
                      const isExisting = existingMasterIds.has(dep.id);
                      const isSelected = selectedMasterIds.has(dep.id);

                      return (
                        <label
                          key={dep.id}
                          className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-xs transition-colors cursor-pointer select-none ${
                            isExisting
                              ? 'border-border/60 bg-surface/50 opacity-60 cursor-default'
                              : isSelected
                              ? 'border-accent bg-accent/5 font-medium'
                              : 'border-border/80 bg-surface hover:border-accent/40'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={isExisting}
                            checked={isExisting || isSelected}
                            onChange={() => toggleMaster(dep.id)}
                            className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent"
                          />
                          <div className="min-w-0 flex-1">
                            <span className="text-text-primary leading-tight">{dep.text}</span>
                            {isExisting && (
                              <span className="ml-2 inline-block rounded bg-success-light px-1.5 py-0.2 text-[10px] font-semibold text-success">
                                Added
                              </span>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ───────────────────────── SECTION 3: ADD CUSTOM DEPENDENCY ───────────────────────── */}
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs space-y-3">
        <div>
          <h3 className="text-sm font-bold text-text-primary">Add Custom Room Dependency</h3>
          <p className="text-xs text-text-secondary">
            Need something not in the master list? Add project-specific dependencies here.
          </p>
        </div>

        <form onSubmit={handleAddCustom} className="flex flex-col sm:flex-row gap-2">
          <select
            value={customAgencyTypeId}
            onChange={(e) => setCustomAgencyTypeId(e.target.value)}
            className="w-full sm:w-48 rounded-lg border border-border bg-surface px-3 py-2 text-xs focus:border-accent"
          >
            {agencyTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="e.g. Italian marble polishing prior to automation panel install"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs focus:border-accent"
          />

          <button
            type="submit"
            disabled={!customText.trim()}
            className="rounded-lg bg-surface-alt border border-border px-4 py-2 text-xs font-semibold text-text-primary hover:bg-border transition-colors disabled:opacity-50"
          >
            + Add
          </button>
        </form>

        {/* Staged custom list */}
        {customList.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-border/60">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
              Custom dependencies to create ({customList.length}):
            </p>
            {customList.map((item, idx) => {
              const tradeName = agencyTypes.find((t) => t.id === item.agency_type_id)?.name ?? 'Trade';
              return (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-lg bg-accent/5 border border-accent/20 p-2 text-xs"
                >
                  <span className="text-text-primary font-medium">
                    <strong className="text-accent">[{tradeName}]</strong> {item.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveCustom(idx)}
                    className="text-text-muted hover:text-danger px-1 font-bold"
                    aria-label="Remove custom dependency"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ───────────────────────── STICKY ACTION BAR ───────────────────────── */}
      <div className="sticky bottom-4 z-20 flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl border border-border bg-surface/95 p-4 shadow-lg backdrop-blur-sm">
        <div className="text-xs">
          <span className="font-semibold text-text-primary">
            {selectedMasterIds.size + customList.length} new dependencies
          </span>{' '}
          selected for <strong className="text-accent">{currentRoom?.name}</strong>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <button
            type="button"
            disabled={saving || (selectedMasterIds.size === 0 && customList.length === 0)}
            onClick={() => handleSave(false)}
            className="rounded-lg bg-surface-alt border border-border px-4 py-2 text-xs font-semibold text-text-primary hover:bg-border transition-colors disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save to this room'}
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={() => handleSave(true)}
            className="rounded-lg bg-accent px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {saving
              ? 'Saving…'
              : nextRoom
              ? `Save & Next: ${nextRoom.name} →`
              : isWizard
              ? 'Save & Continue to Escalation →'
              : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}
