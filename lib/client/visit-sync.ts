'use client';

import { supabaseBrowser } from './supabase';

export interface VisitCheckPayload {
  project_id: string;
  visit_id: string;
  item_id: string;
  status: 'pending' | 'complete' | 'na';
  status_date: string;
  note: string | null;
  photo_path: string | null;
}

const STORAGE_PREFIX = 'vtech_offline_checks_';

export function getOfflineQueue(visitId: string): VisitCheckPayload[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${visitId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveOfflineQueue(visitId: string, queue: VisitCheckPayload[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${visitId}`, JSON.stringify(queue));
  } catch {
    // Ignore storage quota errors
  }
}

export function enqueueCheck(check: VisitCheckPayload) {
  const queue = getOfflineQueue(check.visit_id);
  // Replace if same item_id already in queue
  const idx = queue.findIndex((c) => c.item_id === check.item_id);
  if (idx >= 0) {
    queue[idx] = check;
  } else {
    queue.push(check);
  }
  saveOfflineQueue(check.visit_id, queue);
}

export function removeCheckFromQueue(visitId: string, itemId: string) {
  const queue = getOfflineQueue(visitId).filter((c) => c.item_id !== itemId);
  saveOfflineQueue(visitId, queue);
}

/**
 * Saves a check immediately to Supabase; falls back to localStorage on network error.
 * Returns true if saved live to database, false if queued offline.
 */
export async function saveVisitCheck(check: VisitCheckPayload): Promise<boolean> {
  const sb = supabaseBrowser();
  try {
    const { error } = await sb.from('visit_checks').upsert(
      {
        project_id: check.project_id,
        visit_id: check.visit_id,
        item_id: check.item_id,
        status: check.status,
        status_date: check.status_date,
        note: check.note,
        photo_path: check.photo_path,
      },
      { onConflict: 'visit_id,item_id' }
    );

    if (error) {
      throw error;
    }

    // Success live, ensure it's cleared from offline queue if it was there
    removeCheckFromQueue(check.visit_id, check.item_id);
    return true;
  } catch {
    // Network failure or offline
    enqueueCheck(check);
    return false;
  }
}

/**
 * Flushes the offline queue for this visit to Supabase.
 */
export async function syncOfflineQueue(
  visitId: string,
  onProgress?: (remaining: number) => void
): Promise<{ synced: number; failed: number }> {
  const queue = getOfflineQueue(visitId);
  if (queue.length === 0) return { synced: 0, failed: 0 };

  const sb = supabaseBrowser();
  let synced = 0;
  const remaining: VisitCheckPayload[] = [];

  for (const check of queue) {
    try {
      const { error } = await sb.from('visit_checks').upsert(
        {
          project_id: check.project_id,
          visit_id: check.visit_id,
          item_id: check.item_id,
          status: check.status,
          status_date: check.status_date,
          note: check.note,
          photo_path: check.photo_path,
        },
        { onConflict: 'visit_id,item_id' }
      );
      if (error) {
        remaining.push(check);
      } else {
        synced++;
      }
    } catch {
      remaining.push(check);
    }
    if (onProgress) onProgress(remaining.length);
  }

  saveOfflineQueue(visitId, remaining);
  return { synced, failed: remaining.length };
}
