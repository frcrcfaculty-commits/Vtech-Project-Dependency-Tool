'use client';

import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useAuth } from '@/components/auth-provider';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

export function AppHeader() {
  const { profile, signOut, changePassword } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const roleLabel: Record<string, string> = {
    super_admin: 'Super Admin',
    pm_lead: 'PM Lead',
    pm: 'Project Manager',
  };

  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'pm_lead';
  const isSuperAdmin = profile?.role === 'super_admin';

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border bg-surface px-4 py-2.5">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-6">
            <Link
              href="/hub"
              className="text-lg font-bold tracking-tight text-text-primary hover:opacity-80 transition-opacity"
            >
              VTech
            </Link>

            {/* Navigation pills for admins */}
            {isAdmin && (
              <nav className="flex items-center gap-1">
                <Link
                  href="/hub"
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    pathname === '/' || pathname === '/hub'
                      ? 'bg-surface-alt text-text-primary font-semibold'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  Hub
                </Link>
                <Link
                  href="/projects"
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    pathname.startsWith('/projects')
                      ? 'bg-surface-alt text-text-primary font-semibold'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  Projects
                </Link>
                <Link
                  href="/admin"
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    pathname.startsWith('/admin')
                      ? 'bg-surface-alt text-text-primary font-semibold'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  Admin
                </Link>
                {isSuperAdmin && (
                  <Link
                    href="/dashboard"
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      pathname.startsWith('/dashboard')
                        ? 'bg-surface-alt text-text-primary font-semibold'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    Dashboard
                  </Link>
                )}
              </nav>
            )}
          </div>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm
                         hover:bg-surface-alt active:bg-surface-alt transition-colors"
              aria-label="Profile menu"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
                {profile?.full_name?.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() ?? '?'}
              </span>
              <span className="hidden sm:inline text-sm font-medium text-text-primary">
                {profile?.full_name}
              </span>
              <svg className="h-4 w-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-60 rounded-xl border border-border bg-surface py-1.5 shadow-lg">
                <div className="border-b border-border px-4 py-2.5">
                  <p className="text-sm font-semibold text-text-primary truncate">{profile?.full_name}</p>
                  <p className="text-xs text-text-secondary truncate">{profile?.email}</p>
                  <span className="mt-1.5 inline-block rounded-md bg-surface-alt px-2 py-0.5 text-xs font-medium text-text-secondary">
                    {roleLabel[profile?.role ?? ''] ?? profile?.role}
                  </span>
                </div>

                {isAdmin && (
                  <div className="border-b border-border py-1 sm:hidden">
                    <Link
                      href="/"
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-text-primary hover:bg-surface-alt"
                    >
                      Projects
                    </Link>
                    <Link
                      href="/admin"
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-text-primary hover:bg-surface-alt"
                    >
                      Admin
                    </Link>
                    {isSuperAdmin && (
                      <Link
                        href="/dashboard"
                        onClick={() => setMenuOpen(false)}
                        className="block px-4 py-2 text-sm text-text-primary hover:bg-surface-alt"
                      >
                        Dashboard
                      </Link>
                    )}
                  </div>
                )}

                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setShowChangePw(true);
                  }}
                  className="w-full px-4 py-2.5 text-left text-sm text-text-primary hover:bg-surface-alt transition-colors"
                >
                  Change password
                </button>
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    await signOut();
                    window.location.href = '/login';
                  }}
                  className="w-full px-4 py-2.5 text-left text-sm font-medium text-danger hover:bg-surface-alt transition-colors"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {showChangePw && (
        <ChangePasswordDialog
          onClose={() => setShowChangePw(false)}
          onSubmit={changePassword}
        />
      )}
    </>
  );
}

function ChangePasswordDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (pw: string) => Promise<{ error: string | null }>;
}) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (pw.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (pw !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    const { error: err } = await onSubmit(pw);
    setLoading(false);

    if (err) {
      setError(err);
    } else {
      setSuccess(true);
      setTimeout(onClose, 1500);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4">Change password</h2>

        {success ? (
          <div className="rounded-lg bg-success-light px-3 py-2.5 text-sm text-success font-medium">
            Password updated successfully.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="new-pw" className="block text-sm font-medium mb-1">New password</label>
              <input
                id="new-pw"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="At least 8 characters"
                className="block w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-base
                           focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <div>
              <label htmlFor="confirm-pw" className="block text-sm font-medium mb-1">Confirm password</label>
              <input
                id="confirm-pw"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter new password"
                className="block w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-base
                           focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            {error && (
              <div className="rounded-lg bg-danger-light px-3 py-2 text-sm text-danger" role="alert">
                {error}
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium
                           text-text-primary hover:bg-surface-alt transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white
                           hover:bg-accent-hover disabled:opacity-50 transition-colors"
              >
                {loading ? 'Saving…' : 'Update password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
