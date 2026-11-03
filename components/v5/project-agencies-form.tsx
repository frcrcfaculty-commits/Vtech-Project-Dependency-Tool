'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabaseBrowser } from '@/lib/client/supabase';

export interface AgencyType {
  id: string;
  name: string;
  sort: number;
  internal: boolean;
  active: boolean;
  contact_slots: number | null;
}

export interface ContactDraft {
  id?: string;
  name: string;
  designation: string;
  email: string;
  phone: string;
  error?: string | null;
}

export interface GroupDraft {
  agencyTypeId: string;
  type: AgencyType;
  agencyId?: string;
  companyName: string;
  contacts: ContactDraft[];
}

export interface ProjectAgenciesFormProps {
  projectId: string;
  onSaved?: (message: string) => void;
  isWizard?: boolean;
  onNext?: () => void;
  onBack?: () => void;
}

export function ProjectAgenciesForm({
  projectId,
  onSaved,
  isWizard = false,
  onNext,
  onBack,
}: ProjectAgenciesFormProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [agencyTypes, setAgencyTypes] = useState<AgencyType[]>([]);
  const [groups, setGroups] = useState<Record<string, GroupDraft>>({});

  const showSuccessNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  };

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const sb = supabaseBrowser();

      const [{ data: typesData, error: typesErr }, { data: agenciesData, error: agenciesErr }] =
        await Promise.all([
          sb.from('agency_types').select('*').eq('active', true).order('sort'),
          sb.from('agencies').select('id, agency_type_id, company_name, agency_contacts(*)').eq('project_id', projectId),
        ]);

      if (typesErr) throw typesErr;
      if (agenciesErr) throw agenciesErr;

      const types = (typesData as AgencyType[]) ?? [];
      setAgencyTypes(types);

      const existingAgencies = (agenciesData as Array<{
        id: string;
        agency_type_id: string;
        company_name: string;
        agency_contacts: Array<{ id: string; name: string; designation: string | null; email: string | null; phone: string | null }>;
      }>) ?? [];

      const agencyByTypeId = new Map<string, typeof existingAgencies[0]>();
      existingAgencies.forEach((a) => {
        agencyByTypeId.set(a.agency_type_id, a);
      });

      const initialGroups: Record<string, GroupDraft> = {};

      types.forEach((t) => {
        const existing = agencyByTypeId.get(t.id);
        const savedContacts = (existing?.agency_contacts ?? []).map((c) => ({
          id: c.id,
          name: c.name ?? '',
          designation: c.designation ?? '',
          email: c.email ?? '',
          phone: c.phone ?? '',
        }));

        let contactRows: ContactDraft[] = [];

        if (!t.internal) {
          // External group: render contact_slots rows
          const slots = t.contact_slots ?? 2;
          contactRows = [...savedContacts];
          while (contactRows.length < slots) {
            contactRows.push({ name: '', designation: '', email: '', phone: '' });
          }
        } else {
          // Internal group: 1 row + add more
          contactRows = savedContacts.length > 0
            ? [...savedContacts]
            : [{ name: '', designation: '', email: '', phone: '' }];
        }

        initialGroups[t.id] = {
          agencyTypeId: t.id,
          type: t,
          agencyId: existing?.id,
          companyName: existing?.company_name && existing.company_name !== t.name ? existing.company_name : '',
          contacts: contactRows,
        };
      });

      setGroups(initialGroups);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agency configuration');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const externalTypes = useMemo(() => agencyTypes.filter((t) => !t.internal), [agencyTypes]);
  const internalTypes = useMemo(() => agencyTypes.filter((t) => t.internal), [agencyTypes]);

  const updateCompanyName = (typeId: string, name: string) => {
    setGroups((prev) => {
      const g = prev[typeId];
      if (!g) return prev;
      return {
        ...prev,
        [typeId]: { ...g, companyName: name },
      };
    });
  };

  const updateContact = (typeId: string, idx: number, field: keyof ContactDraft, value: string) => {
    setGroups((prev) => {
      const g = prev[typeId];
      if (!g) return prev;
      const updated = [...g.contacts];
      updated[idx] = { ...updated[idx], [field]: value, error: null };
      return {
        ...prev,
        [typeId]: { ...g, contacts: updated },
      };
    });
  };

  const addInternalContact = (typeId: string) => {
    setGroups((prev) => {
      const g = prev[typeId];
      if (!g) return prev;
      return {
        ...prev,
        [typeId]: {
          ...g,
          contacts: [...g.contacts, { name: '', designation: '', email: '', phone: '' }],
        },
      };
    });
  };

  const removeInternalContact = (typeId: string, idx: number) => {
    setGroups((prev) => {
      const g = prev[typeId];
      if (!g) return prev;
      const updated = g.contacts.filter((_, i) => i !== idx);
      return {
        ...prev,
        [typeId]: {
          ...g,
          contacts: updated.length > 0 ? updated : [{ name: '', designation: '', email: '', phone: '' }],
        },
      };
    });
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);

    // 1. Validate contacts
    let hasValidationErrors = false;
    const validatedGroups: Record<string, GroupDraft> = {};

    Object.entries(groups).forEach(([typeId, g]) => {
      const updatedContacts = g.contacts.map((c) => {
        const isBlank = !c.name.trim() && !c.designation.trim() && !c.email.trim() && !c.phone.trim();
        if (isBlank) return { ...c, error: null };

        if (!c.name.trim()) {
          hasValidationErrors = true;
          return { ...c, error: 'Name is required' };
        }
        if (!c.email.trim() && !c.phone.trim()) {
          hasValidationErrors = true;
          return { ...c, error: 'Email or phone required' };
        }
        return { ...c, error: null };
      });

      validatedGroups[typeId] = {
        ...g,
        contacts: updatedContacts,
      };
    });

    setGroups(validatedGroups);

    if (hasValidationErrors) {
      setError('Please fix the highlighted contact errors before saving.');
      return;
    }

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      for (const t of agencyTypes) {
        const g = groups[t.id];
        if (!g) continue;

        const filledContacts = g.contacts.filter(
          (c) => c.name.trim() && (c.email.trim() || c.phone.trim())
        );

        const companyName = g.companyName.trim() || t.name;

        // If no contacts and no custom company name and not existing, skip
        if (filledContacts.length === 0 && !g.companyName.trim() && !g.agencyId) {
          continue;
        }

        // Upsert agency
        let agencyId = g.agencyId;
        if (!agencyId) {
          const { data: newAg, error: agErr } = await sb
            .from('agencies')
            .insert({
              project_id: projectId,
              agency_type_id: t.id,
              company_name: companyName,
              escalation_enabled: true,
            })
            .select('id')
            .single();

          if (agErr) throw agErr;
          agencyId = newAg.id;
        } else {
          const { error: updErr } = await sb
            .from('agencies')
            .update({
              company_name: companyName,
            })
            .eq('id', agencyId);

          if (updErr) throw updErr;
        }

        // Sync contacts for this agency
        // A. Delete existing contacts that are no longer kept
        const keptContactIds = new Set(filledContacts.map((c) => c.id).filter(Boolean));
        const { data: currentDbContacts } = await sb
          .from('agency_contacts')
          .select('id')
          .eq('agency_id', agencyId);

        const toDeleteIds = ((currentDbContacts ?? []) as Array<{ id: string }>)
          .map((c) => c.id)
          .filter((id: string) => !keptContactIds.has(id));

        if (toDeleteIds.length > 0) {
          const { error: delErr } = await sb
            .from('agency_contacts')
            .delete()
            .in('id', toDeleteIds);
          if (delErr) throw delErr;
        }

        // B. Update existing contacts & Insert new contacts
        for (const c of filledContacts) {
          if (c.id) {
            const { error: cUpdErr } = await sb
              .from('agency_contacts')
              .update({
                name: c.name.trim(),
                designation: c.designation.trim() || null,
                email: c.email.trim() || null,
                phone: c.phone.trim() || null,
                level: 1,
              })
              .eq('id', c.id);
            if (cUpdErr) throw cUpdErr;
          } else {
            const { error: cInsErr } = await sb
              .from('agency_contacts')
              .insert({
                project_id: projectId,
                agency_id: agencyId,
                name: c.name.trim(),
                designation: c.designation.trim() || null,
                email: c.email.trim() || null,
                phone: c.phone.trim() || null,
                level: 1,
              });
            if (cInsErr) throw cInsErr;
          }
        }
      }

      await loadData();
      showSuccessNotice('Agencies and contacts saved successfully.');
      onSaved?.('Agencies and contacts saved.');
      if (isWizard && onNext) {
        onNext();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agencies');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <svg className="h-8 w-8 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {notice && (
        <div role="status" className="rounded-xl border border-success/30 bg-success-light px-4 py-3 text-sm font-medium text-success">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger-light px-4 py-3 text-sm font-medium text-danger">
          {error}
        </div>
      )}

      {/* ────────────────── SECTION 1: EXTERNAL AGENCIES ────────────────── */}
      <div className="space-y-4">
        <div className="border-b border-border pb-2">
          <h3 className="text-base font-bold text-text-primary">External Agencies</h3>
          <p className="text-xs text-text-secondary mt-0.5">
            Trade contractors and consultants from the HansalV2 sheet. Fill contact slots with Name, Designation, Email, and Phone.
          </p>
        </div>

        <div className="space-y-4">
          {externalTypes.map((t) => {
            const g = groups[t.id];
            if (!g) return null;
            const slots = t.contact_slots ?? 2;

            return (
              <div key={t.id} className="rounded-2xl border border-border bg-surface p-4 shadow-2xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-surface-alt px-2 py-0.5 text-xs font-bold text-text-primary border border-border">
                      {t.name}
                    </span>
                    <span className="text-[11px] text-text-muted">
                      ({slots} contact slots)
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 w-full sm:w-auto">
                    <span className="text-xs text-text-secondary shrink-0">Company:</span>
                    <input
                      type="text"
                      placeholder={t.name}
                      value={g.companyName}
                      onChange={(e) => updateCompanyName(t.id, e.target.value)}
                      className="h-8 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs text-text-primary focus:border-accent w-full sm:w-56"
                    />
                  </div>
                </div>

                {/* Contact Rows Header on Desktop */}
                <div className="hidden sm:grid sm:grid-cols-4 gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  <span>Name</span>
                  <span>Designation</span>
                  <span>Email</span>
                  <span>Phone</span>
                </div>

                {/* Contact Rows */}
                <div className="space-y-2">
                  {g.contacts.map((c, idx) => (
                    <div key={c.id ?? idx} className="space-y-1">
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                        <input
                          type="text"
                          placeholder="Name"
                          value={c.name}
                          onChange={(e) => updateContact(t.id, idx, 'name', e.target.value)}
                          className={`h-8 rounded-lg border px-2.5 py-1 text-xs text-text-primary focus:border-accent ${
                            c.error?.includes('Name') ? 'border-danger bg-danger-light/20' : 'border-border bg-surface-alt/40'
                          }`}
                        />
                        <input
                          type="text"
                          placeholder="Designation"
                          value={c.designation}
                          onChange={(e) => updateContact(t.id, idx, 'designation', e.target.value)}
                          className="h-8 rounded-lg border border-border bg-surface-alt/40 px-2.5 py-1 text-xs text-text-primary focus:border-accent"
                        />
                        <input
                          type="email"
                          placeholder="Email"
                          value={c.email}
                          onChange={(e) => updateContact(t.id, idx, 'email', e.target.value)}
                          className={`h-8 rounded-lg border px-2.5 py-1 text-xs text-text-primary focus:border-accent ${
                            c.error?.includes('Email') ? 'border-danger bg-danger-light/20' : 'border-border bg-surface-alt/40'
                          }`}
                        />
                        <input
                          type="tel"
                          placeholder="Phone"
                          value={c.phone}
                          onChange={(e) => updateContact(t.id, idx, 'phone', e.target.value)}
                          className={`h-8 rounded-lg border px-2.5 py-1 text-xs text-text-primary focus:border-accent ${
                            c.error?.includes('phone') ? 'border-danger bg-danger-light/20' : 'border-border bg-surface-alt/40'
                          }`}
                        />
                      </div>
                      {c.error && (
                        <p className="text-[11px] text-danger px-1">{c.error}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ────────────────── SECTION 2: VTECH TEAM (INTERNAL) ────────────────── */}
      <div className="space-y-4 pt-4 border-t border-border">
        <div className="border-b border-border pb-2">
          <h3 className="text-base font-bold text-text-primary">VTech Team</h3>
          <p className="text-xs text-text-secondary mt-0.5">
            Internal VTech execution teams (Sales Team, Installers, Programmers). Add team members who manage or deliver this project.
          </p>
        </div>

        <div className="space-y-4">
          {internalTypes.map((t) => {
            const g = groups[t.id];
            if (!g) return null;

            return (
              <div key={t.id} className="rounded-2xl border border-border bg-surface p-4 shadow-2xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent border border-accent/20">
                      {t.name}
                    </span>
                    <span className="rounded bg-surface-alt px-1.5 py-0.2 text-[10px] font-bold text-text-muted uppercase">
                      Internal
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 w-full sm:w-auto">
                    <span className="text-xs text-text-secondary shrink-0">Company:</span>
                    <input
                      type="text"
                      placeholder={t.name}
                      value={g.companyName}
                      onChange={(e) => updateCompanyName(t.id, e.target.value)}
                      className="h-8 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs text-text-primary focus:border-accent w-full sm:w-56"
                    />
                  </div>
                </div>

                {/* Contact Rows Header on Desktop */}
                <div className="hidden sm:grid sm:grid-cols-4 gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  <span>Name</span>
                  <span>Designation</span>
                  <span>Email</span>
                  <span>Phone</span>
                </div>

                {/* Contact Rows */}
                <div className="space-y-2">
                  {g.contacts.map((c, idx) => (
                    <div key={c.id ?? idx} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 flex-1">
                          <input
                            type="text"
                            placeholder="Name"
                            value={c.name}
                            onChange={(e) => updateContact(t.id, idx, 'name', e.target.value)}
                            className={`h-8 rounded-lg border px-2.5 py-1 text-xs text-text-primary focus:border-accent ${
                              c.error?.includes('Name') ? 'border-danger bg-danger-light/20' : 'border-border bg-surface-alt/40'
                            }`}
                          />
                          <input
                            type="text"
                            placeholder="Designation"
                            value={c.designation}
                            onChange={(e) => updateContact(t.id, idx, 'designation', e.target.value)}
                            className="h-8 rounded-lg border border-border bg-surface-alt/40 px-2.5 py-1 text-xs text-text-primary focus:border-accent"
                          />
                          <input
                            type="email"
                            placeholder="Email"
                            value={c.email}
                            onChange={(e) => updateContact(t.id, idx, 'email', e.target.value)}
                            className={`h-8 rounded-lg border px-2.5 py-1 text-xs text-text-primary focus:border-accent ${
                              c.error?.includes('Email') ? 'border-danger bg-danger-light/20' : 'border-border bg-surface-alt/40'
                            }`}
                          />
                          <input
                            type="tel"
                            placeholder="Phone"
                            value={c.phone}
                            onChange={(e) => updateContact(t.id, idx, 'phone', e.target.value)}
                            className={`h-8 rounded-lg border px-2.5 py-1 text-xs text-text-primary focus:border-accent ${
                              c.error?.includes('phone') ? 'border-danger bg-danger-light/20' : 'border-border bg-surface-alt/40'
                            }`}
                          />
                        </div>
                        {g.contacts.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeInternalContact(t.id, idx)}
                            className="h-8 px-2 text-text-muted hover:text-danger text-xs font-medium rounded hover:bg-danger-light/30 transition-colors shrink-0"
                            title="Remove contact"
                          >
                            ×
                          </button>
                        )}
                      </div>
                      {c.error && (
                        <p className="text-[11px] text-danger px-1">{c.error}</p>
                      )}
                    </div>
                  ))}
                </div>

                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => addInternalContact(t.id)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                  >
                    + Add contact
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ────────────────── ACTIONS / NAVIGATION ────────────────── */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        {isWizard && onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-text-secondary hover:bg-surface-alt transition-colors"
          >
            ← Back
          </button>
        ) : <div />}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-accent px-5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : isWizard ? 'Save & Next: Room Products →' : 'Save Agencies & Contacts'}
          </button>
        </div>
      </div>
    </form>
  );
}
