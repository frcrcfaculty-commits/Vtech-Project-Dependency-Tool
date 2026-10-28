/**
 * Escalation threshold helper for UI components.
 * Matches backend rules and /api/dashboard:
 * Level 1: reminder_count <= l2_after (First contact / routine reminders)
 * Level 2: reminder_count > l2_after (L2 Escalation)
 * Level 3: reminder_count > l3_after (L3 Escalation)
 */

export function getEscalationLevel(
  reminderCount: number,
  l2After = 3,
  l3After = 6
): 1 | 2 | 3 {
  if (reminderCount > l3After) return 3;
  if (reminderCount > l2After) return 2;
  return 1;
}

export function isEscalated(reminderCount: number, l2After = 3): boolean {
  return reminderCount > l2After;
}

export function formatEscalationLabel(
  reminderCount: number,
  l2After = 3,
  l3After = 6
): string {
  const level = getEscalationLevel(reminderCount, l2After, l3After);
  if (level === 3) return 'L3 Escalation';
  if (level === 2) return 'L2 Escalation';
  return 'L1 · First notice';
}
