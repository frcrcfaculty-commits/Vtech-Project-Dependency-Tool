// v4 step display rules (Dashboard). Lock state always comes from the database view item_gate; this file only
// decides what to SHOW for a BOQ line, given its gate rows.

export type ItemStatus = 'unchecked' | 'pending' | 'complete' | 'na';

export interface GateRow {
  item_id: string;
  project_id: string;
  room_id: string;
  room_product_id: string;
  status: ItemStatus;
  agency_id: string | null;
  stuck_reason: string | null;
  note: string | null;
  first_raised_on: string | null;
  completed_on: string | null;
  reminder_count: number;
  step_id: string | null;
  seq: number;
  label: string;
  phase: number;
  responsibility: 'external' | 'internal' | 'client';
  sheet_colour: string;
  title: string;
  location: string | null;
  quantity: number;
  catalogue_title: string | null;
  waits_on_client: boolean;
  waiting_trigger: boolean;
  locked: boolean;
}

/** The sheet's colour legend (tab "Hansal", rows 36–40). */
export const STEP_COLOURS: Record<string, { bg: string; ring: string; text: string; legend: string }> = {
  D9EAD3: { bg: '#D9EAD3', ring: '#9CC98F', text: '#1F4D10', legend: 'Other agencies (before installation)' },
  C9DAF8: { bg: '#C9DAF8', ring: '#8FB0EE', text: '#123F99', legend: 'Other agencies (after installation)' },
  CFE2F3: { bg: '#CFE2F3', ring: '#93BEE3', text: '#123F99', legend: 'Other agencies (after installation)' },
  E06666: { bg: '#E06666', ring: '#C23B3B', text: '#FFFFFF', legend: 'Installers' },
  F4CCCC: { bg: '#F4CCCC', ring: '#E59A9A', text: '#7A0F0F', legend: 'Programmers' },
  F9CB9C: { bg: '#F9CB9C', ring: '#EFA35C', text: '#6B3500', legend: 'Project managers' },
};
export const LEGEND_ORDER = ['D9EAD3', 'E06666', 'F4CCCC', 'C9DAF8', 'F9CB9C'];

export function stepColour(hex?: string | null) {
  return STEP_COLOURS[(hex ?? '').toUpperCase()] ?? { bg: '#E5E7EB', ring: '#CBD5E1', text: '#334155', legend: 'Other' };
}

export const isDone = (s: ItemStatus) => s === 'complete' || s === 'na';

export interface LineStatus {
  /** Steps to show as checkboxes right now (all open greens, or the single current step). */
  visible: GateRow[];
  done: number;
  total: number;
  allDone: boolean;
  /** Waiting for a project trigger (iPhone programming at 50 % installation, Client Side at 80 % programming). */
  waitingTrigger: boolean;
  /** Current phase name for filters and summaries. */
  stage: 'before_installation' | 'after_installation' | 'done' | 'waiting';
}

/**
 * v4 rule (Hansal, item 12): show only the green steps until every green is done; then show ONE step at a time,
 * in sheet order, in the same space. Done steps are counted, not shown (unless "show all steps" is on).
 */
export function lineStatus(rows: GateRow[]): LineStatus {
  const sorted = [...rows].sort((a, b) => a.seq - b.seq);
  const done = sorted.filter((r) => isDone(r.status)).length;
  const total = sorted.length;
  if (total > 0 && done === total) return { visible: [], done, total, allDone: true, waitingTrigger: false, stage: 'done' };
  if (sorted.some((r) => r.waiting_trigger)) {
    return { visible: [], done, total, allDone: false, waitingTrigger: true, stage: 'waiting' };
  }
  const greens = sorted.filter((r) => r.phase === 1);
  if (greens.some((r) => !isDone(r.status))) {
    return { visible: greens, done, total, allDone: false, waitingTrigger: false, stage: 'before_installation' };
  }
  const current = sorted.find((r) => r.phase !== 1 && !isDone(r.status));
  return {
    visible: current ? [current] : [],
    done,
    total,
    allDone: !current && total > 0,
    waitingTrigger: false,
    stage: current ? 'after_installation' : 'done',
  };
}

export const triggerText = (title: string | null, pct: { installation: number; programming: number }) =>
  title === 'iPhone programming'
    ? `Starts when 50% of the BOQ is in installation (now ${pct.installation}%)`
    : `Starts when 80% of programming is done (now ${pct.programming}%)`;
