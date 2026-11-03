'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/client/supabase';
import { useAuth } from '@/components/auth-provider';
import { AppHeader } from '@/components/app-header';
import { RoomProductPicker } from '@/components/room-product-picker';
import { ProjectAgenciesForm } from '@/components/v5/project-agencies-form';
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

  // Step state: 1: Basics, 2: Floors & Rooms, 3: Agencies, 4: Room Products
  const initialStep = Math.max(1, Math.min(4, parseInt(searchParams.get('step') ?? '2', 10)));
  const [currentStep, setCurrentStep] = useState(initialStep);
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
  const [roomPresets, setRoomPresets] = useState<string[]>([]);

  // Step 2 local states
  const [floorCountInput, setFloorCountInput] = useState('1');
  const [newRoomInputs, setNewRoomInputs] = useState<Record<string, string>>({});
  const [copyFloorTarget, setCopyFloorTarget] = useState<string | null>(null);
  const [copyFloorLabel, setCopyFloorLabel] = useState('');

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
        { data: settings },
      ] = await Promise.all([
        sb.from('projects').select('*').eq('id', projectId).single(),
        sb.from('floors').select('*').eq('project_id', projectId).order('sort'),
        sb.from('rooms').select('*').eq('project_id', projectId).order('sort'),
        sb.from('agency_types').select('*').order('sort'),
        sb.from('agencies').select('*, agency_contacts(*)').eq('project_id', projectId),
        sb.from('app_settings').select('*'),
      ]);

      if (pErr) throw new Error(pErr.message);
      if (fErr) throw new Error(fErr.message);
      if (rErr) throw new Error(rErr.message);
      if (atErr) throw new Error(atErr.message);
      if (agErr) throw new Error(agErr.message);

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

      // Presets
      const presetsVal = (settings as { key: string; value: unknown }[] | null)?.find((s) => s.key === 'room_presets')?.value;
      if (Array.isArray(presetsVal)) {
        setRoomPresets(presetsVal as string[]);
      }
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

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-alt">
        <Spinner />
      </div>
    );
  }

  const stepsList = [
    { num: 1, label: 'Basics' },
    { num: 2, label: 'Floors & Rooms' },
    { num: 3, label: 'Agencies' },
    { num: 4, label: 'Room Products' },
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
                Step {currentStep} of 4 — Each step saves immediately. You can exit and resume anytime.
              </p>
            </div>
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
                {currentStep > s.num ? (
                  <svg className="h-2.5 w-2.5 stroke-current stroke-[3]" fill="none" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  s.num
                )}
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
        {currentStep === 3 && (
          <div className="space-y-6">
            <div className="border-b border-border pb-3">
              <h2 className="text-base font-semibold text-text-primary">Step 3: Agencies &amp; Contacts</h2>
              <p className="text-xs text-text-secondary mt-0.5">
                Configure external trade contractors and internal VTech execution teams (HansalV2 groups).
              </p>
            </div>
            <ProjectAgenciesForm
              projectId={projectId}
              isWizard={true}
              onNext={() => setCurrentStep(4)}
              onBack={() => setCurrentStep(2)}
              onSaved={() => {
                showSuccessNotice('Agencies and contacts saved');
                loadAll();
              }}
            />
          </div>
        )}

        {/* ───────────────────────── STEP 4 (OFFICE MODE): ROOM-BY-ROOM PRODUCTS ───────────────────────── */}
        {currentStep === 4 && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-text-primary">
                  Step 4: Room-by-Room Products
                </h2>
                <p className="text-xs text-text-secondary mt-0.5">
                  Place the products VTech sells in each room with location and step tracking.
                </p>
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
            ) : (
              <RoomProductPicker
                projectId={projectId}
                roomId={wizardRoomId || rooms[0]?.id}
                onRoomChange={(newId) => setWizardRoomId(newId)}
                onFinish={() => router.push(`/projects/${projectId}`)}
                isWizard={true}
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
                onClick={() => router.push(`/projects/${projectId}`)}
                className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent-hover transition-colors"
              >
                Complete Setup &amp; Go to Project →
              </button>
            </div>
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
