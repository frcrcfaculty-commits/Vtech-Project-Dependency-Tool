'use client';

import { useState, useEffect, useCallback, use, useMemo } from 'react';
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
  section: 'all' | 'vtech' | 'other';
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

function formatRecipientName(name: string, section: string): string {
  const lower = name.toLowerCase();
  if (section === 'vtech') {
    if (lower === 'vtech pm' || lower.includes('sales') || lower.includes('project manager')) return 'VTECH PM';
    if (lower.includes('installer')) return 'Installer';
    if (lower.includes('programmer')) return 'Programmer';
  }
  if (lower.includes('pmc') || lower.includes('architect')) return 'PMC';
  if (lower === 'vtech pm' || lower.includes('sales') || lower.includes('project manager')) return 'VTECH PM';
  if (lower.includes('installer')) return 'Installer';
  if (lower.includes('programmer')) return 'Programmer';
  return name;
}

function EyeIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

function WhatsAppIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.007c.106.005.249-.04.39.299.144.347.491 1.2.534 1.287.043.087.072.188.014.303-.058.116-.087.188-.173.289l-.26.302c-.087.087-.179.182-.077.357.101.174.449.741.964 1.2.662.589 1.221.77 1.394.856.173.086.274.072.375-.043.101-.116.433-.506.549-.679.116-.173.231-.144.39-.086s1.011.477 1.184.563c.173.087.289.13.332.202.043.073.043.419-.101.824z" />
    </svg>
  );
}

function MailIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

export default function ProjectRemindersPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);

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
  const [showMobilePreview, setShowMobilePreview] = useState(false);

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
            loadedCats = json.map((c: any) => ({
              ...c,
              section: c.section || (['installer', 'programmer', 'sales'].includes(c.key) ? 'vtech' : ['electrical', 'carpentry'].includes(c.key) ? 'other' : 'all'),
            }));
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

        interface DbCat { key: string; label: string; colour: string | null; sort: number; section?: 'all' | 'vtech' | 'other' }
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
            section: c.section || (['installer', 'programmer', 'sales'].includes(c.key) ? 'vtech' : ['electrical', 'carpentry'].includes(c.key) ? 'other' : 'all'),
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
          if (rg.defaultChecked && rg.agencies.length > 0) {
            selected.add(rg.agencyTypeId);
          }
        });
        initialSelected[c.key] = selected;
      });
      setSelectedRecipients(initialSelected);

      if (loadedCats.length > 0) {
        setFocusedCategoryKey((prev) => (loadedCats.some((c) => c.key === prev) ? prev : loadedCats[0].key));
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

  // Toggle recipient checkbox
  const toggleRecipient = (categoryKey: string, agencyTypeId: string) => {
    setSelectedRecipients((prev) => {
      const currentSet = new Set(prev[categoryKey] ?? []);
      if (currentSet.has(agencyTypeId)) {
        currentSet.delete(agencyTypeId);
      } else {
        currentSet.add(agencyTypeId);
      }
      return { ...prev, [categoryKey]: currentSet };
    });
  };

  const focusedCategory = useMemo(() => {
    return categories.find((c) => c.key === focusedCategoryKey) ?? categories[0] ?? null;
  }, [categories, focusedCategoryKey]);

  // Load preview whenever focusedCategory, its checked recipients, or previewTab change
  useEffect(() => {
    if (!focusedCategory || focusedCategory.itemCount === 0) {
      setPreviewData(null);
      return;
    }

    const recipientIds = Array.from(selectedRecipients[focusedCategory.key] ?? []);
    if (recipientIds.length === 0) {
      setPreviewData(null);
      return;
    }

    let isCancelled = false;
    const fetchPreview = async () => {
      setPreviewLoading(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/reminder-rounds`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: focusedCategory.key,
            agencyTypeIds: recipientIds,
            channel: previewTab,
            preview: true,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error || `Failed to load draft preview (${res.status})`);
        }

        const data: PreviewResult = await res.json();
        if (!isCancelled) {
          setPreviewData(data);
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('Preview error:', err);
          setPreviewData(null);
        }
      } finally {
        if (!isCancelled) setPreviewLoading(false);
      }
    };

    fetchPreview();
    return () => {
      isCancelled = true;
    };
  }, [projectId, focusedCategory, selectedRecipients, previewTab]);

  // Dispatch reminders
  const handleSendReminder = async (cat: ReminderCategory, channel: 'email' | 'whatsapp') => {
    const recipientIds = Array.from(selectedRecipients[cat.key] ?? []);
    if (recipientIds.length === 0) {
      setError(`Please select at least one recipient group for ${cat.label}.`);
      return;
    }

    try {
      setSendingState({ key: cat.key, channel });
      setError(null);

      const res = await fetch(`/api/projects/${projectId}/reminder-rounds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: cat.key,
          agencyTypeIds: recipientIds,
          channel,
          preview: false,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `Failed to send reminders (${res.status})`);
      }

      const result = await res.json();
      const dispatches: any[] = result.dispatches ?? [];

      const needsConfirmation = dispatches.filter(
        (d) => d.id && (d.outcome?.status ?? 'needs_confirmation') === 'needs_confirmation'
      );

      const links: { label: string; url: string }[] = [];
      dispatches.forEach((d) => {
        const url = d.outcome?.link || d.outcome?.details?.link;
        if (url) {
          links.push({
            label: `${d.agency?.companyName || d.agency || 'Agency'} (${d.channel})`,
            url,
          });
        }
      });

      if (links.length > 0) {
        const first = window.open(links[0].url, '_blank');
        if (!first || first.closed || typeof first.closed === 'undefined') {
          setPopupLinksModal({
            title: `Your browser blocked popups. Open ${channel === 'whatsapp' ? 'WhatsApp' : 'Gmail'} manually:`,
            links,
          });
        }
        if (needsConfirmation.length > 0) {
          setConfirmDialog({
            dispatchIds: needsConfirmation.map((d) => d.id),
            links,
          });
        }
      } else {
        showToast(`Reminders sent successfully for ${cat.label}!`);
      }

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

  // 3 Boxes grouping
  const sections = useMemo(() => {
    const allCats = categories.filter((c) => c.section === 'all' || c.key === 'all');
    const vtechCats = categories.filter((c) => c.section === 'vtech' || ['installer', 'programmer', 'sales'].includes(c.key));
    const otherCats = categories.filter((c) => c.section === 'other' || ['electrical', 'carpentry'].includes(c.key));

    return [
      {
        id: 'all',
        title: 'All dependencies',
        subtitle: 'Select recipients to follow up on all outstanding project dependencies',
        categories: allCats,
      },
      {
        id: 'vtech',
        title: 'VTECH dependencies',
        subtitle: 'Internal team follow-ups (Installer, Programmer, PM)',
        categories: vtechCats,
      },
      {
        id: 'other',
        title: 'Other agency',
        subtitle: 'External trade contractor follow-ups (Electrician, Carpenter)',
        categories: otherCats,
      },
    ];
  }, [categories]);

  // Recipient chips extracted from previewData
  const recipientChips = useMemo(() => {
    if (!previewData?.drafts) return [];
    const list: string[] = [];
    previewData.drafts.forEach((d) => {
      if (previewTab === 'email' && d.email) {
        d.email.to.forEach((p) => list.push(personLabel(p)));
      } else if (previewTab === 'whatsapp' && d.whatsapp) {
        d.whatsapp.to.forEach((p) => list.push(personLabel(p)));
      }
    });
    return Array.from(new Set(list));
  }, [previewData, previewTab]);

  // Preview content component
  const renderPreviewContent = () => {
    if (previewLoading) {
      return (
        <div className="flex flex-1 items-center justify-center py-20">
          <svg className="h-7 w-7 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      );
    }

    if (!focusedCategory || focusedCategory.itemCount === 0) {
      return (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-xs text-text-muted">
          No pending items for {focusedCategory?.label ?? 'this category'}.
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col space-y-3 min-h-[440px]">
        {/* Recipients chips above draft */}
        <div className="flex flex-wrap items-center gap-1.5 p-2.5 rounded-xl bg-surface-alt/70 border border-border">
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted mr-1">
            Recipients:
          </span>
          {recipientChips.length > 0 ? (
            recipientChips.map((chip, idx) => (
              <span
                key={idx}
                className="inline-flex items-center rounded-md bg-surface px-2 py-0.5 text-[11px] font-medium text-text-primary border border-border/80 shadow-2xs"
              >
                {chip}
              </span>
            ))
          ) : (
            <span className="text-xs text-text-muted italic">No contacts available on selected groups</span>
          )}
        </div>

        {previewTab === 'email' ? (
          <div className="flex-1 flex flex-col space-y-2 text-xs">
            <div className="rounded-xl border border-border bg-surface px-3 py-2 space-y-1 shadow-2xs">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-[11px] text-text-secondary">Subject: </span>
                <span className="text-text-primary font-mono text-[11px] truncate">
                  {previewData?.email?.subject || `Pending Dependencies — ${projectName}`}
                </span>
              </div>
            </div>

            <div className="flex-1 rounded-xl border border-border overflow-hidden bg-white shadow-2xs min-h-[400px]">
              {previewData?.email?.html ? (
                <iframe
                  title="Email Preview"
                  srcDoc={previewData.email.html}
                  sandbox="allow-same-origin"
                  className="w-full h-full min-h-[400px] border-0 text-text-primary"
                />
              ) : (
                <pre className="p-4 text-xs font-sans whitespace-pre-wrap text-text-primary leading-relaxed h-full overflow-y-auto">
                  {previewData?.email?.text || 'No email draft available.'}
                </pre>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col rounded-2xl bg-[#efeae2] p-4 border border-border shadow-2xs min-h-[440px] overflow-y-auto">
            <div className="rounded-2xl bg-white p-4 shadow-sm max-w-lg text-[15px] font-sans text-text-primary whitespace-pre-wrap leading-relaxed border border-border/40">
              {previewData?.whatsapp?.text || 'No WhatsApp text draft available.'}
              <div className="mt-2 text-right text-[11px] text-text-muted">
                Just now
              </div>
            </div>
          </div>
        )}

        {/* Warnings under the preview */}
        {previewData?.warnings && previewData.warnings.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-amber-900">
              <svg className="h-4 w-4 shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>Recipient Notice</span>
            </div>
            <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-amber-800">
              {previewData.warnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  // Render Equal-Width Action Buttons (Line 3 of card)
  const renderActionButtons = (
    cat: ReminderCategory,
    isFocused: boolean,
    hasPending: boolean,
    isSendingThisCat: boolean
  ) => {
    return (
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {/* Preview Button */}
        <button
          type="button"
          onClick={() => {
            setFocusedCategoryKey(cat.key);
            setShowMobilePreview(true);
          }}
          className={`h-8 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors min-w-[84px] ${
            isFocused
              ? 'border-accent bg-accent/15 text-accent shadow-xs'
              : 'border-border bg-surface text-text-secondary hover:bg-surface-alt hover:text-text-primary'
          }`}
        >
          <EyeIcon />
          <span>Preview</span>
        </button>

        {/* WhatsApp Button */}
        <button
          type="button"
          disabled={!hasPending || isSendingThisCat}
          onClick={() => handleSendReminder(cat, 'whatsapp')}
          className="h-8 px-3 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs min-w-[84px]"
        >
          {isSendingThisCat && sendingState?.channel === 'whatsapp' ? (
            <span className="h-3.5 w-3.5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <WhatsAppIcon />
              <span>WhatsApp</span>
            </>
          )}
        </button>

        {/* Email Button */}
        <button
          type="button"
          disabled={!hasPending || isSendingThisCat}
          onClick={() => handleSendReminder(cat, 'email')}
          className="h-8 px-3 rounded-lg border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs min-w-[84px]"
        >
          {isSendingThisCat && sendingState?.channel === 'email' ? (
            <span className="h-3.5 w-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <MailIcon />
              <span>Email</span>
            </>
          )}
        </button>
      </div>
    );
  };

  return (
    <div className="min-h-dvh bg-surface-alt pb-24">
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
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-text-primary">
              Reminders — {projectName}
            </h1>
            <p className="text-xs text-text-secondary mt-0.5">
              Send follow-up reminders per category to trade contractors and execution teams (HansalV2 matrix).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/projects/${projectId}`}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-surface-alt transition-colors"
            >
              Project Details
            </Link>
            <Link
              href={`/hub?p=${projectId}`}
              className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-accent-hover transition-colors"
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
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
            {/* ────────────────────── LEFT COLUMN (40%): 3 BOXES ────────────────────── */}
            <div className="lg:col-span-2 space-y-5">
              {sections.map((sec) => {
                if (sec.categories.length === 0) return null;
                const totalPending = sec.categories.reduce((acc, c) => acc + c.itemCount, 0);

                return (
                  <div
                    key={sec.id}
                    className="rounded-xl border border-border bg-surface overflow-hidden shadow-2xs"
                  >
                    {/* Box Header */}
                    <div className="border-b border-border/70 px-4 py-3 bg-surface-alt/60 flex items-center justify-between">
                      <div>
                        <h2 className="text-xs font-bold uppercase tracking-wider text-text-primary">
                          {sec.title}
                        </h2>
                        <p className="text-[11px] text-text-muted mt-0.5">
                          {sec.subtitle}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                          totalPending > 0
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-surface-alt text-text-muted border border-border'
                        }`}
                      >
                        {totalPending} pending
                      </span>
                    </div>

                    {/* Categories List (Same card design for All dependencies, VTECH dependencies, Other agency) */}
                    <div className="p-3.5 space-y-3.5">
                      {sec.categories.map((cat) => {
                        const isFocused = focusedCategoryKey === cat.key;
                        const chipStyle = CATEGORY_CHIP_COLORS[cat.key] ?? CATEGORY_CHIP_COLORS.all;
                        const catSelectedRecipients = selectedRecipients[cat.key] ?? new Set();
                        const hasPending =
                          cat.itemCount > 0 &&
                          cat.recipients.some(
                            (r) => r.agencies.length > 0 && catSelectedRecipients.has(r.agencyTypeId)
                          );
                        const isSendingThisCat = sendingState?.key === cat.key;

                        const isAllCat = cat.key === 'all';
                        const externalRecipients = isAllCat
                          ? cat.recipients.filter((rg) => !rg.name.toLowerCase().includes('vtech'))
                          : [];
                        const vtechRecipients = isAllCat
                          ? cat.recipients.filter((rg) => rg.name.toLowerCase().includes('vtech'))
                          : [];

                        return (
                          <div
                            key={cat.key}
                            onClick={() => setFocusedCategoryKey(cat.key)}
                            className={`rounded-xl border p-4 transition-all cursor-pointer flex flex-col gap-3.5 shadow-2xs ${
                              isFocused
                                ? 'border-accent bg-accent/5 ring-1 ring-accent'
                                : 'border-border/80 bg-surface hover:bg-surface-alt/40'
                            }`}
                          >
                            {/* Line 1: Category label + pending chip */}
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-bold ${chipStyle.bg} ${chipStyle.text} ${chipStyle.border}`}
                              >
                                {cat.label}
                              </span>
                              <span
                                className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                                  cat.itemCount > 0
                                    ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                    : 'bg-surface-alt text-text-muted border border-border'
                                }`}
                              >
                                {cat.itemCount} pending
                              </span>
                            </div>

                            {/* Line 2: Checkboxes */}
                            {isAllCat ? (
                              /* All dependencies: two sub-groups side by side: left = external, right = VTech */
                              <div
                                className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-surface-alt/50 border border-border/60"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {/* Left Sub-group: External */}
                                <div className="space-y-1.5">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted block border-b border-border/40 pb-1">
                                    External
                                  </span>
                                  <div className="space-y-1.5 pt-0.5">
                                    {externalRecipients.map((rg) => {
                                      const isChecked = catSelectedRecipients.has(rg.agencyTypeId);
                                      const hasAgencies = rg.agencies.length > 0;
                                      const displayName = formatRecipientName(rg.name, cat.section);
                                      return (
                                        <label
                                          key={rg.agencyTypeId}
                                          title={!hasAgencies ? `${rg.name} (not added to project)` : rg.name}
                                          className={`flex items-center gap-2 text-xs select-none transition-opacity ${
                                            !hasAgencies
                                              ? 'opacity-40 cursor-not-allowed text-text-muted'
                                              : 'cursor-pointer text-text-secondary hover:text-text-primary'
                                          }`}
                                        >
                                          <input
                                            type="checkbox"
                                            disabled={!hasAgencies}
                                            checked={isChecked}
                                            onChange={() => toggleRecipient(cat.key, rg.agencyTypeId)}
                                            className="h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent disabled:cursor-not-allowed shrink-0"
                                          />
                                          <span className={`truncate ${isChecked ? 'font-semibold text-text-primary' : ''}`}>
                                            {displayName}
                                          </span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>

                                {/* Right Sub-group: VTech */}
                                <div className="space-y-1.5">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted block border-b border-border/40 pb-1">
                                    VTech
                                  </span>
                                  <div className="space-y-1.5 pt-0.5">
                                    {vtechRecipients.map((rg) => {
                                      const isChecked = catSelectedRecipients.has(rg.agencyTypeId);
                                      const hasAgencies = rg.agencies.length > 0;
                                      const displayName = formatRecipientName(rg.name, cat.section);
                                      return (
                                        <label
                                          key={rg.agencyTypeId}
                                          title={!hasAgencies ? `${rg.name} (not added to project)` : rg.name}
                                          className={`flex items-center gap-2 text-xs select-none transition-opacity ${
                                            !hasAgencies
                                              ? 'opacity-40 cursor-not-allowed text-text-muted'
                                              : 'cursor-pointer text-text-secondary hover:text-text-primary'
                                          }`}
                                        >
                                          <input
                                            type="checkbox"
                                            disabled={!hasAgencies}
                                            checked={isChecked}
                                            onChange={() => toggleRecipient(cat.key, rg.agencyTypeId)}
                                            className="h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent disabled:cursor-not-allowed shrink-0"
                                          />
                                          <span className={`truncate ${isChecked ? 'font-semibold text-text-primary' : ''}`}>
                                            {displayName}
                                          </span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              /* VTech & Other categories: CSS grid, 2 columns, aligned */
                              <div
                                className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2 p-3 rounded-lg bg-surface-alt/50 border border-border/60"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {cat.recipients.map((rg) => {
                                  const isChecked = catSelectedRecipients.has(rg.agencyTypeId);
                                  const hasAgencies = rg.agencies.length > 0;
                                  const displayName = formatRecipientName(rg.name, cat.section);
                                  return (
                                    <label
                                      key={rg.agencyTypeId}
                                      title={!hasAgencies ? `${rg.name} (not added to project)` : rg.name}
                                      className={`flex items-center gap-2 text-xs select-none transition-opacity ${
                                        !hasAgencies
                                          ? 'opacity-40 cursor-not-allowed text-text-muted'
                                          : 'cursor-pointer text-text-secondary hover:text-text-primary'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        disabled={!hasAgencies}
                                        checked={isChecked}
                                        onChange={() => toggleRecipient(cat.key, rg.agencyTypeId)}
                                        className="h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent disabled:cursor-not-allowed shrink-0"
                                      />
                                      <span className={`truncate ${isChecked ? 'font-semibold text-text-primary' : ''}`}>
                                        {displayName}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}

                            {/* Line 3: Action buttons right-aligned, equal size */}
                            <div className="pt-2.5 border-t border-border/50 flex items-center justify-end">
                              {renderActionButtons(cat, isFocused, hasPending, isSendingThisCat)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ────────────────────── RIGHT COLUMN (60%): DRAFT PANEL (DESKTOP) ────────────────────── */}
            <div className="hidden lg:block lg:col-span-3 sticky top-6">
              <div className="rounded-xl border border-border bg-surface p-5 shadow-2xs min-h-[520px] flex flex-col space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-text-primary">
                      Draft Preview
                    </h3>
                    <p className="text-[11px] text-text-secondary">
                      {focusedCategory ? focusedCategory.label : 'Select a category'}
                    </p>
                  </div>

                  {/* Channel Tabs: Email | WhatsApp */}
                  <div className="flex rounded-lg bg-surface-alt p-1 border border-border">
                    <button
                      type="button"
                      onClick={() => setPreviewTab('email')}
                      className={`rounded-md px-3 py-1 text-xs font-bold transition-colors ${
                        previewTab === 'email'
                          ? 'bg-surface text-text-primary shadow-2xs'
                          : 'text-text-muted hover:text-text-primary'
                      }`}
                    >
                      Email
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewTab('whatsapp')}
                      className={`rounded-md px-3 py-1 text-xs font-bold transition-colors ${
                        previewTab === 'whatsapp'
                          ? 'bg-surface text-text-primary shadow-2xs'
                          : 'text-text-muted hover:text-text-primary'
                      }`}
                    >
                      WhatsApp
                    </button>
                  </div>
                </div>

                {renderPreviewContent()}
              </div>
            </div>
          </div>
        )}

        {/* ── Mobile Bottom Sheet for Preview ── */}
        {showMobilePreview && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="fixed inset-0 bg-black/50 transition-opacity"
              onClick={() => setShowMobilePreview(false)}
            />
            <div className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] rounded-t-2xl border-t border-border bg-surface p-4 shadow-2xl overflow-y-auto flex flex-col">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <div>
                  <h3 className="text-sm font-bold text-text-primary">
                    Draft Preview — {focusedCategory?.label}
                  </h3>
                  <p className="text-[11px] text-text-muted">
                    {previewTab === 'whatsapp' ? 'WhatsApp draft' : 'Email draft'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex rounded-lg bg-surface-alt p-0.5 border border-border">
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
                    <button
                      type="button"
                      onClick={() => setPreviewTab('whatsapp')}
                      className={`rounded-md px-2.5 py-1 text-xs font-bold transition-colors ${
                        previewTab === 'whatsapp'
                          ? 'bg-surface text-text-primary shadow-2xs'
                          : 'text-text-muted hover:text-text-primary'
                      }`}
                    >
                      WA
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowMobilePreview(false)}
                    aria-label="Close preview"
                    className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-alt"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="pt-3 flex-1 overflow-y-auto space-y-3">
                {renderPreviewContent()}
              </div>
            </div>
          </div>
        )}

        {/* Modal: Links for Popup Blocker Fallback */}
        {popupLinksModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl space-y-4">
              <h3 className="text-sm font-bold text-text-primary">{popupLinksModal.title}</h3>
              <div className="space-y-2">
                {popupLinksModal.links.map((link, idx) => (
                  <a
                    key={idx}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-lg bg-surface-alt p-3 text-xs font-semibold text-accent hover:underline border border-border"
                  >
                    {link.label} ↗
                  </a>
                ))}
              </div>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setPopupLinksModal(null)}
                  className="rounded-lg border border-border px-4 py-1.5 text-xs font-semibold hover:bg-surface-alt"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Confirmation for Manual Dispatches */}
        {confirmDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl space-y-4">
              <h3 className="text-sm font-bold text-text-primary">Confirm Reminder Dispatches</h3>
              <p className="text-xs text-text-secondary">
                Did you send the drafted messages in the opened WhatsApp / Gmail tabs?
              </p>
              <div className="space-y-1.5">
                {confirmDialog.links.map((link, idx) => (
                  <div key={idx} className="flex items-center justify-between rounded-lg bg-surface-alt p-2 text-xs">
                    <span className="font-semibold text-text-primary">{link.label}</span>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent font-bold hover:underline"
                    >
                      Reopen tab ↗
                    </a>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setConfirmDialog(null)}
                  className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-alt"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={confirming}
                  onClick={() => handleConfirmSend(confirmDialog.dispatchIds)}
                  className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                  {confirming ? 'Saving…' : "I've Sent It"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
