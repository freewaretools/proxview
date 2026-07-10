import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type AlertType =
  | 'site-unreachable'
  | 'no-quorum'
  | 'node-offline'
  | 'node-memory'
  | 'node-cpu'
  | 'node-temp'
  | 'node-power'
  | 'pbs-unreachable'
  | 'datastore-full'
  | 'backups-idle'
  | 'gc-failed'
  | 'verify-failed';

interface AlertRule {
  enabled: boolean;
  level: 'warn' | 'crit';
  threshold: number;
}

interface AlertConfig {
  rules: Record<AlertType, AlertRule>;
  notifyOnResolve: boolean;
  confirmPolls: number;
  reminderMinutes: number;
  metricsIntervalMs: number;
  tempsIntervalMs: number;
}

const PVE_RULES: AlertType[] = [
  'site-unreachable',
  'no-quorum',
  'node-offline',
  'node-memory',
  'node-cpu',
  'node-temp',
  'node-power',
];
const PBS_RULES: AlertType[] = [
  'pbs-unreachable',
  'datastore-full',
  'backups-idle',
  'gc-failed',
  'verify-failed',
];

// `unit` present ⇒ the rule takes a numeric threshold.
const META: Record<AlertType, { label: string; unit?: string }> = {
  'site-unreachable': { label: 'Proxmox site unreachable' },
  'no-quorum': { label: 'Cluster lost quorum' },
  'node-offline': { label: 'Node offline' },
  'node-memory': { label: 'Node memory usage over', unit: '%' },
  'node-cpu': { label: 'Node CPU usage over', unit: '%' },
  'node-temp': { label: 'Node CPU temperature over', unit: '°C' },
  'node-power': { label: 'Node power draw over', unit: 'W' },
  'pbs-unreachable': { label: 'PBS unreachable' },
  'datastore-full': { label: 'Datastore fullness over', unit: '%' },
  'backups-idle': { label: 'No backup in the last', unit: 'days' },
  'gc-failed': { label: 'Garbage collection failed' },
  'verify-failed': { label: 'Verification failed' },
};

export function AlertRulesPanel() {
  const [cfg, setCfg] = useState<AlertConfig | null>(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    void api.get<AlertConfig>('/api/alerts').then((c) => {
      setCfg(c);
      setSaved(JSON.stringify(c));
    });
  }, []);

  if (!cfg)
    return (
      <section className="panel">
        <h2>Alert rules</h2>
        <p className="muted">Loading…</p>
      </section>
    );

  const dirty = JSON.stringify(cfg) !== saved;
  const num = (v: string, fallback: number): number => (v === '' ? fallback : Number(v));

  const patchRule = (t: AlertType, patch: Partial<AlertRule>): void =>
    setCfg({ ...cfg, rules: { ...cfg.rules, [t]: { ...cfg.rules[t], ...patch } } });

  const save = async (): Promise<void> => {
    setBusy(true);
    setNote('');
    try {
      const next = await api.put<AlertConfig>('/api/alerts', cfg);
      setCfg(next);
      setSaved(JSON.stringify(next));
      setNote('Saved.');
      setTimeout(() => setNote(''), 1500);
    } catch {
      setNote('Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const ruleRow = (t: AlertType): React.ReactElement => {
    const r = cfg.rules[t];
    const m = META[t];
    return (
      <div className={`rule-row ${r.enabled ? '' : 'off'}`} key={t}>
        <label className="switch" title={r.enabled ? 'On' : 'Off'}>
          <input
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => patchRule(t, { enabled: e.target.checked })}
          />
          <span className="slider" />
        </label>
        <span className="rule-label">{m.label}</span>
        {m.unit && (
          <span className="rule-thresh">
            <input
              type="number"
              value={r.threshold}
              disabled={!r.enabled}
              onChange={(e) => patchRule(t, { threshold: num(e.target.value, r.threshold) })}
            />
            <span className="rule-unit">{m.unit}</span>
          </span>
        )}
        <select
          className="level-select"
          value={r.level}
          disabled={!r.enabled}
          onChange={(e) => patchRule(t, { level: e.target.value as 'warn' | 'crit' })}
        >
          <option value="warn">Warning</option>
          <option value="crit">Critical</option>
        </select>
      </div>
    );
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Alert rules</h2>
        {dirty && (
          <button className="btn btn-sm" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        )}
      </div>
      <p className="ssh-hint">
        Choose which conditions raise an alert, their thresholds and severity. These drive both the
        on-screen banner and notifications.
      </p>

      <div className="rule-group-title">Proxmox VE</div>
      <div className="rule-list">{PVE_RULES.map(ruleRow)}</div>

      <div className="rule-group-title">Proxmox Backup Server</div>
      <div className="rule-list">{PBS_RULES.map(ruleRow)}</div>

      <div className="rule-group-title">Delivery &amp; polling</div>
      <div className="delivery-grid">
        <label className="field">
          <span>Metrics poll interval (seconds)</span>
          <input
            type="number"
            min={5}
            value={Math.round(cfg.metricsIntervalMs / 1000)}
            onChange={(e) => setCfg({ ...cfg, metricsIntervalMs: num(e.target.value, 10) * 1000 })}
          />
        </label>
        <label className="field">
          <span>Temperature poll interval (seconds)</span>
          <input
            type="number"
            min={15}
            value={Math.round(cfg.tempsIntervalMs / 1000)}
            onChange={(e) => setCfg({ ...cfg, tempsIntervalMs: num(e.target.value, 45) * 1000 })}
          />
        </label>
        <label className="field">
          <span>Confirm for N polls before alerting</span>
          <input
            type="number"
            min={1}
            max={10}
            value={cfg.confirmPolls}
            onChange={(e) => setCfg({ ...cfg, confirmPolls: num(e.target.value, 2) })}
          />
        </label>
        <label className="field">
          <span>Re-notify while active (minutes, 0 = off)</span>
          <input
            type="number"
            min={0}
            value={cfg.reminderMinutes}
            onChange={(e) => setCfg({ ...cfg, reminderMinutes: num(e.target.value, 0) })}
          />
        </label>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={cfg.notifyOnResolve}
          onChange={(e) => setCfg({ ...cfg, notifyOnResolve: e.target.checked })}
        />
        <span>Send a notification when a condition clears</span>
      </label>

      <div className="form-actions">
        <button className="btn" onClick={() => void save()} disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        {note && <span className="saved-note">{note}</span>}
      </div>
    </section>
  );
}
