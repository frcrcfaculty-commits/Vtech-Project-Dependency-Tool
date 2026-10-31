'use client';

// For a BOQ product that is not in the Hansal catalogue (v4 item 11): the PM adds its dependencies by hand.
// Steps marked "Before installation" behave like the sheet's green steps (open together); the rest open one at a time.

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/client/supabase';
import { Glyph } from '@/components/glass-icon';
import type { AgencyOption } from './step-dialog';

interface Draft { label: string; phase: 1 | 2; responsibility: 'external' | 'internal'; agencyId: string }

const SUGGESTED: Draft[] = [
  { label: 'Delivery pending client / VTECH', phase: 1, responsibility: 'external', agencyId: '' },
  { label: 'Readiness of cable', phase: 1, responsibility: 'external', agencyId: '' },
  { label: 'Readiness to install', phase: 1, responsibility: 'external', agencyId: '' },
  { label: 'Installation', phase: 2, responsibility: 'internal', agencyId: '' },
  { label: 'Configuration', phase: 2, responsibility: 'internal', agencyId: '' },
];

export function CustomStepsDialog({
  roomProductId,
  title,
  context,
  agencies,
  onClose,
  onSaved,
}: {
  roomProductId: string;
  title: string;
  context: string;
  agencies: AgencyOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [steps, setSteps] = useState<Draft[]>(SUGGESTED);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (i: number, patch: Partial<Draft>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  async function save() {
    const list = steps.filter((s) => s.label.trim());
    if (!list.length) { setError('Add at least one step.'); return; }
    setSaving(true); setError(null);
    try {
      const sb = supabaseBrowser();
      // Greens first, then the rest, in the order shown.
      for (const s of [...list.filter((x) => x.phase === 1), ...list.filter((x) => x.phase === 2)]) {
        const { error: e } = await sb.rpc('add_custom_step', {
          p_room_product: roomProductId, p_label: s.label.trim(), p_phase: s.phase, p_responsibility: s.responsibility, p_agency: s.agencyId || null,
        });
        if (e) throw e;
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:px-4" onClick={() => !saving && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="custom-steps-title" className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="custom-steps-title" className="text-lg font-semibold">Add dependencies for “{title}”</h2>
            <p className="mt-0.5 text-sm text-text-secondary">{context} · not in VTech’s product list, so its steps are added by hand. Edit the suggestions below.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-alt"><Glyph name="cross" /></button>
        </div>
        <ol className="mt-4 space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="grid grid-cols-1 gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1fr_auto_auto_auto_auto] sm:items-center">
              <input aria-label={`Step ${i + 1}`} value={s.label} onChange={(e) => set(i, { label: e.target.value })} className="rounded-lg border border-border px-3 py-2 text-sm" placeholder="Step name" />
              <select aria-label={`Step ${i + 1} stage`} value={s.phase} onChange={(e) => set(i, { phase: Number(e.target.value) as 1 | 2 })} className="rounded-lg border border-border px-2 py-2 text-sm">
                <option value={1}>Before installation (green)</option>
                <option value={2}>Installation &amp; after</option>
              </select>
              <select aria-label={`Step ${i + 1} owner`} value={s.responsibility} onChange={(e) => set(i, { responsibility: e.target.value as Draft['responsibility'], agencyId: '' })} className="rounded-lg border border-border px-2 py-2 text-sm">
                <option value="external">Other agency</option>
                <option value="internal">VTech team</option>
              </select>
              <select aria-label={`Step ${i + 1} agency`} value={s.agencyId} onChange={(e) => set(i, { agencyId: e.target.value })} className="rounded-lg border border-border px-2 py-2 text-sm">
                <option value="">Agency later</option>
                {agencies.filter((a) => (s.responsibility === 'internal') === a.internal).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <button type="button" onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="text-xs font-medium text-danger hover:underline">Remove</button>
            </li>
          ))}
        </ol>
        <button type="button" onClick={() => setSteps([...steps, { label: '', phase: 2, responsibility: 'internal', agencyId: '' }])} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent">
          <Glyph name="plus" /> Add a step
        </button>
        {error && <div role="alert" className="mt-3 rounded-lg bg-danger-light px-3 py-2 text-sm text-danger">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-border px-4 py-2.5 text-sm">Cancel</button>
          <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save dependencies'}</button>
        </div>
      </div>
    </div>
  );
}
