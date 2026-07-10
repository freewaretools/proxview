import { dispatch } from '../notify/index.js';
import { getAlertConfig } from './alertConfig.js';
import { computeAlerts, type Alert } from './alerts.js';
import type { PbsSnapshot, SiteSnapshot } from './types.js';

const pending = new Map<string, number>(); // key -> consecutive-poll count
const notifiedAt = new Map<string, number>(); // key -> last notify timestamp (ms)
const meta = new Map<string, Alert>();

/**
 * Diff the current alert set against previous evaluations. Fire a notification once an
 * alert has persisted for `confirmPolls`, re-notify every `reminderMinutes` while it's
 * still active, and (optionally) send a "resolved" note when it clears. Returns the
 * current alerts so the caller can broadcast them to the UI.
 */
export function evaluateAlerts(sites: SiteSnapshot[], pbs: PbsSnapshot[]): Alert[] {
  const config = getAlertConfig();
  const current = computeAlerts(sites, pbs, config);
  const currentKeys = new Set(current.map((a) => a.key));
  for (const a of current) meta.set(a.key, a);

  const now = Date.now();
  const reminderMs = config.reminderMinutes * 60_000;

  for (const a of current) {
    const count = (pending.get(a.key) ?? 0) + 1;
    pending.set(a.key, count);
    const last = notifiedAt.get(a.key);
    if (last === undefined) {
      if (count >= config.confirmPolls) {
        notifiedAt.set(a.key, now);
        void dispatch({ title: a.title, body: a.body, level: a.level });
      }
    } else if (reminderMs > 0 && now - last >= reminderMs) {
      notifiedAt.set(a.key, now);
      void dispatch({ title: `Reminder: ${a.title}`, body: a.body, level: a.level });
    }
  }

  // Resolved: previously-notified alerts no longer present.
  for (const key of [...notifiedAt.keys()]) {
    if (!currentKeys.has(key)) {
      notifiedAt.delete(key);
      if (config.notifyOnResolve) {
        const m = meta.get(key);
        void dispatch({
          title: `Resolved: ${m?.title ?? key}`,
          body: m ? `${m.body} — now cleared.` : 'Condition cleared.',
          level: 'info',
        });
      }
    }
  }
  for (const key of [...pending.keys()]) if (!currentKeys.has(key)) pending.delete(key);

  return current;
}
