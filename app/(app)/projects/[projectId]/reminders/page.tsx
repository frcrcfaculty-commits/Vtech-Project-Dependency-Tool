'use client';

import { useState, useEffect, useCallback, use, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/client/supabase';
import { AppHeader } from '@/components/app-header';
import Link from 'next/link';

interface Contact {
  name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
}

interface AgencyInfo {
  id: string;
  companyName: string;
  contacts: Contact[];
}

interface RecipientGroup {
  agencyTypeId: string;
  name: string;
  defaultChecked: boolean;
  agencies: AgencyInfo[];
}

interface ReminderCategory {
  key: string;
  label: string;
  itemCount: number;
  colour: string | null;
  recipients: RecipientGroup[];
}

interface Person { name: string; email?: string; phone?: string }
const personLabel = (p: Person) => `${p.name}${p.email ? ` <${p.email}>` : p.phone ? ` (${p.phone})` : ''}`;

interface PreviewResult {
  email: {
    to: Person[];
    cc: Person[];
    subject: string;
    text: string;
    html: string;
  } | null;
  whatsapp: {
    to: Person[];
    text: string;
  } | null;
  itemCount: number;
  drafts?: { agency: string; email: PreviewResult['email']; whatsapp: PreviewResult['whatsapp'] }[];
  warnings?: string[];
}

interface DispatchResult {
  id: string;
  agency: string;
  channel: string;
  status: string;
  links?: { label: string; url: string }[];
}

const CATEGORY_CHIP_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  installer: { bg: 'bg-[#E06666]/15', text: 'text-[#991b1b]', border: 'border-[#E06666]/40' },
  programmer: { bg: 'bg-[#F4CCCC]', text: 'text-[#991b1b]', border: 'border-[#E06666]/30' },
  sales: { bg: 'bg-[#FF00FF]/15', text: 'text-[#a21caf]', border: 'border-[#FF00FF]/40' },
  electrical: { bg: 'bg-[#9900FF]/15', text: 'text-[#6b21a8]', border: 'border-[#9900FF]/40' },
  carpentry: { bg: 'bg-[#6AA84F]/15', text: 'text-[#2e7d32]', border: 'border-[#6AA84F]/40' },
  all: { bg: 'bg-accent/10', text: 'text-accent', border: 'border-accent/30' },
};

export default function ProjectRemindersPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const router = useRouter();

  const [projectName, setProjectName] = useState<string>('Project');
  const [categories, setCategories] = useState<ReminderCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Recipient checkboxes per category: { [catKey]: Set<agencyTypeId> }
  const [selectedRecipients, setSelectedRecipients] = useState<Record<string, Set<string>>>({});

  // Active / focused category for live preview panel
  const [focusedCategoryKey, setFocusedCategoryKey] = useState<string>('all');
  const [previewTab, setPreviewTab] = useState<'email' | 'whatsapp'>('whatsapp');
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Sending state: { categoryKey: string, channel: 'email' | 'whatsapp' } | null
  const [sendingState, setSendingState] = useState<{ key: string; channel: 'email' | 'whatsapp' } | null>(null);

  // Confirmation dialog for link-mode WhatsApp dispatches
  const [confirmDialog, setConfirmDialog] = useState<{
    dispatchIds: string[];
    links: { label: string; url: string }[];
  } | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Popup blocker fallback links modal
  const [popupLinksModal, setPopupLinksModal] = useState<{
    title: string;
    links: { label: string; url: string }[];
  } | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  // ───────────────────────── DATA LOADING ─────────────────────────
  const loadCategoriesData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const sb = supabaseBrowser();

      // Load project title
      const { data: projData } = await sb
        .from('projects')
        .select('name')
        .eq('id', projectId)
        .maybeSingle();

      if (projData) {
        setProjectName(projData.name);
      }

      // 1. Try GET /api/projects/{projectId}/reminder-categories
      let loadedCats: ReminderCategory[] = [];
      try {
        const res = await fetch(`/api/projects/${projectId}/reminder-categories`);
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json) && json.length > 0) {
            loadedCats = json;
          }
        }
      } catch {
        // Fallback to direct supabase query
      }

      // 2. Direct Supabase Fallback if API route is not available or returned empty
      if (loadedCats.length === 0) {
        const [
          { data: catsData },
          { data: recsData },
          { data: typesData },
          { data: agenciesData },
          { data: catItemsData },
        ] = await Promise.all([
          sb.from('reminder_categories').select('*').order('sort'),
          sb.from('reminder_category_recipients').select('*').order('sort'),
          sb.from('agency_types').select('*').eq('active', true).order('sort'),
          sb.from('agencies').select('id, agency_type_id, company_name, agency_contacts(*)').eq('project_id', projectId),
          sb.from('reminder_category_items').select('category_key, item_id').eq('project_id', projectId),
        ]);

        interface DbCat { key: string; label: string; colour: string | null; sort: number }
        interface DbRec { category_key: string; agency_type_id: string; default_checked: boolean; sort: number }
        interface DbType { id: string; name: string }
        interface DbCatItem { category_key: string; item_id: string }

        const rawCats = (catsData ?? []) as unknown as DbCat[];
        const rawRecs = (recsData ?? []) as unknown as DbRec[];
        const types = (typesData ?? []) as unknown as DbType[];
        const agencies = (agenciesData ?? []) as Array<{
          id: string;
          agency_type_id: string;
          company_name: string;
          agency_contacts: Array<{ name: string; designation: string | null; email: string | null; phone: string | null }>;
        }>;
        const catItems = (catItemsData ?? []) as unknown as DbCatItem[];

        // Count pending items per category
        const itemCountMap = new Map<string, number>();
        catItems.forEach((ci: DbCatItem) => {
          itemCountMap.set(ci.category_key, (itemCountMap.get(ci.category_key) ?? 0) + 1);
        });

        // Group recipients by category_key
        const recsByCategory = new Map<string, DbRec[]>();
        rawRecs.forEach((r: DbRec) => {
          const list = recsByCategory.get(r.category_key) ?? [];
          list.push(r);
          recsByCategory.set(r.category_key, list);
        });

        const typeById = new Map<string, DbType>(types.map((t: DbType) => [t.id, t]));

        loadedCats = rawCats.map((c: DbCat) => {
          const catRecs = recsByCategory.get(c.key) ?? [];
          const recipientGroups: RecipientGroup[] = catRecs.map((r: DbRec) => {
            const t = typeById.get(r.agency_type_id);
            const matchedAgencies = agencies
              .filter((a) => a.agency_type_id === r.agency_type_id)
              .map((a) => ({
                id: a.id,
                companyName: a.company_name,
                contacts: (a.agency_contacts ?? []).map((ct) => ({
                  name: ct.name,
                  designation: ct.designation,
                  email: ct.email,
                  phone: ct.phone,
                })),
              }));

            return {
              agencyTypeId: r.agency_type_id,
              name: t?.name ?? 'Agency',
              defaultChecked: r.default_checked,
              agencies: matchedAgencies,
            };
          });

          return {
            key: c.key,
            label: c.label,
            itemCount: itemCountMap.get(c.key) ?? 0,
            colour: c.colour,
            recipients: recipientGroups,
          };
        });
      }

      setCategories(loadedCats);

      // Initialize default checkbox selections
      const initialSelected: Record<string, Set<string>> = {};
      loadedCats.forEach((c) => {
        const selected = new Set<string>();
        c.recipients.forEach((rg) => {
          // Only check by default if project actually has this agency and defaultChecked is true
          if (rg.defaultChecked && rg.agencies.length > 0) {
            selected.add(rg.agencyTypeId);
          }
        });
        initialSelected[c.key] = selected;
      });
      setSelectedRecipients(initialSelected);

      // Set initial focused category
      if (loadedCats.length > 0) {
        setFocusedCategoryKey(loadedCats[0].key);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reminder categories');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadCategoriesData();
  }, [loadCategoriesData]);

  // Focused category object
  const focusedCategory = useMemo(() => {
    return categories.find((c) => c.key === focusedCategoryKey) ?? categories[0] ?? null;
  }, [categories, focusedCategoryKey]);

  // Toggle recipient checkbox for a category
  const toggleRecipient = (categoryKey: string, agencyTypeId: string) => {
    setSelectedRecipients((prev) => {
      const curSet = new Set(prev[categoryKey] ?? []);
      if (curSet.has(agencyTypeId)) {
        curSet.delete(agencyTypeId);
      } else {
        curSet.add(agencyTypeId);
      }
      return {
        ...prev,
        [categoryKey]: curSet,
      };
    });
  };

  // ───────────────────────── LIVE PREVIEW (300ms debounce) ─────────────────────────
  useEffect(() => {
    if (!focusedCategory) return;
    const currentRecipients = Array.from(selectedRecipients[focusedCategory.key] ?? []);

    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/reminder-rounds`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: focusedCategory.key,
            agencyTypeIds: currentRecipients,
            channel: previewTab,
            preview: true,
          }),
        });

        if (res.ok) {
          const data: PreviewResult = await res.json();
          setPreviewData(data);
        } else {
          const msg = await res.json().then((j: { error?: string }) => j.error).catch(() => null);
          setPreviewData({ email: null, whatsapp: null, itemCount: focusedCategory.itemCount, warnings: [msg ?? `Preview failed (${res.status})`] });
        }
      } catch {
        // Fallback preview
        setPreviewData(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [focusedCategory, selectedRecipients, previewTab, projectId, projectName]);

  // ───────────────────────── SEND REMINDERS ACTION ─────────────────────────
  const handleSendReminder = async (cat: ReminderCategory, channel: 'email' | 'whatsapp') => {
    if (cat.itemCount === 0) return;
    const chosenTypeIds = Array.from(selectedRecipients[cat.key] ?? []);
    if (chosenTypeIds.length === 0) {
      alert('Please select at least one recipient group to send reminders.');
      return;
    }

    setSendingState({ key: cat.key, channel });
    setError(null);

    try {
      const res = await fetch(`/api/projects/${projectId}/reminder-rounds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: cat.key,
          agencyTypeIds: chosenTypeIds,
          channel,
          preview: false,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to send ${channel} reminders (${res.status})`);
      }

      const data: {
        visitId: string;
        dispatches: DispatchResult[];
        warnings?: string[];
      } = await res.json();

      const selectedNames = cat.recipients
        .filter((r) => chosenTypeIds.includes(r.agencyTypeId))
        .map((r) => r.name);

      showToast(`Reminder sent: ${cat.label} -> ${selectedNames.join(', ')}`);

      // Collect links to open
      const allLinks: { label: string; url: string }[] = [];
      const waDispatchIds: string[] = [];

      interface RawDispatch {
        id: string;
        channel: string;
        links?: { label: string; url: string }[];
        outcome?: { status?: string; links?: { label: string; url: string }[] };
      }

      ((data.dispatches ?? []) as unknown as RawDispatch[]).forEach((d) => {
        const links = d.links || d.outcome?.links;
        if (links && Array.isArray(links)) {
          allLinks.push(...links);
        }
        if (d.id && (d.outcome?.status ?? 'needs_confirmation') === 'needs_confirmation') {
          waDispatchIds.push(d.id);
        }
      });

      // Try opening links in new windows
      let blockedPopup = false;
      allLinks.forEach((link) => {
        const w = window.open(link.url, '_blank');
        if (!w || w.closed || typeof w.closed === 'undefined') {
          blockedPopup = true;
        }
      });

      // If popup blocker blocked windows, display modal with direct clickable links
      if (blockedPopup && allLinks.length > 0) {
        setPopupLinksModal({
          title: `${cat.label} -- ${channel.toUpperCase()} Dispatches`,
          links: allLinks,
        });
      }

      // If WhatsApp dispatches were created, show "I've sent it" confirmation dialog
      if (waDispatchIds.length > 0) {
        setConfirmDialog({
          dispatchIds: waDispatchIds,
          links: allLinks,
        });
      }

      // Refresh category item counts
      await loadCategoriesData();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to send ${channel} reminders`);
    } finally {
      setSendingState(null);
    }
  };

  // Confirm manual link send
  const handleConfirmSend = async (dispatchIds: string[]) => {
    setConfirming(true);
    try {
      for (const id of dispatchIds) {
        const res = await fetch(`/api/dispatches/${id}/confirm`, { method: 'POST' });
        if (!res.ok) throw new Error(`Confirmation failed (${res.status})`);
      }
      setConfirmDialog(null);
      showToast('Dispatch marked as sent.');
      await loadCategoriesData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Confirmation error');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="min-h-dvh bg-surface-alt pb-16">
      <AppHeader />

      <main className="mx-auto max-w-7xl px-4 sm:px-6 pt-5">
        {/* Navigation & Header */}
        <div className="mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link
                href={`/hub?p=${projectId}`}
                className="inline-flex items-center gap-1 text-xs font-semibold text-text-secondary hover:text-text-primary"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Dashboard
              </Link>
              <span className="text-text-muted text-xs">/</span>
              <span className="text-xs font-semibold text-text-muted">Reminder Format</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary">
              Reminders -- {projectName}
            </h1>
            <p className="text-xs text-text-secondary mt-0.5">
              Send follow-up reminders per category to trade contractors and execution teams (HansalV2 matrix).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/projects/${projectId}`}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-alt transition-colors"
            >
              Project Details
            </Link>
            <Link
              href={`/hub?p=${projectId}`}
              className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors"
            >
              Open Dashboard
            </Link>
          </div>
        </div>

        {/* Global Notifications */}
        {toast && (
          <div role="status" className="mb-4 rounded-xl border border-success/30 bg-success-light px-4 py-3 text-xs font-semibold text-success shadow-xs">
            {toast}
          </div>
        )}
        {error && (
          <div role="alert" className="mb-4 rounded-xl border border-danger/30 bg-danger-light px-4 py-3 text-xs font-semibold text-danger shadow-xs">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <svg className="h-8 w-8 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* ────────────────────── LEFT COLUMN: CATEGORIES TABLE ────────────────────── */}
            <div className="lg:col-span-7 xl:col-span-8 space-y-4">
              <div className="rounded-2xl border border-border bg-surface overflow-hidden shadow-2xs">
                <div className="border-b border-border/70 px-4 py-3 bg-surface-alt/50 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                    Reminder Format Categories
                  </span>
                  <span className="text-xs text-text-muted">
                    {categories.length} categories configured
                  </span>
                </div>

                <div className="divide-y divide-border">
                  {categories.map((cat) => {
                    const isFocused = focusedCategoryKey === cat.key;
                    const chipStyle = CATEGORY_CHIP_COLORS[cat.key] ?? CATEGORY_CHIP_COLORS.all;
                    const catSelectedRecipients = selectedRecipients[cat.key] ?? new Set();
                    // Sendable only with pending items and at least one ticked group that exists in this project.
                    const hasPending = cat.itemCount > 0 &&
                      cat.recipients.some((r) => r.agencies.length > 0 && catSelectedRecipients.has(r.agencyTypeId));
                    const isSendingThisCat = sendingState?.key === cat.key;

                    return (
                      <div
                        key={cat.key}
                        onClick={() => setFocusedCategoryKey(cat.key)}
                        className={`p-4 sm:p-5 transition-colors cursor-pointer ${
                          isFocused ? 'bg-accent/5 ring-1 ring-inset ring-accent/30' : 'hover:bg-surface-alt/40'
                        }`}
                      >
                        {/* Top: Category Chip + Pending Count */}
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-bold ${chipStyle.bg} ${chipStyle.text} ${chipStyle.border}`}
                            >
                              {cat.label}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                                hasPending
                                  ? 'bg-warning-light text-warning border border-warning/20'
                                  : 'bg-surface-alt text-text-muted border border-border'
                              }`}
                            >
                              {cat.itemCount} pending
                            </span>
                          </div>

                          {!hasPending && (
                            <span className="text-xs font-medium text-text-muted italic">
                              Nothing pending
                            </span>
                          )}
                        </div>

                        {/* Recipient Checkboxes */}
                        <div className="mb-4">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">
                            Recipients offered:
                          </p>
                          <div className="flex flex-wrap gap-2.5">
                            {cat.recipients.map((rg) => {
                              const hasAgencies = rg.agencies.length > 0;
                              const contactCount = rg.agencies.reduce(
                                (acc, a) => acc + (a.contacts?.length ?? 0),
                                0
                              );
                              const isChecked = catSelectedRecipients.has(rg.agencyTypeId);

                              return (
                                <label
                                  key={rg.agencyTypeId}
                                  onClick={(e) => e.stopPropagation()}
                                  className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                                    !hasAgencies
                                      ? 'opacity-40 cursor-not-allowed border-dashed border-border bg-surface-alt/30 text-text-muted'
                                      : isChecked
                                      ? 'border-accent bg-accent/10 text-accent font-semibold shadow-2xs'
                                      : 'border-border bg-surface text-text-secondary hover:border-text-secondary'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    disabled={!hasAgencies}
                                    checked={isChecked}
                                    onChange={() => toggleRecipient(cat.key, rg.agencyTypeId)}
                                    className="h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent"
                                  />
                                  <span>
                                    {rg.name}{' '}
                                    <span className="text-[11px] text-text-muted">
                                      ({hasAgencies ? contactCount : 'not added'})
                                    </span>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        {/* Action Buttons: Send WhatsApp · Send Email */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/50">
                          <span className="text-xs text-text-muted">
                            {isFocused ? 'Previewing' : 'Click row to preview draft'}
                          </span>

                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              disabled={!hasPending || isSendingThisCat}
                              onClick={() => handleSendReminder(cat, 'whatsapp')}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <svg className="h-3.5 w-3.5 text-success" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.007c.106.005.249-.04.39.299.144.347.491 1.2.534 1.287.043.087.072.188.014.303-.058.116-.087.188-.173.289l-.26.302c-.087.087-.179.182-.077.357.101.174.449.741.964 1.2.662.589 1.221.77 1.394.856.173.086.274.072.375-.043.101-.116.433-.506.549-.679.116-.173.231-.144.39-.086s1.011.477 1.184.563c.173.087.289.13.332.202.043.073.043.419-.101.824z" />
                              </svg>
                              {isSendingThisCat && sendingState?.channel === 'whatsapp' ? 'Sending…' : 'Send WhatsApp'}
                            </button>

                            <button
                              type="button"
                              disabled={!hasPending || isSendingThisCat}
                              onClick={() => handleSendReminder(cat, 'email')}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                              {isSendingThisCat && sendingState?.channel === 'email' ? 'Sending…' : 'Send Email'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ────────────────────── RIGHT COLUMN: STICKY PREVIEW PANEL ────────────────────── */}
            <div className="lg:col-span-5 xl:col-span-4 sticky top-6 space-y-4">
              <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between border-b border-border/70 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-text-primary">
                      Draft Preview
                    </h3>
                    <p className="text-[11px] text-text-secondary">
                      {focusedCategory ? focusedCategory.label : 'Select a category'}
                    </p>
                  </div>

                  {/* Channel Tabs: Email | WhatsApp */}
                  <div className="flex rounded-lg bg-surface-alt p-0.5 border border-border">
                    <button
                      type="button"
                      onClick={() => setPreviewTab('whatsapp')}
                      className={`rounded-md px-2.5 py-1 text-xs font-bold transition-colors ${
                        previewTab === 'whatsapp'
                          ? 'bg-surface text-text-primary shadow-2xs'
                          : 'text-text-muted hover:text-text-primary'
                      }`}
                    >
                      WhatsApp
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewTab('email')}
                      className={`rounded-md px-2.5 py-1 text-xs font-bold transition-colors ${
                        previewTab === 'email'
                          ? 'bg-surface text-text-primary shadow-2xs'
                          : 'text-text-muted hover:text-text-primary'
                      }`}
                    >
                      Email
                    </button>
                  </div>
                </div>

                {previewLoading ? (
                  <div className="flex justify-center py-12">
                    <svg className="h-6 w-6 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </div>
                ) : !focusedCategory || focusedCategory.itemCount === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-text-muted">
                    No pending items for this category.
                  </div>
                ) : previewTab === 'email' ? (
                  /* ── EMAIL PREVIEW ── */
                  <div className="space-y-2.5 text-xs">
                    <div className="rounded-lg bg-surface-alt p-2.5 border border-border space-y-1">
                      <div>
                        <span className="font-semibold text-text-secondary">To: </span>
                        <span className="text-text-primary">
                          {previewData?.drafts?.some((d) => d.email) ? previewData.drafts.flatMap((d) => d.email?.to ?? []).map(personLabel).join(', ') : previewData?.warnings?.join(' ') || 'No recipient email'}
                        </span>
                      </div>
                      <div>
                        <span className="font-semibold text-text-secondary">Subject: </span>
                        <span className="text-text-primary font-mono text-[11px]">
                          {previewData?.email?.subject || `Pending Dependencies -- ${projectName}`}
                        </span>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border overflow-hidden bg-white">
                      {previewData?.email?.html ? (
                        <iframe
                          title="Email Preview"
                          srcDoc={previewData.email.html}
                          sandbox="allow-same-origin"
                          className="w-full h-72 border-0 text-text-primary"
                        />
                      ) : (
                        <pre className="p-3 text-[11px] font-sans whitespace-pre-wrap text-text-primary leading-relaxed h-72 overflow-y-auto">
                          {previewData?.email?.text || 'No email draft available.'}
                        </pre>
                      )}
                    </div>
                  </div>
                ) : (
                  /* ── WHATSAPP PREVIEW ── */
                  <div className="space-y-2.5 text-xs">
                    <div className="rounded-lg bg-surface-alt p-2.5 border border-border">
                      <span className="font-semibold text-text-secondary">Recipients: </span>
                      <span className="text-text-primary">
                        {previewData?.drafts?.some((d) => d.whatsapp)
                          ? previewData.drafts.flatMap((d) => d.whatsapp?.to ?? []).map(personLabel).join(', ')
                          : previewData?.warnings?.join(' ') || 'No phone numbers on selected agencies'}
                      </span>
                    </div>

                    <div className="rounded-2xl bg-[#efeae2] p-3 border border-border">
                      <div className="rounded-xl bg-white p-3 shadow-2xs max-w-sm text-xs font-sans text-text-primary whitespace-pre-wrap leading-relaxed border border-border/40">
                        {previewData?.whatsapp?.text || 'No WhatsApp text draft.'}
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

        {/* ── Confirmation Modal for WhatsApp Dispatches ("I've sent it") ── */}
        {confirmDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
              <h2 className="text-base font-bold text-text-primary mb-2">
                Sent Confirmation
              </h2>
              <p className="text-xs text-text-secondary mb-4 leading-relaxed">
                WhatsApp was opened in your browser with the draft message. Once you tap Send on WhatsApp, click below to mark this dispatch as sent and advance reminder counters.
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
                  onClick={() => handleConfirmSend(confirmDialog.dispatchIds)}
                  className="rounded-lg bg-success px-4 py-2 text-xs font-bold text-white shadow-sm hover:opacity-90 transition-opacity"
                >
                  {confirming ? 'Saving…' : "I Have Sent It"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal for Popup-Blocked Links ── */}
        {popupLinksModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
              <h2 className="text-base font-bold text-text-primary mb-2">
                {popupLinksModal.title}
              </h2>
              <p className="text-xs text-text-secondary mb-4 leading-relaxed">
                Your browser blocked opening multiple popups automatically. Click each link below to launch your messaging apps:
              </p>

              <div className="mb-4 space-y-2">
                {popupLinksModal.links.map((link, idx) => (
                  <a
                    key={idx}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-lg border border-border bg-surface-alt px-3 py-2.5 text-xs font-semibold text-accent hover:bg-accent/10 transition-colors"
                  >
                    <span>{link.label}</span>
                    <span>Launch -&gt;</span>
                  </a>
                ))}
              </div>

              <div className="flex justify-end pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setPopupLinksModal(null)}
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
