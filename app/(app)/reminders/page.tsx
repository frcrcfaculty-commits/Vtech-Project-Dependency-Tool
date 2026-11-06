'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/client/supabase';
import { useAuth } from '@/components/auth-provider';
import { AppHeader } from '@/components/app-header';
import { ReminderBoard, type ReminderCategory } from '@/components/v10/reminder-board';

interface ActiveProject {
  id: string;
  name: string;
}

function RemindersPageContent() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [projects, setProjects] = useState<ActiveProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [loadingProjects, setLoadingProjects] = useState(true);

  // Categories received from ReminderBoard
  const [projectCategories, setProjectCategories] = useState<ReminderCategory[]>([]);
  const [currentProjectName, setCurrentProjectName] = useState<string>('');

  // Template email composer state
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedRecipientGroupIds, setSelectedRecipientGroupIds] = useState<Set<string>>(new Set());
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');

  // 1. Load active projects
  useEffect(() => {
    let isCancelled = false;
    const fetchProjects = async () => {
      setLoadingProjects(true);
      try {
        const sb = supabaseBrowser();
        const { data } = await sb
          .from('projects')
          .select('id, name')
          .eq('status', 'active')
          .order('name');

        const activeList = (data ?? []) as ActiveProject[];
        if (!isCancelled) {
          setProjects(activeList);
          const pParam = searchParams.get('p');
          if (pParam && activeList.some((p) => p.id === pParam)) {
            setSelectedProjectId(pParam);
          } else if (activeList.length > 0) {
            setSelectedProjectId(activeList[0].id);
          }
        }
      } finally {
        if (!isCancelled) setLoadingProjects(false);
      }
    };

    fetchProjects();
    return () => {
      isCancelled = true;
    };
  }, [searchParams]);

  const activeProject = useMemo(() => {
    return projects.find((p) => p.id === selectedProjectId) ?? null;
  }, [projects, selectedProjectId]);

  const selectProject = (id: string) => {
    setSelectedProjectId(id);
    router.replace(`/reminders?p=${id}`);
  };

  // Distinct recipient groups across all categories of the selected project
  interface UniqueRecipientGroup {
    id: string;
    name: string;
    isClient: boolean;
    contacts: { name: string; email: string }[];
  }

  const uniqueRecipientGroups = useMemo(() => {
    const map = new Map<string, UniqueRecipientGroup>();

    projectCategories.forEach((cat) => {
      cat.recipients.forEach((rg) => {
        if (!map.has(rg.agencyTypeId)) {
          const isClient = rg.name.trim().toLowerCase() === 'client';
          const contactsWithEmail = rg.agencies
            .flatMap((a) =>
              a.contacts
                .filter((c) => c.email && c.email.trim().length > 0)
                .map((c) => ({
                  name: c.name || a.companyName || rg.name,
                  email: c.email!.trim(),
                }))
            );

          map.set(rg.agencyTypeId, {
            id: rg.agencyTypeId,
            name: rg.name,
            isClient,
            contacts: contactsWithEmail,
          });
        }
      });
    });

    return Array.from(map.values());
  }, [projectCategories]);

  // Open Template Composer modal and prefill content
  const handleOpenComposer = () => {
    const projName = activeProject?.name || currentProjectName || 'Project';
    const pmName = profile?.full_name || 'Project Manager';

    // Default recipients: all non-client groups with email contacts checked
    const initialChecked = new Set<string>();
    uniqueRecipientGroups.forEach((rg) => {
      if (!rg.isClient && rg.contacts.length > 0) {
        initialChecked.add(rg.id);
      }
    });
    setSelectedRecipientGroupIds(initialChecked);

    setEmailSubject(`[${projName}] Site Status & Dependencies`);
    setEmailBody(
      `Dear All,\n\nPlease find the latest status update and pending dependencies for ${projName}.\n\nKindly review the open items and share updates on the schedule.\n\nBest regards,\n${pmName}\nVTech Site Team`
    );
    setComposerOpen(true);
  };

  const toggleComposerRecipient = (groupId: string) => {
    setSelectedRecipientGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  // Open in Gmail (view=cm&fs=1)
  const handleOpenInGmail = () => {
    const allEmails: string[] = [];
    uniqueRecipientGroups.forEach((rg) => {
      if (selectedRecipientGroupIds.has(rg.id)) {
        rg.contacts.forEach((c) => allEmails.push(c.email));
      }
    });

    const uniqueEmails = Array.from(new Set(allEmails));
    const toParam = uniqueEmails.length > 0 ? `&to=${encodeURIComponent(uniqueEmails.join(','))}` : '';
    const subjectParam = `&su=${encodeURIComponent(emailSubject)}`;
    const bodyParam = `&body=${encodeURIComponent(emailBody)}`;
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1${toParam}${subjectParam}${bodyParam}`;

    window.open(gmailUrl, '_blank');
    setComposerOpen(false);
  };

  return (
    <div className="min-h-dvh bg-surface-alt pb-28">
      <AppHeader />

      <main className="mx-auto max-w-7xl px-4 sm:px-6 pt-5">
        {/* Header & Active Project Chips */}
        <div className="mb-5 border-b border-border pb-4 space-y-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-text-primary">
              Reminders
            </h1>
            <p className="text-xs text-text-secondary mt-0.5">
              Select an active project to view category boxes, inspect drafts, and send follow-up reminders.
            </p>
          </div>

          {/* Active project chips row */}
          {loadingProjects ? (
            <div className="flex items-center gap-2 py-2">
              <span className="h-4 w-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-text-muted">Loading projects…</span>
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-4 text-xs text-text-muted">
              No active projects found.
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {projects.map((p) => {
                const isSelected = p.id === selectedProjectId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectProject(p.id)}
                    className={`rounded-full px-4 py-1.5 text-xs transition-all shadow-2xs ${
                      isSelected
                        ? 'bg-text-primary text-surface font-extrabold shadow-xs scale-102 ring-2 ring-text-primary/20'
                        : 'border border-border bg-surface text-text-secondary font-bold hover:border-text-muted hover:text-text-primary hover:bg-surface-alt'
                    }`}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected Project Reminder Board */}
        {selectedProjectId ? (
          <ReminderBoard
            key={selectedProjectId}
            projectId={selectedProjectId}
            projectName={activeProject?.name}
            showBreadcrumbNav={false}
            onCategoriesLoaded={(cats, name) => {
              setProjectCategories(cats);
              setCurrentProjectName(name);
            }}
          />
        ) : (
          !loadingProjects && (
            <div className="rounded-xl border border-dashed border-border p-12 text-center text-xs text-text-muted">
              Please select a project above to inspect reminders.
            </div>
          )
        )}
      </main>

      {/* Floating "Template email" button (only on /reminders) */}
      {selectedProjectId && (
        <button
          type="button"
          aria-label="Template email"
          onClick={handleOpenComposer}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-accent py-2.5 pl-3.5 pr-4 text-xs sm:text-sm font-bold text-white shadow-xl transition hover:scale-105 active:scale-95"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span>Template email</span>
        </button>
      )}

      {/* Template Email Composer Modal */}
      {composerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-surface p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-extrabold text-text-primary">Template Email</h3>
                <p className="text-xs text-text-secondary mt-0.5">
                  Project: <strong className="text-text-primary font-bold">{activeProject?.name || currentProjectName}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setComposerOpen(false)}
                className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-alt"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Recipient Groups Checkboxes */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-text-muted">
                Recipient Groups (Checked will receive email)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-xl border border-border bg-surface-alt/60 max-h-48 overflow-y-auto">
                {uniqueRecipientGroups.map((rg) => {
                  const isChecked = selectedRecipientGroupIds.has(rg.id);
                  const hasEmail = rg.contacts.length > 0;
                  return (
                    <label
                      key={rg.id}
                      className={`flex items-start gap-2 text-xs p-1 rounded hover:bg-surface select-none ${
                        !hasEmail ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={!hasEmail}
                        checked={isChecked}
                        onChange={() => toggleComposerRecipient(rg.id)}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent disabled:cursor-not-allowed shrink-0"
                      />
                      <div className="truncate">
                        <span className={`block truncate ${isChecked ? 'font-bold text-text-primary' : 'text-text-secondary'}`}>
                          {rg.name} {rg.isClient ? '(Owner)' : ''}
                        </span>
                        <span className="block text-[10px] text-text-muted truncate">
                          {hasEmail ? rg.contacts.map((c) => c.email).join(', ') : 'No email contact'}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Subject Field */}
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase tracking-wider text-text-muted">
                Subject
              </label>
              <input
                type="text"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium text-text-primary focus:border-accent focus:outline-none"
              />
            </div>

            {/* Body Field */}
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase tracking-wider text-text-muted">
                Body
              </label>
              <textarea
                rows={7}
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface p-3 text-xs font-sans text-text-primary leading-relaxed focus:border-accent focus:outline-none"
              />
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setComposerOpen(false)}
                className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-semibold text-text-secondary hover:bg-surface-alt"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleOpenInGmail}
                className="rounded-lg bg-accent px-4 py-1.5 text-xs font-bold text-white hover:bg-accent-hover transition-colors shadow-xs flex items-center gap-1.5"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                <span>Open in Gmail</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RemindersPage() {
  return (
    <Suspense fallback={null}>
      <RemindersPageContent />
    </Suspense>
  );
}
