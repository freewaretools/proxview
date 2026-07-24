import { useState } from 'react';
import { api } from '../lib/api';

interface Step {
  name: string;
  ok: boolean;
  detail: string;
}

interface Props {
  siteId: number;
  defaultHost: string;
  defaultPort: string;
  hasSshKey?: boolean;
  onDone: () => void;
}

export function SshSetupWizard({ siteId, defaultHost, defaultPort, hasSshKey, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState(defaultHost);
  const [user, setUser] = useState('root');
  const [port, setPort] = useState(defaultPort || '22');
  const [password, setPassword] = useState('');
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setSteps(null);
    try {
      const r = await api.post<{ ok: boolean; steps: Step[] }>(
        `/api/sites/${siteId}/provision-temps`,
        { host, port: port ? Number(port) : 22, user, password },
      );
      setSteps(r.steps);
      setPassword('');
      if (r.ok) onDone();
    } catch {
      setError('The setup could not run.');
    } finally {
      setRunning(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost btn-sm wizard-open" onClick={() => setOpen(true)}>
        {hasSshKey ? '🔁 Reprovision SSH access' : '⚡ Auto-setup temperatures over SSH'}
      </button>
    );
  }

  return (
    <div className="ssh-wizard">
      <div className="pbs-subhead">{hasSshKey ? 'Reprovision SSH access' : 'Guided temperature setup'}</div>
      <p className="ssh-hint">
        {hasSshKey
          ? 'Safe to re-run any time — e.g. after swapping hardware or reinstalling the host. Generates a fresh SSH key, removes the old one, and reinstalls it + '
          : 'Generates an SSH key, installs it + '}
        <code>lm-sensors</code>
        {hasSshKey ? '.' : ', and verifies temperatures.'} The password is used once for this connection and
        never stored.
      </p>
      <div className="ssh-grid">
        <label className="field">
          <span>Host</span>
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.10" />
        </label>
        <label className="field">
          <span>Port</span>
          <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="22" />
        </label>
      </div>
      <label className="field">
        <span>SSH user (root recommended)</span>
        <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" />
      </label>
      <label className="field">
        <span>SSH password (one-time)</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="off"
        />
      </label>

      {steps && (
        <div className="wizard-steps">
          {steps.map((s, i) => (
            <div key={i} className="wizard-step">
              <span className={`dot ${s.ok ? 'ok' : 'crit'}`} />
              <span className="wizard-step-name">{s.name}</span>
              <span className="wizard-step-detail">{s.detail}</span>
            </div>
          ))}
        </div>
      )}
      {error && <div className="form-error">{error}</div>}

      <div className="form-actions">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setOpen(false);
            setSteps(null);
          }}
        >
          Close
        </button>
        <button
          type="button"
          className="btn"
          onClick={run}
          disabled={running || !host || !user || !password}
        >
          {running ? 'Running…' : 'Run setup'}
        </button>
      </div>
    </div>
  );
}
