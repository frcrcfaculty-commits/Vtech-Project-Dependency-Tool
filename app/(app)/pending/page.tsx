'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/client/supabase';
import { useAuth } from '@/components/auth-provider';
import { compressImageToWebP } from '@/lib/client/image';
import { todayIST } from '@/lib/client/date';
import { downloadCsv } from '@/lib/client/csv';
import { AppHeader } from '@/components/app-header';

export interface PendingItem {
  id: string;
  project_id: string;
  room_id: string;
  agency_id: string | null;
  room_product_id?: string | null;
  step_id?: string | null;
  responsibility?: 'external' | 'internal' | 'client' | null;
  status: 'pending';
  first_raised_on: string | null;
  completed_on: string | null;
  reminder_count: number;
  last_reminded_on: string | null;
  note: string | null;
  photo_path: string | null;
  action_plan: string | null;
  action_plan_updated_at: string | null;
  action_plan_updated_by: string | null;
  updated_at: string;
  waits_on_client?: boolean;
  projects: {
    id: string;
    name: string;
    client_name: string | null;
    l2_after: number | null;
    l3_after: number | null;
  } | null;
  rooms: {
    id: string;
    name: string;
    sort: number;
    floors: {
      id: string;
      label: string;
      sort: number;
      projects?: PendingItem['projects'];
    } | null;
  } | null;
  project_dependencies: {
    id: string;
    text: string;
    seq: number;
    agency_types: {
      id: string;
      name: string;
      internal?: boolean;
    } | null;
  } | null;
  agencies: {
    id: string;
    company_name: string;
    agency_types: {
      id: string;
      name: string;
      internal?: boolean;
    } | null;
  } | null;
  room_products?: {
    id: string;
    location: string | null;
    make: string | null;
    model: string | null;
    quantity: number;
    product_catalogue?: {
      id: string;
      title: string;
    } | null;
  } | null;
  product_steps?: {
    id: string;
    label: string;
    seq: number;
    sheet_colour: string | null;
    responsibility: 'external' | 'internal' | 'client';
  } | null;
}

export function formatPendingItemTitle(item: PendingItem): string {
  const roomName = item.rooms?.name ?? 'Room';
  if (item.room_products) {
    const prodTitle = item.room_products.product_catalogue?.title ?? 'Product';
    const loc = item.room_products.location ? ` (${item.room_products.location})` : '';
    const stepLabel = item.product_steps?.label ?? item.project_dependencies?.text ?? 'Pending step';
    return `${roomName} · ${prodTitle}${loc} · ${stepLabel}`;
  }
  const depText = item.project_dependencies?.text ?? 'Pending dependency';
  return `${roomName} · ${depText}`;
}

export function formatAgencyLabel(item: PendingItem): string {
  const typeName = item.project_dependencies?.agency_types?.name ?? item.agencies?.agency_types?.name;
  const comp = item.agencies?.company_name;

  if (typeName === 'Installer' || typeName === 'Programmer' || typeName === 'Sales') {
    return `${typeName} – VTech`;
  }
  if (comp && typeName && !comp.toLowerCase().includes(typeName.toLowerCase())) {
    return `${typeName} – ${comp}`;
  }
  return comp ?? typeName ?? 'Unassigned';
}

interface AgencyContact {
  id: string;
  agency_id: string;
  project_id: string;
  name: string;
  designation: string;
  level: number;
  phone: string | null;
  email: string | null;
  active: boolean;
}

interface DraftMessage {
  projectId: string;
  projectName: string;
  agencyId: string;
  agencyName: string;
  phone: string | null;
  email: string | null;
  text: string;
  subject: string;
}

type SortColumn = 'default' | 'project' | 'room' | 'product' | 'agency' | 'date';
type SortDirection = 'asc' | 'desc';

export default function PendingPage() {
  const router = useRouter();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [items, setItems] = useState<PendingItem[]>([]);
  const [contacts, setContacts] = useState<AgencyContact[]>([]);

  // 3 Lanes: External · Internal · Waiting on client
  const [activeLane, setActiveLane] = useState<'external' | 'internal' | 'client'>('external');

  // Sorting
  const [sortColumn, setSortColumn] = useState<SortColumn>('default');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Selection
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  // Multi-select dropdown filters
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [selectedAgencyIds, setSelectedAgencyIds] = useState<string[]>([]);
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [agencyDropdownOpen, setAgencyDropdownOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');
  const [agencySearch, setAgencySearch] = useState('');

  const [ageFilter, setAgeFilter] = useState<'all' | '7' | '14' | '30'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Export dropdown
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  // Status modal (Done / N.A.)
  const [statusTargetItem, setStatusTargetItem] = useState<{
    item: PendingItem;
    targetStatus: 'complete' | 'pending' | 'na';
  } | null>(null);
  const [statusDate, setStatusDate] = useState<string>('');
  const [statusNote, setStatusNote] = useState<string>('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState<boolean>(false);

  // Photo viewer modal
  const [viewingPhotoUrl, setViewingPhotoUrl] = useState<string | null>(null);

  // Reminder Draft Drawer
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [drawerChannel, setDrawerChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const [drawerDrafts, setDrawerDrafts] = useState<DraftMessage[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState<boolean>(false);
  const [sendingRound, setSendingRound] = useState<boolean>(false);

  // Confirmation dialog after opening WhatsApp/Gmail
  const [confirmDialog, setConfirmDialog] = useState<{
    dispatchIds: string[];
    links: { channel: string; url: string; label: string }[];
  } | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Lane classification helper
  const getItemLane = useCallback((item: PendingItem): 'external' | 'internal' | 'client' => {
    if (item.waits_on_client) return 'client';
    const isInternal =
      item.responsibility === 'internal' ||
      item.product_steps?.responsibility === 'internal' ||
      item.agencies?.agency_types?.internal === true ||
      item.project_dependencies?.agency_types?.internal === true;
    if (isInternal) return 'internal';
    return 'external';
  }, []);

  // Load pending data
  const loadPendingData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const sb = supabaseBrowser();

      const [itemsRes, contactsRes, gateRes] = await Promise.all([
        sb
          .from('dependency_items')
          .select(
            `id, project_id, room_id, agency_id, room_product_id, step_id, responsibility, status, first_raised_on, completed_on, reminder_count, last_reminded_on, note, photo_path, action_plan, action_plan_updated_at, action_plan_updated_by, updated_at,
             rooms(id, name, sort, floors(id, label, sort, projects(id, name, client_name, l2_after, l3_after))),
             project_dependencies(id, text, seq, agency_types(id, name, internal)),
             agencies(id, company_name, agency_types(id, name, internal)),
             room_products(id, location, make, model, quantity, product_catalogue(id, title)),
             product_steps(id, label, seq, sheet_colour, responsibility)`
          )
          .eq('status', 'pending')
          .order('first_raised_on', { ascending: true, nullsFirst: false }),
        sb
          .from('agency_contacts')
          .select('id, agency_id, project_id, name, designation, level, phone, email, active')
          .eq('active', true)
          .order('level', { ascending: true }),
        sb.from('item_gate').select('item_id, waits_on_client'),
      ]);

      if (itemsRes.error) throw itemsRes.error;
      if (contactsRes.error) throw contactsRes.error;

      const clientWaitsSet = new Set(
        (gateRes.data ?? [])
          .filter((g: { waits_on_client: boolean }) => g.waits_on_client)
          .map((g: { item_id: string }) => g.item_id)
      );

      type Raw = Omit<PendingItem, 'projects'> & {
        rooms: (PendingItem['rooms'] & { floors: { id: string; label: string; sort: number; projects: PendingItem['projects'] } | null }) | null;
      };

      const rawItems: PendingItem[] = ((itemsRes.data ?? []) as unknown as Raw[]).map((r) => {
        const isClient =
          clientWaitsSet.has(r.id) ||
          r.agencies?.agency_types?.name === 'Client' ||
          r.project_dependencies?.agency_types?.name === 'Client' ||
          r.product_steps?.responsibility === 'client' ||
          r.responsibility === 'client';

        return {
          ...r,
          waits_on_client: isClient,
          projects: r.rooms?.floors?.projects ?? null,
        };
      });

      setItems(rawItems);
      setContacts((contactsRes.data ?? []) as AgencyContact[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pending dependencies');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPendingData();
  }, [loadPendingData]);

  // Global event listener for dependencies added
  useEffect(() => {
    const handleAdded = () => loadPendingData();
    window.addEventListener('vtech:dependency-added', handleAdded);
    return () => window.removeEventListener('vtech:dependency-added', handleAdded);
  }, [loadPendingData]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-dropdown]')) {
        setProjectDropdownOpen(false);
        setAgencyDropdownOpen(false);
        setExportDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter options derived from items
  const filterOptions = useMemo(() => {
    const projectsMap = new Map<string, { id: string; name: string; count: number }>();
    const agenciesMap = new Map<string, { id: string; name: string; count: number }>();

    for (const item of items) {
      if (item.projects) {
        const cur = projectsMap.get(item.projects.id) ?? { id: item.projects.id, name: item.projects.name, count: 0 };
        cur.count++;
        projectsMap.set(item.projects.id, cur);
      }
      const agencyName = formatAgencyLabel(item);
      const agencyKey = item.agency_id ?? agencyName;
      const curAg = agenciesMap.get(agencyKey) ?? { id: agencyKey, name: agencyName, count: 0 };
      curAg.count++;
      agenciesMap.set(agencyKey, curAg);
    }

    return {
      projects: Array.from(projectsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      agencies: Array.from(agenciesMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [items]);

  const laneCounts = useMemo(() => {
    let external = 0;
    let internal = 0;
    let client = 0;
    for (const item of items) {
      const lane = getItemLane(item);
      if (lane === 'external') external++;
      else if (lane === 'internal') internal++;
      else client++;
    }
    return { external, internal, client };
  }, [items, getItemLane]);

  // Filtered items
  const filteredItems = useMemo(() => {
    const now = Date.now();

    return items.filter((item) => {
      // 3 Lanes Filter
      if (getItemLane(item) !== activeLane) return false;

      // Multi-select project filter
      if (selectedProjectIds.length > 0 && !selectedProjectIds.includes(item.project_id)) {
        return false;
      }

      // Multi-select agency filter
      if (selectedAgencyIds.length > 0) {
        const agencyName = formatAgencyLabel(item);
        const agencyKey = item.agency_id ?? agencyName;
        if (!selectedAgencyIds.includes(agencyKey) && (!item.agency_id || !selectedAgencyIds.includes(item.agency_id))) {
          return false;
        }
      }

      // Age filter
      if (ageFilter !== 'all') {
        if (!item.first_raised_on) return false;
        const raisedDate = new Date(item.first_raised_on).getTime();
        const daysOpen = Math.floor((now - raisedDate) / (1000 * 60 * 60 * 24));
        const minDays = parseInt(ageFilter, 10);
        if (daysOpen < minDays) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const formattedTitle = formatPendingItemTitle(item).toLowerCase();
        const text = item.project_dependencies?.text?.toLowerCase() ?? '';
        const room = item.rooms?.name?.toLowerCase() ?? '';
        const floor = item.rooms?.floors?.label?.toLowerCase() ?? '';
        const proj = item.projects?.name?.toLowerCase() ?? '';
        const agency = formatAgencyLabel(item).toLowerCase();
        const actionPlan = item.action_plan?.toLowerCase() ?? '';
        if (
          !formattedTitle.includes(q) &&
          !text.includes(q) &&
          !room.includes(q) &&
          !floor.includes(q) &&
          !proj.includes(q) &&
          !agency.includes(q) &&
          !actionPlan.includes(q)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [items, getItemLane, activeLane, selectedProjectIds, selectedAgencyIds, ageFilter, searchQuery]);

  // Sorted items
  const sortedItems = useMemo(() => {
    const list = [...filteredItems];

    if (sortColumn === 'default') {
      // Default: grouped by project name, then room sort / floor sort
      return list.sort((a, b) => {
        const pA = a.projects?.name ?? '';
        const pB = b.projects?.name ?? '';
        const pCmp = pA.localeCompare(pB);
        if (pCmp !== 0) return pCmp;

        const fA = a.rooms?.floors?.sort ?? 0;
        const fB = b.rooms?.floors?.sort ?? 0;
        if (fA !== fB) return fA - fB;

        const rA = a.rooms?.sort ?? 0;
        const rB = b.rooms?.sort ?? 0;
        if (rA !== rB) return rA - rB;

        return (a.rooms?.name ?? '').localeCompare(b.rooms?.name ?? '');
      });
    }

    list.sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case 'project': {
          const pA = a.projects?.name ?? '';
          const pB = b.projects?.name ?? '';
          cmp = pA.localeCompare(pB);
          break;
        }
        case 'room': {
          const rA = a.rooms?.name ?? '';
          const rB = b.rooms?.name ?? '';
          cmp = rA.localeCompare(rB);
          break;
        }
        case 'product': {
          const prA = a.room_products?.product_catalogue?.title ?? a.project_dependencies?.text ?? '';
          const prB = b.room_products?.product_catalogue?.title ?? b.project_dependencies?.text ?? '';
          cmp = prA.localeCompare(prB);
          break;
        }
        case 'agency': {
          const agA = formatAgencyLabel(a);
          const agB = formatAgencyLabel(b);
          cmp = agA.localeCompare(agB);
          break;
        }
        case 'date': {
          const dA = a.first_raised_on ?? '';
          const dB = b.first_raised_on ?? '';
          cmp = dA.localeCompare(dB);
          break;
        }
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [filteredItems, sortColumn, sortDirection]);

  // Toggle sort on header click
  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortColumn('default');
        setSortDirection('asc');
      }
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  // Selection handlers
  const handleToggleItem = (itemId: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const allVisibleSelected = sortedItems.length > 0 && sortedItems.every((i) => selectedItemIds.has(i.id));
  const someVisibleSelected = sortedItems.some((i) => selectedItemIds.has(i.id)) && !allVisibleSelected;

  const handleToggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedItemIds((prev) => {
        const next = new Set(prev);
        sortedItems.forEach((i) => next.delete(i.id));
        return next;
      });
    } else {
      setSelectedItemIds((prev) => {
        const next = new Set(prev);
        sortedItems.forEach((i) => next.add(i.id));
        return next;
      });
    }
  };

  const handleClearSelection = () => setSelectedItemIds(new Set());

  // Individual Reminders drawer trigger
  const handleOpenReminderDrawer = async (channel: 'whatsapp' | 'email') => {
    if (selectedItemIds.size === 0) return;
    setDrawerChannel(channel);
    setDrawerOpen(true);
    setLoadingDrafts(true);
    setError(null);

    try {
      // Group selected items by project
      const byProject = new Map<string, { projectName: string; itemIds: string[] }>();
      for (const item of items) {
        if (selectedItemIds.has(item.id)) {
          const p = byProject.get(item.project_id) ?? {
            projectName: item.projects?.name ?? 'Project',
            itemIds: [],
          };
          p.itemIds.push(item.id);
          byProject.set(item.project_id, p);
        }
      }

      const drafts: DraftMessage[] = [];

      // Fetch preview drafts for each project with itemIds
      for (const [projectId, pData] of byProject.entries()) {
        const res = await fetch(`/api/projects/${projectId}/reminder-rounds`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: 'all',
            agencyTypeIds: ['client', 'pmc', 'ele', 'carp', 'sales', 'inst', 'prog'],
            channel,
            preview: true,
            itemIds: pData.itemIds,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.error ?? `Failed to preview drafts for ${pData.projectName}`);
        }

        const data = await res.json();
        for (const d of data.drafts ?? []) {
          const phone = d.whatsapp?.to?.[0]?.phone ?? null;
          const email = d.email?.to?.[0]?.email ?? null;
          const text = channel === 'whatsapp' ? (d.whatsapp?.text ?? '') : (d.email?.text ?? '');
          const subject = d.email?.subject ?? `Pending items for ${d.agency?.companyName ?? 'Agency'}`;

          drafts.push({
            projectId,
            projectName: pData.projectName,
            agencyId: d.agency?.id ?? '',
            agencyName: d.agency?.companyName ?? 'Contractor',
            phone,
            email,
            text,
            subject,
          });
        }
      }

      setDrawerDrafts(drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate reminder drafts');
    } finally {
      setLoadingDrafts(false);
    }
  };

  // Send reminders from drawer
  const handleSendDrafts = async () => {
    try {
      setSendingRound(true);
      setError(null);

      const byProject = new Map<string, string[]>();
      for (const item of items) {
        if (selectedItemIds.has(item.id)) {
          const list = byProject.get(item.project_id) ?? [];
          list.push(item.id);
          byProject.set(item.project_id, list);
        }
      }

      const allDispatches: any[] = [];
      const linksToOpen: { channel: string; url: string; label: string }[] = [];

      for (const [projectId, pItemIds] of byProject.entries()) {
        const res = await fetch(`/api/projects/${projectId}/reminder-rounds`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: 'all',
            agencyTypeIds: ['client', 'pmc', 'ele', 'carp', 'sales', 'inst', 'prog'],
            channel: drawerChannel,
            preview: false,
            itemIds: pItemIds,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? `Failed to send reminders for project`);
        }

        const data = await res.json();
        if (data.dispatches) {
          allDispatches.push(...data.dispatches);
        }
      }

      // Collect links
      for (const d of allDispatches) {
        const outcome = d.outcome;
        const link = outcome?.link ?? outcome?.details?.link;
        if (link) {
          linksToOpen.push({
            channel: d.channel,
            url: link,
            label: `${d.agency?.company_name ?? 'Agency'} (${d.channel})`,
          });
        }
      }

      setDrawerOpen(false);
      setNotice(`Sent reminder round for ${selectedItemIds.size} items.`);
      setTimeout(() => setNotice(null), 4000);

      if (linksToOpen.length > 0) {
        // Open the first link in a new tab
        window.open(linksToOpen[0].url, '_blank');
        setConfirmDialog({
          dispatchIds: allDispatches.map((d) => d.id).filter(Boolean),
          links: linksToOpen,
        });
      }

      loadPendingData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reminders');
    } finally {
      setSendingRound(false);
    }
  };

  const handleConfirmDispatches = async (dispatchIds: string[]) => {
    try {
      setConfirming(true);
      for (const id of dispatchIds) {
        await fetch(`/api/dispatches/${id}/confirm`, { method: 'POST' });
      }
      setConfirmDialog(null);
      setNotice('Dispatches confirmed successfully.');
      setTimeout(() => setNotice(null), 3000);
      loadPendingData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm dispatches');
    } finally {
      setConfirming(false);
    }
  };

  // Status Modal Handlers (Done / N.A.)
  const handleOpenStatusSheet = (item: PendingItem, targetStatus: 'complete' | 'pending' | 'na') => {
    setStatusTargetItem({ item, targetStatus });
    setStatusDate(todayIST());
    setStatusNote(item.note ?? '');
    setPhotoFile(null);
    setPhotoPreview(null);
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleSaveStatus = async () => {
    if (!statusTargetItem) return;
    const { item, targetStatus } = statusTargetItem;

    try {
      setSavingStatus(true);
      setError(null);
      const sb = supabaseBrowser();

      let storagePath: string | null = item.photo_path;

      if (photoFile) {
        const compressedBlob = await compressImageToWebP(photoFile, 1280, 0.7);
        const uuid = crypto.randomUUID();
        storagePath = `${item.project_id}/${item.id}/${uuid}.webp`;

        const { error: uploadErr } = await sb.storage.from('evidence').upload(storagePath, compressedBlob, {
          contentType: 'image/webp',
          upsert: true,
        });
        if (uploadErr) throw uploadErr;
      }

      const { error: rpcErr } = await sb.rpc('set_item_status', {
        p_item: item.id,
        p_status: targetStatus,
        p_date: statusDate || todayIST(),
        p_note: statusNote.trim() || null,
        p_photo: storagePath,
      });

      if (rpcErr) throw rpcErr;

      if (targetStatus !== 'pending') {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
        setSelectedItemIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        setNotice(`Item marked as ${targetStatus === 'complete' ? 'Completed' : 'N.A.'}`);
      } else {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, note: statusNote.trim() || null, photo_path: storagePath } : i))
        );
        setNotice('Item updated');
      }

      setTimeout(() => setNotice(null), 3000);
      setStatusTargetItem(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update item status');
    } finally {
      setSavingStatus(false);
    }
  };

  // View photo
  const handleViewPhoto = async (photoPath: string) => {
    try {
      const sb = supabaseBrowser();
      const { data } = await sb.storage.from('evidence').createSignedUrl(photoPath, 3600);
      if (data?.signedUrl) setViewingPhotoUrl(data.signedUrl);
    } catch (err) {
      console.error('Failed to load signed photo url:', err);
    }
  };

  // Exports
  const handleExportPendingCsv = () => {
    const headers = [
      'Project',
      'Floor',
      'Room',
      'Product',
      'Location',
      'What Pending',
      'Agency',
      'First Raised On',
      'Days Open',
      'Reminders Sent',
      'Action Plan',
      'Note',
    ];
    const now = Date.now();
    const rows = sortedItems.map((item) => {
      const days = item.first_raised_on
        ? Math.max(0, Math.floor((now - new Date(item.first_raised_on).getTime()) / (1000 * 60 * 60 * 24)))
        : 0;
      return [
        item.projects?.name ?? '—',
        item.rooms?.floors?.label ?? '—',
        item.rooms?.name ?? '—',
        item.room_products?.product_catalogue?.title ?? item.project_dependencies?.text ?? '—',
        item.room_products?.location ?? '—',
        item.product_steps?.label ?? item.project_dependencies?.text ?? '—',
        formatAgencyLabel(item),
        item.first_raised_on ?? '—',
        days,
        item.reminder_count,
        item.action_plan ?? '',
        item.note ?? '',
      ];
    });
    const dStr = new Date().toISOString().slice(0, 10);
    downloadCsv(`VTech_Pending_Items_${dStr}`, headers, rows);
  };

  const handleExportAllBoqCsv = async () => {
    try {
      setExporting('boq_csv');
      const sb = supabaseBrowser();
      const { data, error: err } = await sb
        .from('room_products')
        .select(`
          location, make, model, quantity, note,
          product_catalogue(title),
          rooms(name, sort, floors(label, sort, projects(name)))
        `);
      if (err) throw err;

      const headers = ['Project', 'Floor', 'Room', 'Product', 'Location', 'Make', 'Model', 'Quantity', 'Note'];
      const rows = (data ?? []).map((rp: any) => [
        rp.rooms?.floors?.projects?.name ?? '—',
        rp.rooms?.floors?.label ?? '—',
        rp.rooms?.name ?? '—',
        rp.product_catalogue?.title ?? '—',
        rp.location ?? '—',
        rp.make ?? '—',
        rp.model ?? '—',
        rp.quantity || 1,
        rp.note ?? '',
      ]);
      const dStr = new Date().toISOString().slice(0, 10);
      downloadCsv(`VTech_All_Products_BOQ_${dStr}`, headers, rows);
    } catch (e: any) {
      alert(e?.message || 'Failed to export BOQ');
    } finally {
      setExporting(null);
    }
  };

  const handleExportCompletedCsv = async () => {
    try {
      setExporting('completed_csv');
      const sb = supabaseBrowser();
      const { data, error: err } = await sb
        .from('dependency_items')
        .select(`
          first_raised_on, completed_on, note,
          rooms(name, floors(label, projects(name))),
          project_dependencies(text),
          room_products(location, product_catalogue(title)),
          product_steps(label),
          agencies(company_name, agency_types(name))
        `)
        .eq('status', 'complete')
        .order('completed_on', { ascending: false });

      if (err) throw err;

      const headers = [
        'Project',
        'Floor',
        'Room',
        'Product / Dependency',
        'Location',
        'What was pending',
        'Agency',
        'First Raised On',
        'Completed On',
        'Days to Complete',
        'Note',
      ];

      const rows = (data ?? []).map((i: any) => {
        let days: number | string = '—';
        if (i.first_raised_on && i.completed_on) {
          const s = new Date(i.first_raised_on).getTime();
          const e = new Date(i.completed_on).getTime();
          days = Math.max(0, Math.round((e - s) / (1000 * 60 * 60 * 24)));
        }
        const prod = i.room_products?.product_catalogue?.title ?? i.project_dependencies?.text ?? '—';
        const agencyName = i.agencies?.company_name
          ? `${i.agencies?.agency_types?.name ?? ''} – ${i.agencies.company_name}`
          : '—';

        return [
          i.rooms?.floors?.projects?.name ?? '—',
          i.rooms?.floors?.label ?? '—',
          i.rooms?.name ?? '—',
          prod,
          i.room_products?.location ?? '—',
          i.product_steps?.label ?? i.project_dependencies?.text ?? '—',
          agencyName,
          i.first_raised_on ?? '—',
          i.completed_on ?? '—',
          days,
          i.note ?? '',
        ];
      });

      const dStr = new Date().toISOString().slice(0, 10);
      downloadCsv(`VTech_Completed_Items_${dStr}`, headers, rows);
    } catch (e: any) {
      alert(e?.message || 'Failed to export completed items');
    } finally {
      setExporting(null);
    }
  };

  const getDaysOpen = (dateStr: string | null) => {
    if (!dateStr) return 0;
    const raised = new Date(dateStr).getTime();
    return Math.max(0, Math.floor((Date.now() - raised) / (1000 * 60 * 60 * 24)));
  };

  const formatPendingDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const totalPending = items.length;

  return (
    <div className="min-h-screen bg-surface-alt pb-32">
      <AppHeader />

      {/* ───────────────────────── HEADER & TOP METRICS ───────────────────────── */}
      <div className="border-b border-border bg-surface px-4 py-5 shadow-xs">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold tracking-tight text-text-primary">Pending Dependencies</h1>
                <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-bold text-danger">
                  {totalPending} open
                </span>
              </div>
              <p className="mt-0.5 text-xs text-text-secondary">
                Cross-project actionable items requiring contractor follow-up
              </p>
            </div>

            {/* Top Right: Exports Dropdown & Refresh */}
            <div className="flex items-center gap-2">
              <div className="relative" data-dropdown>
                <button
                  type="button"
                  onClick={() => setExportDropdownOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary shadow-xs hover:bg-surface-alt transition-colors"
                >
                  <svg className="h-3.5 w-3.5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export
                  <svg className="h-3 w-3 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {exportDropdownOpen && (
                  <div className="absolute right-0 mt-1.5 w-60 rounded-xl border border-border bg-surface p-1.5 shadow-xl z-50 text-xs">
                    <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                      Pending Items
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setExportDropdownOpen(false);
                        handleExportPendingCsv();
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-text-primary hover:bg-surface-alt font-medium"
                    >
                      <span>Pending items (CSV)</span>
                      <span className="text-[10px] text-text-muted">Filtered</span>
                    </button>
                    <a
                      href={selectedProjectIds.length === 1 ? `/api/reports/pending.pdf?project=${selectedProjectIds[0]}` : '/api/reports/pending.pdf'}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setExportDropdownOpen(false)}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-text-primary hover:bg-surface-alt font-medium"
                    >
                      <span>Pending items (PDF)</span>
                      <span className="text-[10px] text-text-muted">Printable</span>
                    </a>

                    <div className="my-1 border-t border-border/60" />
                    <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                      All Products (BOQ)
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setExportDropdownOpen(false);
                        handleExportAllBoqCsv();
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-text-primary hover:bg-surface-alt font-medium"
                    >
                      <span>All products BOQ (CSV)</span>
                      <span className="text-[10px] text-text-muted">Full catalog</span>
                    </button>
                    <a
                      href="/api/reports/boq.pdf"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setExportDropdownOpen(false)}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-text-primary hover:bg-surface-alt font-medium"
                    >
                      <span>All products BOQ (PDF)</span>
                      <span className="text-[10px] text-text-muted">Printable</span>
                    </a>

                    <div className="my-1 border-t border-border/60" />
                    <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                      Completed Items
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setExportDropdownOpen(false);
                        handleExportCompletedCsv();
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-text-primary hover:bg-surface-alt font-medium"
                    >
                      <span>Completed items (CSV)</span>
                      <span className="text-[10px] text-text-muted">History</span>
                    </button>
                    <a
                      href="/api/reports/completed.pdf"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setExportDropdownOpen(false)}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-text-primary hover:bg-surface-alt font-medium"
                    >
                      <span>Completed items (PDF)</span>
                      <span className="text-[10px] text-text-muted">Printable</span>
                    </a>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={loadPendingData}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-surface-alt hover:text-text-primary disabled:opacity-50"
              >
                <svg
                  className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ───────────────────────── NOTICES / ERRORS ───────────────────────── */}
      <div className="mx-auto max-w-7xl px-4 pt-3">
        {error && (
          <div className="mb-3 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs font-semibold text-danger">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-3 rounded-lg border border-accent/30 bg-accent/10 p-3 text-xs font-semibold text-accent">
            {notice}
          </div>
        )}
      </div>

      {/* ───────────────────────── THREE LANES TABS ───────────────────────── */}
      <div className="mx-auto max-w-7xl px-4 pt-3">
        <div className="flex border-b border-border bg-surface rounded-t-xl px-2 pt-2 gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => {
              setActiveLane('external');
              setSelectedItemIds(new Set());
            }}
            className={`flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-xs font-bold border-b-2 transition-all ${
              activeLane === 'external'
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            <span>External (agencies)</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                activeLane === 'external' ? 'bg-accent/15 text-accent' : 'bg-surface-alt text-text-muted'
              }`}
            >
              {laneCounts.external}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveLane('internal');
              setSelectedItemIds(new Set());
            }}
            className={`flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-xs font-bold border-b-2 transition-all ${
              activeLane === 'internal'
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            <span>Internal (VTech team)</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                activeLane === 'internal' ? 'bg-accent/15 text-accent' : 'bg-surface-alt text-text-muted'
              }`}
            >
              {laneCounts.internal}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveLane('client');
              setSelectedItemIds(new Set());
            }}
            className={`flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-xs font-bold border-b-2 transition-all ${
              activeLane === 'client'
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            <span>Waiting on client</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                activeLane === 'client' ? 'bg-accent/15 text-accent' : 'bg-surface-alt text-text-muted'
              }`}
            >
              {laneCounts.client}
            </span>
          </button>
        </div>
      </div>

      {/* ───────────────────────── FILTERS & ACTION BAR ───────────────────────── */}
      <div className="mx-auto max-w-7xl px-4 py-3">
        <div className="rounded-xl border border-border bg-surface p-3.5 shadow-xs space-y-3">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-12">
            {/* Search */}
            <div className="lg:col-span-4">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">
                Search
              </label>
              <input
                type="text"
                placeholder="Search description, room, project, contractor…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-alt px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:bg-surface focus:outline-none"
              />
            </div>

            {/* Project Multi-Select Dropdown */}
            <div className="lg:col-span-3 relative" data-dropdown>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">
                Project ({selectedProjectIds.length === 0 ? 'All' : `${selectedProjectIds.length} selected`})
              </label>
              <button
                type="button"
                onClick={() => {
                  setProjectDropdownOpen((prev) => !prev);
                  setAgencyDropdownOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-surface-alt px-3 py-1.5 text-xs text-text-primary text-left focus:border-accent"
              >
                <span className="truncate">
                  {selectedProjectIds.length === 0
                    ? 'All Projects'
                    : selectedProjectIds.length === 1
                    ? filterOptions.projects.find((p) => p.id === selectedProjectIds[0])?.name ?? '1 Project'
                    : `${selectedProjectIds.length} Projects selected`}
                </span>
                <svg className="h-3 w-3 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {projectDropdownOpen && (
                <div className="absolute left-0 mt-1 w-72 rounded-xl border border-border bg-surface p-2 shadow-xl z-50 space-y-1.5 text-xs">
                  <input
                    type="text"
                    placeholder="Search project…"
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-alt px-2.5 py-1 text-xs focus:border-accent focus:outline-none"
                  />
                  <div className="flex items-center justify-between px-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setSelectedProjectIds([])}
                      className="text-accent font-semibold hover:underline"
                    >
                      Select all
                    </button>
                    {selectedProjectIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedProjectIds([])}
                        className="text-text-muted hover:underline"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-0.5 divide-y divide-border/30">
                    {filterOptions.projects
                      .filter((p) => p.name.toLowerCase().includes(projectSearch.toLowerCase()))
                      .map((p) => {
                        const checked = selectedProjectIds.includes(p.id);
                        return (
                          <label
                            key={p.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-alt cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setSelectedProjectIds((prev) =>
                                  checked ? prev.filter((id) => id !== p.id) : [...prev, p.id]
                                );
                              }}
                              className="rounded border-border text-accent focus:ring-accent"
                            />
                            <span className="flex-1 truncate text-xs text-text-primary font-medium">{p.name}</span>
                            <span className="text-[10px] text-text-muted">({p.count})</span>
                          </label>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>

            {/* Agency Multi-Select Dropdown */}
            <div className="lg:col-span-3 relative" data-dropdown>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">
                Agency ({selectedAgencyIds.length === 0 ? 'All' : `${selectedAgencyIds.length} selected`})
              </label>
              <button
                type="button"
                onClick={() => {
                  setAgencyDropdownOpen((prev) => !prev);
                  setProjectDropdownOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-surface-alt px-3 py-1.5 text-xs text-text-primary text-left focus:border-accent"
              >
                <span className="truncate">
                  {selectedAgencyIds.length === 0
                    ? 'All Agencies'
                    : selectedAgencyIds.length === 1
                    ? filterOptions.agencies.find((a) => a.id === selectedAgencyIds[0])?.name ?? '1 Agency'
                    : `${selectedAgencyIds.length} Agencies selected`}
                </span>
                <svg className="h-3 w-3 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {agencyDropdownOpen && (
                <div className="absolute left-0 mt-1 w-72 rounded-xl border border-border bg-surface p-2 shadow-xl z-50 space-y-1.5 text-xs">
                  <input
                    type="text"
                    placeholder="Search agency…"
                    value={agencySearch}
                    onChange={(e) => setAgencySearch(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-alt px-2.5 py-1 text-xs focus:border-accent focus:outline-none"
                  />
                  <div className="flex items-center justify-between px-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setSelectedAgencyIds([])}
                      className="text-accent font-semibold hover:underline"
                    >
                      Select all
                    </button>
                    {selectedAgencyIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedAgencyIds([])}
                        className="text-text-muted hover:underline"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-0.5 divide-y divide-border/30">
                    {filterOptions.agencies
                      .filter((a) => a.name.toLowerCase().includes(agencySearch.toLowerCase()))
                      .map((a) => {
                        const checked = selectedAgencyIds.includes(a.id);
                        return (
                          <label
                            key={a.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-alt cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setSelectedAgencyIds((prev) =>
                                  checked ? prev.filter((id) => id !== a.id) : [...prev, a.id]
                                );
                              }}
                              className="rounded border-border text-accent focus:ring-accent"
                            />
                            <span className="flex-1 truncate text-xs text-text-primary font-medium">{a.name}</span>
                            <span className="text-[10px] text-text-muted">({a.count})</span>
                          </label>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>

            {/* Age Filter */}
            <div className="lg:col-span-2">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">
                Pending since
              </label>
              <div className="flex items-center gap-1">
                {(['all', '7', '14', '30'] as const).map((age) => (
                  <button
                    key={age}
                    type="button"
                    onClick={() => setAgeFilter(age)}
                    className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                      ageFilter === age
                        ? 'bg-text-primary text-surface'
                        : 'bg-surface-alt text-text-secondary hover:bg-border'
                    }`}
                  >
                    {age === 'all' ? 'All' : `>${age}d`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Action Row: Send Reminders (WhatsApp / Email) + Selection Stats */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-text-primary">
                {selectedItemIds.size > 0 ? (
                  <span className="text-accent">{selectedItemIds.size} items selected</span>
                ) : (
                  <span className="text-text-muted">0 items selected</span>
                )}
              </span>

              {selectedItemIds.size > 0 && (
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="text-xs text-text-muted hover:text-text-primary hover:underline ml-1"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Individual Reminder Action Buttons (Requirement 15) */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={selectedItemIds.size === 0}
                onClick={() => handleOpenReminderDrawer('whatsapp')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 shadow-xs hover:bg-emerald-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={selectedItemIds.size === 0 ? 'Select items to send reminder' : 'Send WhatsApp reminder for selected items'}
              >
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.007c.101.005.232-.038.361.275.144.346.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.087-.179.182-.077.357.101.173.449.742.965 1.201.664.591 1.224.774 1.397.86.173.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.144.39-.086s1.011.477 1.184.564.289.13.332.202c.043.073.043.419-.101.824z" />
                </svg>
                Send WhatsApp {selectedItemIds.size > 0 ? `(${selectedItemIds.size})` : ''}
              </button>

              <button
                type="button"
                disabled={selectedItemIds.size === 0}
                onClick={() => handleOpenReminderDrawer('email')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-bold text-accent shadow-xs hover:bg-accent/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={selectedItemIds.size === 0 ? 'Select items to send reminder' : 'Send Email reminder for selected items'}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Send Email {selectedItemIds.size > 0 ? `(${selectedItemIds.size})` : ''}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ───────────────────────── MAIN TABLE (ROW 3 COLUMNS) ───────────────────────── */}
      <div className="mx-auto max-w-7xl px-4 pt-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <p className="mt-3 text-xs text-text-secondary">Loading pending dependencies…</p>
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface p-12 text-center">
            <svg className="mx-auto h-8 w-8 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
            </svg>
            <h3 className="mt-2 text-sm font-bold text-text-primary">No pending dependencies found</h3>
            <p className="mt-1 text-xs text-text-secondary">
              {items.length === 0
                ? 'All clear! No items are currently marked as pending across your projects.'
                : 'No items match your active filter criteria.'}
            </p>
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSelectedProjectIds([]);
                  setSelectedAgencyIds([]);
                  setAgeFilter('all');
                  setSearchQuery('');
                }}
                className="mt-3 inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-alt"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-surface-alt border-b border-border text-[11px] font-bold text-text-secondary uppercase tracking-wider">
                    {/* 1. Checkbox */}
                    <th className="p-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someVisibleSelected;
                        }}
                        onChange={handleToggleAllVisible}
                        className="rounded border-border text-accent focus:ring-accent"
                        aria-label="Select all visible items"
                      />
                    </th>

                    {/* 2. Project Name */}
                    <th
                      className="p-3 cursor-pointer hover:text-text-primary whitespace-nowrap min-w-[140px]"
                      onClick={() => handleSort('project')}
                    >
                      <div className="flex items-center gap-1">
                        <span>Project name</span>
                        {sortColumn === 'project' && <span>{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                      </div>
                    </th>

                    {/* 3. Room */}
                    <th
                      className="p-3 cursor-pointer hover:text-text-primary whitespace-nowrap min-w-[120px]"
                      onClick={() => handleSort('room')}
                    >
                      <div className="flex items-center gap-1">
                        <span>Room</span>
                        {sortColumn === 'room' && <span>{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                      </div>
                    </th>

                    {/* 4. Product */}
                    <th
                      className="p-3 cursor-pointer hover:text-text-primary whitespace-nowrap min-w-[150px]"
                      onClick={() => handleSort('product')}
                    >
                      <div className="flex items-center gap-1">
                        <span>Product</span>
                        {sortColumn === 'product' && <span>{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                      </div>
                    </th>

                    {/* 5. Location */}
                    <th className="p-3 whitespace-nowrap min-w-[100px]">Location</th>

                    {/* 6. What Pending */}
                    <th className="p-3 whitespace-nowrap min-w-[200px]">What pending</th>

                    {/* 7. Agency */}
                    <th
                      className="p-3 cursor-pointer hover:text-text-primary whitespace-nowrap min-w-[150px]"
                      onClick={() => handleSort('agency')}
                    >
                      <div className="flex items-center gap-1">
                        <span>Agency</span>
                        {sortColumn === 'agency' && <span>{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                      </div>
                    </th>

                    {/* 8. Pending Since */}
                    <th
                      className="p-3 cursor-pointer hover:text-text-primary whitespace-nowrap min-w-[110px]"
                      onClick={() => handleSort('date')}
                    >
                      <div className="flex items-center gap-1">
                        <span>Pending since</span>
                        {sortColumn === 'date' && <span>{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                      </div>
                    </th>

                    {/* 9. Action Plan */}
                    <th className="p-3 whitespace-nowrap min-w-[220px]">Action plan</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-border/60">
                  {sortedItems.map((item) => {
                    const isSelected = selectedItemIds.has(item.id);
                    const daysOpen = getDaysOpen(item.first_raised_on);
                    const agencyText = formatAgencyLabel(item);
                    const roomName = item.rooms?.name ?? 'Room';
                    const floorLabel = item.rooms?.floors?.label ?? 'Floor';
                    const prodTitle = item.room_products?.product_catalogue?.title ?? item.project_dependencies?.text ?? '—';
                    const location = item.room_products?.location ?? '—';
                    const whatPending = item.product_steps?.label ?? item.project_dependencies?.text ?? 'Pending step';

                    return (
                      <tr
                        key={item.id}
                        className={`transition-colors ${
                          isSelected ? 'bg-accent/5' : 'hover:bg-surface-alt/40'
                        }`}
                      >
                        {/* 1. Checkbox */}
                        <td className="p-3 text-center align-top pt-3.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleItem(item.id)}
                            className="rounded border-border text-accent focus:ring-accent"
                            aria-label={`Select item in ${roomName}`}
                          />
                        </td>

                        {/* 2. Project Name */}
                        <td className="p-3 align-top pt-3.5 font-bold text-text-primary">
                          <div className="font-extrabold text-[13px]">{item.projects?.name ?? '—'}</div>
                          {item.projects?.client_name && (
                            <div className="text-[11px] text-text-muted font-normal">{item.projects.client_name}</div>
                          )}
                        </td>

                        {/* 3. Room */}
                        <td className="p-3 align-top pt-3.5">
                          <div className="font-semibold text-text-primary">{roomName}</div>
                          <div className="text-[11px] text-text-muted">{floorLabel}</div>
                        </td>

                        {/* 4. Product */}
                        <td className="p-3 align-top pt-3.5">
                          <div className="font-semibold text-text-primary">{prodTitle}</div>
                          {(item.room_products?.make || item.room_products?.model) && (
                            <div className="text-[11px] text-text-muted">
                              {[item.room_products.make, item.room_products.model].filter(Boolean).join(' / ')}
                            </div>
                          )}
                        </td>

                        {/* 5. Location */}
                        <td className="p-3 align-top pt-3.5 text-text-secondary font-medium">
                          {location}
                        </td>

                        {/* 6. What Pending */}
                        <td className="p-3 align-top pt-3.5">
                          <div className="flex items-center gap-1.5">
                            {item.product_steps?.sheet_colour && (
                              <span
                                className="inline-block w-2.5 h-2.5 rounded-full border border-black/10 flex-shrink-0"
                                style={{ backgroundColor: `#${item.product_steps.sheet_colour}` }}
                                title={`Colour: #${item.product_steps.sheet_colour}`}
                              />
                            )}
                            <span className="font-semibold text-text-primary leading-snug">{whatPending}</span>
                          </div>

                          {/* Quick Done / N.A. buttons & Note / Photo */}
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenStatusSheet(item, 'complete')}
                              className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-text-primary hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300"
                            >
                              Done
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenStatusSheet(item, 'na')}
                              className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary hover:bg-surface-alt"
                            >
                              N.A.
                            </button>

                            {item.note && (
                              <span className="inline-flex items-center gap-0.5 text-[11px] text-text-muted italic">
                                &quot;{item.note}&quot;
                              </span>
                            )}
                            {item.photo_path && (
                              <button
                                type="button"
                                onClick={() => handleViewPhoto(item.photo_path!)}
                                className="text-[11px] text-accent hover:underline font-semibold"
                              >
                                Photo
                              </button>
                            )}
                          </div>
                        </td>

                        {/* 7. Agency */}
                        <td className="p-3 align-top pt-3.5">
                          <span className="inline-block rounded-md bg-surface-alt px-2 py-0.5 text-xs font-semibold text-text-primary border border-border/60">
                            {agencyText}
                          </span>
                        </td>

                        {/* 8. Pending Since */}
                        <td className="p-3 align-top pt-3.5 whitespace-nowrap">
                          <div className="text-xs text-text-primary font-medium">
                            {formatPendingDate(item.first_raised_on)}
                          </div>
                          <div className={`text-[11px] ${daysOpen >= 14 ? 'text-danger font-bold' : 'text-text-muted'}`}>
                            {daysOpen}d open ({item.reminder_count} rem)
                          </div>
                        </td>

                        {/* 9. Action Plan (Inline Editable, Requirement 14) */}
                        <td className="p-3 align-top pt-3">
                          <ActionPlanCell
                            itemId={item.id}
                            initialValue={item.action_plan}
                            currentUserId={profile?.id ?? null}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ───────────────────────── DRAWER: DRAFT REMINDER PREVIEW (Requirement 15) ───────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity" onClick={() => setDrawerOpen(false)} />

          <div className="relative z-50 flex h-full w-full max-w-lg flex-col border-l border-border bg-surface shadow-2xl">
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-sm font-bold text-text-primary">
                  Draft Reminders ({selectedItemIds.size} {selectedItemIds.size === 1 ? 'item' : 'items'})
                </h3>
                <p className="text-xs text-text-secondary mt-0.5">
                  Sending via {drawerChannel === 'whatsapp' ? 'WhatsApp' : 'Email'} to responsible contractors
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-1.5 text-text-muted hover:bg-surface-alt hover:text-text-primary"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Drawer Body: Draft messages list */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {loadingDrafts ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  <p className="mt-2 text-xs text-text-secondary">Generating drafts with selected items…</p>
                </div>
              ) : drawerDrafts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-text-muted">
                  No reminder messages generated for selected items. (Contractors might be unassigned or already up to date).
                </div>
              ) : (
                drawerDrafts.map((draft, idx) => (
                  <div key={idx} className="rounded-xl border border-border bg-surface-alt/50 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-bold text-text-primary">{draft.agencyName}</span>
                        <span className="text-[11px] text-text-muted ml-2">({draft.projectName})</span>
                      </div>
                      <span className="text-[11px] font-semibold text-accent">
                        {drawerChannel === 'whatsapp' ? draft.phone || 'No phone' : draft.email || 'No email'}
                      </span>
                    </div>

                    {drawerChannel === 'email' && (
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-0.5">
                          Subject
                        </label>
                        <input
                          type="text"
                          value={draft.subject}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDrawerDrafts((prev) =>
                              prev.map((d, i) => (i === idx ? { ...d, subject: val } : d))
                            );
                          }}
                          className="w-full rounded-lg border border-border bg-surface px-2.5 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-0.5">
                        Message Content (editable)
                      </label>
                      <textarea
                        rows={7}
                        value={draft.text}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDrawerDrafts((prev) =>
                            prev.map((d, i) => (i === idx ? { ...d, text: val } : d))
                          );
                        }}
                        className="w-full font-mono rounded-lg border border-border bg-surface p-2.5 text-xs text-text-primary leading-relaxed focus:border-accent focus:outline-none"
                      />
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Drawer Footer Actions */}
            <div className="border-t border-border px-5 py-4 flex items-center justify-between bg-surface">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-alt"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={sendingRound || loadingDrafts || drawerDrafts.length === 0}
                onClick={handleSendDrafts}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {sendingRound ? (
                  <>
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Opening…
                  </>
                ) : (
                  <>
                    {drawerChannel === 'whatsapp' ? 'Open in WhatsApp' : 'Send via Gmail'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────── MODAL: DISPATCH CONFIRMATION ───────────────────────── */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl space-y-4">
            <div className="border-b border-border/60 pb-3">
              <h3 className="text-sm font-bold text-text-primary">Confirm Sent Reminders</h3>
              <p className="text-xs text-text-secondary mt-0.5">
                We generated links for WhatsApp / Gmail. Click to open any additional tabs, then confirm when sent:
              </p>
            </div>

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
                    Open link ↗
                  </a>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-alt"
              >
                Dismiss
              </button>
              <button
                type="button"
                disabled={confirming}
                onClick={() => handleConfirmDispatches(confirmDialog.dispatchIds)}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {confirming ? 'Saving…' : "I Have Sent It"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────── MODAL: STATUS SHEET (DONE / N.A.) ───────────────────────── */}
      {statusTargetItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setStatusTargetItem(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-border/60 pb-3">
              <h3 className="text-sm font-bold text-text-primary">Update Dependency Status</h3>
              <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">
                {statusTargetItem.item.project_dependencies?.text ?? 'Pending step'}
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">
                  Status
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setStatusTargetItem((prev) => (prev ? { ...prev, targetStatus: 'complete' } : null))
                    }
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                      statusTargetItem.targetStatus === 'complete'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                        : 'border-border text-text-secondary hover:bg-surface-alt'
                    }`}
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setStatusTargetItem((prev) => (prev ? { ...prev, targetStatus: 'na' } : null))
                    }
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                      statusTargetItem.targetStatus === 'na'
                        ? 'border-border bg-text-primary text-surface'
                        : 'border-border text-text-secondary hover:bg-surface-alt'
                    }`}
                  >
                    N.A.
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={statusDate}
                  onChange={(e) => setStatusDate(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">
                  Note (optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Verified on site with contractor…"
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">
                  Photo Evidence (optional)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoSelect}
                  className="w-full text-xs text-text-secondary file:mr-2 file:rounded-md file:border-0 file:bg-surface-alt file:px-3 file:py-1 file:text-xs file:font-semibold file:text-text-primary hover:file:bg-border"
                />

                {photoPreview && (
                  <div className="mt-2 relative w-20 h-20 rounded-lg overflow-hidden border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
                <button
                  type="button"
                  onClick={() => setStatusTargetItem(null)}
                  className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-alt"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingStatus}
                  onClick={handleSaveStatus}
                  className="rounded-lg bg-accent px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-accent-hover transition-colors disabled:opacity-50"
                >
                  {savingStatus ? 'Saving…' : 'Save Status'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────── MODAL: PHOTO LIGHTBOX ───────────────────────── */}
      {viewingPhotoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setViewingPhotoUrl(null)}
        >
          <div className="relative max-w-2xl max-h-[90vh] overflow-hidden rounded-xl bg-black">
            <button
              type="button"
              onClick={() => setViewingPhotoUrl(null)}
              className="absolute top-2 right-2 rounded-full bg-black/60 px-2.5 py-1 text-xs font-bold text-white hover:bg-black/90"
            >
              Close
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={viewingPhotoUrl} alt="Evidence" className="max-h-[85vh] w-auto object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Inline-Editable Action Plan Cell with Debounce 800ms (Requirement 14)
// ─────────────────────────────────────────────────────────────────
function ActionPlanCell({
  itemId,
  initialValue,
  currentUserId,
}: {
  itemId: string;
  initialValue: string | null;
  currentUserId: string | null;
}) {
  const [value, setValue] = useState(initialValue ?? '');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync if initialValue changes externally
  useEffect(() => {
    setValue(initialValue ?? '');
  }, [initialValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setValue(newVal);
    setSaved(false);

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      try {
        setSaving(true);
        const sb = supabaseBrowser();
        const { error } = await sb
          .from('dependency_items')
          .update({
            action_plan: newVal.trim() || null,
            action_plan_updated_at: new Date().toISOString(),
            action_plan_updated_by: currentUserId,
          })
          .eq('id', itemId);

        if (error) throw error;
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      } catch (err) {
        console.error('Failed to save action plan:', err);
      } finally {
        setSaving(false);
      }
    }, 800);
  };

  return (
    <div className="relative flex items-center">
      <input
        type="text"
        placeholder="Add action plan…"
        value={value}
        onChange={handleChange}
        maxLength={1000}
        className="w-full rounded border border-transparent bg-surface-alt/70 px-2 py-1 text-xs text-text-primary placeholder:text-text-muted hover:border-border focus:border-accent focus:bg-surface focus:outline-none transition-colors pr-6"
      />
      {saving ? (
        <span className="absolute right-2 h-2.5 w-2.5 animate-spin rounded-full border border-accent border-t-transparent" />
      ) : saved ? (
        <span
          className="absolute right-2 text-emerald-600 font-bold text-[11px]"
          title="Saved to database"
        >
          ✓
        </span>
      ) : null}
    </div>
  );
}
