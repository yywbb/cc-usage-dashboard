import type { MonitorAlert } from '../../shared/types.js';

/**
 * Fire a desktop notification. node-notifier is loaded lazily and any failure
 * is swallowed with a console warning — desktop notification is best-effort and
 * must never crash the scan loop.
 */
export async function notifyDesktop(alert: MonitorAlert): Promise<void> {
  try {
    const mod = await import('node-notifier');
    const notifier = (mod as { default?: unknown }).default ?? mod;
    (notifier as { notify: (opts: unknown) => void }).notify({
      title:   alert.title,
      message: alert.body,
      sound:   false,
      wait:    false,
      appID:   'CC Usage Dashboard',
    });
  } catch (err) {
    console.warn('[monitor] desktop notification failed:', (err as Error).message);
  }
}
