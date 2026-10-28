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

interface MasterDep {
  id: string;
  agency_type_id: string;
  seq: number;
  text: string;
  active: boolean;
  origin: string;
}

interface CustomDep {
  id: string;
  project_id: string;
  agency_type_id: string;
  text: string;
  master_dependency_id: string | null;
  projects?: { name: string };
  agency_types?: { name: string };
}

export default function AdminPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();

  // Tabs: 'users' | 'assignments' | 'master'
  const [activeTab, setActiveTab] = useState<'users' | 'assignments' | 'master'>('users');

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
  const [masterDeps, setMasterDeps] = useState<MasterDep[]>([]);
  const [customDeps, setCustomDeps] = useState<CustomDep[]>([]);
  const [showAddMasterModal, setShowAddMasterModal] = useState(false);
  const [newMasterTypeId, setNewMasterTypeId] = useState('');
  const [newMasterText, setNewMasterText] = useState('');
  const [promotingId, setPromotingId] = useState<string | null>(null);

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
        { data: mdData, error: mdErr },
        { data: cdData, error: cdErr },
      ] = await Promise.all([
        sb.from('profiles').select('*').order('created_at', { ascending: false }),
        sb.from('projects').select('id, name, client_name').neq('status', 'closed').order('name'),
        sb.from('project_members').select('*'),
        sb.from('agency_types').select('*').order('sort'),
        sb.from('master_dependencies').select('*').order('seq'),
        sb.from('project_dependencies').select('id, project_id, agency_type_id, text, master_dependency_id, projects(name), agency_types(name)').is('master_dependency_id', null),
      ]);

      if (uErr) throw uErr;
      if (pErr) throw pErr;
      if (pmErr) throw pmErr;
      if (mdErr) throw mdErr;
      if (cdErr) throw cdErr;

      setUsers(uData as ProfileRow[]);
      setProjects(pData as ProjectRow[]);
      setProjectMembers(pmData as ProjectMemberRow[]);
      setAgencyTypes(atData ?? []);
      setMasterDeps(mdData as MasterDep[]);
      setCustomDeps((cdData as unknown as CustomDep[]) ?? []);

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

  // Add Master Dependency
  async function handleAddMasterDep(e: React.FormEvent) {
    e.preventDefault();
    if (!newMasterTypeId || !newMasterText.trim()) return;
    try {
      const sb = supabaseBrowser();
      const typeDeps = masterDeps.filter((d) => d.agency_type_id === newMasterTypeId);
      const nextSeq = typeDeps.length + 1;

      const { error: err } = await sb.from('master_dependencies').insert({
        agency_type_id: newMasterTypeId,
        seq: nextSeq,
        text: newMasterText.trim(),
        origin: 'master',
        active: true,
      });
      if (err) throw err;

      setShowAddMasterModal(false);
      setNewMasterText('');
      await loadAll();
      showSuccessNotice('Master dependency added');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add master dependency');
    }
  }

  // Toggle Master Dependency active
  async function handleToggleMasterActive(dep: MasterDep) {
    try {
      const sb = supabaseBrowser();
      const { error: err } = await sb
        .from('master_dependencies')
        .update({ active: !dep.active })
        .eq('id', dep.id);
      if (err) throw err;
      await loadAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update master item');
    }
  }

  // Promote custom project dependency to master list
  async function handlePromoteCustomDep(depId: string) {
    setPromotingId(depId);
    try {
      const sb = supabaseBrowser();
      const { error: err } = await sb.rpc('promote_dependency', {
        p_project_dependency: depId,
      });
      if (err) throw err;
      await loadAll();
      showSuccessNotice('Dependency successfully promoted to company Master List!');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to promote dependency');
    } finally {
      setPromotingId(null);
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
                Manage VTech staff accounts, project assignments, and master dependency catalogue.
              </p>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mb-5 flex border-b border-border">
          {[
            { id: 'users', label: `Staff Accounts (${users.length})` },
            { id: 'assignments', label: 'Project Assignment' },
            { id: 'master', label: `Master Catalogue (${masterDeps.length})` },
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
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-surface-alt border-b border-border">
                      <th className="p-3 font-bold text-text-secondary">Name</th>
                      <th className="p-3 font-bold text-text-secondary">Email</th>
                      <th className="p-3 font-bold text-text-secondary">Role</th>
                      <th className="p-3 font-bold text-text-secondary">Status</th>
                      <th className="p-3 font-bold text-text-secondary text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-surface-alt/50 transition-colors">
                        <td className="p-3 font-semibold text-text-primary">{u.full_name}</td>
                        <td className="p-3 text-text-secondary">{u.email}</td>
                        <td className="p-3">
                          <span
                            className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold ${
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
                        <td className="p-3">
                          <span
                            className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold ${
                              u.active
                                ? 'bg-success-light text-success'
                                : 'bg-surface-alt text-text-muted'
                            }`}
                          >
                            {u.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="p-3 text-right">
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

        {/* ───────────────────────── TAB 3: MASTER LIST ───────────────────────── */}
        {activeTab === 'master' && (
          <div className="space-y-6">
            {/* Custom Project Items pending Promotion */}
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-bold text-text-primary">
                  Site-Created Custom Items ({customDeps.length})
                </h2>
                <span className="text-xs text-text-muted">
                  Custom items added by PMs on site that can be promoted into the standard catalogue
                </span>
              </div>

              {customDeps.length === 0 ? (
                <p className="text-xs text-text-muted italic pt-2">
                  No site-specific custom dependencies currently awaiting promotion.
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {customDeps.map((cd) => (
                    <div key={cd.id} className="flex items-center justify-between py-2.5 text-xs">
                      <div className="min-w-0 flex-1 pr-4">
                        <p className="font-semibold text-text-primary">{cd.text}</p>
                        <p className="text-[11px] text-text-secondary">
                          Project: {cd.projects?.name} • Trade: {cd.agency_types?.name}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={promotingId === cd.id}
                        onClick={() => handlePromoteCustomDep(cd.id)}
                        className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors shrink-0"
                      >
                        {promotingId === cd.id ? 'Promoting…' : 'Promote to Master'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Standard Master Dependencies */}
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-text-primary">
                    Master Dependency Catalogue ({masterDeps.length} Items)
                  </h2>
                  <p className="text-xs text-text-secondary">
                    VTech standard checklist items used across all installation projects.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAddMasterModal(true)}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors"
                >
                  + Add Master Item
                </button>
              </div>

              <div className="space-y-4">
                {agencyTypes.map((type) => {
                  const typeDeps = masterDeps.filter((d) => d.agency_type_id === type.id);
                  if (typeDeps.length === 0) return null;

                  return (
                    <div key={type.id} className="border-t border-border pt-3">
                      <h3 className="text-xs font-bold text-text-primary mb-2">
                        {type.name} ({typeDeps.length})
                      </h3>
                      <div className="divide-y divide-border/50">
                        {typeDeps.map((dep) => (
                          <div key={dep.id} className="flex items-center justify-between py-1.5 text-xs">
                            <span className={`flex-1 pr-4 ${!dep.active ? 'line-through text-text-muted' : 'text-text-primary'}`}>
                              {dep.text}
                              {dep.origin === 'promoted' && (
                                <span className="ml-2 rounded-sm bg-accent/10 text-accent px-1.5 py-0.2 text-[10px] font-bold">
                                  Promoted
                                </span>
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleToggleMasterActive(dep)}
                              className="text-[11px] text-text-secondary hover:underline"
                            >
                              {dep.active ? 'Deactivate' : 'Activate'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
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

        {/* ── Modal: Add Master Item ── */}
        {showAddMasterModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-xl">
              <h3 className="text-base font-bold text-text-primary mb-2">Add Master Dependency</h3>
              <form onSubmit={handleAddMasterDep} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Contractor Trade</label>
                  <select
                    required
                    value={newMasterTypeId}
                    onChange={(e) => setNewMasterTypeId(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  >
                    <option value="">Select trade…</option>
                    {agencyTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Standard Checklist Text</label>
                  <textarea
                    required
                    rows={3}
                    placeholder="e.g. Ensure all switchboard back boxes are grounded and levelled"
                    value={newMasterText}
                    onChange={(e) => setNewMasterText(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:border-accent"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setShowAddMasterModal(false)}
                    className="rounded-lg border border-border px-3.5 py-1.5 text-xs text-text-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-accent px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-accent-hover"
                  >
                    Add to Master
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

function Spinner() {
  return (
    <svg className="h-6 w-6 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={2.5} />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
