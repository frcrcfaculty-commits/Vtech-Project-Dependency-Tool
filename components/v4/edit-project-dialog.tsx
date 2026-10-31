'use client';

// Edit project details (v4 item 10). Every save records what changed, why, and who asked for it
// (table project_changes, append-only). Covers the project fields and each BOQ line (location, quantity,
// brand, make, model) — removing a line is also a logged change.

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
  l2_after: number;
  l3_after: number;
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
interface ChangeRow { id: string; requested_by: string; reason: string; changes: { what: string; from: string; to: string }[]; created_at: string; profiles: { full_name: string } | null }

const STATUS_LABEL: Record<string, string> = { active: 'Active', on_hold: 'On hold', finished: 'Finished', closed: 'Closed' };
const s = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

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
  const [requestedBy, setRequestedBy] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEscape(onClose, saving);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<ChangeRow[]>([]);

  useEffect(() => {
    supabaseBrowser()
      .from('project_changes')
      .select('id, requested_by, reason, changes, created_at, profiles(full_name)')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .then(({ data }: { data: unknown }) => setLog((data ?? []) as unknown as ChangeRow[]));
  }, [project.id]);

  const changes = useMemo(() => {
    const out: { what: string; from: string; to: string }[] = [];
    const fields: [keyof EditableProject, string][] = [
      ['name', 'Project name'], ['client_name', 'Client name'], ['site_address', 'Site address'], ['status', 'Status'],
      ['l2_after', 'Escalate to level 2 after (reminders)'], ['l3_after', 'Escalate to level 3 after (reminders)'],
    ];
    for (const [k, label] of fields) {
      const a = k === 'status' ? STATUS_LABEL[String(project[k])] : s(project[k]);
      const b = k === 'status' ? STATUS_LABEL[String(p[k])] : s(p[k]);
      if (a !== b) out.push({ what: label, from: a, to: b });
    }
    for (const l of ls) {
      const o = lines.find((x) => x.id === l.id)!;
      const name = `${o.title} · ${o.room}`;
      if (l.remove) { out.push({ what: `${name}: line`, from: `qty ${o.quantity}`, to: 'removed' }); continue; }
      for (const [k, label] of [['location', 'location'], ['quantity', 'quantity'], ['brand', 'brand'], ['make', 'make'], ['model', 'model']] as const) {
        if (s(o[k]) !== s(l[k])) out.push({ what: `${name}: ${label}`, from: s(o[k]), to: s(l[k]) });
      }
    }
    return out;
  }, [p, ls, project, lines]);

  async function save() {
    setError(null);
    if (!changes.length) { setError('Nothing has changed.'); return; }
    if (!reason.trim() || !requestedBy.trim()) { setError('Say why the change is needed and who requested it.'); return; }
    if (!p.name.trim()) { setError('The project needs a name.'); return; }
    setSaving(true);
    try {
      const sb = supabaseBrowser();
      const { error: pErr } = await sb.from('projects').update({
        name: p.name.trim(), client_name: p.client_name?.trim() || null, site_address: p.site_address?.trim() || null,
        status: p.status, l2_after: Number(p.l2_after), l3_after: Number(p.l3_after),
      }).eq('id', p.id);
      if (pErr) throw pErr;
      for (const l of ls) {
        const o = lines.find((x) => x.id === l.id)!;
        if (l.remove) {
          const { error: rErr } = await sb.rpc('remove_room_product', { p_room_product: l.id });
          if (rErr) throw rErr;
          continue;
        }
        if (s(o.location) !== s(l.location) || o.quantity !== l.quantity || s(o.brand) !== s(l.brand) || s(o.make) !== s(l.make) || s(o.model) !== s(l.model)) {
          const { error: lErr } = await sb.from('room_products').update({
            location: l.location?.trim() || null, quantity: Math.max(1, Number(l.quantity) || 1),
            brand: l.brand?.trim() || null, make: l.make?.trim() || null, model: l.model?.trim() || null,
            ...(s(o.location) !== s(l.location) ? { location_validated_at: null, location_validated_by: null } : {}),
          }).eq('id', l.id);
          if (lErr) throw lErr;
        }
      }
      const { data: u } = await sb.auth.getUser();
      const { error: cErr } = await sb.from('project_changes').insert({
        project_id: p.id, changed_by: u.user?.id, requested_by: requestedBy.trim(), reason: reason.trim(), changes,
      });
      if (cErr) throw cErr;
      onSaved(`${changes.length} change${changes.length === 1 ? '' : 's'} saved and logged.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const input = 'mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm font-normal normal-case tracking-normal';
  const label = 'block text-xs font-semibold uppercase tracking-wider text-text-secondary';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:px-4" onClick={() => !saving && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="edit-project-title" className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h2 id="edit-project-title" className="text-lg font-semibold">Edit project details</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-alt"><Glyph name="cross" /></button>
        </div>
        <div className="mt-3 flex gap-1 border-b border-border text-sm">
          {(['edit', 'log'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-2 font-medium ${tab === t ? 'border-accent text-accent' : 'border-transparent text-text-secondary'}`}>
              {t === 'edit' ? 'Edit' : `Change log (${log.length})`}
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
                </p>
                <p className="mt-1"><span className="text-text-secondary">Why:</span> {c.reason}</p>
                <ul className="mt-1.5 space-y-0.5 text-xs text-text-secondary">
                  {c.changes.map((x, i) => <li key={i}>{x.what}: <s>{x.from}</s> → <span className="text-text-primary">{x.to}</span></li>)}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={label}>Project name<input className={input} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></label>
              <label className={label}>Client name<input className={input} value={p.client_name ?? ''} onChange={(e) => setP({ ...p, client_name: e.target.value })} /></label>
              <label className={`${label} sm:col-span-2`}>Site address<input className={input} value={p.site_address ?? ''} onChange={(e) => setP({ ...p, site_address: e.target.value })} /></label>
              <label className={label}>Status
                <select className={input} value={p.status} onChange={(e) => setP({ ...p, status: e.target.value })}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className={label}>L2 after<input type="number" min={1} className={input} value={p.l2_after} onChange={(e) => setP({ ...p, l2_after: Number(e.target.value) })} /></label>
                <label className={label}>L3 after<input type="number" min={1} className={input} value={p.l3_after} onChange={(e) => setP({ ...p, l3_after: Number(e.target.value) })} /></label>
              </div>
            </div>

            <h3 className="mt-5 text-sm font-semibold">BOQ lines</h3>
            <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="sticky top-0 bg-surface text-left text-xs uppercase tracking-wider text-text-secondary">
                  <tr><th className="px-3 py-2">Product · Room</th><th className="px-2 py-2">Location</th><th className="px-2 py-2 w-16">Qty</th><th className="px-2 py-2">Brand</th><th className="px-2 py-2">Make</th><th className="px-2 py-2">Model</th><th className="px-2 py-2" /></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ls.map((l, i) => {
                    const set = (patch: Partial<typeof l>) => setLs(ls.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                    const cell = 'w-full rounded-md border border-border px-2 py-1 text-sm';
                    return (
                      <tr key={l.id} className={l.remove ? 'opacity-40 line-through' : ''}>
                        <td className="px-3 py-1.5"><span className="font-medium">{l.title}</span><span className="block text-xs text-text-muted">{l.room}</span></td>
                        <td className="px-2 py-1.5"><input aria-label={`${l.title} location`} className={cell} value={l.location ?? ''} onChange={(e) => set({ location: e.target.value })} /></td>
                        <td className="px-2 py-1.5"><input aria-label={`${l.title} quantity`} type="number" min={1} className={cell} value={l.quantity} onChange={(e) => set({ quantity: Number(e.target.value) })} /></td>
                        <td className="px-2 py-1.5"><input aria-label={`${l.title} brand`} className={cell} value={l.brand ?? ''} onChange={(e) => set({ brand: e.target.value })} /></td>
                        <td className="px-2 py-1.5"><input aria-label={`${l.title} make`} className={cell} value={l.make ?? ''} onChange={(e) => set({ make: e.target.value })} /></td>
                        <td className="px-2 py-1.5"><input aria-label={`${l.title} model`} className={cell} value={l.model ?? ''} onChange={(e) => set({ model: e.target.value })} /></td>
                        <td className="px-2 py-1.5 text-right">
                          <button type="button" onClick={() => set({ remove: !l.remove })} className="text-xs font-medium text-danger hover:underline">{l.remove ? 'Keep' : 'Remove'}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-5 rounded-xl border border-accent/30 bg-accent/5 p-4">
              <p className="text-sm font-semibold">Log this change</p>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className={label}>Requested by<input className={input} value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} placeholder="e.g. Client – Mr Shah" /></label>
                <label className={label}>Why is the change needed?<input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Keypad moved to the bedside after site visit" /></label>
              </div>
              {changes.length > 0 && (
                <ul className="mt-3 space-y-0.5 text-xs text-text-secondary">
                  {changes.map((x, i) => <li key={i}>{x.what}: <s>{x.from}</s> → <span className="text-text-primary">{x.to}</span></li>)}
                </ul>
              )}
            </div>

            {error && <div role="alert" className="mt-3 rounded-lg bg-danger-light px-3 py-2 text-sm text-danger">{error}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-border px-4 py-2.5 text-sm">Cancel</button>
              <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {saving ? 'Saving…' : `Save ${changes.length || ''} change${changes.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
