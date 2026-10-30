'use client';

import { useState, type FormEvent } from 'react';
import { supabaseBrowser } from '@/lib/client/supabase';
import { VTechLogo } from '@/components/vtech-logo';

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
    <div className="brand-band relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-8">
      {/* Diagonal light panes, as in VTech's own artwork */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-1/4 top-[12%] h-56 w-[150%] -rotate-[14deg] bg-white/[0.07]" />
        <div className="absolute -left-1/4 top-[38%] h-24 w-[150%] -rotate-[14deg] bg-white/[0.05]" />
        <div className="absolute -right-1/4 bottom-[6%] h-72 w-[120%] rotate-[22deg] bg-white/[0.06]" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Branding header */}
        <div className="mb-8 text-center">
          <VTechLogo tone="white" className="mx-auto h-10 w-auto drop-shadow-[0_6px_18px_rgba(10,0,60,0.35)]" />
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/75">
            Leading the technology curve
          </p>
          <h1 className="mt-6 text-2xl font-bold tracking-tight text-white">
            Site Tracker
          </h1>
          <p className="mt-1 text-sm text-white/80">
            Sign in to track site dependencies &amp; visits
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/60 bg-white/80 p-6 shadow-[0_30px_60px_-20px_rgba(10,0,60,0.55)] backdrop-blur-xl">
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

        <div className="mt-6 text-center text-xs text-white/75 space-y-1">
          <p>Temporary password? Sign in, then change it in your profile menu.</p>
          <p>Accounts are provisioned by VTech administrators.</p>
        </div>
      </div>
    </div>
  );
}
