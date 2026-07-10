import type { Alert } from '../types';

/**
 * Alerts are computed on the server (from the configurable rules) and streamed over
 * SSE, so the banner and notifications always agree. This just renders them.
 */
export function OverviewSummary({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null;

  const critical = alerts.some((a) => a.level === 'crit');
  return (
    <div className={`alert-banner ${critical ? 'crit' : 'warn'}`}>
      <span className="alert-banner-title">
        {critical ? '⛔' : '⚠️'} {alerts.length} alert{alerts.length === 1 ? '' : 's'}
      </span>
      <div className="alert-chips">
        {alerts.map((a) => (
          <span key={a.key} className={`alert-chip ${a.level}`}>
            <span className={`dot ${a.level === 'crit' ? 'crit' : 'warn'}`} />
            {a.title}
          </span>
        ))}
      </div>
    </div>
  );
}
