'use client';

import { useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/client/supabase';
import { AppHeader } from '@/components/app-header';
import Link from 'next/link';

export default function NewVisitPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const router = useRouter();

  // Default to today in IST
  const todayIST = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const [visitDate, setVisitDate] = useState(todayIST);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStartVisit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const sb = supabaseBrowser();
      const { data: visit, error: err } = await sb
        .from('site_visits')
        .insert({
          project_id: projectId,
          visit_date: visitDate,
          status: 'draft',
        })
        .select('id')
        .single();

      if (err) throw err;

      router.push(`/projects/${projectId}/visits/${visit.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create site visit');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-surface-alt pb-12">
      <AppHeader />

      <main className="mx-auto max-w-sm px-4 pt-6">
        <Link
          href={`/projects/${projectId}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-text-primary mb-3"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to project
        </Link>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-xs">
          <h1 className="text-xl font-bold tracking-tight text-text-primary mb-1">
            Start Site Visit
          </h1>
          <p className="text-xs text-text-secondary mb-5">
            Log your site inspection. You can verify items room by room on your phone.
          </p>

          <form onSubmit={handleStartVisit} className="space-y-4">
            <div>
              <label htmlFor="visitDate" className="block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1.5">
                Visit Date
              </label>
              <input
                id="visitDate"
                type="date"
                required
                value={visitDate}
                onChange={(e) => setVisitDate(e.target.value)}
                className="block w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-base font-medium
                           focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-danger/20 bg-danger-light px-3.5 py-2.5 text-xs text-danger font-medium" role="alert">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center rounded-lg bg-accent px-4 py-3 text-base
                         font-semibold text-white shadow-sm transition-colors
                         hover:bg-accent-hover active:bg-accent-hover
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Starting…' : 'Start Visit →'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
