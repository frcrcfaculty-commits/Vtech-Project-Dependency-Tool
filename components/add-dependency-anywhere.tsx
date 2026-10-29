'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/client/supabase';

interface ProjectOption {
  id: string;
  name: string;
}

interface AgencyType {
  id: string;
  name: string;
}

interface MasterDependency {
  id: string;
  agency_type_id: string;
  text: string;
  origin: string;
  active: boolean;
}

interface RoomOption {
  id: string;
  name: string;
  floorLabel: string;
}

interface CustomEntry {
  id: string;
  agency_type_id: string;
  text: string;
}

export function AddDependencyAnywhere() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [isOpen, setIsOpen] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Form selections
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');

  const [agencyTypes, setAgencyTypes] = useState<AgencyType[]>([]);
  const [masterDeps, setMasterDeps] = useState<MasterDependency[]>([]);
  const [selectedMasterIds, setSelectedMasterIds] = useState<Set<string>>(new Set());

  // Existing room dependency texts (to prevent duplicates / show added)
  const [existingRoomDepTexts, setExistingRoomDepTexts] = useState<Set<string>>(new Set());

  // Custom dependency fields
  const [customEntries, setCustomEntries] = useState<CustomEntry[]>([]);
  const [customText, setCustomText] = useState('');
  const [customTypeId, setCustomTypeId] = useState('');

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  // Toggle: Mark as pending now
  const isWizard = pathname.includes('/setup');
  const [markAsPending, setMarkAsPending] = useState(!isWizard);

  // Context-aware preselection
  const detectContext = useCallback(() => {
    // If URL has ?p=... (like /hub?p=...)
    const pParam = searchParams.get('p');
    if (pParam) return { projectId: pParam, roomId: '' };

    // If path is /projects/[projectId]/rooms/[roomId]/...
    const roomMatch = pathname.match(/\/projects\/([0-9a-f-]+)\/rooms\/([0-9a-f-]+)/i);
    if (roomMatch) return { projectId: roomMatch[1], roomId: roomMatch[2] };

    // If path is /projects/[projectId]
    const projMatch = pathname.match(/\/projects\/([0-9a-f-]+)/i);
    if (projMatch) return { projectId: projMatch[1], roomId: '' };

    return { projectId: '', roomId: '' };
  }, [pathname, searchParams]);

  // Load projects, agency types, and master dependencies on modal open
  const loadInitialData = useCallback(async () => {
    try {
      setLoadingInitial(true);
      setError(null);
      const sb = supabaseBrowser();

      const [projRes, typeRes, masterRes] = await Promise.all([
        sb.from('projects').select('id, name').neq('status', 'closed').order('name'),
        sb.from('agency_types').select('id, name').order('sort'),
        sb.from('master_dependencies').select('id, agency_type_id, text, origin, active').eq('active', true).order('seq'),
      ]);

      if (projRes.error) throw projRes.error;
      if (typeRes.error) throw typeRes.error;
      if (masterRes.error) throw masterRes.error;

      setProjects(projRes.data ?? []);
      setAgencyTypes(typeRes.data ?? []);
      setMasterDeps(masterRes.data ?? []);

      if (typeRes.data && typeRes.data.length > 0 && !customTypeId) {
        setCustomTypeId(typeRes.data[0].id);
      }

      const ctx = detectContext();
      if (ctx.projectId && ((projRes.data ?? []) as ProjectOption[]).some((p: ProjectOption) => p.id === ctx.projectId)) {
        setSelectedProjectId(ctx.projectId);
      } else if (projRes.data && projRes.data.length > 0) {
        setSelectedProjectId(projRes.data[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load options');
    } finally {
      setLoadingInitial(false);
    }
  }, [detectContext, customTypeId]);

  // When selected project changes, load its rooms
  useEffect(() => {
    if (!isOpen || !selectedProjectId) {
      setRooms([]);
      setSelectedRoomId('');
      return;
    }

    async function loadRoomsForProject() {
      try {
        setLoadingRooms(true);
        const sb = supabaseBrowser();
        const [floorsRes, roomsRes] = await Promise.all([
          sb.from('floors').select('id, label, sort').eq('project_id', selectedProjectId).order('sort'),
          sb.from('rooms').select('id, name, floor_id, sort').eq('project_id', selectedProjectId).order('sort'),
        ]);

        if (floorsRes.error) throw floorsRes.error;
        if (roomsRes.error) throw roomsRes.error;

        const floorMap = new Map(((floorsRes.data ?? []) as { id: string; label: string }[]).map((f) => [f.id, f.label]));
        const formattedRooms: RoomOption[] = ((roomsRes.data ?? []) as { id: string; name: string; floor_id: string }[]).map((r) => ({
          id: r.id,
          name: r.name,
          floorLabel: floorMap.get(r.floor_id) ?? 'Floor',
        }));

        setRooms(formattedRooms);

        const ctx = detectContext();
        if (ctx.roomId && formattedRooms.some((r) => r.id === ctx.roomId)) {
          setSelectedRoomId(ctx.roomId);
        } else if (formattedRooms.length > 0) {
          setSelectedRoomId(formattedRooms[0].id);
        } else {
          setSelectedRoomId('');
        }
      } catch (err) {
        console.error('Failed to load rooms:', err);
      } finally {
        setLoadingRooms(false);
      }
    }

    loadRoomsForProject();
  }, [isOpen, selectedProjectId, detectContext]);

  // When room changes, check which items are already in this room
  useEffect(() => {
    if (!isOpen || !selectedRoomId) {
      setExistingRoomDepTexts(new Set());
      return;
    }

    async function checkRoomDeps() {
      try {
        const sb = supabaseBrowser();
        const { data } = await sb
          .from('dependency_items')
          .select('project_dependencies(text)')
          .eq('room_id', selectedRoomId);

        const set = new Set<string>();
        for (const d of data ?? []) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const text = (d.project_dependencies as any)?.text;
          if (text) set.add(text.toLowerCase().trim());
        }
        setExistingRoomDepTexts(set);
      } catch (err) {
        console.error('Failed to fetch existing room items:', err);
      }
    }

    checkRoomDeps();
  }, [isOpen, selectedRoomId]);

  // Handle project change: immediately reset room and block save until new rooms finish loading
  const handleProjectChange = (newProjectId: string) => {
    setSelectedProjectId(newProjectId);
    setSelectedRoomId(''); // immediately reset room selection
    setRooms([]); // immediately clear old rooms so stale room cannot be saved
    setLoadingRooms(true); // immediately lock save
    setExistingRoomDepTexts(new Set());
  };

  // Open modal handler
  const handleOpenModal = () => {
    setIsOpen(true);
    setSelectedMasterIds(new Set());
    setCustomEntries([]);
    setCustomText('');
    setSearchQuery('');
    setMarkAsPending(!pathname.includes('/setup'));
    setError(null);
    loadInitialData();
  };

  // Toggle master item selection
  const handleToggleMasterItem = (id: string) => {
    setSelectedMasterIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Add custom entry
  const handleAddCustomEntry = () => {
    if (!customText.trim() || !customTypeId) return;
    const newEntry: CustomEntry = {
      id: crypto.randomUUID(),
      agency_type_id: customTypeId,
      text: customText.trim(),
    };
    setCustomEntries((prev) => [...prev, newEntry]);
    setCustomText('');
  };

  const handleRemoveCustomEntry = (id: string) => {
    setCustomEntries((prev) => prev.filter((c) => c.id !== id));
  };

  // Filtered master items
  const filteredMasterItems = useMemo(() => {
    return masterDeps.filter((m) => {
      if (typeFilter !== 'all' && m.agency_type_id !== typeFilter) return false;
      if (searchQuery.trim() && !m.text.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [masterDeps, typeFilter, searchQuery]);

  // Group filtered master items by agency type
  const groupedMasterItems = useMemo(() => {
    const map = new Map<string, { type: AgencyType; items: MasterDependency[] }>();
    const typeLookup = new Map(agencyTypes.map((t) => [t.id, t]));

    for (const item of filteredMasterItems) {
      const t = typeLookup.get(item.agency_type_id) ?? { id: item.agency_type_id, name: 'General' };
      if (!map.has(t.id)) {
        map.set(t.id, { type: t, items: [] });
      }
      map.get(t.id)!.items.push(item);
    }
    return Array.from(map.values());
  }, [filteredMasterItems, agencyTypes]);

  // Save handler
  const handleSaveDependencies = async () => {
    if (loadingRooms || !selectedRoomId) {
      setError('Please wait for rooms to load and select a room.');
      return;
    }

    const totalSelected = selectedMasterIds.size + customEntries.length;
    if (totalSelected === 0) {
      setError('Please select at least one master dependency or add a custom dependency.');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const sb = supabaseBrowser();

      const masterIds = Array.from(selectedMasterIds);
      const customPayload = customEntries.map((c) => ({
        agency_type_id: c.agency_type_id,
        text: c.text,
      }));

      const { data: count, error: rpcErr } = await sb.rpc('add_room_dependencies', {
        p_room: selectedRoomId,
        p_master_ids: masterIds,
        p_custom: customPayload,
        p_initial_status: markAsPending ? 'pending' : 'unchecked',
      });

      if (rpcErr) throw rpcErr;

      // Close modal and emit event
      setIsOpen(false);
      const roomObj = rooms.find((r) => r.id === selectedRoomId);
      const msg = `Added ${count ?? totalSelected} dependencies to ${roomObj ? `${roomObj.floorLabel} · ${roomObj.name}` : 'room'}`;
      setSuccessNotice(msg);
      setTimeout(() => setSuccessNotice(null), 3500);

      // Dispatch global event so Pending and Hub pages update reactively without a reload
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('vtech:dependency-added', {
            detail: {
              projectId: selectedProjectId,
              roomId: selectedRoomId,
              initialStatus: markAsPending ? 'pending' : 'unchecked',
            },
          })
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add dependencies');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* ───────────────────────── FLOATING TRIGGER BUTTON ───────────────────────── */}
      <button
        type="button"
        role="button"
        aria-label="Add dependency"
        onClick={handleOpenModal}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-bold text-white shadow-xl hover:bg-accent-hover hover:scale-105 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        <span className="hidden sm:inline">Add dependency</span>
      </button>

      {/* Global Success Banner */}
      {successNotice && (
        <div className="fixed bottom-20 right-6 z-50 rounded-xl border border-emerald-500/30 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-800 shadow-lg animate-fade-in">
          ✓ {successNotice}
        </div>
      )}

      {/* ───────────────────────── DIALOG MODAL ───────────────────────── */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
              <div>
                <h2 className="text-base font-bold text-text-primary">+ Add Dependency</h2>
                <p className="text-xs text-text-secondary mt-0.5">
                  Pick master catalog items or add custom dependencies to a room
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1.5 text-text-muted hover:bg-surface-alt hover:text-text-primary font-bold"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {error && (
                <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs font-semibold text-danger">
                  {error}
                </div>
              )}

              {/* Location Selectors: Project & Room */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">
                    Project
                  </label>
                  <select
                    value={selectedProjectId}
                    onChange={(e) => handleProjectChange(e.target.value)}
                    disabled={loadingInitial || saving}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">
                    Target Room
                  </label>
                  <select
                    value={selectedRoomId}
                    onChange={(e) => setSelectedRoomId(e.target.value)}
                    disabled={loadingRooms || rooms.length === 0}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
                  >
                    {rooms.length === 0 ? (
                      <option value="">{loadingRooms ? 'Loading rooms…' : 'No rooms available'}</option>
                    ) : (
                      rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.floorLabel} — {r.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              {/* Mark as pending now Toggle */}
              <div className="rounded-xl border border-border bg-surface-alt/60 p-3.5">
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <span className="text-xs font-bold text-text-primary">Mark as pending now</span>
                    <p className="text-[11px] text-text-secondary mt-0.5">
                      New items will immediately show in the Pending list and contractor reminder follow-ups.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={markAsPending}
                    onChange={(e) => setMarkAsPending(e.target.checked)}
                    className="h-4 w-4 rounded border-border text-danger focus:ring-danger"
                  />
                </label>
              </div>

              {/* Master Dependency Catalogue Picker */}
              <div className="space-y-2 border-t border-border/70 pt-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                    Select from Master Catalogue
                  </h3>
                  <span className="text-xs font-semibold text-accent">
                    {selectedMasterIds.size} selected
                  </span>
                </div>

                {/* Filters */}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    placeholder="Search master dependencies…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 rounded-lg border border-border bg-surface-alt px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:bg-surface focus:outline-none"
                  />
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="rounded-lg border border-border bg-surface-alt px-2.5 py-1.5 text-xs text-text-primary focus:border-accent focus:bg-surface focus:outline-none"
                  >
                    <option value="all">All Trades / Types</option>
                    {agencyTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Items Container */}
                <div className="max-h-52 overflow-y-auto rounded-xl border border-border bg-surface divide-y divide-border/50">
                  {groupedMasterItems.length === 0 ? (
                    <p className="p-4 text-center text-xs text-text-muted italic">
                      No master dependencies match the search query.
                    </p>
                  ) : (
                    groupedMasterItems.map((group) => (
                      <div key={group.type.id} className="p-2.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted px-1">
                          {group.type.name}
                        </span>
                        <div className="mt-1 space-y-1">
                          {group.items.map((item) => {
                            const isSelected = selectedMasterIds.has(item.id);
                            const isAlreadyInRoom = existingRoomDepTexts.has(item.text.toLowerCase().trim());

                            return (
                              <label
                                key={item.id}
                                className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-xs cursor-pointer transition-colors ${
                                  isAlreadyInRoom
                                    ? 'opacity-40 cursor-not-allowed bg-surface-alt/30'
                                    : isSelected
                                    ? 'bg-accent/10 text-accent font-semibold'
                                    : 'hover:bg-surface-alt'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  disabled={isAlreadyInRoom}
                                  checked={isSelected}
                                  onChange={() => handleToggleMasterItem(item.id)}
                                  className="mt-0.5 rounded border-border text-accent focus:ring-accent"
                                />
                                <span className="flex-1 leading-snug text-text-primary">
                                  {item.text}
                                </span>
                                {isAlreadyInRoom && (
                                  <span className="text-[10px] text-text-muted font-normal italic">
                                    Already in room
                                  </span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Custom Dependency Section */}
              <div className="space-y-2 border-t border-border/70 pt-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                  Add Custom Dependency
                </h3>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select
                    value={customTypeId}
                    onChange={(e) => setCustomTypeId(e.target.value)}
                    className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                  >
                    {agencyTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="e.g. Wall groove cutting near main entrance switchboard"
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomEntry();
                      }
                    }}
                    className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomEntry}
                    disabled={!customText.trim()}
                    className="rounded-lg border border-border bg-surface-alt px-3 py-1.5 text-xs font-bold text-text-primary hover:bg-border transition-colors disabled:opacity-50"
                  >
                    + Add
                  </button>
                </div>

                {/* Staged Custom Entries */}
                {customEntries.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    {customEntries.map((c) => {
                      const typeName = agencyTypes.find((t) => t.id === c.agency_type_id)?.name ?? 'Trade';
                      return (
                        <div
                          key={c.id}
                          className="flex items-center justify-between rounded-lg border border-border/60 bg-surface-alt/50 px-3 py-1.5 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-border/80 px-1.5 py-0.2 text-[10px] font-bold text-text-secondary">
                              {typeName}
                            </span>
                            <span className="font-semibold text-text-primary">{c.text}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveCustomEntry(c.id)}
                            className="text-text-muted hover:text-danger text-xs font-bold px-1"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border/70 bg-surface-alt/40 px-5 py-3">
              <span className="text-xs text-text-secondary">
                Total:{' '}
                <strong className="text-text-primary">
                  {selectedMasterIds.size + customEntries.length} items
                </strong>
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-alt"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    saving ||
                    loadingRooms ||
                    !selectedRoomId ||
                    (selectedMasterIds.size === 0 && customEntries.length === 0)
                  }
                  onClick={handleSaveDependencies}
                  className="rounded-lg bg-accent px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-accent-hover transition-colors disabled:opacity-50"
                >
                  {saving ? 'Adding…' : loadingRooms ? 'Loading rooms…' : 'Save Dependencies'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
