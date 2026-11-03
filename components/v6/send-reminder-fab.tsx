'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/client/supabase';
import { GlassIcon } from '@/components/glass-icon';
import { useEscape } from '@/lib/client/use-escape';

interface ActiveProject {
  id: string;
  name: string;
}

export function SendReminderFab() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [projects, setProjects] = useState<ActiveProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  useEscape(() => setPickerOpen(false), false);

  // Hidden on login and on any Reminders page itself
  const hidden = pathname.startsWith('/login') || pathname.includes('/reminders');

  // Detect project in current context
  const currentProjectId =
    params.get('p') ??
    pathname.match(/\/projects\/([0-9a-f-]{36})/i)?.[1] ??
    '';

  const handleClick = async () => {
    if (currentProjectId) {
      startTransition(() => {
        router.push(`/projects/${currentProjectId}/reminders`);
      });
      return;
    }

    // Open project picker
    setPickerOpen(true);
    setLoadingProjects(true);
    try {
      const sb = supabaseBrowser();
      const { data } = await sb
        .from('projects')
        .select('id, name')
        .eq('status', 'active')
        .order('name');
      setProjects((data ?? []) as ActiveProject[]);
    } finally {
      setLoadingProjects(false);
    }
  };

  const handleSelectProject = (projectId: string) => {
    setPickerOpen(false);
    startTransition(() => {
      router.push(`/projects/${projectId}/reminders`);
    });
  };

  if (hidden) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Send reminders"
        onClick={handleClick}
        className="fixed bottom-20 right-6 sm:bottom-6 sm:right-52 z-40 flex items-center gap-2 rounded-full bg-accent py-2 pl-2 pr-4 text-sm font-semibold text-white shadow-xl transition hover:scale-105 active:scale-95"
      >
        <GlassIcon name="send" size={30} tint="clear" />
        <span className="hidden sm:inline">Send reminders</span>
      </button>

      {pickerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="send-reminder-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h2 id="send-reminder-dialog-title" className="text-base font-bold text-text-primary">
                Send reminders
              </h2>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="rounded-lg p-1 text-text-muted hover:bg-surface-alt hover:text-text-primary"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <p className="mt-3 text-xs text-text-secondary">
              Select a project to review and send reminders:
            </p>

            <div className="mt-3 max-h-72 overflow-y-auto space-y-1">
              {loadingProjects && (
                <div className="py-6 text-center text-xs text-text-muted">Loading projects…</div>
              )}
              {!loadingProjects && projects.length === 0 && (
                <div className="py-6 text-center text-xs text-text-muted">No active projects found.</div>
              )}
              {!loadingProjects &&
                projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectProject(p.id)}
                    className="w-full rounded-xl px-3.5 py-2.5 text-left text-sm font-medium text-text-primary hover:bg-surface-alt hover:text-accent transition-colors"
                  >
                    {p.name}
                  </button>
                ))}
            </div>

            <div className="mt-4 pt-3 border-t border-border flex justify-end">
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-surface-alt"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
