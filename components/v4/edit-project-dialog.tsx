'use client';

// Edit project details & BOQ (v7). Every save records who requested it, when, a reference (email / call / meeting / other)
// and a reason of >= 10 words. Adds and removes products via edit_boq RPC.

import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/client/supabase';
import { Glyph } from '@/components/glass-icon';
import { useEscape } from '@/lib/client/use-escape';

export interface EditableProject {
  id: string;
  name: string;
  client_name: string | null;
  site_address: string | null;
  status: string;
}
export interface EditableLine {
  id: string;
  title: string;
  room: string;
  location: string | null;
  quantity: number;
  brand: string | null;
  make: string | null;
  model: string | null;
}
interface ChangeRow {
  id: string;
  requested_by: string;
  requested_at?: string;
  reason: string;
  reference_type?: string | null;
  reference?: string | null;
  kind?: string;
  changes: { what: string; from: string; to: string }[] | { added?: number; removed?: number } | any;
  created_at: string;
  profiles: { full_name: string } | null;
}

interface RoomOption {
  id: string;
  name: string;
  floorLabel?: string;
}

interface CatalogueProduct {
  id: string;
  title: string;
  scope?: string;
}

interface NewProductRow {
  tempId: string;
  room_id: string;
  product_id: string;
  product_title?: string;
  location: string;
  make?: string;
  model?: string;
  note?: string;
  quantity: number;
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

const STATUS_LABEL: Record<string, string> = { active: 'Active', on_hold: 'On hold', finished: 'Finished', closed: 'Closed' };
const REFERENCE_TYPES = [
  { value: 'email', label: 'Email' },
  { value: 'call', label: 'Call' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'other', label: 'Other' },
] as const;

const s = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

function getLocalDatetimeString() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function EditProjectDialog({
  project,
  lines,
  onClose,
  onSaved,
}: {
  project: EditableProject;
  lines: EditableLine[];
  onClose: () => void;
  onSaved: (summary: string) => void;
}) {
  const [tab, setTab] = useState<'edit' | 'log'>('edit');
  const [p, setP] = useState(project);
  const [ls, setLs] = useState(lines.map((l) => ({ ...l, remove: false })));
  const [newProducts, setNewProducts] = useState<NewProductRow[]>([]);

  // Room & catalogue options
  const [roomOptions, setRoomOptions] = useState<RoomOption[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueProduct[]>([]);

  // Change request block
  const [requestedBy, setRequestedBy] = useState('');
  const [requestedAt, setRequestedAt] = useState(getLocalDatetimeString);
  const [referenceType, setReferenceType] = useState<'email' | 'call' | 'meeting' | 'other'>('email');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');

  const [saving, setSaving] = useState(false);
  useEscape(onClose, saving);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<ChangeRow[]>([]);

  useEffect(() => {
    const sb = supabaseBrowser();
    // Load change log
    sb.from('project_changes')
      .select('id, requested_by, requested_at, reason, reference_type, reference, kind, changes, created_at, profiles(full_name)')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .then(({ data }: { data: any }) => setLog((data ?? []) as unknown as ChangeRow[]));

    // Load rooms
    sb.from('rooms')
      .select('id, name, floors(label)')
      .eq('project_id', project.id)
      .order('sort')
      .then(({ data }: { data: any }) => {
        if (data) {
          const rms = data.map((r: any) => ({
            id: r.id,
            name: r.name,
            floorLabel: r.floors?.label,
          }));
          setRoomOptions(rms);
        }
      });

    // Load catalogue
    sb.from('product_catalogue')
      .select('id, title, scope')
      .order('title')
      .then(({ data }: { data: any }) => {
        if (data) setCatalogue(data as CatalogueProduct[]);
      });
  }, [project.id]);

  // Add product row state (starts as '--' / empty)
  const [curRoomId, setCurRoomId] = useState('');
  const [curProductId, setCurProductId] = useState('');
  const [curLocation, setCurLocation] = useState('');
  const [curMake, setCurMake] = useState('');
  const [curModel, setCurModel] = useState('');
  const [curOther, setCurOther] = useState('');

  // Live word counter
  const wordCount = useMemo(() => {
    const words = reason.trim().split(/\s+/).filter(Boolean);
    return words.length;
  }, [reason]);

  const hasEnoughWords = wordCount >= 10;

  // Add product handler: 1 item per click, no counter, disabled until product and location chosen
  const handleAddProduct = () => {
    if (!curProductId || !curLocation || curProductId === '--' || curLocation === '--') return;
    const targetRoomId = curRoomId || roomOptions[0]?.id || '';
    const prod = catalogue.find((c) => c.id === curProductId);
    setNewProducts((prev) => [
      ...prev,
      {
        tempId: crypto.randomUUID(),
        room_id: targetRoomId,
        product_id: curProductId,
        product_title: prod?.title || 'Product',
        location: curLocation === '--' ? '' : curLocation,
        make: curMake === '--' ? '' : curMake,
        model: curModel === '--' ? '' : curModel,
        note: curOther.trim() || undefined,
        quantity: 1,
      },
    ]);
    // Reset to '--'
    setCurProductId('');
    setCurLocation('');
    setCurMake('');
    setCurModel('');
    setCurOther('');
  };

  const removeNewProductRow = (tempId: string) => {
    setNewProducts((prev) => prev.filter((p) => p.tempId !== tempId));
  };

  const projectChanges = useMemo(() => {
    const out: { what: string; from: string; to: string }[] = [];
    const fields: [keyof EditableProject, string][] = [
      ['name', 'Project name'], ['client_name', 'Client name'], ['site_address', 'Site address'], ['status', 'Status'],
    ];
    for (const [k, label] of fields) {
      const a = k === 'status' ? STATUS_LABEL[String(project[k])] : s(project[k]);
      const b = k === 'status' ? STATUS_LABEL[String(p[k])] : s(p[k]);
      if (a !== b) out.push({ what: label, from: a, to: b });
    }
    for (const l of ls) {
      const o = lines.find((x) => x.id === l.id);
      if (!o) continue;
      const name = `${o.title} · ${o.room}`;
      if (l.remove) continue;
      for (const [k, label] of [['location', 'location'], ['quantity', 'quantity'], ['brand', 'brand'], ['make', 'make'], ['model', 'model']] as const) {
        if (s(o[k]) !== s(l[k])) out.push({ what: `${name}: ${label}`, from: s(o[k]), to: s(l[k]) });
      }
    }
    return out;
  }, [p, ls, project, lines]);

  const removedProductIds = useMemo(() => ls.filter((l) => l.remove).map((l) => l.id), [ls]);

  const hasAnyChanges =
    projectChanges.length > 0 ||
    removedProductIds.length > 0 ||
    newProducts.length > 0;

  const canSave =
    hasAnyChanges &&
    requestedBy.trim().length > 0 &&
    reference.trim().length > 0 &&
    referenceType.length > 0 &&
    hasEnoughWords &&
    !saving;

  async function save() {
    setError(null);
    if (!hasAnyChanges) {
      setError('Nothing has changed.');
      return;
    }
    if (!requestedBy.trim()) {
      setError('Requested by is required.');
      return;
    }
    if (!reference.trim()) {
      setError('Reference is required.');
      return;
    }
    if (wordCount < 10) {
      setError('Reason must be at least 10 words.');
      return;
    }
    if (!p.name.trim()) {
      setError('The project needs a name.');
      return;
    }

    setSaving(true);
    try {
      const sb = supabaseBrowser();
      const reqAtIso = requestedAt ? new Date(requestedAt).toISOString() : new Date().toISOString();

      // 1. BOQ Add / Remove via edit_boq RPC
      const hasBoqAddRemove = removedProductIds.length > 0 || newProducts.length > 0;
      if (hasBoqAddRemove) {
        const pAdd = newProducts.map((np) => ({
          room_id: np.room_id || null,
          product_id: np.product_id,
          location: np.location.trim() || null,
          quantity: Math.max(1, Number(np.quantity) || 1),
        }));

        const { error: rpcErr } = await sb.rpc('edit_boq', {
          p_project: p.id,
          p_add: pAdd,
          p_remove: removedProductIds,
          p_requested_by: requestedBy.trim(),
          p_requested_at: reqAtIso,
          p_reason: reason.trim(),
          p_reference_type: referenceType,
          p_reference: reference.trim(),
        });
        if (rpcErr) throw rpcErr;

        // Update make, model, note for newly added products
        for (const np of newProducts) {
          if (np.make || np.model || np.note) {
            await sb
              .from('room_products')
              .update({
                make: np.make || null,
                model: np.model || null,
                note: np.note || null,
              })
              .eq('project_id', p.id)
              .eq('product_id', np.product_id)
              .eq('room_id', np.room_id || null)
              .order('created_at', { ascending: false })
              .limit(1);
          }
        }
      }

      // 2. Project details update
      const projectMetaChanged =
        p.name.trim() !== project.name ||
        (p.client_name?.trim() || null) !== (project.client_name || null) ||
        (p.site_address?.trim() || null) !== (project.site_address || null) ||
        p.status !== project.status;

      if (projectMetaChanged) {
        const { error: pErr } = await sb.from('projects').update({
          name: p.name.trim(),
          client_name: p.client_name?.trim() || null,
          site_address: p.site_address?.trim() || null,
          status: p.status,
        }).eq('id', p.id);
        if (pErr) throw pErr;
      }

      // 3. Update existing line fields (location, quantity, brand, etc.)
      for (const l of ls) {
        if (l.remove) continue;
        const o = lines.find((x) => x.id === l.id);
        if (!o) continue;
        if (s(o.location) !== s(l.location) || o.quantity !== l.quantity || s(o.brand) !== s(l.brand) || s(o.make) !== s(l.make) || s(o.model) !== s(l.model)) {
          const { error: lErr } = await sb.from('room_products').update({
            location: l.location?.trim() || null,
            quantity: Math.max(1, Number(l.quantity) || 1),
            brand: l.brand?.trim() || null,
            make: l.make?.trim() || null,
            model: l.model?.trim() || null,
            ...(s(o.location) !== s(l.location) ? { location_validated_at: null, location_validated_by: null } : {}),
          }).eq('id', l.id);
          if (lErr) throw lErr;
        }
      }

      // 4. If project details or existing line edits changed without edit_boq RPC, log to project_changes
      if (!hasBoqAddRemove && projectChanges.length > 0) {
        const { data: u } = await sb.auth.getUser();
        const { error: cErr } = await sb.from('project_changes').insert({
          project_id: p.id,
          changed_by: u.user?.id,
          requested_by: requestedBy.trim(),
          requested_at: reqAtIso,
          reason: reason.trim(),
          reference_type: referenceType,
          reference: reference.trim(),
          kind: 'project',
          changes: projectChanges,
        });
        if (cErr) throw cErr;
      }

      onSaved('Project and BOQ changes saved successfully.');
    } catch (e: any) {
      setError(e?.message || (typeof e === 'string' ? e : 'Could not save changes'));
    } finally {
      setSaving(false);
    }
  }

  const input = 'mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm font-normal normal-case tracking-normal bg-surface';
  const label = 'block text-xs font-semibold uppercase tracking-wider text-text-secondary';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:px-4" onClick={() => !saving && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-project-title"
        className="max-h-[92dvh] w-full max-w-4xl overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="edit-project-title" className="text-lg font-semibold">Edit project &amp; BOQ details</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-alt">
            <Glyph name="cross" />
          </button>
        </div>
        <div className="mt-3 flex gap-1 border-b border-border text-sm">
          {(['edit', 'log'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-3 py-2 font-medium ${
                tab === t ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {t === 'edit' ? 'Edit details & products' : `Change log (${log.length})`}
            </button>
          ))}
        </div>

        {tab === 'log' ? (
          <ul className="mt-4 space-y-3">
            {log.length === 0 && <li className="text-sm text-text-secondary">No changes logged yet.</li>}
            {log.map((c) => (
              <li key={c.id} className="rounded-xl border border-border p-3 text-sm">
                <p className="text-xs text-text-secondary">
                  {new Date(c.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} ·
                  changed by {c.profiles?.full_name ?? 'unknown'} · requested by <strong className="text-text-primary">{c.requested_by}</strong>
                  {c.reference_type && (
                    <span className="ml-1.5 rounded bg-surface-alt px-1.5 py-0.5 text-[10px] font-semibold uppercase text-text-secondary">
                      {c.reference_type}
                    </span>
                  )}
                </p>
                {c.reference && (
                  <p className="mt-1 text-xs text-text-muted italic">Ref: {c.reference}</p>
                )}
                <p className="mt-1"><span className="text-text-secondary">Why:</span> {c.reason}</p>
                {Array.isArray(c.changes) && (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-text-secondary">
                    {c.changes.map((x: any, i: number) => (
                      <li key={i}>{x.what}: <s>{x.from}</s> → <span className="text-text-primary">{x.to}</span></li>
                    ))}
                  </ul>
                )}
                {typeof c.changes === 'object' && !Array.isArray(c.changes) && c.changes && (
                  <p className="mt-1 text-xs text-text-muted">
                    Products: +{c.changes.added ?? 0} added, -{c.changes.removed ?? 0} removed
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <>
            {/* Project Details */}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={label}>Project name<input className={input} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></label>
              <label className={label}>Client name<input className={input} value={p.client_name ?? ''} onChange={(e) => setP({ ...p, client_name: e.target.value })} /></label>
              <label className={`${label} sm:col-span-2`}>Site address<input className={input} value={p.site_address ?? ''} onChange={(e) => setP({ ...p, site_address: e.target.value })} /></label>
              <label className={label}>Status
                <select className={input} value={p.status} onChange={(e) => setP({ ...p, status: e.target.value })}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            </div>

            {/* Current Products */}
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-text-primary">Current products ({ls.length})</h3>
              <p className="text-xs text-text-secondary">Room · Product · Location · Qty</p>
            </div>

            <div className="mt-2 max-h-60 overflow-auto rounded-xl border border-border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="sticky top-0 bg-surface-alt/90 backdrop-blur-xs text-left text-xs uppercase tracking-wider text-text-secondary">
                  <tr>
                    <th className="px-3 py-2">Room</th>
                    <th className="px-2 py-2">Product</th>
                    <th className="px-2 py-2">Location</th>
                    <th className="px-2 py-2 w-16 text-center">Qty</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ls.map((l, i) => {
                    const set = (patch: Partial<typeof l>) => setLs(ls.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                    const cell = 'w-full rounded-md border border-border px-2 py-1 text-xs bg-surface';
                    return (
                      <tr key={l.id} className={l.remove ? 'opacity-40 line-through bg-danger/5' : 'hover:bg-surface-alt/30'}>
                        <td className="px-3 py-1.5 font-medium text-xs text-text-secondary whitespace-nowrap">{l.room}</td>
                        <td className="px-2 py-1.5 font-medium text-text-primary">{l.title}</td>
                        <td className="px-2 py-1.5">
                          <input
                            aria-label={`${l.title} location`}
                            className={cell}
                            value={l.location ?? ''}
                            onChange={(e) => set({ location: e.target.value })}
                            disabled={l.remove}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <input
                            aria-label={`${l.title} quantity`}
                            type="number"
                            min={1}
                            className={`${cell} text-center w-16`}
                            value={l.quantity}
                            onChange={(e) => set({ quantity: Number(e.target.value) })}
                            disabled={l.remove}
                          />
                        </td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => set({ remove: !l.remove })}
                            className={`rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
                              l.remove
                                ? 'bg-surface-alt text-text-primary hover:bg-surface-alt/80'
                                : 'text-danger hover:bg-danger-light'
                            }`}
                          >
                            {l.remove ? 'Undo remove' : 'Remove'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Add product aligned row (sheet tab "Pending Page" row 12) */}
            <div className="mt-4 rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-text-primary">
                  Add product
                </h4>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-text-secondary">Room:</span>
                  <select
                    value={curRoomId}
                    onChange={(e) => setCurRoomId(e.target.value)}
                    className="rounded-lg border border-border px-2.5 py-1 text-xs bg-surface"
                  >
                    {roomOptions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.floorLabel ? `${r.floorLabel} · ` : ''}{r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Aligned Row: Product · Location · Make · Model · Other · [Add] */}
              <div className="grid grid-cols-1 sm:grid-cols-[1.2fr_1fr_1fr_1fr_1.2fr_auto] gap-2 items-center">
                {/* 1. Product dropdown */}
                <select
                  aria-label="Product"
                  value={curProductId}
                  onChange={(e) => setCurProductId(e.target.value)}
                  className="w-full rounded-lg border border-border px-2.5 py-2 text-xs bg-surface focus:border-accent"
                >
                  <option value="">-- Product --</option>
                  {catalogue.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
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
                  disabled={!curProductId || !curLocation || curProductId === '--' || curLocation === '--'}
                  onClick={handleAddProduct}
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Added products rows */}
            {newProducts.length > 0 && (
              <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-3.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-accent mb-2">
                  New products to add ({newProducts.length})
                </h4>
                <div className="space-y-2">
                  {newProducts.map((np) => {
                    const roomName = roomOptions.find((r) => r.id === np.room_id)?.name ?? 'Room';
                    const specStr = [np.make, np.model, np.note].filter(Boolean).join(' · ');
                    return (
                      <div
                        key={np.tempId}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-text-primary">
                            {np.product_title}
                            <span className="ml-1.5 font-normal text-text-muted">
                              ({roomName}{np.location ? ` · ${np.location}` : ''})
                            </span>
                          </p>
                          {specStr && <p className="text-[11px] text-text-muted mt-0.5">{specStr}</p>}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeNewProductRow(np.tempId)}
                          aria-label="Remove new product"
                          className="rounded p-1 text-danger hover:bg-danger-light transition-colors"
                        >
                          <Glyph name="cross" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Mandatory Change-Request Block */}
            <div className="mt-5 rounded-xl border border-accent/40 bg-accent/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-accent/20 pb-2">
                <h3 className="text-sm font-bold text-text-primary">Change request (required to save)</h3>
                <span className="text-xs text-text-muted">Database logs this with reason and reference</span>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className={label}>
                  Requested by *
                  <input
                    className={input}
                    value={requestedBy}
                    onChange={(e) => setRequestedBy(e.target.value)}
                    placeholder="e.g. Client – Mr Shah, PMC – Rahul"
                    required
                  />
                </label>
                <label className={label}>
                  Date &amp; time requested *
                  <input
                    type="datetime-local"
                    className={input}
                    value={requestedAt}
                    onChange={(e) => setRequestedAt(e.target.value)}
                    required
                  />
                </label>
                <label className={label}>
                  Reference type *
                  <select
                    className={input}
                    value={referenceType}
                    onChange={(e) => setReferenceType(e.target.value as any)}
                    required
                  >
                    {REFERENCE_TYPES.map((rt) => (
                      <option key={rt.value} value={rt.value}>
                        {rt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={label}>
                  Reference (paste email or write note) *
                  <textarea
                    rows={2}
                    className={input}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="e.g. Paste email body or 'Call with Mr Shah at 11am confirmed changes'"
                    required
                  />
                </label>
                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between">
                    <label className={label}>Reason (minimum 10 words) *</label>
                    <span className={`text-xs font-bold tabular-nums ${hasEnoughWords ? 'text-success' : 'text-danger'}`}>
                      {wordCount} / 10 words {wordCount < 10 && `(${10 - wordCount} more required)`}
                    </span>
                  </div>
                  <textarea
                    rows={2}
                    className={`${input} ${!hasEnoughWords && reason.length > 0 ? 'border-danger/50 focus:border-danger' : ''}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Detailed explanation of why this project / BOQ change was requested..."
                    required
                  />
                </div>
              </div>

              {/* Summary of pending changes */}
              <div className="mt-3 text-xs text-text-secondary border-t border-accent/15 pt-2">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>Changes: {projectChanges.length} metadata</span>
                  <span>Removed products: {removedProductIds.length}</span>
                  <span>New products: {newProducts.length}</span>
                </div>
              </div>
            </div>

            {error && <div role="alert" className="mt-3 rounded-lg bg-danger-light px-3 py-2 text-sm text-danger">{error}</div>}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-text-muted">
                {!canSave && (
                  wordCount < 10
                    ? 'Save disabled: reason must have at least 10 words'
                    : !requestedBy.trim()
                    ? 'Save disabled: enter who requested the change'
                    : !reference.trim()
                    ? 'Save disabled: enter reference'
                    : !hasAnyChanges
                    ? 'No changes made'
                    : ''
                )}
              </p>
              <div className="flex gap-2 ml-auto">
                <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-border px-4 py-2 text-sm">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={!canSave}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-hover transition-colors"
                >
                  {saving ? 'Saving changes…' : 'Save changes'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
