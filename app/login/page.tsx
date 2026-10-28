'use client';

import { useState, type FormEvent } from 'react';
import { supabaseBrowser } from '@/lib/client/supabase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const sb = supabaseBrowser();
      const { error: err } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }

      // Hard redirect to root ensures fresh session cookies are evaluated by proxy
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred during sign in');
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-alt px-4 py-8">
      <div className="w-full max-w-sm">
        {/* Branding header */}
        <div className="mb-8 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-white font-bold text-xl shadow-xs mb-3">
            V
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">
            VTech Site Tracker
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Sign in to track site dependencies &amp; visits
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-xs">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-base
                           placeholder:text-text-muted
                           focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                placeholder="name@vtechpl.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-base
                           placeholder:text-text-muted
                           focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                placeholder="Enter password"
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
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in…
                </span>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        </div>

        <div className="mt-6 text-center text-xs text-text-muted space-y-1">
          <p>Temporary password? Sign in, then change it in your profile menu.</p>
          <p>Accounts are provisioned by VTech administrators.</p>
        </div>
      </div>
    </div>
  );
}
