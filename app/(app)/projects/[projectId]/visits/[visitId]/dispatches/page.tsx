'use client';

import { useState, useEffect, useCallback, use, useMemo } from 'react';
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

interface AgencyDraftGroup {
  key: string;
  companyName: string;
  typeName: string;
  itemCount: number;
  emailDispatch: Dispatch | null;
  waDispatch: Dispatch | null;
  allRecipients: { to: Recipient[]; cc: Recipient[] };
}

export default function ReviewSendPage({
  params,
}: {
  params: Promise<{ projectId: string; visitId: string }>;
}) {
  const { projectId, visitId } = use(params);

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

  // Two-column layout: Selected agency for right-side preview
  const [selectedAgencyKey, setSelectedAgencyKey] = useState<string | null>(null);
  const [previewChannel, setPreviewChannel] = useState<'whatsapp' | 'email'>('whatsapp');

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

  // Group dispatches by agency company name
  const agencyGroups: AgencyDraftGroup[] = useMemo(() => {
    const map = new Map<string, AgencyDraftGroup>();

    dispatches.forEach((d) => {
      const comp = d.agencies?.company_name ?? 'Contractor';
      const type = d.agencies?.agency_types?.name ?? 'General';
      const key = `${comp}__${type}`;

      const existing = map.get(key) ?? {
        key,
        companyName: comp,
        typeName: type,
        itemCount: 0,
        emailDispatch: null,
        waDispatch: null,
        allRecipients: { to: [], cc: [] },
      };

      if (d.channel === 'email') {
        existing.emailDispatch = d;
      } else if (d.channel === 'whatsapp') {
        existing.waDispatch = d;
      }

      const count = d.dispatch_items?.[0]?.count ?? 0;
      if (count > existing.itemCount) {
        existing.itemCount = count;
      }

      // Merge recipients
      (d.recipients?.to ?? []).forEach((r) => {
        if (!existing.allRecipients.to.some((x) => x.name === r.name)) {
          existing.allRecipients.to.push(r);
        }
      });
      (d.recipients?.cc ?? []).forEach((r) => {
        if (!existing.allRecipients.cc.some((x) => x.name === r.name)) {
          existing.allRecipients.cc.push(r);
        }
      });

      map.set(key, existing);
    });

    return Array.from(map.values());
  }, [dispatches]);

  // Set default selected agency
  useEffect(() => {
    if (agencyGroups.length > 0 && (!selectedAgencyKey || !agencyGroups.some((g) => g.key === selectedAgencyKey))) {
      setSelectedAgencyKey(agencyGroups[0].key);
    }
  }, [agencyGroups, selectedAgencyKey]);

  const focusedGroup = useMemo(() => {
    return agencyGroups.find((g) => g.key === selectedAgencyKey) ?? agencyGroups[0] ?? null;
  }, [agencyGroups, selectedAgencyKey]);

  const activePreviewDispatch = useMemo(() => {
    if (!focusedGroup) return null;
    if (previewChannel === 'whatsapp') {
      return focusedGroup.waDispatch ?? focusedGroup.emailDispatch;
    }
    return focusedGroup.emailDispatch ?? focusedGroup.waDispatch;
  }, [focusedGroup, previewChannel]);

  const draftEmailCount = dispatches.filter((d) => d.channel === 'email' && d.status === 'draft').length;
  const draftWaCount = dispatches.filter((d) => d.channel === 'whatsapp' && d.status === 'draft').length;
  const sentCount = dispatches.filter((d) => d.status === 'sent').length;

  return (
    <div className="min-h-dvh bg-surface-alt pb-16">
      <AppHeader />

      <main className="mx-auto max-w-7xl px-4 sm:px-6 pt-5">
        {/* Navigation & Header */}
        <div className="mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <Link
              href={`/projects/${projectId}/visits/${visitId}`}
              className="inline-flex items-center gap-1 text-xs font-semibold text-text-secondary hover:text-text-primary mb-1.5"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back to visit checklist
            </Link>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary">
              Review &amp; Send Dispatches
            </h1>
            <p className="text-xs text-text-secondary mt-0.5">
              Two-column dispatch review: inspect drafts on the left, check live preview on the right. Nothing leaves without your confirmation.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={rebuilding}
              onClick={handleRebuild}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors"
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

        {/* Global warnings */}
        {warnings.length > 0 && (
          <div className="mb-4 rounded-xl bg-warning-light border border-warning/20 p-3 text-xs text-warning space-y-1">
            <p className="font-semibold">Warnings:</p>
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
        <div className="mb-5 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl border border-border bg-surface p-2.5 shadow-2xs">
            <p className="text-xs text-text-muted">Draft Emails</p>
            <p className="text-base font-bold text-text-primary">{draftEmailCount}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-2.5 shadow-2xs">
            <p className="text-xs text-text-muted">Draft WhatsApp</p>
            <p className="text-base font-bold text-text-primary">{draftWaCount}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-2.5 shadow-2xs">
            <p className="text-xs text-text-muted">Sent Dispatches</p>
            <p className="text-base font-bold text-success">{sentCount}</p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        ) : agencyGroups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface p-12 text-center text-xs text-text-muted">
            No dispatches drafted. All items were either completed or no pending dependencies were observed.
          </div>
        ) : (
          /* ────────────────────── TWO COLUMNS: DRAFTS LIST LEFT · PREVIEW RIGHT ────────────────────── */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT COLUMN: DRAFTS LIST */}
            <div className="lg:col-span-7 xl:col-span-7 space-y-3.5">
              {agencyGroups.map((group) => {
                const isSelected = selectedAgencyKey === group.key;

                const emailSent = group.emailDispatch?.status === 'sent';
                const waSent = group.waDispatch?.status === 'sent';

                const hasEmail = group.allRecipients.to.some((r) => !!r.email);
                const hasPhone = group.allRecipients.to.some((r) => !!r.phone);

                const emailDisabledReason = !group.emailDispatch
                  ? 'No email draft'
                  : emailSent
                  ? 'Email already sent'
                  : !hasEmail
                  ? 'Missing email address'
                  : null;

                const waDisabledReason = !group.waDispatch
                  ? 'No WhatsApp draft'
                  : waSent
                  ? 'WhatsApp already sent'
                  : !hasPhone
                  ? 'Missing phone number'
                  : null;

                return (
                  <div
                    key={group.key}
                    onClick={() => setSelectedAgencyKey(group.key)}
                    className={`rounded-2xl border bg-surface p-4 sm:p-5 shadow-xs transition-all cursor-pointer ${
                      isSelected ? 'border-accent ring-2 ring-accent/20 bg-accent/5' : 'border-border hover:border-text-secondary/50'
                    }`}
                  >
                    {/* Header: Company, Trade, Items, Status */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="rounded-md bg-surface-alt px-2 py-0.5 text-[11px] font-bold text-text-secondary border border-border">
                            {group.typeName}
                          </span>
                          <span className="text-xs text-text-muted">
                            {group.itemCount} {group.itemCount === 1 ? 'item' : 'items'}
                          </span>
                        </div>
                        <h2 className="text-base font-bold text-text-primary">
                          {group.companyName}
                        </h2>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {emailSent && waSent ? (
                          <span className="rounded-md bg-success-light px-2 py-0.5 text-[11px] font-bold text-success border border-success/30">
                            All Sent
                          </span>
                        ) : emailSent ? (
                          <span className="rounded-md bg-success-light px-2 py-0.5 text-[11px] font-bold text-success border border-success/30">
                            Email Sent
                          </span>
                        ) : waSent ? (
                          <span className="rounded-md bg-success-light px-2 py-0.5 text-[11px] font-bold text-success border border-success/30">
                            WhatsApp Sent
                          </span>
                        ) : (
                          <span className="rounded-md bg-surface-alt px-2 py-0.5 text-[11px] font-medium text-text-secondary border border-border">
                            Draft
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Recipients Info */}
                    <div className="mt-2 text-xs space-y-1 text-text-secondary border-t border-border/60 pt-2.5">
                      <div>
                        <span className="font-semibold text-text-secondary">To: </span>
                        <span className="text-text-primary">
                          {group.allRecipients.to.map((r) => `${r.name} (${r.phone || r.email || 'No contact info'})`).join(', ')}
                        </span>
                      </div>
                      {group.allRecipients.cc.length > 0 && (
                        <div>
                          <span className="font-semibold text-text-secondary">CC: </span>
                          <span className="text-text-muted">
                            {group.allRecipients.cc.map((r) => `${r.name} (${r.phone || r.email})`).join(', ')}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Actions: Send WhatsApp · Send Email */}
                    <div className="mt-4 pt-3 border-t border-border/60 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-text-muted">
                        {isSelected ? 'Preview displayed on right' : 'Click card to view preview'}
                      </span>

                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {/* Send WhatsApp Button */}
                        <button
                          type="button"
                          disabled={!!waDisabledReason || sendingId === group.waDispatch?.id}
                          onClick={() => group.waDispatch && handleSend(group.waDispatch)}
                          title={waDisabledReason ?? undefined}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <svg className="h-3.5 w-3.5 text-success" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.007c.106.005.249-.04.39.299.144.347.491 1.2.534 1.287.043.087.072.188.014.303-.058.116-.087.188-.173.289l-.26.302c-.087.087-.179.182-.077.357.101.174.449.741.964 1.2.662.589 1.221.77 1.394.856.173.086.274.072.375-.043.101-.116.433-.506.549-.679.116-.173.231-.144.39-.086s1.011.477 1.184.563c.173.087.289.13.332.202.043.073.043.419-.101.824z" />
                          </svg>
                          {sendingId === group.waDispatch?.id
                            ? 'Sending…'
                            : waSent
                            ? 'WhatsApp Sent'
                            : waDisabledReason
                            ? `WhatsApp (${waDisabledReason})`
                            : 'Send WhatsApp'}
                        </button>

                        {/* Send Email Button */}
                        <button
                          type="button"
                          disabled={!!emailDisabledReason || sendingId === group.emailDispatch?.id}
                          onClick={() => group.emailDispatch && handleSend(group.emailDispatch)}
                          title={emailDisabledReason ?? undefined}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          {sendingId === group.emailDispatch?.id
                            ? 'Sending…'
                            : emailSent
                            ? 'Email Sent'
                            : emailDisabledReason
                            ? `Email (${emailDisabledReason})`
                            : 'Send Email'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* RIGHT COLUMN: STICKY PREVIEW PANEL */}
            <div className="lg:col-span-5 xl:col-span-5 sticky top-6 space-y-4">
              <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between border-b border-border/70 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-text-primary">
                      Draft Preview
                    </h3>
                    <p className="text-[11px] text-text-secondary">
                      {focusedGroup ? `${focusedGroup.companyName} (${focusedGroup.typeName})` : 'Select an agency'}
                    </p>
                  </div>

                  {/* Channel Switch Tabs */}
                  <div className="flex rounded-lg bg-surface-alt p-0.5 border border-border">
                    <button
                      type="button"
                      onClick={() => setPreviewChannel('whatsapp')}
                      className={`rounded-md px-2.5 py-1 text-xs font-bold transition-colors ${
                        previewChannel === 'whatsapp'
                          ? 'bg-surface text-text-primary shadow-2xs'
                          : 'text-text-muted hover:text-text-primary'
                      }`}
                    >
                      WhatsApp
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewChannel('email')}
                      className={`rounded-md px-2.5 py-1 text-xs font-bold transition-colors ${
                        previewChannel === 'email'
                          ? 'bg-surface text-text-primary shadow-2xs'
                          : 'text-text-muted hover:text-text-primary'
                      }`}
                    >
                      Email
                    </button>
                  </div>
                </div>

                {!activePreviewDispatch ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-text-muted">
                    No {previewChannel} draft available for this agency.
                  </div>
                ) : previewChannel === 'email' ? (
                  /* ── EMAIL PREVIEW ── */
                  <div className="space-y-2.5 text-xs">
                    <div className="rounded-lg bg-surface-alt p-2.5 border border-border space-y-1">
                      <div>
                        <span className="font-semibold text-text-secondary">To: </span>
                        <span className="text-text-primary">
                          {(activePreviewDispatch.recipients?.to ?? []).map((r) => `${r.name} (${r.email || r.phone})`).join(', ') || 'No recipients'}
                        </span>
                      </div>
                      {activePreviewDispatch.subject && (
                        <div>
                          <span className="font-semibold text-text-secondary">Subject: </span>
                          <span className="text-text-primary font-mono text-[11px]">{activePreviewDispatch.subject}</span>
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-border overflow-hidden bg-white">
                      <iframe
                        title="Email Draft Preview"
                        srcDoc={activePreviewDispatch.body_html || `<pre>${activePreviewDispatch.body_text}</pre>`}
                        sandbox="allow-same-origin"
                        className="w-full h-80 border-0"
                      />
                    </div>
                  </div>
                ) : (
                  /* ── WHATSAPP PREVIEW ── */
                  <div className="space-y-2.5 text-xs">
                    <div className="rounded-lg bg-surface-alt p-2.5 border border-border">
                      <span className="font-semibold text-text-secondary">Recipients: </span>
                      <span className="text-text-primary">
                        {(activePreviewDispatch.recipients?.to ?? []).map((r) => `${r.name} (${r.phone || 'No phone'})`).join(', ')}
                      </span>
                    </div>

                    <div className="rounded-2xl bg-[#efeae2] p-3 border border-border">
                      <div className="rounded-xl bg-white p-3 shadow-2xs max-w-sm text-xs font-sans text-text-primary whitespace-pre-wrap leading-relaxed border border-border/40">
                        {activePreviewDispatch.body_text}
                        <div className="mt-1 text-right text-[10px] text-text-muted">
                          Just now
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
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
                    Re-open {link.label}
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
                  {confirming ? 'Saving…' : 'I Have Sent It'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-6 w-6 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={2.5} />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
