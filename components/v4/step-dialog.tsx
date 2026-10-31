'use client';

// The popup behind every status checkbox on the v4 Dashboard. A step is either done (✓) or not done (✗).
// Not done asks WHY, using the reasons from sheet tab "HansalV2" when the sheet has them for this step, otherwise
// free text; the reason can point the step at the agency that is holding it up (done in set_item_status).

import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/client/supabase';
import { compressImageToWebP } from '@/lib/client/image';
import { todayIST } from '@/lib/client/date';
import { stepColour, type GateRow } from '@/lib/client/steps';
import { Glyph } from '@/components/glass-icon';

export interface AgencyOption { id: string; label: string; internal: boolean; typeName: string }
interface Reason { step_prefix: string; reason: string; agency_type: string | null; sort: number }
interface EventRow { id: string; status: string; status_date: string; note: string | null; reason: string | null; created_at: string }

let reasonsCache: Promise<Reason[]> | null = null;
const loadReasons = () =>
  (reasonsCache ??= (async () => {
    const { data } = await supabaseBrowser().from('step_reasons').select('step_prefix, reason, agency_type, sort').order('sort');
    return (data ?? []) as Reason[];
  })());

export function StepDialog({
  row,
  context,
  agencies,
  onClose,
  onSaved,
}: {
  row: GateRow;
  context: string; // "Living Room · Ground Floor"
  agencies: AgencyOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const done = row.status === 'complete' || row.status === 'na';
  const [mode, setMode] = useState<'done' | 'stuck'>(done ? 'stuck' : row.status === 'pending' ? 'stuck' : 'done');
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [reason, setReason] = useState<string>(row.stuck_reason ?? '');
  const [otherReason, setOtherReason] = useState('');
  const [date, setDate] = useState(todayIST());
  const [note, setNote] = useState(row.note ?? '');
  const [agencyId, setAgencyId] = useState(row.agency_id ?? '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);

  useEffect(() => {
    loadReasons().then(setReasons);
    supabaseBrowser()
      .from('item_events')
      .select('id, status, status_date, note, reason, created_at')
      .eq('item_id', row.item_id)
      .order('created_at', { ascending: false })
      .limit(8)
      .then(({ data }: { data: unknown }) => setEvents((data ?? []) as EventRow[]));
  }, [row.item_id]);

  const options = useMemo(
    () => reasons.filter((r) => row.label.toLowerCase().startsWith(r.step_prefix.toLowerCase())),
    [reasons, row.label]
  );
  useEffect(() => {
    // A stored reason that is not in the list goes to "Other".
    if (row.stuck_reason && options.length && !options.some((o) => o.reason === row.stuck_reason)) {
      setReason('__other');
      setOtherReason(row.stuck_reason);
    }
  }, [options, row.stuck_reason]);

  const agencyChoices = agencies.filter((a) => (row.responsibility === 'internal' ? a.internal : !a.internal) || a.id === row.agency_id);
  const colour = stepColour(row.sheet_colour);
  const finalReason = reason === '__other' || options.length === 0 ? otherReason.trim() : reason;

  async function save(status: 'complete' | 'pending' | 'na') {
    setError(null);
    if (status === 'pending' && !finalReason) {
      setError('Pick or type why this step is not done yet.');
      return;
    }
    setSaving(true);
    try {
      const sb = supabaseBrowser();
      let photoPath: string | null = null;
      if (photo) {
        const blob = await compressImageToWebP(photo);
        photoPath = `${row.project_id}/${row.item_id}/${Date.now()}.webp`;
        const up = await sb.storage.from('evidence').upload(photoPath, blob, { contentType: 'image/webp' });
        if (up.error) throw up.error;
      }
      if (agencyId && agencyId !== row.agency_id) {
        const { error: aErr } = await sb.from('dependency_items').update({ agency_id: agencyId }).eq('id', row.item_id);
        if (aErr) throw aErr;
      }
      const { error: sErr } = await sb.rpc('set_item_status', {
        p_item: row.item_id,
        p_status: status,
        p_date: date || null,
        p_note: note.trim() || null,
        p_photo: photoPath,
        p_reason: status === 'pending' ? finalReason : null,
      });
      if (sErr) throw new Error(sErr.message.startsWith('locked') ? 'This step opens after the earlier steps of this product are done.' : sErr.message);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:px-4" onClick={() => !saving && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="step-dialog-title"
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-text-secondary truncate">{row.title}{row.location ? ` · ${row.location}` : ''} · {context}</p>
            <h2 id="step-dialog-title" className="mt-1 flex items-center gap-2 text-lg font-semibold">
              <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: colour.bg, boxShadow: `0 0 0 1px ${colour.ring}` }} />
              {row.label}
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">{colour.legend}{row.status === 'complete' && row.completed_on ? ` · done on ${row.completed_on}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-alt">
            <Glyph name="cross" />
          </button>
        </div>

        {/* ✓ / ✗ */}
        <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Status">
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'done'}
            onClick={() => setMode('done')}
            className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
              mode === 'done' ? 'border-success bg-success-light text-success ring-2 ring-success/30' : 'border-border text-text-secondary hover:bg-surface-alt'
            }`}
          >
            <Glyph name="check" /> Done
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'stuck'}
            onClick={() => setMode('stuck')}
            className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
              mode === 'stuck' ? 'border-danger bg-danger-light text-danger ring-2 ring-danger/30' : 'border-border text-text-secondary hover:bg-surface-alt'
            }`}
          >
            <Glyph name="cross" /> Not done
          </button>
        </div>

        {mode === 'stuck' && (
          <fieldset className="mt-4">
            <legend className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Why is it stuck?</legend>
            {options.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {options.map((o) => (
                  <label key={o.reason} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${reason === o.reason ? 'border-accent bg-accent/5' : 'border-border'}`}>
                    <input type="radio" name="reason" className="mt-0.5" checked={reason === o.reason} onChange={() => setReason(o.reason)} />
                    <span>
                      {o.reason}
                      {o.agency_type && <span className="block text-xs text-text-muted">Waiting on: {o.agency_type}</span>}
                    </span>
                  </label>
                ))}
                <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${reason === '__other' ? 'border-accent bg-accent/5' : 'border-border'}`}>
                  <input type="radio" name="reason" checked={reason === '__other'} onChange={() => setReason('__other')} />
                  Other reason
                </label>
              </div>
            )}
            {(options.length === 0 || reason === '__other') && (
              <input
                aria-label="Reason"
                value={otherReason}
                onChange={(e) => setOtherReason(e.target.value)}
                placeholder="e.g. False ceiling not closed yet"
                className="mt-2 block w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            )}
          </fieldset>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold uppercase tracking-wider text-text-secondary">
            {mode === 'done' ? 'Done on' : 'Noticed on'}
            <input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm font-normal normal-case tracking-normal" />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Waiting on
            <select value={agencyId} onChange={(e) => setAgencyId(e.target.value)} className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm font-normal normal-case tracking-normal">
              <option value="">Not assigned</option>
              {agencyChoices.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 block text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Note (optional)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm font-normal normal-case tracking-normal" />
        </label>
        <label className="mt-3 block text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Photo (optional)
          <input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm font-normal normal-case tracking-normal" />
        </label>

        {error && <div role="alert" className="mt-3 rounded-lg bg-danger-light px-3 py-2 text-sm text-danger">{error}</div>}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => save(mode === 'done' ? 'complete' : 'pending')}
            className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : mode === 'done' ? 'Save as done' : 'Save as not done'}
          </button>
          <button type="button" disabled={saving} onClick={() => save('na')} className="rounded-lg border border-border px-3 py-2.5 text-sm text-text-secondary hover:bg-surface-alt disabled:opacity-50">
            Not applicable
          </button>
        </div>

        {events.length > 0 && (
          <div className="mt-5 border-t border-border pt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">History</p>
            <ul className="mt-2 space-y-1.5 text-xs text-text-secondary">
              {events.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="w-20 shrink-0 tabular-nums">{e.status_date}</span>
                  <span>
                    <span className={e.status === 'complete' ? 'font-semibold text-success' : e.status === 'pending' ? 'font-semibold text-danger' : 'font-semibold'}>
                      {e.status === 'complete' ? '✓ Done' : e.status === 'pending' ? '✗ Not done' : 'N.A.'}
                    </span>
                    {e.reason ? ` · ${e.reason}` : ''}{e.note ? ` · ${e.note}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
