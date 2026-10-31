'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { supabaseBrowser } from '@/lib/client/supabase';
import { AppHeader } from '@/components/app-header';
import Link from 'next/link';

interface ProfileRow {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: 'super_admin' | 'pm_lead' | 'pm';
  active: boolean;
  created_at: string;
}

interface ProjectRow {
  id: string;
  name: string;
  client_name: string | null;
}

interface ProjectMemberRow {
  project_id: string;
  user_id: string;
}

interface AgencyType {
  id: string;
  name: string;
}

interface ProductCatalogueRow {
  id: string;
  title: string;
  scope: 'room' | 'project';
  location_options: string[];
  sort: number;
  active: boolean;
  created_at: string;
}

interface ProductStepRow {
  id: string;
  product_id: string;
  seq: number;
  label: string;
  phase: number;
  responsibility: 'external' | 'internal' | 'client';
  gate: 'none' | 'after_external' | 'after_previous';
  default_agency_type_id: string;
  sheet_colour: string | null;
  agency_types?: { id: string; name: string } | null;
}

export default function AdminPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'users' | 'assignments' | 'catalogue'>('users');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Users data
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRole, setNewRole] = useState<'super_admin' | 'pm_lead' | 'pm'>('pm');
  const [creatingUser, setCreatingUser] = useState(false);
  const [temporaryPasswordResult, setTemporaryPasswordResult] = useState<{
    email: string;
    temporaryPassword?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  // Projects & Assignment data
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectMembers, setProjectMembers] = useState<ProjectMemberRow[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  // Master List data
  const [agencyTypes, setAgencyTypes] = useState<AgencyType[]>([]);
  const [promotingId, setPromotingId] = useState<string | null>(null);

  // Product Catalogue state (v3 P5)
  const [catalogueProducts, setCatalogueProducts] = useState<ProductCatalogueRow[]>([]);
  const [catalogueSteps, setCatalogueSteps] = useState<ProductStepRow[]>([]);
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(new Set());
  const [catalogueSearch, setCatalogueSearch] = useState('');
  
  // Product modals
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [newProductTitle, setNewProductTitle] = useState('');
  const [newProductScope, setNewProductScope] = useState<'room' | 'project'>('room');
  const [newProductLocations, setNewProductLocations] = useState('');
  const [editingProduct, setEditingProduct] = useState<ProductCatalogueRow | null>(null);

  // Step modals
  const [showStepModal, setShowStepModal] = useState(false);
  const [stepModalProductId, setStepModalProductId] = useState<string | null>(null);
  const [editingStep, setEditingStep] = useState<ProductStepRow | null>(null);
  const [stepLabel, setStepLabel] = useState('');
  const [stepPhase, setStepPhase] = useState<1 | 2>(1);
  const [stepResponsibility, setStepResponsibility] = useState<'external' | 'internal' | 'client'>('external');
  const [stepGate, setStepGate] = useState<'none' | 'after_external' | 'after_previous'>('none');
  const [stepDefaultAgencyTypeId, setStepDefaultAgencyTypeId] = useState('');
  const [stepSheetColour, setStepSheetColour] = useState('D9EAD3');

  // Check access
  const isSuperAdmin = profile?.role === 'super_admin';
  const isPmLead = profile?.role === 'pm_lead';
  const hasAccess = isSuperAdmin || isPmLead;

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const sb = supabaseBrowser();

      const [
        { data: uData, error: uErr },
        { data: pData, error: pErr },
        { data: pmData, error: pmErr },
        { data: atData },
        { data: pcData, error: pcErr },
        { data: psData, error: psErr },
      ] = await Promise.all([
        sb.from('profiles').select('*').order('created_at', { ascending: false }),
        sb.from('projects').select('id, name, client_name').neq('status', 'closed').order('name'),
        sb.from('project_members').select('*'),
        sb.from('agency_types').select('*').order('sort'),
        sb.from('product_catalogue').select('*').order('sort').order('title'),
        sb.from('product_steps').select('id, product_id, seq, label, phase, responsibility, gate, default_agency_type_id, sheet_colour, agency_types(id, name)').order('seq'),
      ]);

      if (uErr) throw uErr;
      if (pErr) throw pErr;
      if (pmErr) throw pmErr;
      if (pcErr) throw pcErr;
      if (psErr) throw psErr;

      setUsers(uData as ProfileRow[]);
      setProjects(pData as ProjectRow[]);
      setProjectMembers(pmData as ProjectMemberRow[]);
      setAgencyTypes(atData ?? []);
      setCatalogueProducts((pcData as ProductCatalogueRow[]) ?? []);
      setCatalogueSteps((psData as unknown as ProductStepRow[]) ?? []);

      if (pData && pData.length > 0 && !selectedProjectId) {
        setSelectedProjectId(pData[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (!authLoading && hasAccess) {
      loadAll();
    }
  }, [authLoading, hasAccess, loadAll]);

  const showSuccessNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  };

  // Create User
  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setCreatingUser(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newEmail.trim(),
          fullName: newFullName.trim(),
          phone: newPhone.trim() || undefined,
          role: newRole,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Failed to create user (${res.status})`);
      }

      setShowCreateUserModal(false);
      setNewEmail('');
      setNewFullName('');
      setNewPhone('');
      setNewRole('pm');

      setTemporaryPasswordResult({
        email: body.email,
        temporaryPassword: body.temporaryPassword,
      });

      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creating user');
    } finally {
      setCreatingUser(false);
    }
  }

  // Toggle user active status
  async function handleToggleUserActive(userRow: ProfileRow) {
    const nextActive = !userRow.active;
    const action = nextActive ? 'activate' : 'deactivate';
    if (!confirm(`Are you sure you want to ${action} ${userRow.full_name}?`)) return;

    try {
      const sb = supabaseBrowser();
      const { error: err } = await sb
        .from('profiles')
        .update({ active: nextActive })
        .eq('id', userRow.id);
      if (err) throw err;
      await loadAll();
      showSuccessNotice(`User ${action}d successfully`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update user');
    }
  }

  // Project membership: Assign PM
  async function handleAssignUser(userId: string) {
    if (!selectedProjectId) return;
    try {
      const sb = supabaseBrowser();
      const { error: err } = await sb
        .from('project_members')
        .insert({ project_id: selectedProjectId, user_id: userId });
      if (err) throw err;
      await loadAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to assign user');
    }
  }

  // Project membership: Unassign PM
  async function handleUnassignUser(userId: string) {
    if (!selectedProjectId) return;
    try {
      const sb = supabaseBrowser();
      const { error: err } = await sb
        .from('project_members')
        .delete()
        .eq('project_id', selectedProjectId)
        .eq('user_id', userId);
      if (err) throw err;
      await loadAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to unassign user');
    }
  }

  // ── Product Catalogue Handlers (v3 P5) ──
  async function handleAddProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!newProductTitle.trim()) return;
    try {
      const sb = supabaseBrowser();
      const locs = newProductLocations
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const nextSort =
        catalogueProducts.length > 0 ? Math.max(...catalogueProducts.map((p) => p.sort || 0)) + 1 : 0;

      const { data: inserted, error: insErr } = await sb
        .from('product_catalogue')
        .insert({
          title: newProductTitle.trim(),
          scope: newProductScope,
          location_options: locs,
          sort: nextSort,
          active: true,
        })
        .select('id')
        .single();

      if (insErr) throw insErr;

      setShowAddProductModal(false);
      setNewProductTitle('');
      setNewProductLocations('');
      setNewProductScope('room');
      if (inserted?.id) {
        setExpandedProductIds((prev) => new Set(prev).add(inserted.id));
      }
      await loadAll();
      showSuccessNotice('Product added to catalogue');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add product');
    }
  }

  async function handleSaveProductEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingProduct || !editingProduct.title.trim()) return;
    try {
      const sb = supabaseBrowser();
      const { error: upErr } = await sb
        .from('product_catalogue')
        .update({
          title: editingProduct.title.trim(),
          scope: editingProduct.scope,
          location_options: editingProduct.location_options,
        })
        .eq('id', editingProduct.id);
      if (upErr) throw upErr;
      setEditingProduct(null);
      await loadAll();
      showSuccessNotice('Product updated');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update product');
    }
  }

  async function handleToggleProductActive(prod: ProductCatalogueRow) {
    try {
      const sb = supabaseBrowser();
      const { error: err } = await sb
        .from('product_catalogue')
        .update({ active: !prod.active })
        .eq('id', prod.id);
      if (err) throw err;
      await loadAll();
      showSuccessNotice(prod.active ? 'Product deactivated' : 'Product activated');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to toggle product status');
    }
  }

  function handleOpenAddStep(productId: string) {
    setStepModalProductId(productId);
    setEditingStep(null);
    setStepLabel('');
    setStepPhase(1);
    setStepResponsibility('external');
    setStepGate('none');
    setStepSheetColour('D9EAD3');
    if (agencyTypes.length > 0) {
      setStepDefaultAgencyTypeId(agencyTypes[0].id);
    }
    setShowStepModal(true);
  }

  function handleOpenEditStep(step: ProductStepRow) {
    setStepModalProductId(step.product_id);
    setEditingStep(step);
    setStepLabel(step.label);
    setStepPhase(step.phase as 1 | 2);
    setStepResponsibility(step.responsibility);
    setStepGate(step.gate);
    setStepSheetColour(step.sheet_colour ?? 'D9EAD3');
    setStepDefaultAgencyTypeId(step.default_agency_type_id);
    setShowStepModal(true);
  }

  async function handleSaveStep(e: React.FormEvent) {
    e.preventDefault();
    if (!stepModalProductId || !stepLabel.trim() || !stepDefaultAgencyTypeId) return;
    try {
      const sb = supabaseBrowser();
      const prodSteps = catalogueSteps.filter((s) => s.product_id === stepModalProductId);

      if (editingStep) {
        const { error: upErr } = await sb
          .from('product_steps')
          .update({
            label: stepLabel.trim(),
            phase: stepPhase,
            responsibility: stepResponsibility,
            gate: stepGate,
            default_agency_type_id: stepDefaultAgencyTypeId,
            sheet_colour: stepSheetColour.replace('#', '').trim() || null,
          })
          .eq('id', editingStep.id);
        if (upErr) throw upErr;
        showSuccessNotice('Step updated');
      } else {
        const nextSeq = prodSteps.length > 0 ? Math.max(...prodSteps.map((s) => s.seq)) + 1 : 1;
        const { error: insErr } = await sb.from('product_steps').insert({
          product_id: stepModalProductId,
          seq: nextSeq,
          label: stepLabel.trim(),
          phase: stepPhase,
          responsibility: stepResponsibility,
          gate: stepGate,
          default_agency_type_id: stepDefaultAgencyTypeId,
          sheet_colour: stepSheetColour.replace('#', '').trim() || null,
        });
        if (insErr) throw insErr;
        showSuccessNotice('Step added to product');
      }

      setShowStepModal(false);
      setEditingStep(null);
      setStepLabel('');
      await loadAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save step');
    }
  }

  async function handleDeleteStep(stepId: string) {
    if (!confirm('Are you sure you want to delete this step?')) return;
    try {
      const sb = supabaseBrowser();
      const { error: delErr } = await sb.from('product_steps').delete().eq('id', stepId);
      if (delErr) throw delErr;
      await loadAll();
      showSuccessNotice('Step deleted');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete step');
    }
  }

  async function handleMoveStep(step: ProductStepRow, direction: 'up' | 'down') {
    const prodSteps = catalogueSteps
      .filter((s) => s.product_id === step.product_id)
      .sort((a, b) => a.seq - b.seq);
    const idx = prodSteps.findIndex((s) => s.id === step.id);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= prodSteps.length) return;

    const targetStep = prodSteps[targetIdx];
    try {
      const sb = supabaseBrowser();
      const { error: err1 } = await sb.from('product_steps').update({ seq: 0 }).eq('id', step.id);
      if (err1) throw err1;
      const { error: err2 } = await sb.from('product_steps').update({ seq: step.seq }).eq('id', targetStep.id);
      if (err2) throw err2;
      const { error: err3 } = await sb.from('product_steps').update({ seq: targetStep.seq }).eq('id', step.id);
      if (err3) throw err3;

      await loadAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reorder step');
    }
  }


    if (authLoading || (loading && !profile)) {
  
  return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-alt">
        <Spinner />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-dvh bg-surface-alt">
        <AppHeader />
        <main className="mx-auto max-w-md px-4 py-16 text-center">
          <div className="rounded-2xl border border-danger/20 bg-danger-light p-6">
            <h1 className="text-base font-bold text-danger mb-1">Access Restricted</h1>
            <p className="text-xs text-danger/80">
              Only VTech Super Admins and PM Leads have access to the administration console.
            </p>
            <div className="mt-4">
              <Link href="/" className="rounded-lg bg-danger px-4 py-2 text-xs font-semibold text-white">
                Back to Projects
              </Link>
            </div>
          </div>
        
        {/* ── Modal: Add Product ── */}
        {showAddProductModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-xl">
              <h3 className="text-base font-bold text-text-primary mb-1">Add Product to Catalogue</h3>
              <p className="text-xs text-text-secondary mb-3">
                Create a product that can be placed across rooms with its milestone delivery steps.
              </p>
              <form onSubmit={handleAddProduct} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Product Title</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Video door phone"
                    value={newProductTitle}
                    onChange={(e) => setNewProductTitle(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Scope</label>
                  <select
                    value={newProductScope}
                    onChange={(e) => setNewProductScope(e.target.value as 'room' | 'project')}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  >
                    <option value="room">Room product (Keypad, Speakers, Curtain...)</option>
                    <option value="project">Project deliverable (Main Rack, Handover...)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">
                    Preset Location Options (comma-separated)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Entrance, Front Gate, Bedside"
                    value={newProductLocations}
                    onChange={(e) => setNewProductLocations(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setShowAddProductModal(false)}
                    className="rounded-lg border border-border px-3.5 py-1.5 text-xs text-text-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-accent px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-accent-hover"
                  >
                    Add Product
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Modal: Edit Product ── */}
        {editingProduct && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-xl">
              <h3 className="text-base font-bold text-text-primary mb-1">Edit Product</h3>
              <form onSubmit={handleSaveProductEdit} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Product Title</label>
                  <input
                    type="text"
                    required
                    value={editingProduct.title}
                    onChange={(e) => setEditingProduct({ ...editingProduct, title: e.target.value })}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Scope</label>
                  <select
                    value={editingProduct.scope}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, scope: e.target.value as 'room' | 'project' })
                    }
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  >
                    <option value="room">Room product</option>
                    <option value="project">Project deliverable</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">
                    Preset Locations (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={editingProduct.location_options?.join(', ') ?? ''}
                    onChange={(e) =>
                      setEditingProduct({
                        ...editingProduct,
                        location_options: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setEditingProduct(null)}
                    className="rounded-lg border border-border px-3.5 py-1.5 text-xs text-text-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-accent px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-accent-hover"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Modal: Add / Edit Step ── */}
        {showStepModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-xl">
              <h3 className="text-base font-bold text-text-primary mb-1">
                {editingStep ? 'Edit Step' : 'Add Milestone Step'}
              </h3>
              <form onSubmit={handleSaveStep} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Step Label</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Wiring check & conduit signoff"
                    value={stepLabel}
                    onChange={(e) => setStepLabel(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Default Trade</label>
                  <select
                    required
                    value={stepDefaultAgencyTypeId}
                    onChange={(e) => setStepDefaultAgencyTypeId(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  >
                    <option value="">Select responsible trade…</option>
                    {agencyTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1">Responsibility</label>
                    <select
                      value={stepResponsibility}
                      onChange={(e) =>
                        setStepResponsibility(e.target.value as 'external' | 'internal' | 'client')
                      }
                      className="w-full rounded-lg border border-border px-2.5 py-1.5 text-xs focus:border-accent"
                    >
                      <option value="external">External (Trade)</option>
                      <option value="internal">Internal (VTech)</option>
                      <option value="client">Client</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1">Phase</label>
                    <select
                      value={stepPhase}
                      onChange={(e) => setStepPhase(parseInt(e.target.value, 10) as 1 | 2)}
                      className="w-full rounded-lg border border-border px-2.5 py-1.5 text-xs focus:border-accent"
                    >
                      <option value={1}>Phase 1 (Open)</option>
                      <option value={2}>Phase 2 (Locked)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Unlocking Gate Rule</label>
                  <select
                    value={stepGate}
                    onChange={(e) =>
                      setStepGate(e.target.value as 'none' | 'after_external' | 'after_previous')
                    }
                    className="w-full rounded-lg border border-border px-3 py-1.5 text-xs focus:border-accent"
                  >
                    <option value="none">none (Opens immediately in phase 1)</option>
                    <option value="after_external">after_external (Unlocks when all green steps done)</option>
                    <option value="after_previous">after_previous (Sequential chain)</option>
                  </select>
                </div>

                {/* Sheet Colour selection */}
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">
                    Sheet Milestone Colour
                  </label>
                  <div className="flex items-center gap-2">
                    {[
                      { hex: 'D9EAD3', name: 'Green (Phase 1 other agencies)' },
                      { hex: 'C9DAF8', name: 'Blue (Phase 2 other agencies)' },
                      { hex: 'E06666', name: 'Dark Red (VTech Installers)' },
                      { hex: 'F4CCCC', name: 'Light Red (VTech Programmers)' },
                      { hex: 'F9CB9C', name: 'Orange (VTech PMs)' },
                    ].map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        onClick={() => {
                          setStepSheetColour(c.hex);
                          if (c.hex === 'D9EAD3') {
                            setStepPhase(1);
                            setStepGate('none');
                          } else {
                            setStepPhase(2);
                            setStepGate('after_external');
                          }
                        }}
                        className={`h-6 w-6 rounded-full border-2 transition-transform ${
                          stepSheetColour.toLowerCase() === c.hex.toLowerCase()
                            ? 'scale-110 border-text-primary ring-2 ring-accent'
                            : 'border-black/20 hover:scale-105'
                        }`}
                        style={{ backgroundColor: `#${c.hex}` }}
                        title={c.name}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setShowStepModal(false)}
                    className="rounded-lg border border-border px-3.5 py-1.5 text-xs text-text-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-accent px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-accent-hover"
                  >
                    {editingStep ? 'Save Step' : 'Add Step'}
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

  return (
    <div className="min-h-dvh bg-surface-alt pb-16">
      <AppHeader />

      <main className="mx-auto max-w-4xl px-4 pt-5">
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
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-text-primary">
                Administration Console
              </h1>
              <p className="text-xs text-text-secondary mt-0.5">
                Manage VTech staff accounts, project assignments, and the product catalogue.
              </p>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mb-5 flex border-b border-border overflow-x-auto">
          {[
            { id: 'users', label: `Staff Accounts (${users.length})` },
            { id: 'assignments', label: 'Project Assignment' },
            { id: 'catalogue', label: `Product Catalogue (${catalogueProducts.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`px-4 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                activeTab === tab.id
                  ? 'border-accent text-accent font-bold'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {notice && (
          <div className="mb-4 rounded-xl bg-success-light border border-success/20 p-3 text-xs text-success font-medium">
            {notice}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-xl bg-danger-light border border-danger/20 p-3 text-xs text-danger font-medium">
            {error}
          </div>
        )}

        {/* ───────────────────────── TAB 1: USERS ───────────────────────── */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-text-primary">VTech Staff Accounts</h2>
              <button
                type="button"
                onClick={() => setShowCreateUserModal(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors"
              >
                + Create Staff Account
              </button>
            </div>

            <div className="rounded-2xl border border-border bg-surface overflow-hidden shadow-xs">
              <div className="w-full overflow-x-auto">
                <table className="w-full table-fixed text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-surface-alt border-b border-border">
                      <th className="p-2.5 sm:p-3 font-bold text-text-secondary w-5/12 sm:w-auto">User</th>
                      <th className="hidden sm:table-cell sm:p-3 font-bold text-text-secondary">Email</th>
                      <th className="p-2.5 sm:p-3 font-bold text-text-secondary w-2/12 sm:w-auto">Role</th>
                      <th className="p-2.5 sm:p-3 font-bold text-text-secondary w-2/12 sm:w-auto">Status</th>
                      <th className="p-2.5 sm:p-3 font-bold text-text-secondary text-right w-3/12 sm:w-auto">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-surface-alt/50 transition-colors">
                        <td className="p-2.5 sm:p-3">
                          <p className="font-semibold text-text-primary truncate">{u.full_name}</p>
                          <p className="text-[11px] text-text-secondary truncate sm:hidden">{u.email}</p>
                        </td>
                        <td className="hidden sm:table-cell sm:p-3 text-text-secondary truncate">{u.email}</td>
                        <td className="p-2.5 sm:p-3">
                          <span
                            className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] sm:text-[11px] font-bold ${
                              u.role === 'super_admin'
                                ? 'bg-danger-light text-danger'
                                : u.role === 'pm_lead'
                                ? 'bg-accent/10 text-accent'
                                : 'bg-surface-alt text-text-secondary'
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="p-2.5 sm:p-3">
                          <span
                            className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                              u.active
                                ? 'bg-success-light text-success'
                                : 'bg-surface-alt text-text-muted'
                            }`}
                          >
                            {u.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="p-2.5 sm:p-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleToggleUserActive(u)}
                            className="text-xs font-medium text-text-secondary hover:text-danger underline"
                          >
                            {u.active ? 'Deactivate' : 'Activate'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ───────────────────────── TAB 2: PROJECT ASSIGNMENT ───────────────────────── */}
        {activeTab === 'assignments' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-text-primary">Project Assignments</h2>
                <p className="text-xs text-text-secondary">
                  Assign Project Managers to site projects. PMs only see their assigned projects.
                </p>
              </div>

              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold focus:border-accent"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {selectedProjectId && (() => {
              const assignedUserIds = new Set(
                projectMembers
                  .filter((pm) => pm.project_id === selectedProjectId)
                  .map((pm) => pm.user_id)
              );

              const assignedUsers = users.filter((u) => assignedUserIds.has(u.id));
              const availableUsers = users.filter((u) => !assignedUserIds.has(u.id) && u.active);

              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Assigned PMs */}
                  <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
                    <h3 className="text-sm font-bold text-text-primary mb-3">
                      Assigned to Project ({assignedUsers.length})
                    </h3>
                    {assignedUsers.length === 0 ? (
                      <p className="text-xs text-text-muted italic">No PMs currently assigned.</p>
                    ) : (
                      <div className="space-y-2">
                        {assignedUsers.map((u) => (
                          <div
                            key={u.id}
                            className="flex items-center justify-between rounded-xl bg-surface-alt p-2.5 text-xs border border-border"
                          >
                            <div>
                              <p className="font-semibold text-text-primary">{u.full_name}</p>
                              <p className="text-[11px] text-text-secondary">{u.email}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleUnassignUser(u.id)}
                              className="rounded-md bg-surface px-2.5 py-1 text-xs font-medium text-danger border border-border hover:bg-danger-light transition-colors"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Available Staff */}
                  <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
                    <h3 className="text-sm font-bold text-text-primary mb-3">
                      Available Staff ({availableUsers.length})
                    </h3>
                    {availableUsers.length === 0 ? (
                      <p className="text-xs text-text-muted italic">All active staff are already assigned.</p>
                    ) : (
                      <div className="space-y-2">
                        {availableUsers.map((u) => (
                          <div
                            key={u.id}
                            className="flex items-center justify-between rounded-xl bg-surface-alt p-2.5 text-xs border border-border"
                          >
                            <div>
                              <p className="font-semibold text-text-primary">{u.full_name}</p>
                              <p className="text-[11px] text-text-secondary">{u.role} • {u.email}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleAssignUser(u.id)}
                              className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors"
                            >
                              + Assign
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}



        {/* ───────────────────────── TAB 4: PRODUCT CATALOGUE (v3 P5) ───────────────────────── */}
        {activeTab === 'catalogue' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-text-primary">Product Catalogue (v3)</h2>
                <p className="text-xs text-text-secondary mt-0.5">
                  Products VTech sells, location presets, and delivery milestone step chains.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Filter products or steps…"
                  value={catalogueSearch}
                  onChange={(e) => setCatalogueSearch(e.target.value)}
                  className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowAddProductModal(true)}
                  className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors whitespace-nowrap"
                >
                  + Add Product
                </button>
              </div>
            </div>

            {/* Product List */}
            <div className="space-y-3">
              {catalogueProducts
                .filter((p) => {
                  if (!catalogueSearch.trim()) return true;
                  const q = catalogueSearch.toLowerCase();
                  if (p.title.toLowerCase().includes(q)) return true;
                  const steps = catalogueSteps.filter((s) => s.product_id === p.id);
                  return steps.some((s) => s.label.toLowerCase().includes(q));
                })
                .map((product) => {
                  const isExpanded = expandedProductIds.has(product.id);
                  const steps = catalogueSteps
                    .filter((s) => s.product_id === product.id)
                    .sort((a, b) => a.seq - b.seq);

                  return (
                    <div
                      key={product.id}
                      className={`rounded-2xl border transition-all overflow-hidden ${
                        product.active ? 'border-border bg-surface shadow-xs' : 'border-border/60 bg-surface/50 opacity-70'
                      }`}
                    >
                      {/* Product Header */}
                      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-surface">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedProductIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(product.id)) next.delete(product.id);
                                else next.add(product.id);
                                return next;
                              });
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-text-secondary hover:bg-surface-alt transition-colors"
                            aria-label={isExpanded ? 'Collapse product' : 'Expand product'}
                          >
                            <svg
                              className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>

                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-bold text-text-primary">{product.title}</h3>
                              <span
                                className={`rounded px-1.5 py-0.2 text-[10px] font-semibold uppercase ${
                                  product.scope === 'project'
                                    ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                    : 'bg-surface-alt text-text-secondary border border-border'
                                }`}
                              >
                                {product.scope === 'project' ? 'Project deliverable' : 'Room product'}
                              </span>
                              <span
                                className={`rounded px-1.5 py-0.2 text-[10px] font-semibold ${
                                  product.active ? 'bg-emerald-100 text-emerald-800' : 'bg-surface-alt text-text-muted'
                                }`}
                              >
                                {product.active ? 'Active' : 'Inactive'}
                              </span>
                            </div>

                            {/* Location Options chips */}
                            {product.location_options && product.location_options.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1 mt-1 text-[11px] text-text-secondary">
                                <span className="text-text-muted">Locations:</span>
                                {product.location_options.map((loc) => (
                                  <span key={loc} className="rounded bg-surface-alt px-1.5 py-0.2 border border-border/60">
                                    {loc}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Product Actions */}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenAddStep(product.id)}
                            className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors"
                          >
                            + Add Step
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingProduct(product)}
                            className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-text-secondary hover:text-text-primary hover:bg-surface-alt transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleProductActive(product)}
                            className={`rounded-lg px-2.5 py-1 text-xs font-semibold border transition-colors ${
                              product.active
                                ? 'border-border text-danger hover:bg-danger-light'
                                : 'border-border text-emerald-700 hover:bg-emerald-50'
                            }`}
                          >
                            {product.active ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </div>

                      {/* Steps List (Collapsible) */}
                      {isExpanded && (
                        <div className="border-t border-border bg-surface-alt/40 p-4 space-y-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                              Milestone Delivery Chain ({steps.length} {steps.length === 1 ? 'step' : 'steps'})
                            </span>
                            <span className="text-[11px] text-text-muted italic">
                              Phase 1: all open. Phase 2: unlocks after all green steps complete.
                            </span>
                          </div>

                          {steps.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-border bg-surface p-4 text-center text-xs text-text-muted">
                              No milestone steps configured yet.{' '}
                              <button
                                type="button"
                                onClick={() => handleOpenAddStep(product.id)}
                                className="font-semibold text-accent hover:underline"
                              >
                                Add the first step →
                              </button>
                            </div>
                          ) : (
                            <div className="divide-y divide-border/60 rounded-xl border border-border bg-surface overflow-hidden">
                              {steps.map((step, idx) => (
                                <div
                                  key={step.id}
                                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 text-xs hover:bg-surface-alt/30 transition-colors"
                                >
                                  {/* Left: Seq + Colour + Label */}
                                  <div className="flex items-center gap-2.5">
                                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-alt text-[10px] font-bold text-text-muted border border-border">
                                      {step.seq}
                                    </span>
                                    {step.sheet_colour && (
                                      <span
                                        className="h-3.5 w-3.5 rounded-full border border-black/15 flex-shrink-0"
                                        style={{ backgroundColor: `#${step.sheet_colour}` }}
                                        title={`Colour: #${step.sheet_colour}`}
                                      />
                                    )}
                                    <div>
                                      <p className="font-semibold text-text-primary">{step.label}</p>
                                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-text-secondary mt-0.5">
                                        <span className="rounded bg-surface-alt px-1.5 py-0.2 border border-border/60">
                                          Phase {step.phase}
                                        </span>
                                        <span
                                          className={`rounded px-1.5 py-0.2 font-semibold ${
                                            step.responsibility === 'internal'
                                              ? 'bg-amber-100 text-amber-900 border border-amber-200'
                                              : step.responsibility === 'client'
                                              ? 'bg-blue-100 text-blue-900 border border-blue-200'
                                              : 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                                          }`}
                                        >
                                          {step.responsibility}
                                        </span>
                                        <span className="text-text-muted">
                                          Trade: <strong>{step.agency_types?.name ?? 'Assigned Trade'}</strong>
                                        </span>
                                        {step.gate !== 'none' && (
                                          <span className="text-amber-700 font-medium">
                                            (🔒 Gate: {step.gate})
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Right: Actions */}
                                  <div className="flex items-center gap-1.5 pt-1 sm:pt-0">
                                    <button
                                      type="button"
                                      disabled={idx === 0}
                                      onClick={() => handleMoveStep(step, 'up')}
                                      className="rounded px-1.5 py-0.5 border border-border text-[10px] font-semibold text-text-secondary hover:bg-surface-alt disabled:opacity-30"
                                      title="Move step up"
                                    >
                                      ↑
                                    </button>
                                    <button
                                      type="button"
                                      disabled={idx === steps.length - 1}
                                      onClick={() => handleMoveStep(step, 'down')}
                                      className="rounded px-1.5 py-0.5 border border-border text-[10px] font-semibold text-text-secondary hover:bg-surface-alt disabled:opacity-30"
                                      title="Move step down"
                                    >
                                      ↓
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenEditStep(step)}
                                      className="rounded px-2 py-0.5 border border-border text-[10px] font-semibold text-text-secondary hover:text-text-primary hover:bg-surface-alt"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteStep(step.id)}
                                      className="rounded px-2 py-0.5 border border-border text-[10px] font-semibold text-danger hover:bg-danger-light"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* ── Modal: Create User ── */}
        {showCreateUserModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-xl">
              <h3 className="text-base font-bold text-text-primary mb-1">Create Staff Login</h3>
              <p className="text-xs text-text-secondary mb-4">
                Accounts are provisioned with a secure temporary password.
              </p>

              <form onSubmit={handleCreateUser} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Rahul Sharma"
                    value={newFullName}
                    onChange={(e) => setNewFullName(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Email</label>
                  <input
                    type="email"
                    required
                    placeholder="rahul@vtechpl.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Phone (optional)</label>
                  <input
                    type="tel"
                    placeholder="+91 98765 43210"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Role</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as 'super_admin' | 'pm_lead' | 'pm')}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  >
                    <option value="pm">Project Manager (PM)</option>
                    {/* PM Lead cannot see or select super_admin */}
                    {isSuperAdmin && <option value="pm_lead">PM Lead</option>}
                    {isSuperAdmin && <option value="super_admin">Super Admin</option>}
                  </select>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setShowCreateUserModal(false)}
                    className="rounded-lg border border-border px-3.5 py-1.5 text-xs text-text-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingUser}
                    className="rounded-lg bg-accent px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-accent-hover"
                  >
                    {creatingUser ? 'Creating…' : 'Create User'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Modal: Show Temporary Password Once with Copy Button ── */}
        {temporaryPasswordResult && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-2xl">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-success-light text-success font-bold text-lg">
                ✓
              </div>
              <h3 className="text-base font-bold text-center text-text-primary mb-1">
                Account Created Successfully
              </h3>
              <p className="text-xs text-center text-text-secondary mb-4">
                Share this temporary password with <strong>{temporaryPasswordResult.email}</strong>. This password will not be shown again.
              </p>

              <div className="rounded-xl border border-border bg-surface-alt p-3.5 flex items-center justify-between mb-4">
                <span className="font-mono text-sm font-bold text-text-primary tracking-wide select-all">
                  {temporaryPasswordResult.temporaryPassword}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (temporaryPasswordResult.temporaryPassword) {
                      navigator.clipboard.writeText(temporaryPasswordResult.temporaryPassword);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }
                  }}
                  className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors"
                >
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => setTemporaryPasswordResult(null)}
                className="w-full rounded-lg bg-surface-alt border border-border py-2 text-xs font-bold text-text-primary hover:bg-border transition-colors"
              >
                Done
              </button>
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
