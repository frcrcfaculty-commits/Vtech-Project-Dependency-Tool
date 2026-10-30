'use client';

// "Delete project" — shown only to accounts listed in project_deleters (Vipul and Hansal; migration 0008).
// The database enforces the same rule, so hiding the button is convenience, not security.
// Deleting removes the project and everything under it (floors, rooms, items, history, visits, drafts) and its
// evidence photos. It cannot be undone, so the user must type the project name to confirm.

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/client/supabase';

let canDeleteCache: Promise<boolean> | null = null;
function canDeleteProjects(): Promise<boolean> {
  canDeleteCache ??= (async () => {
    const { data, error } = await supabaseBrowser().rpc('can_delete_projects');
    return !error && data === true;
  })();
  return canDeleteCache;
}

async function removeEvidence(projectId: string) {
  const bucket = supabaseBrowser().storage.from('evidence');
  const { data: top } = await bucket.list(projectId, { limit: 1000 });
  const paths: string[] = [];
  for (const entry of top ?? []) {
    const { data: inner } = await bucket.list(`${projectId}/${entry.name}`, { limit: 1000 });
    if (inner?.length) paths.push(...inner.map((f: { name: string }) => `${projectId}/${entry.name}/${f.name}`));
    else paths.push(`${projectId}/${entry.name}`);
  }
  for (let i = 0; i < paths.length; i += 100) await bucket.remove(paths.slice(i, i + 100));
}

export function DeleteProjectButton({
  projectId,
  projectName,
  onDeleted,
  className,
}: {
  projectId: string;
  projectName: string;
  onDeleted: () => void;
  className?: string;
}) {
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    canDeleteProjects().then((ok) => live && setAllowed(ok));
    return () => { live = false; };
  }, []);

  if (!allowed) return null;

  const matches = typed.trim() === projectName.trim();

  async function handleDelete() {
    if (!matches) return;
    setBusy(true);
    setError(null);
    try {
      await removeEvidence(projectId);
      const { data, error: delErr } = await supabaseBrowser().from('projects').delete().eq('id', projectId).select('id');
      if (delErr) throw delErr;
      if (!data?.length) throw new Error('The project was not deleted (no permission or already gone).');
      setOpen(false);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setTyped(''); setError(null); setOpen(true); }}
        className={className ?? 'rounded-lg border border-danger/40 bg-danger px-3 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity'}
      >
        Delete Project
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => !busy && setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-project-title" className="text-lg font-semibold text-danger">Delete project permanently?</h2>
            <p className="mt-2 text-sm text-text-secondary">
              This deletes <span className="font-semibold text-text-primary">{projectName}</span> with all its floors, rooms,
              dependencies, products, history, visits, reminder drafts and photos. <span className="font-semibold">It cannot be undone.</span>{' '}
              To keep the record instead, use Close Project.
            </p>
            <label htmlFor="delete-project-confirm" className="mt-4 block text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Type the project name to confirm
            </label>
            <input
              id="delete-project-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={projectName}
              autoComplete="off"
              className="mt-1.5 block w-full rounded-lg border border-border px-3 py-2.5 text-base focus:border-danger focus:outline-none focus:ring-2 focus:ring-danger/20"
            />
            {error && (
              <div className="mt-3 rounded-lg bg-danger-light px-3 py-2 text-sm text-danger" role="alert">{error}</div>
            )}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-surface-alt transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!matches || busy}
                className="flex-1 rounded-lg bg-danger px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
