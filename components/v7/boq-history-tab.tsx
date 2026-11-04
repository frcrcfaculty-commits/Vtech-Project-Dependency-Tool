'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabaseBrowser } from '@/lib/client/supabase';
import { downloadCsv } from '@/lib/client/csv';
import { Glyph } from '@/components/glass-icon';

export interface BoqEventRow {
  id: string;
  project_id: string;
  room_product_id: string | null;
  change_id: string | null;
  event: 'added' | 'removed' | 'changed';
  product: string;
  floor: string | null;
  room: string | null;
  location: string | null;
  quantity: number | null;
  details: Record<string, { from: unknown; to: unknown }> | any;
  by_user: string | null;
  at: string;
  project_changes: {
    requested_by: string;
    requested_at: string;
    reason: string;
    reference_type: string | null;
    reference: string | null;
  } | null;
}

export function BoqHistoryTab({
  projectId,
  projectName,
  rooms,
  isSuperAdmin,
}: {
  projectId: string;
  projectName: string;
  rooms: { id: string; name: string }[];
  isSuperAdmin: boolean;
}) {
  const [events, setEvents] = useState<BoqEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [eventTypeFilter, setEventTypeFilter] = useState<'all' | 'added' | 'removed' | 'changed'>('all');
  const [roomFilter, setRoomFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  useEffect(() => {
    async function loadEvents() {
      try {
        setLoading(true);
        setError(null);
        const sb = supabaseBrowser();
        const { data, error: err } = await sb
          .from('boq_events')
          .select('*, project_changes(requested_by, requested_at, reason, reference_type, reference)')
          .eq('project_id', projectId)
          .order('at', { ascending: false });

        if (err) throw err;
        setEvents((data ?? []) as BoqEventRow[]);
      } catch (e: any) {
        setError(e?.message || 'Failed to load BOQ history');
      } finally {
        setLoading(false);
      }
    }
    loadEvents();
  }, [projectId]);

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (eventTypeFilter !== 'all' && e.event !== eventTypeFilter) return false;
      if (roomFilter !== 'all' && (e.room ?? '').trim().toLowerCase() !== roomFilter.trim().toLowerCase()) return false;
      if (startDate) {
        const evDate = new Date(e.at).toISOString().slice(0, 10);
        if (evDate < startDate) return false;
      }
      if (endDate) {
        const evDate = new Date(e.at).toISOString().slice(0, 10);
        if (evDate > endDate) return false;
      }
      return true;
    });
  }, [events, eventTypeFilter, roomFilter, startDate, endDate]);

  const formatChangeDetails = (details: Record<string, { from: unknown; to: unknown }> | null | undefined) => {
    if (!details || typeof details !== 'object' || Object.keys(details).length === 0) return '—';
    return Object.entries(details)
      .map(([k, v]) => {
        const fromStr = v?.from === null || v?.from === undefined || v?.from === '' ? 'none' : String(v.from);
        const toStr = v?.to === null || v?.to === undefined || v?.to === '' ? 'none' : String(v.to);
        return `${k}: ${fromStr} → ${toStr}`;
      })
      .join('; ');
  };

  const handleExportCsv = () => {
    const headers = [
      'Date & Time',
      'Event',
      'Product',
      'Floor',
      'Room',
      'Location',
      'Quantity',
      'Change Details',
      'Requested By',
      'Reason',
      'Reference Type',
      'Reference',
    ];

    const rows = filteredEvents.map((e) => {
      const dt = new Date(e.at).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      const reqBy = e.project_changes?.requested_by ?? (e.change_id ? '—' : 'Initial BOQ');
      const reason = e.project_changes?.reason ?? (e.change_id ? '—' : 'Initial BOQ');
      const refType = e.project_changes?.reference_type ?? '';
      const ref = e.project_changes?.reference ?? '';
      const chgDetails = formatChangeDetails(e.details);

      return [
        dt,
        e.event.toUpperCase(),
        e.product,
        e.floor ?? '—',
        e.room ?? '—',
        e.location ?? '—',
        e.quantity ?? 1,
        chgDetails,
        reqBy,
        reason,
        refType,
        ref,
      ];
    });

    const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadCsv(`${safeName}_BOQ_History_${dateStr}`, headers, rows);
  };

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-text-primary">BOQ History</h2>
          <p className="text-xs text-text-secondary">
            Audit log of all products added, removed, or changed in this project
          </p>
        </div>

        {isSuperAdmin && (
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredEvents.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text-primary hover:bg-surface-alt transition-colors disabled:opacity-50 shadow-xs"
          >
            <Glyph name="send" className="h-3.5 w-3.5" /> Export CSV ({filteredEvents.length})
          </button>
        )}
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-text-secondary">Event:</span>
          <select
            value={eventTypeFilter}
            onChange={(e) => setEventTypeFilter(e.target.value as any)}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text-primary focus:border-accent"
          >
            <option value="all">All events ({events.length})</option>
            <option value="added">Added</option>
            <option value="removed">Removed</option>
            <option value="changed">Changed</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-text-secondary">Room:</span>
          <select
            value={roomFilter}
            onChange={(e) => setRoomFilter(e.target.value)}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text-primary focus:border-accent max-w-[140px] truncate"
          >
            <option value="all">All rooms</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-text-secondary">From:</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-text-primary focus:border-accent"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-text-secondary">To:</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-text-primary focus:border-accent"
          />
        </div>

        {(eventTypeFilter !== 'all' || roomFilter !== 'all' || startDate || endDate) && (
          <button
            type="button"
            onClick={() => {
              setEventTypeFilter('all');
              setRoomFilter('all');
              setStartDate('');
              setEndDate('');
            }}
            className="ml-auto text-xs font-semibold text-accent hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-danger/20 bg-danger-light p-3 text-xs text-danger">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12 text-sm text-text-muted">Loading BOQ history…</div>
      ) : filteredEvents.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-text-muted">
          No BOQ history events found matching your filter criteria.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-xs">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="border-b border-border bg-surface-alt/80 text-[11px] font-bold uppercase tracking-wider text-text-secondary">
              <tr>
                <th className="px-3.5 py-2.5">Date &amp; time</th>
                <th className="px-3 py-2.5">Event</th>
                <th className="px-3 py-2.5">Product</th>
                <th className="px-3 py-2.5">Floor – Room</th>
                <th className="px-3 py-2.5">Location</th>
                <th className="px-2 py-2.5 text-center">Qty</th>
                <th className="px-3 py-2.5">Change details</th>
                <th className="px-3 py-2.5">Requested by</th>
                <th className="px-3 py-2.5">Reason</th>
                <th className="px-3 py-2.5">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-normal text-text-primary">
              {filteredEvents.map((e) => {
                const dt = new Date(e.at).toLocaleString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                  dateStyle: 'medium',
                  timeStyle: 'short',
                });
                const reqBy = e.project_changes?.requested_by ?? (e.change_id ? '—' : 'Initial BOQ');
                const reason = e.project_changes?.reason ?? (e.change_id ? '—' : 'Initial BOQ');
                const ref = e.project_changes?.reference
                  ? `${e.project_changes.reference_type ? `[${e.project_changes.reference_type}] ` : ''}${e.project_changes.reference}`
                  : '—';

                return (
                  <tr key={e.id} className="hover:bg-surface-alt/30 transition-colors">
                    <td className="px-3.5 py-2.5 whitespace-nowrap text-text-secondary font-medium">{dt}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {e.event === 'added' ? (
                        <span className="inline-block rounded-md bg-success-light px-2 py-0.5 text-[11px] font-bold uppercase text-success">
                          Added
                        </span>
                      ) : e.event === 'removed' ? (
                        <span className="inline-block rounded-md bg-danger-light px-2 py-0.5 text-[11px] font-bold uppercase text-danger">
                          Removed
                        </span>
                      ) : (
                        <span className="inline-block rounded-md bg-accent/15 px-2 py-0.5 text-[11px] font-bold uppercase text-accent">
                          Changed
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-text-primary">{e.product}</td>
                    <td className="px-3 py-2.5 text-text-secondary">
                      {[e.floor, e.room].filter(Boolean).join(' – ')}
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary">{e.location || '—'}</td>
                    <td className="px-2 py-2.5 text-center font-medium">{e.quantity ?? 1}</td>
                    <td className="px-3 py-2.5 text-xs text-text-muted max-w-[200px] truncate" title={formatChangeDetails(e.details)}>
                      {formatChangeDetails(e.details)}
                    </td>
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap">{reqBy}</td>
                    <td className="px-3 py-2.5 text-text-secondary max-w-[220px] truncate" title={reason}>
                      {reason}
                    </td>
                    <td className="px-3 py-2.5 text-text-muted max-w-[180px] truncate" title={ref}>
                      {ref}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
