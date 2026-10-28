// Escalation rules — the single source of truth. Pure functions, unit tested.

export type Level = 1 | 2 | 3;
export type Channel = 'email' | 'whatsapp';

export interface EscalationPolicy {
  l2After: number;       // reminders 1..l2After go to L1
  l3After: number;       // reminders l2After+1..l3After go to L2; beyond → L3
  mgmtCcLevel: number;   // CC management (super admins) on email when level >= this; 4 = never
}

export interface Contact {
  id: string;
  name: string;
  designation: string;
  level: Level;
  email: string | null;
  phone: string | null;
  active: boolean;
}

/** Level for the n-th reminder (n is 1-based: the reminder about to be sent). */
export function levelForReminder(n: number, p: EscalationPolicy, escalationEnabled = true): Level {
  if (!escalationEnabled) return 1;
  if (n > p.l3After) return 3;
  if (n > p.l2After) return 2;
  return 1;
}

function usable(c: Contact, channel: Channel): boolean {
  return c.active && (channel === 'email' ? !!c.email : !!c.phone);
}

/**
 * Who receives a dispatch at a target level.
 * To  = contacts at the highest level <= target that has a usable contact.
 * CC  = usable contacts at lower levels (the junior stays informed when it goes over their head).
 * If the target level has nobody, it falls back downward; effectiveLevel reports what was actually used.
 */
export function resolveRecipients(contacts: Contact[], target: Level, channel: Channel) {
  const ok = contacts.filter((c) => usable(c, channel));
  for (let lvl = target; lvl >= 1; lvl--) {
    const to = ok.filter((c) => c.level === lvl);
    if (to.length) {
      return { to, cc: ok.filter((c) => c.level < lvl), effectiveLevel: lvl as Level };
    }
  }
  return { to: [] as Contact[], cc: [] as Contact[], effectiveLevel: null };
}

export function shouldCcManagement(level: Level, p: EscalationPolicy): boolean {
  return p.mgmtCcLevel <= 3 && level >= p.mgmtCcLevel;
}
