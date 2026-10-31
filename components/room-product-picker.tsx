'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabaseBrowser } from '@/lib/client/supabase';

export interface RoomProductPickerProps {
  projectId: string;
  roomId?: string;
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

interface ProductItem {
  id: string;
  title: string;
  scope: 'room' | 'project';
  location_options: string[];
  sort: number;
  active: boolean;
}

interface ProductStep {
  id: string;
  product_id: string;
  seq: number;
  label: string;
  phase: number;
  responsibility: 'external' | 'internal' | 'client';
  gate: string;
  sheet_colour: string | null;
}

interface PlacedRoomProduct {
  id: string;
  project_id: string;
  room_id: string;
  product_id: string;
  location: string | null;
  quantity: number;
  note: string | null;
  created_at: string;
  product_catalogue?: ProductItem;
  rooms?: { id: string; name: string; floor_id: string };
}

export function getStepDotColor(sheetColour?: string | null): { bg: string; border: string; text: string; label: string } {
  const c = sheetColour?.toUpperCase().trim();
  if (c === 'D9EAD3') return { bg: '#D9EAD3', border: '#B7D7B0', text: '#274E13', label: 'Other agencies (green)' };
  if (c === 'C9DAF8' || c === 'CFE2F3') return { bg: '#C9DAF8', border: '#A4C2F4', text: '#1155CC', label: 'Other agencies (blue)' };
  if (c === 'E06666') return { bg: '#E06666', border: '#CC0000', text: '#FFFFFF', label: 'VTech Installers (dark red)' };
  if (c === 'F4CCCC') return { bg: '#F4CCCC', border: '#EA9999', text: '#990000', label: 'VTech Programmers (light red)' };
  if (c === 'F9CB9C') return { bg: '#F9CB9C', border: '#F6B26B', text: '#783F04', label: 'VTech Project Managers (orange)' };
  return { bg: '#E2E8F0', border: '#CBD5E1', text: '#475569', label: 'Other' };
}

export function RoomProductPicker({
  projectId,
  roomId: initialRoomId,
  onRoomChange,
  onFinish,
  isWizard = false,
}: RoomProductPickerProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Core metadata
  const [floors, setFloors] = useState<Floor[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [steps, setSteps] = useState<ProductStep[]>([]);
  const [placedProducts, setPlacedProducts] = useState<PlacedRoomProduct[]>([]);

  // Selected scope / room: activeRoomId is null for Project-wide
  const [selectedFloorId, setSelectedFloorId] = useState<string>('');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(initialRoomId ?? null);
  const [isProjectWide, setIsProjectWide] = useState(false);

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');

  // Per-product configuration state in the catalog list: { [productId]: { location: string, customLocation: string, quantity: number } }
  const [productConfigs, setProductConfigs] = useState<
    Record<string, { location: string; customLocation: string; quantity: number }>
  >({});

  // Copy products modal state
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [copySourceRoomId, setCopySourceRoomId] = useState('');

  const showSuccessNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  };

  // Load project rooms, products catalogue, steps, and placed room products
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const sb = supabaseBrowser();

      const [
        { data: fData, error: fErr },
        { data: rData, error: rErr },
        { data: pData, error: pErr },
        { data: sData, error: sErr },
        { data: rpData, error: rpErr },
      ] = await Promise.all([
        sb.from('floors').select('*').eq('project_id', projectId).order('sort'),
        sb.from('rooms').select('*').eq('project_id', projectId).order('sort'),
        sb.from('product_catalogue').select('*').eq('active', true).order('sort'),
        sb.from('product_steps').select('*').order('seq'),
        sb.from('room_products').select('*, product_catalogue(*), rooms(*)').eq('project_id', projectId),
      ]);

      if (fErr) throw fErr;
      if (rErr) throw rErr;
      if (pErr) throw pErr;
      if (sErr) throw sErr;
      if (rpErr) throw rpErr;

      const loadedFloors: Floor[] = (fData as Floor[]) ?? [];
      const loadedRooms: Room[] = (rData as Room[]) ?? [];
      const loadedProducts: ProductItem[] = (pData as ProductItem[]) ?? [];
      const loadedSteps: ProductStep[] = (sData as ProductStep[]) ?? [];
      const loadedPlaced = (rpData as unknown as PlacedRoomProduct[]) ?? [];

      setFloors(loadedFloors);
      setRooms(loadedRooms);
      setProducts(loadedProducts);
      setSteps(loadedSteps);
      setPlacedProducts(loadedPlaced);

      // Initialize room selection if not set
      if (!isProjectWide) {
        if (initialRoomId && loadedRooms.some((r: Room) => r.id === initialRoomId)) {
          setActiveRoomId(initialRoomId);
          const r = loadedRooms.find((r: Room) => r.id === initialRoomId);
          if (r) setSelectedFloorId(r.floor_id);
        } else if (loadedRooms.length > 0 && !activeRoomId) {
          setActiveRoomId(loadedRooms[0].id);
          setSelectedFloorId(loadedRooms[0].floor_id);
          onRoomChange?.(loadedRooms[0].id);
        }
      }

      // Initialize default configs for products
      const initialConfigs: Record<string, { location: string; customLocation: string; quantity: number }> = {};
      loadedProducts.forEach((p: ProductItem) => {
        const defaultLoc = p.location_options && p.location_options.length > 0 ? p.location_options[0] : '';
        initialConfigs[p.id] = {
          location: defaultLoc,
          customLocation: '',
          quantity: 1,
        };
      });
      setProductConfigs(initialConfigs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load room products data');
    } finally {
      setLoading(false);
    }
  }, [projectId, initialRoomId, onRoomChange, isProjectWide, activeRoomId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle active room change
  const handleSelectRoom = (rId: string) => {
    setIsProjectWide(false);
    setActiveRoomId(rId);
    onRoomChange?.(rId);
    const r = rooms.find((room) => room.id === rId);
    if (r) setSelectedFloorId(r.floor_id);
  };

  const handleSelectProjectWide = () => {
    setIsProjectWide(true);
    setActiveRoomId(null);
  };

  // Group steps by product
  const stepsByProduct = useMemo(() => {
    const map = new Map<string, ProductStep[]>();
    steps.forEach((s) => {
      const arr = map.get(s.product_id) ?? [];
      arr.push(s);
      map.set(s.product_id, arr);
    });
    return map;
  }, [steps]);

  // Placed products counts by room
  const placedCountByRoom = useMemo(() => {
    const counts: Record<string, number> = {};
    placedProducts.forEach((rp) => {
      if (rp.room_id) {
        counts[rp.room_id] = (counts[rp.room_id] ?? 0) + 1;
      }
    });
    return counts;
  }, [placedProducts]);

  // Current room placed products
  const currentPlacedProducts = useMemo(() => {
    if (isProjectWide) {
      // Find products with scope === 'project' or items attached to project-wide room
      return placedProducts.filter((rp) => rp.product_catalogue?.scope === 'project');
    }
    return placedProducts.filter((rp) => rp.room_id === activeRoomId);
  }, [placedProducts, isProjectWide, activeRoomId]);

  // Ordered rooms for "Save & Next Room"
  const allRoomsOrdered = useMemo(() => {
    const floorOrder = new Map(floors.map((f) => [f.id, f.sort]));
    return [...rooms].sort((a, b) => {
      const fDiff = (floorOrder.get(a.floor_id) ?? 0) - (floorOrder.get(b.floor_id) ?? 0);
      if (fDiff !== 0) return fDiff;
      return a.sort - b.sort;
    });
  }, [floors, rooms]);

  const currentRoomIndex = useMemo(
    () => allRoomsOrdered.findIndex((r) => r.id === activeRoomId),
    [allRoomsOrdered, activeRoomId]
  );
  const nextRoom = useMemo(
    () => (currentRoomIndex !== -1 && currentRoomIndex < allRoomsOrdered.length - 1 ? allRoomsOrdered[currentRoomIndex + 1] : null),
    [currentRoomIndex, allRoomsOrdered]
  );

  // Products available to add
  const filteredProducts = useMemo(() => {
    const scopeFilter = isProjectWide ? 'project' : 'room';
    return products
      .filter((p) => p.scope === scopeFilter)
      .filter((p) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return p.title.toLowerCase().includes(q) || (p.location_options ?? []).some((loc) => loc.toLowerCase().includes(q));
      });
  }, [products, isProjectWide, searchQuery]);

  // Add product to current room or project
  const handleAddProduct = async (product: ProductItem) => {
    if (!isProjectWide && !activeRoomId) return;
    setSaving(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      const cfg = productConfigs[product.id] ?? {
        location: product.location_options?.[0] ?? '',
        customLocation: '',
        quantity: 1,
      };

      const finalLocation =
        cfg.location === '__custom__' || cfg.location === 'Other'
          ? cfg.customLocation.trim() || 'Other'
          : cfg.location || null;

      const qty = Math.max(1, cfg.quantity || 1);

      const { data: newRpId, error: rpcErr } = await sb.rpc('add_room_product', {
        p_project: projectId,
        p_room: isProjectWide ? null : activeRoomId,
        p_product: product.id,
        p_location: finalLocation,
        p_quantity: qty,
      });

      if (rpcErr) throw rpcErr;

      // Reload placed products
      const { data: freshPlaced, error: rpErr } = await sb
        .from('room_products')
        .select('*, product_catalogue(*), rooms(*)')
        .eq('project_id', projectId);
      if (rpErr) throw rpErr;
      setPlacedProducts((freshPlaced as unknown as PlacedRoomProduct[]) ?? []);

      showSuccessNotice(`Added ${product.title}${finalLocation ? ` (${finalLocation})` : ''} to room`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add product');
    } finally {
      setSaving(false);
    }
  };

  // Remove placed product
  const handleRemoveProduct = async (rp: PlacedRoomProduct) => {
    const title = rp.product_catalogue?.title ?? 'Product';
    const loc = rp.location ? ` (${rp.location})` : '';
    if (!confirm(`Are you sure you want to remove ${title}${loc} from this room? This will also remove its associated step dependencies.`)) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      const { error: rpcErr } = await sb.rpc('remove_room_product', {
        p_room_product: rp.id,
      });
      if (rpcErr) throw rpcErr;

      const { data: freshPlaced, error: rpErr } = await sb
        .from('room_products')
        .select('*, product_catalogue(*), rooms(*)')
        .eq('project_id', projectId);
      if (rpErr) throw rpErr;
      setPlacedProducts((freshPlaced as unknown as PlacedRoomProduct[]) ?? []);

      showSuccessNotice(`Removed ${title}${loc}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove product');
    } finally {
      setSaving(false);
    }
  };

  // Copy products from another room
  const handleCopyFromRoom = async () => {
    if (!copySourceRoomId || !activeRoomId || copySourceRoomId === activeRoomId) return;
    setSaving(true);
    setError(null);
    try {
      const sourceProducts = placedProducts.filter((rp) => rp.room_id === copySourceRoomId);
      if (sourceProducts.length === 0) {
        alert('The selected source room has no products placed.');
        return;
      }

      const sb = supabaseBrowser();
      let addedCount = 0;
      for (const sp of sourceProducts) {
        const { error: rpcErr } = await sb.rpc('add_room_product', {
          p_project: projectId,
          p_room: activeRoomId,
          p_product: sp.product_id,
          p_location: sp.location,
          p_quantity: sp.quantity ?? 1,
        });
        if (rpcErr) throw rpcErr;
        addedCount++;
      }

      // Reload placed
      const { data: freshPlaced, error: rpErr } = await sb
        .from('room_products')
        .select('*, product_catalogue(*), rooms(*)')
        .eq('project_id', projectId);
      if (rpErr) throw rpErr;
      setPlacedProducts((freshPlaced as unknown as PlacedRoomProduct[]) ?? []);

      setShowCopyModal(false);
      setCopySourceRoomId('');
      showSuccessNotice(`Copied ${addedCount} product(s) successfully`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy products');
    } finally {
      setSaving(false);
    }
  };

  // Navigate to next room
  const handleSaveAndNext = () => {
    if (nextRoom) {
      handleSelectRoom(nextRoom.id);
      showSuccessNotice(`Moved to ${nextRoom.name}`);
    } else if (onFinish) {
      onFinish();
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-12 text-center text-xs text-text-muted">
        Loading product catalogue and room data…
      </div>
    );
  }

  const currentRoom = rooms.find((r) => r.id === activeRoomId);

  return (
    <div className="space-y-6">
      {/* ── Notification Banner ── */}
      {notice && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs font-semibold text-emerald-700 animate-fadeIn flex items-center justify-between">
          <span>✓ {notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-emerald-700 font-bold ml-2">
            ×
          </button>
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-danger/20 bg-danger/10 p-3 text-xs font-semibold text-danger flex items-center justify-between">
          <span>⚠ {error}</span>
          <button type="button" onClick={() => setError(null)} className="text-danger font-bold ml-2">
            ×
          </button>
        </div>
      )}

      {/* ── Top Bar: Mode Switcher & Copy Action ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface p-4 rounded-2xl border border-border">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-accent/10 px-2 py-0.5 text-xs font-bold text-accent">
              VTech Product Tracking (v3)
            </span>
            <span className="text-xs text-text-muted">
              Select products VTech sells in each room
            </span>
          </div>
          <p className="text-xs text-text-secondary mt-1">
            Products generate fixed step chains with owner-colored milestones (green = external, red/orange = VTech).
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isProjectWide && rooms.length > 1 && (
            <button
              type="button"
              onClick={() => setShowCopyModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-alt px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-border transition-colors"
            >
              <svg className="h-3.5 w-3.5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
              </svg>
              Copy products from room…
            </button>
          )}
        </div>
      </div>

      {/* ── Room Switcher Bar ── */}
      <div className="rounded-2xl border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">
            Select Room or Scope:
          </span>
          <span className="text-xs text-text-muted">
            {rooms.length} room(s) in project
          </span>
        </div>

        {/* Floor selector if multiple floors */}
        {floors.length > 1 && (
          <div className="flex flex-wrap gap-1.5 border-b border-border/60 pb-3">
            {floors.map((fl) => {
              const flRooms = rooms.filter((r) => r.floor_id === fl.id);
              const isSelected = selectedFloorId === fl.id && !isProjectWide;
              return (
                <button
                  key={fl.id}
                  type="button"
                  onClick={() => {
                    setSelectedFloorId(fl.id);
                    if (flRooms.length > 0) handleSelectRoom(flRooms[0].id);
                  }}
                  className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                    isSelected
                      ? 'bg-accent text-white shadow-xs'
                      : 'bg-surface-alt text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {fl.label} ({flRooms.length})
                </button>
              );
            })}
          </div>
        )}

        {/* Room chips & Project-wide tab */}
        <div className="flex flex-wrap items-center gap-2">
          {rooms
            .filter((r) => !selectedFloorId || r.floor_id === selectedFloorId)
            .map((r) => {
              const isSelected = !isProjectWide && activeRoomId === r.id;
              const count = placedCountByRoom[r.id] ?? 0;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => handleSelectRoom(r.id)}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all ${
                    isSelected
                      ? 'border-accent bg-accent/10 text-accent ring-1 ring-accent'
                      : 'border-border bg-surface-alt text-text-primary hover:border-accent/40'
                  }`}
                >
                  <span>{r.name}</span>
                  {count > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                        isSelected ? 'bg-accent text-white' : 'bg-surface text-text-secondary border border-border'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}

          {/* Project-wide Scope Tab */}
          <button
            type="button"
            onClick={handleSelectProjectWide}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all ml-auto ${
              isProjectWide
                ? 'border-accent bg-accent/10 text-accent ring-1 ring-accent'
                : 'border-border bg-surface-alt text-text-primary hover:border-accent/40'
            }`}
          >
            <span>★ Project-wide (Handover &amp; Client)</span>
            {placedProducts.filter((p) => p.product_catalogue?.scope === 'project').length > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                  isProjectWide ? 'bg-accent text-white' : 'bg-surface text-text-secondary border border-border'
                }`}
              >
                {placedProducts.filter((p) => p.product_catalogue?.scope === 'project').length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── SECTION: Placed Products in this Room ── */}
      <div className="rounded-2xl border border-border bg-surface p-5 space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/70 pb-3">
          <div>
            <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
              <span>{isProjectWide ? 'Project-wide Deliverables' : `${currentRoom?.name ?? 'Room'} Products`}</span>
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent">
                {currentPlacedProducts.length} placed
              </span>
            </h3>
            <p className="text-xs text-text-secondary mt-0.5">
              {isProjectWide
                ? 'High-level project scope deliverables placed across the whole site.'
                : 'Hardware, wiring, and automation items installed in this specific room.'}
            </p>
          </div>

          {!isProjectWide && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveAndNext}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {nextRoom ? `Save & next room (${nextRoom.name}) →` : 'Save & continue →'}
              </button>
            </div>
          )}
        </div>

        {currentPlacedProducts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface-alt p-6 text-center text-xs text-text-muted">
            No products placed in {isProjectWide ? 'project-wide scope' : currentRoom?.name ?? 'this room'} yet.
            Select products from the catalogue below to add them.
          </div>
        ) : (
          <div className="space-y-3">
            {currentPlacedProducts.map((rp) => {
              const product = rp.product_catalogue;
              const productSteps = stepsByProduct.get(rp.product_id) ?? [];
              return (
                <div
                  key={rp.id}
                  className="rounded-xl border border-border bg-surface-alt p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors hover:border-accent/30"
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-bold text-text-primary">{product?.title ?? 'Product'}</h4>
                      {rp.location && (
                        <span className="rounded-md bg-surface border border-border px-2 py-0.5 text-xs font-semibold text-text-secondary">
                          📍 {rp.location}
                        </span>
                      )}
                      {rp.quantity > 1 && (
                        <span className="rounded-md bg-accent/15 text-accent border border-accent/20 px-1.5 py-0.5 text-xs font-bold">
                          Qty: {rp.quantity}
                        </span>
                      )}
                    </div>

                    {/* Step chain preview dots with sheet colours */}
                    <div className="flex items-center gap-1.5 pt-1">
                      <span className="text-[11px] font-medium text-text-secondary">Steps ({productSteps.length}):</span>
                      <div className="flex items-center gap-1 flex-wrap">
                        {productSteps.map((st) => {
                          const col = getStepDotColor(st.sheet_colour);
                          return (
                            <span
                              key={st.id}
                              title={`Step ${st.seq}: ${st.label} (${col.label})`}
                              className="inline-block h-3.5 w-3.5 rounded-full border shadow-2xs transition-transform hover:scale-125 cursor-help"
                              style={{
                                backgroundColor: col.bg,
                                borderColor: col.border,
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end md:self-center">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleRemoveProduct(rp)}
                      className="text-xs font-medium text-text-muted hover:text-danger px-2.5 py-1.5 rounded-lg hover:bg-danger-light/30 transition-colors disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── SECTION: Product Catalogue (Room-scope or Project-scope) ── */}
      <div className="rounded-2xl border border-border bg-surface p-5 space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/70 pb-3">
          <div>
            <h3 className="text-base font-bold text-text-primary">
              {isProjectWide ? 'Add Project Deliverable' : `Add Product to ${currentRoom?.name ?? 'Room'}`}
            </h3>
            <p className="text-xs text-text-secondary mt-0.5">
              Choose location and quantity, then tap &quot;+ Add&quot;. The same product can be placed multiple times in different locations.
            </p>
          </div>

          <div className="w-full sm:w-64">
            <input
              type="text"
              placeholder="Filter products (e.g. Keypad, Curtain, Speaker)…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-alt px-3 py-1.5 text-xs focus:border-accent"
            />
          </div>
        </div>

        {/* Legend strip */}
        <div className="flex flex-wrap items-center gap-3 bg-surface-alt p-2.5 rounded-xl border border-border/60 text-[11px] text-text-secondary">
          <span className="font-semibold text-text-primary">Step Colour Legend:</span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-[#D9EAD3] border border-[#B7D7B0]" />
            <span>Other agencies (green)</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-[#C9DAF8] border border-[#A4C2F4]" />
            <span>Other agencies (blue)</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-[#E06666] border border-[#CC0000]" />
            <span>Installers (dark red)</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-[#F4CCCC] border border-[#EA9999]" />
            <span>Programmers (light red)</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-[#F9CB9C] border border-[#F6B26B]" />
            <span>Project managers (orange)</span>
          </span>
        </div>

        {/* Products Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filteredProducts.map((p) => {
            const pSteps = stepsByProduct.get(p.id) ?? [];
            const cfg = productConfigs[p.id] ?? {
              location: p.location_options?.[0] ?? '',
              customLocation: '',
              quantity: 1,
            };

            const isCustomLoc = cfg.location === '__custom__' || cfg.location === 'Other';

            return (
              <div
                key={p.id}
                className="rounded-xl border border-border bg-surface p-4 flex flex-col justify-between space-y-3 shadow-2xs hover:border-accent/40 transition-colors"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <h4 className="text-sm font-bold text-text-primary">{p.title}</h4>
                    <span className="text-[10px] font-bold uppercase rounded bg-surface-alt border border-border px-1.5 py-0.5 text-text-secondary">
                      {pSteps.length} steps
                    </span>
                  </div>

                  {/* Step dots preview */}
                  <div className="flex items-center gap-1 flex-wrap mb-2">
                    {pSteps.map((st) => {
                      const col = getStepDotColor(st.sheet_colour);
                      return (
                        <span
                          key={st.id}
                          title={`Step ${st.seq}: ${st.label} (${col.label})`}
                          className="h-2.5 w-2.5 rounded-full border"
                          style={{
                            backgroundColor: col.bg,
                            borderColor: col.border,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Configuration: Location & Quantity */}
                <div className="space-y-2 pt-2 border-t border-border/60">
                  {!isProjectWide && (
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-text-secondary">Location</label>
                      <select
                        value={cfg.location}
                        onChange={(e) => {
                          const val = e.target.value;
                          setProductConfigs((prev) => ({
                            ...prev,
                            [p.id]: {
                              ...(prev[p.id] ?? cfg),
                              location: val,
                            },
                          }));
                        }}
                        className="w-full rounded-lg border border-border bg-surface-alt px-2.5 py-1.5 text-xs focus:border-accent"
                      >
                        {(p.location_options ?? []).map((loc) => (
                          <option key={loc} value={loc}>
                            {loc}
                          </option>
                        ))}
                        <option value="__custom__">+ Other (custom location)…</option>
                      </select>

                      {isCustomLoc && (
                        <input
                          type="text"
                          placeholder="Type custom location (e.g. Sofa side, Balcony)…"
                          value={cfg.customLocation}
                          onChange={(e) => {
                            const val = e.target.value;
                            setProductConfigs((prev) => ({
                              ...prev,
                              [p.id]: {
                                ...(prev[p.id] ?? cfg),
                                customLocation: val,
                              },
                            }));
                          }}
                          className="w-full rounded-lg border border-border bg-surface px-2.5 py-1 text-xs focus:border-accent mt-1"
                        />
                      )}
                    </div>
                  )}

                  {/* Quantity & Action Button */}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    {!isProjectWide ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-text-secondary">Qty:</span>
                        <div className="flex items-center border border-border rounded-lg bg-surface-alt">
                          <button
                            type="button"
                            onClick={() => {
                              const newQty = Math.max(1, (cfg.quantity || 1) - 1);
                              setProductConfigs((prev) => ({
                                ...prev,
                                [p.id]: { ...(prev[p.id] ?? cfg), quantity: newQty },
                              }));
                            }}
                            className="px-2 py-1 text-xs font-bold text-text-secondary hover:text-text-primary"
                          >
                            –
                          </button>
                          <span className="px-2 py-1 text-xs font-bold text-text-primary min-w-[20px] text-center">
                            {cfg.quantity || 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const newQty = (cfg.quantity || 1) + 1;
                              setProductConfigs((prev) => ({
                                ...prev,
                                [p.id]: { ...(prev[p.id] ?? cfg), quantity: newQty },
                              }));
                            }}
                            className="px-2 py-1 text-xs font-bold text-text-secondary hover:text-text-primary"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span className="text-[11px] text-text-muted">Scope: Project-wide</span>
                    )}

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleAddProduct(p)}
                      className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-accent-hover transition-colors disabled:opacity-50"
                    >
                      + Add to {isProjectWide ? 'Project' : 'Room'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Modal: Copy Products from another room ── */}
      {showCopyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl space-y-4">
            <div>
              <h3 className="text-base font-bold text-text-primary">Copy Products from Room</h3>
              <p className="text-xs text-text-secondary mt-1">
                Select an existing room. All products placed in that room (with their locations and quantities) will be added to{' '}
                <strong className="text-text-primary">{currentRoom?.name ?? 'current room'}</strong>.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Source Room</label>
              <select
                value={copySourceRoomId}
                onChange={(e) => setCopySourceRoomId(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
              >
                <option value="">Select source room…</option>
                {rooms
                  .filter((r) => r.id !== activeRoomId)
                  .map((r) => {
                    const count = placedCountByRoom[r.id] ?? 0;
                    return (
                      <option key={r.id} value={r.id}>
                        {r.name} ({count} product{count === 1 ? '' : 's'})
                      </option>
                    );
                  })}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCopyModal(false)}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!copySourceRoomId || saving}
                onClick={handleCopyFromRoom}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {saving ? 'Copying…' : 'Copy Products'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
