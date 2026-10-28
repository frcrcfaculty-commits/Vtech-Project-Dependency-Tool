'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import Link from 'next/link';

interface Recipient {
  name: string;
  email?: string;
  phone?: string;
}

interface Dispatch {
  id: string;
  channel: 'email' | 'whatsapp';
  level: 1 | 2 | 3;
  status: 'draft' | 'sent' | 'failed' | 'skipped';
  recipients: {
    to: Recipient[];
    cc?: Recipient[];
  };
  subject: string | null;
  body_text: string;
  body_html: string | null;
  sent_at: string | null;
  error: string | null;
  agencies: {
    company_name: string;
    agency_types: { name: string } | null;
  } | null;
  dispatch_items: { count: number }[];
}

export default function ReviewSendPage({
  params,
}: {
  params: Promise<{ projectId: string; visitId: string }>;
}) {
  const { projectId, visitId } = use(params);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);

  // Action states
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [sendingAllEmail, setSendingAllEmail] = useState(false);

  // Link mode confirmation dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    dispatchId: string;
    links: { label: string; url: string }[];
  } | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Expanded preview state
  const [expandedPreviewId, setExpandedPreviewId] = useState<string | null>(null);

  const fetchDispatches = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/visits/${visitId}/dispatches`);
      if (!res.ok) {
        throw new Error(`Failed to load dispatches (${res.status})`);
      }
      const data = await res.json();
      setDispatches(data.dispatches ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dispatches');
    } finally {
      setLoading(false);
    }
  }, [visitId]);

  useEffect(() => {
    fetchDispatches();
  }, [fetchDispatches]);

  // Rebuild drafts
  async function handleRebuild() {
    if (!confirm('Rebuild draft dispatches based on the latest visit checks?')) return;
    setRebuilding(true);
    setError(null);
    try {
      const res = await fetch(`/api/visits/${visitId}/dispatches`, {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error(`Failed to rebuild dispatches (${res.status})`);
      }
      const data = await res.json();
      setWarnings(data.warnings ?? []);
      await fetchDispatches();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rebuild');
    } finally {
      setRebuilding(false);
    }
  }

  // Send single dispatch
  async function handleSend(dispatch: Dispatch) {
    setSendingId(dispatch.id);
    setError(null);
    try {
      const res = await fetch(`/api/dispatches/${dispatch.id}/send`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Send failed (${res.status})`);
      }
      const data = await res.json();

      if (data.status === 'needs_confirmation') {
        // Open the links (Gmail compose or wa.me)
        data.links?.forEach((link: { url: string }) => {
          window.open(link.url, '_blank');
        });
        setConfirmDialog({
          dispatchId: dispatch.id,
          links: data.links ?? [],
        });
      } else {
        await fetchDispatches();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send error');
    } finally {
      setSendingId(null);
    }
  }

  // Confirm manual link send
  async function handleConfirmSend(dispatchId: string) {
    setConfirming(true);
    try {
      const res = await fetch(`/api/dispatches/${dispatchId}/confirm`, {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error(`Confirmation failed (${res.status})`);
      }
      setConfirmDialog(null);
      await fetchDispatches();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Confirmation error');
    } finally {
      setConfirming(false);
    }
  }

  // Send all email convenience action
  async function handleSendAllEmail() {
    const draftEmails = dispatches.filter((d) => d.channel === 'email' && d.status === 'draft');
    if (draftEmails.length === 0) return;

    setSendingAllEmail(true);
    setError(null);
    try {
      for (const d of draftEmails) {
        const res = await fetch(`/api/dispatches/${d.id}/send`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (data.status === 'needs_confirmation' && data.links) {
          data.links.forEach((l: { url: string }) => window.open(l.url, '_blank'));
        }
      }
      await fetchDispatches();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error sending emails');
    } finally {
      setSendingAllEmail(false);
    }
  }

  const draftEmailCount = dispatches.filter((d) => d.channel === 'email' && d.status === 'draft').length;
  const draftWaCount = dispatches.filter((d) => d.channel === 'whatsapp' && d.status === 'draft').length;
  const sentCount = dispatches.filter((d) => d.status === 'sent').length;

  return (
    <div className="min-h-dvh bg-surface-alt pb-16">
      <AppHeader />

      <main className="mx-auto max-w-2xl px-4 pt-5">
        {/* Navigation & Header */}
        <div className="mb-4">
          <Link
            href={`/projects/${projectId}/visits/${visitId}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-text-primary mb-2"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to visit checklist
          </Link>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-text-primary">
                Review &amp; Send Dispatches
              </h1>
              <p className="text-xs text-text-secondary mt-0.5">
                Review messages drafted for each agency with pending items. Nothing is sent without your confirmation.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={rebuilding}
                onClick={handleRebuild}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-alt transition-colors"
              >
                {rebuilding ? 'Rebuilding…' : 'Rebuild Drafts'}
              </button>

              {draftEmailCount > 0 && (
                <button
                  type="button"
                  disabled={sendingAllEmail}
                  onClick={handleSendAllEmail}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors"
                >
                  {sendingAllEmail ? 'Sending…' : `Send All Emails (${draftEmailCount})`}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Global warnings */}
        {warnings.length > 0 && (
          <div className="mb-4 rounded-xl bg-warning-light border border-warning/20 p-3 text-xs text-warning space-y-1">
            <p className="font-semibold">⚠️ Warnings:</p>
            {warnings.map((w, i) => (
              <p key={i}>• {w}</p>
            ))}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-xl bg-danger-light border border-danger/20 p-3 text-xs text-danger font-medium">
            {error}
          </div>
        )}

        {/* Summary metric banner */}
        <div className="mb-5 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border border-border bg-surface p-2.5">
            <p className="text-xs text-text-muted">Draft Emails</p>
            <p className="text-base font-bold text-text-primary">{draftEmailCount}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-2.5">
            <p className="text-xs text-text-muted">Draft WhatsApp</p>
            <p className="text-base font-bold text-text-primary">{draftWaCount}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-2.5">
            <p className="text-xs text-text-muted">Sent Dispatches</p>
            <p className="text-base font-bold text-success">{sentCount}</p>
          </div>
        </div>

        {/* List of dispatches */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : dispatches.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center text-xs text-text-muted">
            No dispatches drafted. All items were either completed or no pending dependencies were observed.
          </div>
        ) : (
          <div className="space-y-4">
            {dispatches.map((d) => {
              const isEmail = d.channel === 'email';
              const isSent = d.status === 'sent';
              const isExpanded = expandedPreviewId === d.id;
              const itemCount = d.dispatch_items?.[0]?.count ?? 0;

              return (
                <div
                  key={d.id}
                  className={`rounded-2xl border bg-surface p-5 shadow-xs transition-colors ${
                    isSent ? 'border-success/30 bg-success-light/5' : 'border-border'
                  }`}
                >
                  {/* Card Header: Channel, Agency, Level, Status */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${
                            isEmail
                              ? 'bg-accent/10 text-accent'
                              : 'bg-success-light text-success font-medium'
                          }`}
                        >
                          {isEmail ? '✉️ Email' : '💬 WhatsApp'}
                        </span>

                        {/* Level badge — Red only for L3 escalation as required by taste-skill */}
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${
                            d.level === 3
                              ? 'bg-danger-light text-danger'
                              : d.level === 2
                              ? 'bg-warning-light text-warning'
                              : 'bg-surface-alt text-text-secondary'
                          }`}
                        >
                          {d.level === 1 ? 'L1 · First notice' : `L${d.level} Escalation`}
                        </span>

                        <span className="text-xs text-text-muted">
                          {itemCount} {itemCount === 1 ? 'item' : 'items'}
                        </span>
                      </div>

                      <h2 className="text-base font-bold text-text-primary truncate">
                        {d.agencies?.company_name ?? 'Contractor'}
                      </h2>
                      <p className="text-xs text-text-secondary">
                        Trade: {d.agencies?.agency_types?.name ?? 'General'}
                      </p>
                    </div>

                    {/* Status Pill */}
                    <div className="shrink-0 text-right">
                      {isSent ? (
                        <span className="inline-flex items-center rounded-md bg-success-light px-2.5 py-1 text-xs font-bold text-success">
                          Sent ✓
                        </span>
                      ) : d.status === 'failed' ? (
                        <span className="inline-flex items-center rounded-md bg-danger-light px-2 py-0.5 text-xs font-bold text-danger">
                          Failed
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-md bg-surface-alt px-2 py-0.5 text-xs font-medium text-text-secondary border border-border">
                          Draft
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Recipients */}
                  <div className="mt-3 pt-3 border-t border-border/60 text-xs space-y-1">
                    <div>
                      <span className="font-semibold text-text-secondary">To: </span>
                      <span className="text-text-primary">
                        {(d.recipients?.to ?? []).map((r) => `${r.name} (${r.email || r.phone})`).join(', ') || 'No recipients'}
                      </span>
                    </div>

                    {d.recipients?.cc && d.recipients.cc.length > 0 && (
                      <div>
                        <span className="font-semibold text-text-secondary">CC: </span>
                        <span className="text-text-muted">
                          {d.recipients.cc.map((r) => `${r.name} (${r.email || r.phone})`).join(', ')}
                        </span>
                      </div>
                    )}

                    {d.subject && (
                      <div>
                        <span className="font-semibold text-text-secondary">Subject: </span>
                        <span className="text-text-primary font-mono text-[11px]">{d.subject}</span>
                      </div>
                    )}
                  </div>

                  {/* Preview Container */}
                  {isExpanded && (
                    <div className="mt-4 pt-3 border-t border-border">
                      <p className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">
                        Message Preview
                      </p>

                      {isEmail ? (
                        <div className="rounded-xl border border-border overflow-hidden bg-white">
                          <iframe
                            title={`Preview for ${d.agencies?.company_name}`}
                            srcDoc={d.body_html || `<pre>${d.body_text}</pre>`}
                            sandbox="allow-same-origin"
                            className="w-full h-80 border-0"
                          />
                        </div>
                      ) : (
                        <div className="rounded-2xl bg-[#e5ddd5] p-3 max-w-sm">
                          <div className="rounded-xl bg-white p-3 shadow-xs text-xs whitespace-pre-wrap font-sans text-text-primary leading-relaxed">
                            {d.body_text}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setExpandedPreviewId(isExpanded ? null : d.id)}
                      className="text-xs font-medium text-accent hover:underline flex items-center gap-1"
                    >
                      {isExpanded ? 'Hide preview ↑' : 'Preview message ↓'}
                    </button>

                    <div>
                      {isSent ? (
                        <span className="text-xs text-text-muted">
                          Sent at {formatDate(d.sent_at ?? '')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={sendingId === d.id}
                          onClick={() => handleSend(d)}
                          className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors disabled:opacity-50"
                        >
                          {sendingId === d.id ? 'Sending…' : isEmail ? 'Send Email' : 'Send WhatsApp'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Confirmation Modal for Link Mode ── */}
        {confirmDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl">
              <h2 className="text-base font-bold text-text-primary mb-2">
                Sent Confirmation
              </h2>
              <p className="text-xs text-text-secondary mb-4 leading-relaxed">
                Your messaging application was opened with the prefilled draft. After you tap send in Gmail or WhatsApp, click below to mark this dispatch as sent and advance reminder counters.
              </p>

              <div className="mb-4 space-y-1.5">
                {confirmDialog.links.map((link, idx) => (
                  <a
                    key={idx}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-lg border border-border bg-surface-alt px-3 py-2 text-xs font-medium text-accent hover:underline truncate"
                  >
                    🔗 Re-open {link.label}
                  </a>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setConfirmDialog(null)}
                  className="rounded-lg border border-border px-3.5 py-2 text-xs font-medium text-text-secondary hover:bg-surface-alt"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={confirming}
                  onClick={() => handleConfirmSend(confirmDialog.dispatchId)}
                  className="rounded-lg bg-success px-4 py-2 text-xs font-bold text-white shadow-sm hover:opacity-90 transition-opacity"
                >
                  {confirming ? 'Saving…' : '✓ I Have Sent It'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });
  } catch {
    return iso;
  }
}

function Spinner() {
  return (
    <svg className="h-6 w-6 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={2.5} />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
