'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/client/supabase';
import { useAuth } from '@/components/auth-provider';
import { AppHeader } from '@/components/app-header';
import { RoomDependencyPicker } from '@/components/room-dependency-picker';
import { RoomProductPicker } from '@/components/room-product-picker';
import Link from 'next/link';

interface Floor {
  id: string;
  project_id: string;
  label: string;
  sort: number;
}

interface Room {
  id: string;
  project_id: string;
  floor_id: string;
  name: string;
  sort: number;
}

interface AgencyType {
  id: string;
  name: string;
  sort: number;
  internal?: boolean;
}

interface AgencyContact {
  id?: string;
  name: string;
  designation: string;
  level: 1 | 2 | 3;
  phone: string;
  email: string;
}

interface Agency {
  id: string;
  project_id: string;
  agency_type_id: string;
  company_name: string;
  escalation_enabled: boolean;
  notes: string | null;
  agency_contacts: AgencyContact[];
}

interface MasterDep {
  id: string;
  agency_type_id: string;
  seq: number;
  text: string;
}

interface ProjectDep {
  id: string;
  project_id: string;
  master_dependency_id: string | null;
  agency_type_id: string;
  text: string;
  seq: number;
}

interface ProjectData {
  id: string;
  name: string;
  client_name: string | null;
  site_address: string | null;
  l2_after: number;
  l3_after: number;
  mgmt_cc_level: number;
  terms: string;
}

export default function SetupWizardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile } = useAuth();

  // Step state: 1: Basics, 2: Floors & Rooms, 3: Agencies, 4: Dependencies, 5: Apply to Rooms, 6: Escalation & Terms
  const initialStep = Math.max(1, Math.min(6, parseInt(searchParams.get('step') ?? '2', 10)));
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [isClassic, setIsClassic] = useState(searchParams.get('mode') === 'classic');
  const [wizardRoomId, setWizardRoomId] = useState<string>('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Loaded data
  const [project, setProject] = useState<ProjectData | null>(null);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [agencyTypes, setAgencyTypes] = useState<AgencyType[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [masterDeps, setMasterDeps] = useState<MasterDep[]>([]);
  const [projectDeps, setProjectDeps] = useState<ProjectDep[]>([]);
  const [roomPresets, setRoomPresets] = useState<string[]>([]);
  const [existingItems, setExistingItems] = useState<{ room_id: string; project_dependency_id: string }[]>([]);

  // Step 2 local states
  const [floorCountInput, setFloorCountInput] = useState('1');
  const [newRoomInputs, setNewRoomInputs] = useState<Record<string, string>>({});
  const [copyFloorTarget, setCopyFloorTarget] = useState<string | null>(null);
  const [copyFloorLabel, setCopyFloorLabel] = useState('');

  // Step 3 local states (New agency form)
  const [showAddAgency, setShowAddAgency] = useState(false);
  const [agencyModalMode, setAgencyModalMode] = useState<'external' | 'internal'>('external');
  const [newAgencyTypeId, setNewAgencyTypeId] = useState('');
  const [newAgencyCompany, setNewAgencyCompany] = useState('');
  const [newAgencyEscalation, setNewAgencyEscalation] = useState(true);
  const [newAgencyContacts, setNewAgencyContacts] = useState<AgencyContact[]>([
    { name: '', designation: '', level: 1, phone: '', email: '' },
  ]);

  // Step 4 local states
  const [useMasterListMode, setUseMasterListMode] = useState(false);
  const [depSearch, setDepSearch] = useState('');
  const [selectedMasterIds, setSelectedMasterIds] = useState<Set<string>>(new Set());
  const [showCustomDepModal, setShowCustomDepModal] = useState(false);
  const [customDepTypeId, setCustomDepTypeId] = useState('');
  const [customDepText, setCustomDepText] = useState('');

  // Step 5 local states: Matrix (roomId_depId)
  const [selectedPairs, setSelectedPairs] = useState<Set<string>>(new Set());

  // Step 6 local states: Escalation & Terms
  const [l2After, setL2After] = useState(3);
  const [l3After, setL3After] = useState(6);
  const [mgmtCcLevel, setMgmtCcLevel] = useState(3);
  const [termsText, setTermsText] = useState('');

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const sb = supabaseBrowser();

      const [
        { data: proj, error: pErr },
        { data: fls, error: fErr },
        { data: rms, error: rErr },
        { data: aTypes, error: atErr },
        { data: ags, error: agErr },
        { data: mDeps, error: mdErr },
        { data: pDeps, error: pdErr },
        { data: settings },
        { data: items },
      ] = await Promise.all([
        sb.from('projects').select('*').eq('id', projectId).single(),
        sb.from('floors').select('*').eq('project_id', projectId).order('sort'),
        sb.from('rooms').select('*').eq('project_id', projectId).order('sort'),
        sb.from('agency_types').select('*').order('sort'),
        sb.from('agencies').select('*, agency_contacts(*)').eq('project_id', projectId),
        sb.from('master_dependencies').select('id, agency_type_id, seq, text').eq('active', true).order('seq'),
        sb.from('project_dependencies').select('*').eq('project_id', projectId).order('seq'),
        sb.from('app_settings').select('*'),
        sb.from('dependency_items').select('room_id, project_dependency_id').eq('project_id', projectId),
      ]);

      if (pErr) throw new Error(pErr.message);
      if (fErr) throw new Error(fErr.message);
      if (rErr) throw new Error(rErr.message);
      if (atErr) throw new Error(atErr.message);
      if (agErr) throw new Error(agErr.message);
      if (mdErr) throw new Error(mdErr.message);
      if (pdErr) throw new Error(pdErr.message);

      let activeFloors = fls ?? [];
      // O1: Floors default to 1 pre-filled floor
      if (activeFloors.length === 0) {
        const { data: newF } = await sb
          .from('floors')
          .insert({
            project_id: projectId,
            label: '1st Floor',
            sort: 1,
          })
          .select('*')
          .single();
        if (newF) {
          activeFloors = [newF];
        }
      }

      setProject(proj as ProjectData);
      setFloors(activeFloors);
      setRooms(rms ?? []);
      if (rms && rms.length > 0) {
        setWizardRoomId((prev) => prev || rms[0].id);
      }
      setAgencyTypes(aTypes ?? []);
      setAgencies((ags as Agency[]) ?? []);
      setMasterDeps(mDeps ?? []);
      setProjectDeps(pDeps ?? []);

      // Presets
      const presetsVal = (settings as { key: string; value: unknown }[] | null)?.find((s) => s.key === 'room_presets')?.value;
      if (Array.isArray(presetsVal)) {
        setRoomPresets(presetsVal as string[]);
      }

      // Project escalation & terms
      if (proj) {
        setL2After(proj.l2_after ?? 3);
        setL3After(proj.l3_after ?? 6);
        setMgmtCcLevel(proj.mgmt_cc_level ?? 3);
        setTermsText(proj.terms ?? '');
      }

      // Existing items
      const existing = (items ?? []) as { room_id: string; project_dependency_id: string }[];
      setExistingItems(existing);
      const pairSet = new Set<string>();
      existing.forEach((i) => pairSet.add(`${i.room_id}_${i.project_dependency_id}`));
      setSelectedPairs(pairSet);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const showSuccessNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  };

  // ───────────────────────── STEP 1: BASICS ─────────────────────────
  async function handleSaveBasics(e: React.FormEvent) {
    e.preventDefault();
    if (!project) return;
    setSaving(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      const { error: err } = await sb
        .from('projects')
        .update({
          name: project.name,
          client_name: project.client_name,
          site_address: project.site_address,
        })
        .eq('id', projectId);
      if (err) throw err;
      showSuccessNotice('Project details saved');
      setCurrentStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // ───────────────────────── STEP 2: FLOORS & ROOMS ─────────────────────────
  async function handleAddFloors() {
    const count = parseInt(floorCountInput, 10);
    if (isNaN(count) || count < 1) return;
    setSaving(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      const startSort = floors.length;
      const newFloors = Array.from({ length: count }, (_, i) => {
        const num = startSort + i + 1;
        return {
          project_id: projectId,
          label: `${num}${getOrdinal(num)} Floor`,
          sort: num,
        };
      });
      const { error: err } = await sb.from('floors').insert(newFloors);
      if (err) throw err;
      await loadAll();
      showSuccessNotice(`Added ${count} floor(s)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add floors');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddRoom(floorId: string, roomName: string) {
    const trimmed = roomName.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      const floorRooms = rooms.filter((r) => r.floor_id === floorId);
      const { error: err } = await sb.from('rooms').insert({
        project_id: projectId,
        floor_id: floorId,
        name: trimmed,
        sort: floorRooms.length + 1,
      });
      if (err) throw err;
      setNewRoomInputs((prev) => ({ ...prev, [floorId]: '' }));
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add room');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRoom(roomId: string) {
    if (!confirm('Delete this room and its applied dependencies?')) return;
    setSaving(true);
    try {
      const sb = supabaseBrowser();
      const { error: err } = await sb.from('rooms').delete().eq('id', roomId);
      if (err) throw err;
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete room');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateFloorLabel(floorId: string, newLabel: string) {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    try {
      const sb = supabaseBrowser();
      const { error: err } = await sb.from('floors').update({ label: trimmed }).eq('id', floorId);
      if (err) throw err;
      setFloors((prev) => prev.map((f) => (f.id === floorId ? { ...f, label: trimmed } : f)));
    } catch (err) {
      console.error('Failed to update floor label:', err);
    }
  }

  async function handleCopyFloor(floorId: string) {
    if (!copyFloorLabel.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      const { error: err } = await sb.rpc('copy_floor', {
        p_floor: floorId,
        p_label: copyFloorLabel.trim(),
      });
      if (err) throw err;
      setCopyFloorTarget(null);
      setCopyFloorLabel('');
      await loadAll();
      showSuccessNotice('Floor copied with identical rooms and dependencies');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy floor');
    } finally {
      setSaving(false);
    }
  }

  // ───────────────────────── STEP 3: AGENCIES ─────────────────────────
  async function handleSaveNewAgency(e: React.FormEvent) {
    e.preventDefault();
    if (!newAgencyTypeId || !newAgencyCompany.trim()) {
      setError('Please select an agency type and enter the company name');
      return;
    }
    const validContacts = newAgencyContacts.filter(
      (c) => c.name.trim() && (c.phone.trim() || c.email.trim())
    );
    if (validContacts.length === 0) {
      setError('Add at least one contact with a name and either phone or email');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      const { data: newAg, error: agErr } = await sb
        .from('agencies')
        .insert({
          project_id: projectId,
          agency_type_id: newAgencyTypeId,
          company_name: newAgencyCompany.trim(),
          escalation_enabled: newAgencyEscalation,
        })
        .select('id')
        .single();
      if (agErr) throw agErr;

      const contactsToInsert = validContacts.map((c) => ({
        project_id: projectId,
        agency_id: newAg.id,
        name: c.name.trim(),
        designation: c.designation.trim() || 'Site Contact',
        level: c.level,
        phone: c.phone.trim() || null,
        email: c.email.trim() || null,
      }));

      const { error: contErr } = await sb.from('agency_contacts').insert(contactsToInsert);
      if (contErr) throw contErr;

      setShowAddAgency(false);
      setNewAgencyTypeId('');
      setNewAgencyCompany('');
      setNewAgencyContacts([{ name: '', designation: '', level: 1, phone: '', email: '' }]);
      await loadAll();
      showSuccessNotice(agencyModalMode === 'internal' ? 'Internal team added' : 'Agency added');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agency');
    } finally {
      setSaving(false);
    }
  }

  // One-click Add VTech Team from pre-suggestions
  async function handleAddSuggestedVtechTeam(t: AgencyType) {
    setSaving(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      const { data: newAg, error: agErr } = await sb
        .from('agencies')
        .insert({
          project_id: projectId,
          agency_type_id: t.id,
          company_name: t.name,
          escalation_enabled: true,
        })
        .select('id')
        .single();
      if (agErr) throw agErr;

      const { error: contErr } = await sb.from('agency_contacts').insert({
        project_id: projectId,
        agency_id: newAg.id,
        name: profile?.full_name || 'VTech Office Lead',
        designation: t.name.replace('VTech ', '') + ' Lead',
        level: 1,
        phone: profile?.phone || '+91 98200 00000',
        email: profile?.email || 'office@vtechpl.com',
      });
      if (contErr) console.warn('Could not add contact for internal team:', contErr);

      await loadAll();
      showSuccessNotice(`Added ${t.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to add ${t.name}`);
    } finally {
      setSaving(false);
    }
  }

  // Add all unadded canonical VTech teams
  async function handleAddAllVtechTeams(teams: AgencyType[]) {
    if (teams.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      for (const t of teams) {
        const { data: newAg, error: agErr } = await sb
          .from('agencies')
          .insert({
            project_id: projectId,
            agency_type_id: t.id,
            company_name: t.name,
            escalation_enabled: true,
          })
          .select('id')
          .single();
        if (agErr) throw agErr;

        await sb.from('agency_contacts').insert({
          project_id: projectId,
          agency_id: newAg.id,
          name: profile?.full_name || 'VTech Office Lead',
          designation: t.name.replace('VTech ', '') + ' Lead',
          level: 1,
          phone: profile?.phone || '+91 98200 00000',
          email: profile?.email || 'office@vtechpl.com',
        });
      }
      await loadAll();
      showSuccessNotice(`Added ${teams.length} VTech team(s)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add VTech teams');
    } finally {
      setSaving(false);
    }
  }

  // Delete Agency handler
  async function handleDeleteAgency(agencyId: string, agencyName: string) {
    if (!confirm(`Are you sure you want to remove "${agencyName}"?`)) return;
    setSaving(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      const { error: err } = await sb.from('agencies').delete().eq('id', agencyId);
      if (err) throw err;
      await loadAll();
      showSuccessNotice(`Removed ${agencyName}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove agency');
    } finally {
      setSaving(false);
    }
  }

  // ───────────────────────── STEP 4: DEPENDENCIES ─────────────────────────
  async function handleAddSelectedMaster() {
    if (selectedMasterIds.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      const idsArray = Array.from(selectedMasterIds);
      const { error: err } = await sb.rpc('add_master_dependencies', {
        p_project: projectId,
        p_master_ids: idsArray,
      });
      if (err) throw err;
      setSelectedMasterIds(new Set());
      await loadAll();
      showSuccessNotice(`Added master dependencies`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add master dependencies');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddCustomDep(e: React.FormEvent) {
    e.preventDefault();
    if (!customDepTypeId || !customDepText.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      const { error: err } = await sb.from('project_dependencies').insert({
        project_id: projectId,
        agency_type_id: customDepTypeId,
        text: customDepText.trim(),
        master_dependency_id: null,
      });
      if (err) throw err;
      setShowCustomDepModal(false);
      setCustomDepText('');
      await loadAll();
      showSuccessNotice('Custom dependency added');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add custom dependency');
    } finally {
      setSaving(false);
    }
  }

  // ───────────────────────── STEP 5: APPLY TO ROOMS ─────────────────────────
  async function handleApplyDependencies() {
    setSaving(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      const depIds = projectDeps.map((d) => d.id);
      const roomIds = rooms.map((r) => r.id);

      if (depIds.length === 0 || roomIds.length === 0) {
        showSuccessNotice('No dependencies or rooms to apply');
        setCurrentStep(6);
        return;
      }

      // In Step 5, we call RPC apply_dependencies with selected pairs
      // The RPC takes p_dep_ids and p_room_ids as arrays, or we can insert directly into dependency_items
      // Let's call rpc('apply_dependencies', { p_project, p_dep_ids: depIds, p_room_ids: roomIds })
      const { error: err } = await sb.rpc('apply_dependencies', {
        p_project: projectId,
        p_dep_ids: depIds,
        p_room_ids: roomIds,
      });
      if (err) throw err;

      await loadAll();
      showSuccessNotice('Dependencies applied to rooms');
      setCurrentStep(6);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply dependencies');
    } finally {
      setSaving(false);
    }
  }

  // ───────────────────────── STEP 6: ESCALATION & TERMS ─────────────────────────
  async function handleFinishSetup(e: React.FormEvent) {
    e.preventDefault();
    if (l3After <= l2After) {
      setError('L3 threshold must be strictly greater than L2 threshold');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      const { error: err } = await sb
        .from('projects')
        .update({
          l2_after: l2After,
          l3_after: l3After,
          mgmt_cc_level: mgmtCcLevel,
          terms: termsText,
        })
        .eq('id', projectId);
      if (err) throw err;

      router.push(`/projects/${projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-alt">
        <Spinner />
      </div>
    );
  }

  const stepsList = isClassic
    ? [
        { num: 1, label: 'Basics' },
        { num: 2, label: 'Floors & Rooms' },
        { num: 3, label: 'Agencies' },
        { num: 4, label: 'Bulk Dependencies' },
        { num: 5, label: 'Apply Grid' },
        { num: 6, label: 'Escalation' },
      ]
    : [
        { num: 1, label: 'Basics' },
        { num: 2, label: 'Floors & Rooms' },
        { num: 3, label: 'Agencies' },
        { num: 4, label: 'Room Dependencies' },
        { num: 5, label: 'Escalation' },
      ];

  return (
    <div className="min-h-dvh bg-surface-alt pb-16">
      <AppHeader />

      <main className="mx-auto max-w-4xl px-4 pt-5">
        {/* Header navigation & title */}
        <div className="mb-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-text-primary mb-2"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Projects
          </Link>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-text-primary">
                Project Setup: {project?.name}
              </h1>
              <p className="text-xs text-text-secondary mt-0.5">
                Step {currentStep} of {isClassic ? 6 : 5} — Each step saves immediately. You can exit and resume anytime.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsClassic(!isClassic);
                if (currentStep > 3) setCurrentStep(4);
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline shrink-0"
            >
              {isClassic ? 'Switch to Office room-by-room setup →' : 'Switch to Classic matrix setup →'}
            </button>
          </div>
        </div>

        {/* Wizard Step Pills Bar */}
        <div className="mb-6 flex overflow-x-auto py-1 scrollbar-none gap-1.5 border-b border-border pb-3">
          {stepsList.map((s) => (
            <button
              key={s.num}
              onClick={() => setCurrentStep(s.num)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                currentStep === s.num
                  ? 'bg-accent text-white shadow-xs font-semibold'
                  : currentStep > s.num
                  ? 'bg-surface text-text-primary border border-border hover:bg-surface-alt'
                  : 'bg-surface-alt text-text-muted hover:text-text-secondary'
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                  currentStep === s.num
                    ? 'bg-white text-accent'
                    : currentStep > s.num
                    ? 'bg-success-light text-success'
                    : 'bg-border text-text-muted'
                }`}
              >
                {currentStep > s.num ? '✓' : s.num}
              </span>
              {s.label}
            </button>
          ))}
        </div>

        {/* Global Notifications / Errors */}
        {notice && (
          <div className="mb-4 rounded-xl bg-success-light px-4 py-2.5 text-xs font-medium text-success border border-success/20">
            {notice}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-xl bg-danger-light px-4 py-2.5 text-xs font-medium text-danger border border-danger/20" role="alert">
            {error}
          </div>
        )}

        {/* ───────────────────────── STEP 1 ───────────────────────── */}
        {currentStep === 1 && project && (
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-xs">
            <h2 className="text-base font-semibold text-text-primary mb-4">Step 1: Project Details</h2>
            <form onSubmit={handleSaveBasics} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1">
                  Project Name <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={project.name}
                  onChange={(e) => setProject({ ...project, name: e.target.value })}
                  className="block w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-base
                             focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1">
                  Client Name
                </label>
                <input
                  type="text"
                  value={project.client_name ?? ''}
                  onChange={(e) => setProject({ ...project, client_name: e.target.value })}
                  className="block w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-base
                             focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1">
                  Site Address
                </label>
                <textarea
                  rows={3}
                  value={project.site_address ?? ''}
                  onChange={(e) => setProject({ ...project, site_address: e.target.value })}
                  className="block w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-base
                             focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent-hover transition-colors"
                >
                  {saving ? 'Saving…' : 'Save & Next →'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ───────────────────────── STEP 2 ───────────────────────── */}
        {currentStep === 2 && (
          <div className="space-y-6">
            {/* Quick floor generator */}
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
              <h2 className="text-base font-semibold text-text-primary">How many floors?</h2>
              <p className="text-xs text-text-secondary mt-1">
                Add floors to your project. You can customize the label for each floor below.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={floorCountInput}
                  onChange={(e) => setFloorCountInput(e.target.value)}
                  className="w-24 rounded-lg border border-border px-3 py-2 text-center text-base font-semibold focus:border-accent"
                />
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleAddFloors}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
                >
                  Add floor(s)
                </button>
              </div>
            </div>

            {/* List of floors & their rooms */}
            {floors.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-xs text-text-muted">
                No floors added yet. Enter a count above and tap &quot;Add floor(s)&quot;.
              </div>
            ) : (
              <div className="space-y-4">
                {floors.map((floor) => {
                  const floorRooms = rooms.filter((r) => r.floor_id === floor.id);
                  return (
                    <div key={floor.id} className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
                      <div className="flex items-center justify-between border-b border-border/70 pb-3 mb-4">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-alt text-xs font-bold text-text-secondary">
                            #{floor.sort}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              aria-label="Floor label"
                              defaultValue={floor.label}
                              onBlur={(e) => handleUpdateFloorLabel(floor.id, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  (e.target as HTMLInputElement).blur();
                                }
                              }}
                              className="text-base font-bold text-text-primary bg-transparent border-b border-transparent hover:border-border focus:border-accent focus:bg-surface px-1 py-0.5 rounded transition-colors w-32 sm:w-44"
                            />
                            <span className="text-[10px] text-text-muted italic hidden sm:inline">(editable)</span>
                          </div>
                          <span className="text-xs text-text-muted">({floorRooms.length} rooms)</span>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setCopyFloorTarget(floor.id);
                            setCopyFloorLabel(`${floor.label} (Copy)`);
                          }}
                          className="inline-flex items-center gap-1 rounded-md bg-surface-alt px-2.5 py-1 text-xs font-medium text-text-primary hover:bg-border transition-colors"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                          </svg>
                          Copy floor
                        </button>
                      </div>

                      {/* Current rooms chips */}
                      <div className="mb-4">
                        <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-2">
                          Rooms on this floor:
                        </p>
                        {floorRooms.length === 0 ? (
                          <p className="text-xs text-text-muted italic">No rooms added to this floor yet.</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {floorRooms.map((r) => (
                              <span
                                key={r.id}
                                className="inline-flex items-center gap-1 rounded-lg bg-surface-alt px-2.5 py-1 text-xs font-medium text-text-primary border border-border"
                              >
                                {r.name}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRoom(r.id)}
                                  className="text-text-muted hover:text-danger ml-1"
                                  aria-label={`Remove ${r.name}`}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Room Presets chip picker */}
                      <div className="mb-3">
                        <p className="text-xs font-medium text-text-secondary mb-1.5">
                          Tap to add room preset:
                        </p>
                        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1 bg-surface-alt rounded-lg border border-border/50">
                          {roomPresets.map((preset) => {
                            const alreadyAdded = floorRooms.some(
                              (r) => r.name.toLowerCase() === preset.toLowerCase()
                            );
                            if (alreadyAdded) return null;
                            return (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => handleAddRoom(floor.id, preset)}
                                className="rounded-md bg-surface px-2 py-0.5 text-xs text-text-secondary hover:text-accent hover:border-accent border border-border transition-colors"
                              >
                                + {preset}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Free-text add room */}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Or type custom room name…"
                          value={newRoomInputs[floor.id] ?? ''}
                          onChange={(e) =>
                            setNewRoomInputs({ ...newRoomInputs, [floor.id]: e.target.value })
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddRoom(floor.id, newRoomInputs[floor.id] ?? '');
                            }
                          }}
                          className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs focus:border-accent"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddRoom(floor.id, newRoomInputs[floor.id] ?? '')}
                          className="rounded-lg bg-surface-alt px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-border transition-colors"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Navigation buttons */}
            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-surface transition-colors"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => setCurrentStep(3)}
                className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent-hover transition-colors"
              >
                Next: Agencies ({agencies.length}) →
              </button>
            </div>
          </div>
        )}

        {/* ───────────────────────── STEP 3 ───────────────────────── */}
        {currentStep === 3 && (() => {
          const externalAgencies = agencies.filter(
            (a) => !agencyTypes.find((t) => t.id === a.agency_type_id)?.internal
          );
          const internalAgencies = agencies.filter(
            (a) => agencyTypes.find((t) => t.id === a.agency_type_id)?.internal
          );
          const vtechCanonicalNames = ['VTech Installers', 'VTech Programmers', 'VTech Project Managers'];
          const unaddedVtechTeams = agencyTypes
            .filter((t) => t.internal && vtechCanonicalNames.includes(t.name))
            .filter((t) => !agencies.some((a) => a.agency_type_id === t.id));

          return (
            <div className="space-y-8">
              {/* Step 3 Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
                <div>
                  <h2 className="text-base font-semibold text-text-primary">Agencies &amp; Contacts</h2>
                  <p className="text-xs text-text-secondary mt-0.5">
                    Configure external contractors and internal VTech teams assigned to this site.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAgencyModalMode('external');
                      setNewAgencyTypeId('');
                      setNewAgencyCompany('');
                      setNewAgencyEscalation(true);
                      setNewAgencyContacts([{ name: '', designation: '', level: 1, phone: '', email: '' }]);
                      setShowAddAgency(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors"
                  >
                    + Add External Agency
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAgencyModalMode('internal');
                      setNewAgencyTypeId('');
                      setNewAgencyCompany('');
                      setNewAgencyEscalation(true);
                      setNewAgencyContacts([{ name: '', designation: '', level: 1, phone: '', email: '' }]);
                      setShowAddAgency(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors"
                  >
                    + Add Internal Team
                  </button>
                </div>
              </div>

              {/* SECTION 1: EXTERNAL AGENCIES */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                      <span>External Agencies</span>
                      <span className="rounded-full bg-surface-alt border border-border px-2 py-0.2 text-xs font-semibold text-text-secondary">
                        {externalAgencies.length}
                      </span>
                    </h3>
                    <p className="text-xs text-text-secondary mt-0.5">
                      Contractors &amp; vendors (Electrician, Carpenter, Painter, AC, Architect, Client, etc.)
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAgencyModalMode('external');
                      setNewAgencyTypeId('');
                      setNewAgencyCompany('');
                      setNewAgencyEscalation(true);
                      setNewAgencyContacts([{ name: '', designation: '', level: 1, phone: '', email: '' }]);
                      setShowAddAgency(true);
                    }}
                    className="text-xs font-semibold text-accent hover:underline sm:hidden"
                  >
                    + Add External
                  </button>
                </div>

                {externalAgencies.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-surface p-6 text-center text-xs text-text-muted">
                    No external agencies added yet. Click &quot;+ Add External Agency&quot; to configure contractors.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {externalAgencies.map((agency) => {
                      const type = agencyTypes.find((t) => t.id === agency.agency_type_id);
                      return (
                        <div key={agency.id} className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
                          <div className="flex items-start justify-between">
                            <div>
                              <span className="inline-block rounded-md bg-surface-alt border border-border px-2 py-0.5 text-xs font-semibold text-text-secondary mb-1">
                                {type?.name ?? 'Agency'}
                              </span>
                              <h4 className="text-base font-bold text-text-primary">{agency.company_name}</h4>
                              <p className="text-xs text-text-secondary mt-0.5">
                                Escalation: {agency.escalation_enabled ? 'Enabled (L1–L3)' : 'Disabled'}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteAgency(agency.id, agency.company_name)}
                              className="text-text-muted hover:text-danger text-xs font-medium px-2 py-1 rounded hover:bg-danger-light/30 transition-colors"
                            >
                              Remove
                            </button>
                          </div>

                          {/* Contacts list */}
                          <div className="mt-3 pt-3 border-t border-border/70 space-y-1.5">
                            <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                              Contacts ({agency.agency_contacts?.length ?? 0}):
                            </p>
                            {(agency.agency_contacts ?? []).map((c, i) => (
                              <div key={i} className="flex items-center justify-between text-xs bg-surface-alt rounded-lg px-3 py-1.5">
                                <div>
                                  <span className="font-semibold text-text-primary">{c.name}</span>
                                  <span className="text-text-muted ml-1.5">({c.designation})</span>
                                  <span className="ml-2 rounded-sm bg-border px-1.5 py-0.2 text-[10px] font-medium text-text-secondary">
                                    L{c.level}
                                  </span>
                                </div>
                                <div className="text-text-secondary flex gap-2">
                                  {c.phone && <span>{c.phone}</span>}
                                  {c.email && <span>{c.email}</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* SECTION 2: INTERNAL TEAM (VTECH) */}
              <div className="space-y-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                      <span>Internal Team (VTech)</span>
                      <span className="rounded-full bg-accent/10 border border-accent/20 px-2 py-0.2 text-xs font-semibold text-accent">
                        {internalAgencies.length}
                      </span>
                    </h3>
                    <p className="text-xs text-text-secondary mt-0.5">
                      Internal execution teams responsible for installation, programming, and project management.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAgencyModalMode('internal');
                      setNewAgencyTypeId('');
                      setNewAgencyCompany('');
                      setNewAgencyEscalation(true);
                      setNewAgencyContacts([{ name: '', designation: '', level: 1, phone: '', email: '' }]);
                      setShowAddAgency(true);
                    }}
                    className="text-xs font-semibold text-accent hover:underline sm:hidden"
                  >
                    + Add Team
                  </button>
                </div>

                {/* Pre-suggestions for the 3 VTech teams */}
                {unaddedVtechTeams.length > 0 && (
                  <div className="rounded-2xl border border-dashed border-accent/40 bg-accent/5 p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-bold text-text-primary">
                          Pre-suggested VTech Teams ({unaddedVtechTeams.length} available)
                        </h4>
                        <p className="text-[11px] text-text-secondary">
                          Standard execution chain from the sheet legend. One click to add each team.
                        </p>
                      </div>
                      {unaddedVtechTeams.length > 1 && (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => handleAddAllVtechTeams(unaddedVtechTeams)}
                          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-accent-hover transition-colors disabled:opacity-50"
                        >
                          Add all {unaddedVtechTeams.length} teams
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {unaddedVtechTeams.map((t) => {
                        const isInstallers = t.name.includes('Installers');
                        const isProgrammers = t.name.includes('Programmers');
                        const colourBadge = isInstallers
                          ? 'bg-[#E06666]/15 text-[#991b1b] border-[#E06666]/30'
                          : isProgrammers
                          ? 'bg-[#F4CCCC] text-[#991b1b] border-[#e06666]/30'
                          : 'bg-[#F9CB9C] text-[#9a3412] border-[#f97316]/30';
                        const desc = isInstallers
                          ? 'Dark red · Hardware mounting & terminations'
                          : isProgrammers
                          ? 'Light red · Scene & automation programming'
                          : 'Orange · Coordination & client handoff';

                        return (
                          <div
                            key={t.id}
                            className="flex flex-col justify-between rounded-xl border border-border bg-surface p-3 shadow-2xs space-y-2.5"
                          >
                            <div>
                              <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold ${colourBadge}`}>
                                {t.name}
                              </span>
                              <p className="text-[11px] text-text-secondary mt-1.5 leading-snug">
                                {desc}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => handleAddSuggestedVtechTeam(t)}
                              className="w-full inline-flex items-center justify-center rounded-lg border border-accent bg-accent/10 px-2.5 py-1.5 text-xs font-bold text-accent hover:bg-accent hover:text-white transition-colors disabled:opacity-50"
                            >
                              + Add VTech team
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Internal Agencies List */}
                {internalAgencies.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-surface p-6 text-center text-xs text-text-muted">
                    No internal teams added to this project yet. Use the pre-suggested teams above or click &quot;+ Add Internal Team&quot;.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {internalAgencies.map((agency) => {
                      const type = agencyTypes.find((t) => t.id === agency.agency_type_id);
                      return (
                        <div key={agency.id} className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="inline-block rounded-md bg-accent/15 text-accent border border-accent/20 px-2 py-0.5 text-xs font-semibold">
                                  {type?.name ?? 'Internal Team'}
                                </span>
                                <span className="rounded bg-surface-alt px-1.5 py-0.2 text-[10px] font-bold text-text-muted uppercase">
                                  [Internal]
                                </span>
                              </div>
                              <h4 className="text-base font-bold text-text-primary">{agency.company_name}</h4>
                              <p className="text-xs text-text-secondary mt-0.5">
                                Escalation: {agency.escalation_enabled ? 'Enabled (L1–L3)' : 'Disabled'}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteAgency(agency.id, agency.company_name)}
                              className="text-text-muted hover:text-danger text-xs font-medium px-2 py-1 rounded hover:bg-danger-light/30 transition-colors"
                            >
                              Remove
                            </button>
                          </div>

                          {/* Contacts list */}
                          <div className="mt-3 pt-3 border-t border-border/70 space-y-1.5">
                            <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                              Contacts ({agency.agency_contacts?.length ?? 0}):
                            </p>
                            {(agency.agency_contacts ?? []).map((c, i) => (
                              <div key={i} className="flex items-center justify-between text-xs bg-surface-alt rounded-lg px-3 py-1.5">
                                <div>
                                  <span className="font-semibold text-text-primary">{c.name}</span>
                                  <span className="text-text-muted ml-1.5">({c.designation})</span>
                                  <span className="ml-2 rounded-sm bg-border px-1.5 py-0.2 text-[10px] font-medium text-text-secondary">
                                    L{c.level}
                                  </span>
                                </div>
                                <div className="text-text-secondary flex gap-2">
                                  {c.phone && <span>{c.phone}</span>}
                                  {c.email && <span>{c.email}</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Navigation buttons */}
              <div className="flex justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-surface transition-colors"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentStep(4)}
                  className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent-hover transition-colors"
                >
                  Next: Dependencies →
                </button>
              </div>
            </div>
          );
        })()}

        {/* ───────────────────────── STEP 4 (OFFICE MODE): ROOM-BY-ROOM PRODUCTS ───────────────────────── */}
        {!isClassic && currentStep === 4 && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-text-primary">
                  {useMasterListMode ? 'Step 4: Room-by-Room Dependencies (Master List)' : 'Step 4: Room-by-Room Products'}
                </h2>
                <p className="text-xs text-text-secondary mt-0.5">
                  {useMasterListMode
                    ? 'Configure trade dependencies room by room from the 78-item master list.'
                    : 'Place the products VTech sells in each room with location and step tracking.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setUseMasterListMode(!useMasterListMode)}
                  className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors"
                >
                  {useMasterListMode ? 'Switch to Product Picker (v3)' : 'Use master dependency list (classic)'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsClassic(true)}
                  className="text-xs text-accent hover:underline text-left sm:text-right"
                >
                  Switch to classic bulk matrix setup →
                </button>
              </div>
            </div>

            {rooms.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center text-xs text-text-muted space-y-3">
                <p>No rooms added yet. Please add at least one room in Step 2 first.</p>
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white"
                >
                  ← Go to Step 2: Floors &amp; Rooms
                </button>
              </div>
            ) : useMasterListMode ? (
              <RoomDependencyPicker
                projectId={projectId}
                roomId={wizardRoomId || rooms[0]?.id}
                onRoomChange={(newId) => setWizardRoomId(newId)}
                onFinish={() => setCurrentStep(5)}
                isWizard={true}
              />
            ) : (
              <RoomProductPicker
                projectId={projectId}
                roomId={wizardRoomId || rooms[0]?.id}
                onRoomChange={(newId) => setWizardRoomId(newId)}
                onFinish={() => setCurrentStep(5)}
                isWizard={true}
                onSwitchToMasterList={() => setUseMasterListMode(true)}
              />
            )}

            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={() => setCurrentStep(3)}
                className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-surface transition-colors"
              >
                ← Back to Agencies
              </button>
              <button
                type="button"
                onClick={() => setCurrentStep(5)}
                className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent-hover transition-colors"
              >
                Next: Escalation &amp; Terms →
              </button>
            </div>
          </div>
        )}

        {/* ───────────────────────── STEP 4 (CLASSIC MODE): BULK MASTER PICK ───────────────────────── */}
        {isClassic && currentStep === 4 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-text-primary">Dependencies Checklist (Classic)</h2>
                <p className="text-xs text-text-secondary">
                  Pick dependencies from VTech&apos;s approved master list or add site-specific custom items.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsClassic(false)}
                  className="text-xs text-accent hover:underline"
                >
                  Switch to room-by-room setup
                </button>
                <button
                  type="button"
                  onClick={() => setShowCustomDepModal(true)}
                  className="inline-flex items-center gap-1 rounded-lg bg-surface-alt px-3 py-2 text-xs font-medium text-text-primary border border-border hover:bg-border transition-colors"
                >
                  + Add Custom Item
                </button>
              </div>
            </div>

            {/* Currently picked dependencies summary */}
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Project Dependencies ({projectDeps.length})
                </span>
              </div>
              {projectDeps.length === 0 ? (
                <p className="text-xs text-text-muted italic">No dependencies added to project yet.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                  {projectDeps.map((pd) => (
                    <span
                      key={pd.id}
                      className="inline-flex items-center rounded-md bg-surface-alt px-2 py-0.5 text-xs text-text-primary border border-border"
                    >
                      {pd.text}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Master list picker */}
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-text-primary">Master List (78 Items)</h3>
                <input
                  type="text"
                  placeholder="Search master dependencies…"
                  value={depSearch}
                  onChange={(e) => setDepSearch(e.target.value)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs focus:border-accent w-full sm:w-60"
                />
              </div>

              {agencyTypes.map((type) => {
                const typeMasterDeps = masterDeps.filter(
                  (d) =>
                    d.agency_type_id === type.id &&
                    (!depSearch || d.text.toLowerCase().includes(depSearch.toLowerCase()))
                );
                if (typeMasterDeps.length === 0) return null;

                const alreadyPickedIds = new Set(
                  projectDeps.filter((pd) => pd.master_dependency_id).map((pd) => pd.master_dependency_id)
                );

                const unpicked = typeMasterDeps.filter((d) => !alreadyPickedIds.has(d.id));

                return (
                  <div key={type.id} className="border-t border-border pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-text-primary">{type.name}</span>
                      {unpicked.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const newSet = new Set(selectedMasterIds);
                            unpicked.forEach((d) => newSet.add(d.id));
                            setSelectedMasterIds(newSet);
                          }}
                          className="text-xs text-accent hover:underline"
                        >
                          Select all ({unpicked.length})
                        </button>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      {typeMasterDeps.map((dep) => {
                        const isAlreadyPicked = alreadyPickedIds.has(dep.id);
                        const isSelected = selectedMasterIds.has(dep.id);

                        return (
                          <label
                            key={dep.id}
                            className={`flex items-start gap-2.5 rounded-lg p-2 text-xs transition-colors cursor-pointer ${
                              isAlreadyPicked
                                ? 'bg-surface-alt/60 opacity-60 cursor-not-allowed'
                                : isSelected
                                ? 'bg-accent/10 border border-accent/20'
                                : 'hover:bg-surface-alt'
                            }`}
                          >
                            <input
                              type="checkbox"
                              disabled={isAlreadyPicked}
                              checked={isAlreadyPicked || isSelected}
                              onChange={(e) => {
                                const next = new Set(selectedMasterIds);
                                if (e.target.checked) next.add(dep.id);
                                else next.delete(dep.id);
                                setSelectedMasterIds(next);
                              }}
                              className="mt-0.5 rounded text-accent focus:ring-accent"
                            />
                            <span className="flex-1 text-text-primary">
                              {dep.text}
                              {isAlreadyPicked && (
                                <span className="ml-2 text-[10px] text-text-muted">(added)</span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {selectedMasterIds.size > 0 && (
                <div className="sticky bottom-4 pt-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleAddSelectedMaster}
                    className="w-full rounded-lg bg-accent px-4 py-2.5 text-xs font-semibold text-white shadow-md hover:bg-accent-hover transition-colors"
                  >
                    {saving ? 'Adding…' : `Add ${selectedMasterIds.size} Selected Dependencies to Project`}
                  </button>
                </div>
              )}
            </div>

            {/* Navigation buttons */}
            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={() => setCurrentStep(3)}
                className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-surface transition-colors"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => setCurrentStep(5)}
                className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent-hover transition-colors"
              >
                Next: Apply to Rooms →
              </button>
            </div>
          </div>
        )}

        {/* ───────────────────────── STEP 5 (CLASSIC MODE): APPLY GRID ───────────────────────── */}
        {isClassic && currentStep === 5 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-semibold text-text-primary">Apply Dependencies to Rooms (Classic Matrix)</h2>
              <p className="text-xs text-text-secondary mt-0.5">
                Matrix: {projectDeps.length} dependencies × {rooms.length} rooms ({existingItems.length} currently applied).
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
              <p className="text-xs text-text-secondary mb-4">
                By default, all chosen dependencies apply to all rooms in the project. You can untick any dependency not applicable to specific rooms or floors.
              </p>

              <div className="flex gap-2 mb-4">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleApplyDependencies}
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-accent-hover transition-colors"
                >
                  {saving ? 'Applying…' : 'Apply All to All Rooms'}
                </button>
              </div>

              {/* Summary table */}
              <div className="space-y-3">
                {floors.map((floor) => {
                  const floorRooms = rooms.filter((r) => r.floor_id === floor.id);
                  return (
                    <div key={floor.id} className="rounded-xl border border-border p-3 bg-surface-alt">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-xs text-text-primary">{floor.label}</span>
                        <span className="text-xs text-text-muted">{floorRooms.length} rooms</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {floorRooms.map((r) => (
                          <span key={r.id} className="rounded bg-surface px-2 py-1 text-xs text-text-secondary border border-border">
                            {r.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Navigation buttons */}
            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={() => setCurrentStep(4)}
                className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-surface transition-colors"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => setCurrentStep(6)}
                className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent-hover transition-colors"
              >
                Next: Escalation &amp; Terms →
              </button>
            </div>
          </div>
        )}

        {/* ───────────────────────── ESCALATION & TERMS STEP ───────────────────────── */}
        {((!isClassic && currentStep === 5) || (isClassic && currentStep === 6)) && (
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-xs">
            <h2 className="text-base font-semibold text-text-primary mb-1">
              Step {isClassic ? 6 : 5}: Escalation Policy &amp; Terms
            </h2>
            <p className="text-xs text-text-secondary mb-4">
              Configure reminder thresholds and general disclaimer terms for site visit reports.
            </p>

            <form onSubmit={handleFinishSetup} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1">
                    Escalate to L2 after (reminders)
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={l2After}
                    onChange={(e) => setL2After(parseInt(e.target.value, 10))}
                    className="block w-full rounded-lg border border-border bg-surface px-3.5 py-2 text-base font-medium focus:border-accent"
                  />
                  <p className="mt-1 text-[11px] text-text-muted">
                    Reminders 1..N go to L1 (Site Engineer).
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1">
                    Escalate to L3 after (reminders)
                  </label>
                  <input
                    type="number"
                    min={l2After + 1}
                    required
                    value={l3After}
                    onChange={(e) => setL3After(parseInt(e.target.value, 10))}
                    className="block w-full rounded-lg border border-border bg-surface px-3.5 py-2 text-base font-medium focus:border-accent"
                  />
                  <p className="mt-1 text-[11px] text-text-muted">
                    Reminders above this go to L3 (Owner/Director).
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1">
                  CC Management (Super Admins)
                </label>
                <select
                  value={mgmtCcLevel}
                  onChange={(e) => setMgmtCcLevel(parseInt(e.target.value, 10))}
                  className="block w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm focus:border-accent"
                >
                  <option value={1}>Always (Level 1 and above)</option>
                  <option value={2}>From Level 2 and above</option>
                  <option value={3}>Level 3 escalations only (Default)</option>
                  <option value={4}>Never CC management</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1">
                  General Terms &amp; Disclaimer
                </label>
                <textarea
                  rows={6}
                  value={termsText}
                  onChange={(e) => setTermsText(e.target.value)}
                  className="block w-full rounded-lg border border-border bg-surface px-3.5 py-2 text-xs font-mono focus:border-accent"
                />
              </div>

              <div className="flex justify-between pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setCurrentStep(isClassic ? 5 : 4)}
                  className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-surface-alt transition-colors"
                >
                  ← Back
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-accent px-6 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-accent-hover transition-colors"
                >
                  {saving ? 'Saving…' : 'Complete Setup & Go to Project →'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ───────────────────────── MODALS ───────────────────────── */}
        {/* Copy Floor Dialog */}
        {copyFloorTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-xl">
              <h3 className="text-base font-bold mb-2">Copy Floor</h3>
              <p className="text-xs text-text-secondary mb-3">
                Duplicating will clone all rooms and their assigned dependencies with a new label.
              </p>
              <input
                type="text"
                placeholder="e.g. 14th Floor"
                value={copyFloorLabel}
                onChange={(e) => setCopyFloorLabel(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm mb-4 focus:border-accent"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCopyFloorTarget(null)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-alt"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleCopyFloor(copyFloorTarget)}
                  className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
                >
                  {saving ? 'Copying…' : 'Confirm Copy'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Agency Modal */}
        {showAddAgency && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold">
                  {agencyModalMode === 'internal' ? 'Add Internal Team' : 'Add External Agency'}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAddAgency(false)}
                  className="text-text-muted hover:text-text-primary text-sm font-bold p-1"
                >
                  ✕
                </button>
              </div>

              {/* Mode switch tabs */}
              <div className="flex rounded-lg bg-surface-alt p-1 mb-4 border border-border">
                <button
                  type="button"
                  onClick={() => {
                    setAgencyModalMode('external');
                    setNewAgencyTypeId('');
                    setNewAgencyCompany('');
                  }}
                  className={`flex-1 rounded-md py-1.5 text-xs font-semibold text-center transition-colors ${
                    agencyModalMode === 'external'
                      ? 'bg-surface text-text-primary shadow-xs'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  External Agency
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAgencyModalMode('internal');
                    setNewAgencyTypeId('');
                    setNewAgencyCompany('');
                  }}
                  className={`flex-1 rounded-md py-1.5 text-xs font-semibold text-center transition-colors ${
                    agencyModalMode === 'internal'
                      ? 'bg-surface text-text-primary shadow-xs'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  Internal Team (VTech)
                </button>
              </div>

              <form onSubmit={handleSaveNewAgency} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">
                    {agencyModalMode === 'internal' ? 'VTech Team Type' : 'Agency Type'}
                  </label>
                  <select
                    required
                    value={newAgencyTypeId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewAgencyTypeId(val);
                      if (agencyModalMode === 'internal') {
                        const matchedType = agencyTypes.find((t) => t.id === val);
                        if (matchedType && !newAgencyCompany) {
                          setNewAgencyCompany(matchedType.name);
                        }
                      }
                    }}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  >
                    <option value="">Select type…</option>
                    {agencyTypes
                      .filter((t) => (agencyModalMode === 'internal' ? t.internal : !t.internal))
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">
                    {agencyModalMode === 'internal' ? 'Team Name / Label' : 'Company Name'}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={agencyModalMode === 'internal' ? 'e.g. VTech Installers' : 'e.g. Omkar Electricals'}
                    value={newAgencyCompany}
                    onChange={(e) => setNewAgencyCompany(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="escToggle"
                    checked={newAgencyEscalation}
                    onChange={(e) => setNewAgencyEscalation(e.target.checked)}
                    className="rounded text-accent focus:ring-accent"
                  />
                  <label htmlFor="escToggle" className="text-xs text-text-primary">
                    Enable structured escalation for this agency
                  </label>
                </div>

                {/* Contacts */}
                <div className="border-t border-border pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-text-primary">Contacts</span>
                    <button
                      type="button"
                      onClick={() =>
                        setNewAgencyContacts([
                          ...newAgencyContacts,
                          { name: '', designation: '', level: 1, phone: '', email: '' },
                        ])
                      }
                      className="text-xs text-accent hover:underline"
                    >
                      + Add contact
                    </button>
                  </div>

                  {newAgencyContacts.map((c, idx) => (
                    <div key={idx} className="space-y-2 rounded-lg bg-surface-alt p-3 mb-2 border border-border">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          required
                          placeholder="Contact Name"
                          value={c.name}
                          onChange={(e) => {
                            const updated = [...newAgencyContacts];
                            updated[idx].name = e.target.value;
                            setNewAgencyContacts(updated);
                          }}
                          className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                        />
                        <input
                          type="text"
                          placeholder="Designation"
                          value={c.designation}
                          onChange={(e) => {
                            const updated = [...newAgencyContacts];
                            updated[idx].designation = e.target.value;
                            setNewAgencyContacts(updated);
                          }}
                          className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <select
                          value={c.level}
                          onChange={(e) => {
                            const updated = [...newAgencyContacts];
                            updated[idx].level = parseInt(e.target.value, 10) as 1 | 2 | 3;
                            setNewAgencyContacts(updated);
                          }}
                          className="rounded-md border border-border bg-surface px-1 py-1 text-xs"
                        >
                          <option value={1}>L1 (Site)</option>
                          <option value={2}>L2 (Manager)</option>
                          <option value={3}>L3 (Owner)</option>
                        </select>
                        <input
                          type="tel"
                          placeholder="Phone"
                          value={c.phone}
                          onChange={(e) => {
                            const updated = [...newAgencyContacts];
                            updated[idx].phone = e.target.value;
                            setNewAgencyContacts(updated);
                          }}
                          className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                        />
                        <input
                          type="email"
                          placeholder="Email"
                          value={c.email}
                          onChange={(e) => {
                            const updated = [...newAgencyContacts];
                            updated[idx].email = e.target.value;
                            setNewAgencyContacts(updated);
                          }}
                          className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddAgency(false)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
                  >
                    {saving ? 'Saving…' : 'Save Agency'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Add Custom Dependency Modal */}
        {showCustomDepModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-xl">
              <h3 className="text-base font-bold mb-3">Add Custom Dependency</h3>
              <form onSubmit={handleAddCustomDep} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Agency Type</label>
                  <select
                    required
                    value={customDepTypeId}
                    onChange={(e) => setCustomDepTypeId(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  >
                    <option value="">Select type…</option>
                    {agencyTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Dependency Text</label>
                  <textarea
                    required
                    rows={3}
                    placeholder="e.g. Ensure motorized curtain track conduit has 25mm clearance"
                    value={customDepText}
                    onChange={(e) => setCustomDepText(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCustomDepModal(false)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
                  >
                    {saving ? 'Adding…' : 'Add Item'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function getOrdinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function Spinner() {
  return (
    <svg className="h-6 w-6 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
