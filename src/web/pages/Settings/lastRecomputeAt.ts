import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime.js';

dayjs.extend(relativeTime);

const KEY = 'cc-usage:lastRecomputeAt';

export function getLastRecomputeAt(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setLastRecomputeAt(iso: string = new Date().toISOString()): void {
  try {
    localStorage.setItem(KEY, iso);
  } catch {
    // Ignore quota / private-mode errors — purely cosmetic field.
  }
}

export function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const d = dayjs(iso);
  if (!d.isValid()) return '—';
  return d.fromNow();
}
