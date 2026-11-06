'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabaseBrowser } from '@/lib/client/supabase';
import { stepColour, isDone, type GateRow } from '@/lib/client/steps';

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

const COMMON_LOCATIONS = [
  'Entrance', 'Bedside', 'Ceiling', 'Wall', 'Floor', 'Window', 'TV Unit', 'Door', 'Wardrobe', 'Balcony', 'Kitchen', 'Bathroom', 'Passage', 'Other'
];
const COMMON_MAKES = [
  'VTech', 'Lutron', 'Crestron', 'Sonance', 'Apple', 'Samsung', 'Sony', 'Philips', 'Daikin', 'Somfy', 'Other'
];
const COMMON_MODELS = [
  'Standard', 'Custom', 'Pro', 'Elite', 'Series 1', 'Series 2', '2-Channel', '4-Channel', '8-Channel', 'Other'
];

export function getStepDotColor(sheetColour?: string | null): { bg: string; border: string; text: string; label: string } {
  const c = sheetColour?.toUpperCase().trim();
  if (c === 'D9EAD3') return { bg: '#D9EAD3', border: '#B7D7B0', text: '#274E13', label: 'Other agencies (green)' };
  if (c === 'C9DAF8' || c === 'CFE2F3') return { bg: '#C9DAF8', border: '#A4C2F4', text: '#1155CC', label: 'Other agencies (blue)' };
  if (c === 'E06666') return { bg: '#E06666', border: '#CC0000', text: '#FFFFFF', label: 'VTech Installers (dark red)' };
  if (c === 'F4CCCC') return { bg: '#F4CCCC', border: '#EA9999', text: '#990000', label: 'VTech Programmers (light red)' };
  if (c === 'F9CB9C') return { bg: '#F9CB9C', border: '#F6B26B', text: '#783F04', label: 'VTECH PM (orange)' };
  if (c === 'FF00FF') return { bg: '#FF00FF', border: '#C000C0', text: '#FFFFFF', label: 'Client / Architect (magenta)' };
  if (c === '9900FF') return { bg: '#9900FF', border: '#6B00B3', text: '#FFFFFF', label: 'Electrician (purple)' };
  if (c === '666666') return { bg: '#666666', border: '#4B5563', text: '#FFFFFF', label: 'VTECH Sales (grey)' };
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
  const [gate, setGate] = useState<GateRow[]>([]);

  // Selected scope / room: activeRoomId is null for Project-wide
  const [selectedFloorId, setSelectedFloorId] = useState<string>('');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(initialRoomId ?? null);
  const [isProjectWide, setIsProjectWide] = useState(false);

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');

  // Add Product Row state (starts as '--' / empty, no default Entrance)
  const [curProductId, setCurProductId] = useState('');
  const [curLocation, setCurLocation] = useState('');
  const [curMake, setCurMake] = useState('');
  const [curModel, setCurModel] = useState('');
  const [curOther, setCurOther] = useState('');

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

  const refreshPlacedAndGate = async () => {
    const sb = supabaseBrowser();
    const [{ data: freshPlaced }, { data: freshGate }] = await Promise.all([
      sb.from('room_products').select('*, product_catalogue(*), rooms(*)').eq('project_id', projectId),
      sb.from('item_gate').select('*').eq('project_id', projectId).order('seq'),
    ]);
    if (freshPlaced) setPlacedProducts(freshPlaced as unknown as PlacedRoomProduct[]);
    if (freshGate) setGate((freshGate as GateRow[]) ?? []);
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
        { data: gData, error: gErr },
      ] = await Promise.all([
        sb.from('floors').select('*').eq('project_id', projectId).order('sort'),
        sb.from('rooms').select('*').eq('project_id', projectId).order('sort'),
        sb.from('product_catalogue').select('*').eq('active', true).order('sort'),
        sb.from('product_steps').select('*').order('seq'),
        sb.from('room_products').select('*, product_catalogue(*), rooms(*)').eq('project_id', projectId),
        sb.from('item_gate').select('*').eq('project_id', projectId).order('seq'),
      ]);

      if (fErr) throw fErr;
      if (rErr) throw rErr;
      if (pErr) throw pErr;
      if (sErr) throw sErr;
      if (rpErr) throw rpErr;
      if (gErr) throw gErr;

      const loadedFloors: Floor[] = (fData as Floor[]) ?? [];
      const loadedRooms: Room[] = (rData as Room[]) ?? [];
      const loadedProducts: ProductItem[] = (pData as ProductItem[]) ?? [];
      const loadedSteps: ProductStep[] = (sData as ProductStep[]) ?? [];
      const loadedPlaced = (rpData as unknown as PlacedRoomProduct[]) ?? [];
      const loadedGate = (gData as GateRow[]) ?? [];

      setFloors(loadedFloors);
      setRooms(loadedRooms);
      setProducts(loadedProducts);
      setSteps(loadedSteps);
      setPlacedProducts(loadedPlaced);
      setGate(loadedGate);

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

  // Group gate rows by room_product_id
  const gateByRoomProduct = useMemo(() => {
    const map = new Map<string, GateRow[]>();
    gate.forEach((g) => {
      if (g.room_product_id) {
        const arr = map.get(g.room_product_id) ?? [];
        arr.push(g);
        map.set(g.room_product_id, arr);
      }
    });
    return map;
  }, [gate]);

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
  const handleAddProduct = async () => {
    if (!isProjectWide && !activeRoomId) return;
    if (!curProductId || !curLocation || curProductId === '--' || curLocation === '--') return;
    setSaving(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      const finalLocation = curLocation === '--' ? null : curLocation;

      const { data: newRpId, error: rpcErr } = await sb.rpc('add_room_product', {
        p_project: projectId,
        p_room: isProjectWide ? null : activeRoomId,
        p_product: curProductId,
        p_location: finalLocation,
        p_quantity: 1,
      });

      if (rpcErr) throw rpcErr;

      if (newRpId && (curMake || curModel || curOther)) {
        await sb.from('room_products').update({
          make: curMake && curMake !== '--' ? curMake : null,
          model: curModel && curModel !== '--' ? curModel : null,
          note: curOther.trim() || null,
        }).eq('id', newRpId);
      }

      // Reset to '--'
      setCurProductId('');
      setCurLocation('');
      setCurMake('');
      setCurModel('');
      setCurOther('');

      // Reload placed products and item_gate
      await refreshPlacedAndGate();

      showSuccessNotice('Product added');
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

      await refreshPlacedAndGate();

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

      // Reload placed and gate
      await refreshPlacedAndGate();

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
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-emerald-700 font-bold ml-2">
            ×
          </button>
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-danger/20 bg-danger/10 p-3 text-xs font-semibold text-danger flex items-center justify-between">
          <span>{error}</span>
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
            <span>Project-wide (Handover &amp; Client)</span>
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
          <div className="divide-y divide-border rounded-xl border border-border overflow-hidden bg-surface">
            {currentPlacedProducts.map((rp) => {
              const product = rp.product_catalogue;
              const rpGate = gateByRoomProduct.get(rp.id) ?? [];
              const pSteps = stepsByProduct.get(rp.product_id) ?? [];
              const displaySteps =
                rpGate.length > 0
                  ? rpGate
                  : pSteps.map((st) => ({
                      item_id: st.id,
                      label: st.label,
                      status: 'unchecked' as const,
                      locked: false,
                      sheet_colour: st.sheet_colour ?? 'D9EAD3',
                    }));
              const total = displaySteps.length;
              const done = displaySteps.filter((r) => isDone(r.status)).length;
              const progressPct = total > 0 ? Math.round((100 * done) / total) : 0;

              return (
                <div
                  key={rp.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5 px-3 text-[13px] bg-surface hover:bg-surface-alt/40 transition-colors sm:flex-nowrap sm:h-10"
                >
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 min-w-0 flex-1">
                    <span
                      className="font-semibold text-text-primary truncate min-w-[120px] max-w-[200px]"
                      title={product?.title ?? 'Product'}
                    >
                      {product?.title ?? 'Product'}
                    </span>
                    {rp.location && (
                      <span className="text-xs text-text-secondary truncate">
                        · {rp.location}
                      </span>
                    )}
                    <span className="text-xs tabular-nums text-text-secondary whitespace-nowrap">
                      · Qty: {rp.quantity}
                    </span>
                    {/* Step dots */}
                    <div
                      className="flex items-center gap-1 shrink-0"
                      title={`Steps: ${done}/${total} done`}
                    >
                      {displaySteps.map((st) => {
                        const col = stepColour(st.sheet_colour);
                        const finished = isDone(st.status);
                        const isPending = st.status === 'pending';
                        const isLocked = st.locked && !finished;
                        const tip = `${st.label}: ${isLocked ? 'locked' : finished ? 'done' : isPending ? 'pending' : 'open'}`;

                        return (
                          <span
                            key={st.item_id}
                            title={tip}
                            className={`h-2 w-2 rounded-full shrink-0 ${
                              isLocked
                                ? 'bg-slate-300 ring-1 ring-slate-400'
                                : finished
                                ? 'ring-1 ring-black/10'
                                : isPending
                                ? 'bg-white ring-2 ring-danger'
                                : 'bg-white ring-1 ring-slate-300'
                            }`}
                            style={{
                              backgroundColor: finished ? col.ring || col.bg : undefined,
                            }}
                          />
                        );
                      })}
                    </div>
                    <span className="text-xs font-semibold tabular-nums text-text-secondary whitespace-nowrap">
                      {progressPct}%
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleRemoveProduct(rp)}
                    className="h-7 shrink-0 text-xs font-medium text-text-muted hover:text-danger px-2.5 py-1 rounded-lg hover:bg-danger-light/30 transition-colors disabled:opacity-50"
                  >
                    Remove
                  </button>
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

        {/* Add Product Row (sheet tab "Pending Page" row 12) */}
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Add product to {currentRoom?.name ?? 'room'}
            </h4>
          </div>

          {/* Aligned CSS Grid: Product · Location · Make · Model · Other · [Add] */}
          <div className="grid grid-cols-1 sm:grid-cols-[1.2fr_1fr_1fr_1fr_1.2fr_auto] gap-2 items-center">
            {/* 1. Product dropdown */}
            <select
              aria-label="Product"
              value={curProductId}
              onChange={(e) => setCurProductId(e.target.value)}
              className="w-full rounded-lg border border-border px-2.5 py-2 text-xs bg-surface focus:border-accent"
            >
              <option value="">-- Product --</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>

            {/* 2. Location dropdown */}
            <select
              aria-label="Location"
              value={curLocation}
              onChange={(e) => setCurLocation(e.target.value)}
              className="w-full rounded-lg border border-border px-2.5 py-2 text-xs bg-surface focus:border-accent"
            >
              <option value="">-- Location --</option>
              {COMMON_LOCATIONS.map((loc) => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>

            {/* 3. Make dropdown */}
            <select
              aria-label="Make"
              value={curMake}
              onChange={(e) => setCurMake(e.target.value)}
              className="w-full rounded-lg border border-border px-2.5 py-2 text-xs bg-surface focus:border-accent"
            >
              <option value="">-- Make --</option>
              {COMMON_MAKES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>

            {/* 4. Model dropdown */}
            <select
              aria-label="Model"
              value={curModel}
              onChange={(e) => setCurModel(e.target.value)}
              className="w-full rounded-lg border border-border px-2.5 py-2 text-xs bg-surface focus:border-accent"
            >
              <option value="">-- Model --</option>
              {COMMON_MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>

            {/* 5. Other / Note text */}
            <input
              aria-label="Other / note"
              type="text"
              placeholder="Other / note"
              value={curOther}
              onChange={(e) => setCurOther(e.target.value)}
              className="w-full rounded-lg border border-border px-2.5 py-2 text-xs bg-surface focus:border-accent"
            />

            {/* 6. Add button */}
            <button
              type="button"
              disabled={saving || !curProductId || !curLocation || curProductId === '--' || curLocation === '--'}
              onClick={handleAddProduct}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              {saving ? 'Adding…' : 'Add'}
            </button>
          </div>
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
