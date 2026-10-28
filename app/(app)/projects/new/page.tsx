'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/client/supabase';
import { AppHeader } from '@/components/app-header';
import Link from 'next/link';

export default function NewProjectPage() {
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Project name is required');
      return;
    }

    setLoading(true);
    try {
      const sb = supabaseBrowser();
      const { data: project, error: insertError } = await sb
        .from('projects')
        .insert({
          name: trimmedName,
          client_name: clientName.trim() || null,
          site_address: siteAddress.trim() || null,
        })
        .select('id')
        .single();

      if (insertError) {
        throw new Error(insertError.message);
      }

      // Pre-fill exactly 1 floor (O1 setup requirement)
      await sb.from('floors').insert({
        project_id: project.id,
        label: '1st Floor',
        sort: 1,
      });

      router.push(`/projects/${project.id}/setup`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-surface-alt pb-12">
      <AppHeader />

      <main className="mx-auto max-w-lg px-4 pt-6">
        <div className="mb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-text-primary mb-3"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to projects
          </Link>
          <h1 className="text-xl font-bold tracking-tight text-text-primary">Create new project</h1>
          <p className="text-xs text-text-secondary mt-1">
            Step 1 of 6: Enter the project and site information to start setup.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-xs">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1.5">
                Project Name <span className="text-danger">*</span>
              </label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. TEST – Sharma Villa, Juhu"
                className="block w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-base
                           placeholder:text-text-muted
                           focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
              <p className="mt-1 text-xs text-text-muted">
                Tip: When testing, include &quot;TEST&quot; in the project name.
              </p>
            </div>

            <div>
              <label htmlFor="clientName" className="block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1.5">
                Client Name
              </label>
              <input
                id="clientName"
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="e.g. Mr. Sharma"
                className="block w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-base
                           placeholder:text-text-muted
                           focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>

            <div>
              <label htmlFor="siteAddress" className="block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1.5">
                Site Address
              </label>
              <textarea
                id="siteAddress"
                rows={3}
                value={siteAddress}
                onChange={(e) => setSiteAddress(e.target.value)}
                placeholder="e.g. 14th Floor, Sea View Heights, Juhu Tara Road, Mumbai"
                className="block w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-base
                           placeholder:text-text-muted
                           focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-danger/20 bg-danger-light px-3.5 py-2.5 text-xs text-danger font-medium" role="alert">
                {error}
              </div>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center rounded-lg bg-accent px-4 py-3 text-base
                           font-semibold text-white shadow-sm transition-colors
                           hover:bg-accent-hover active:bg-accent-hover
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Creating project…' : 'Continue to Floors & Rooms →'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
