import { useState, type ChangeEvent, type FormEvent } from 'react';
import { ApiError } from '../lib/api';
import { useSites, type SiteFormInput, type TestResult } from '../store/sites';
import type { SitePublic } from '../types';
import { Modal } from './Modal';
import { OnboardForm } from './OnboardForm';
import { SshSetupWizard } from './SshSetupWizard';

const EMPTY: SiteFormInput = {
  name: '',
  kind: 'pve',
  baseUrl: '',
  tokenId: '',
  tokenSecret: '',
  tlsVerify: false,
  sshHost: '',
  sshUser: '',
  sshPort: '',
  sshKey: '',
};

function fromSite(s: SitePublic): SiteFormInput {
  return {
    name: s.name,
    kind: s.kind,
    baseUrl: s.baseUrl,
    tokenId: s.tokenId,
    tokenSecret: '',
    tlsVerify: s.tlsVerify,
    sshHost: s.sshHost ?? '',
    sshUser: s.sshUser ?? '',
    sshPort: s.sshPort != null ? String(s.sshPort) : '',
    sshKey: '',
  };
}

interface Props {
  site: SitePublic | null; // null = add
  onClose: () => void;
}

export function SiteFormModal({ site, onClose }: Props) {
  const { test, create, update, load } = useSites();
  const editingId = site?.id ?? null;

  const [form, setForm] = useState<SiteFormInput>(site ? fromSite(site) : EMPTY);
  const [result, setResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'guided' | 'manual'>('guided');

  const upd =
    (k: keyof SiteFormInput) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const t = e.target;
      const value = t instanceof HTMLInputElement && t.type === 'checkbox' ? t.checked : t.value;
      setForm((f) => ({ ...f, [k]: value }));
      setResult(null);
    };

  const doTest = async () => {
    setBusy('test');
    setError(null);
    try {
      setResult(await test(form));
    } catch {
      setError('Could not run the test.');
    } finally {
      setBusy(null);
    }
  };

  const doSave = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    setError(null);
    try {
      if (editingId) await update(editingId, form);
      else await create(form);
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? 'Please complete all fields with a valid URL.'
          : 'Could not save the site.',
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title={editingId ? `Edit ${site?.name}` : 'Add a site'} onClose={onClose} wide>
      {!editingId && (
        <div className="mode-toggle">
          <button
            type="button"
            className={mode === 'guided' ? 'active' : ''}
            onClick={() => setMode('guided')}
          >
            Guided (SSH)
          </button>
          <button
            type="button"
            className={mode === 'manual' ? 'active' : ''}
            onClick={() => setMode('manual')}
          >
            Manual
          </button>
        </div>
      )}
      {!editingId && mode === 'guided' ? (
        <OnboardForm onClose={onClose} />
      ) : (
        <form className="form" onSubmit={doSave}>
        <label className="field">
          <span>Name</span>
          <input value={form.name} onChange={upd('name')} placeholder="Home Rack" required />
        </label>
        <label className="field">
          <span>Type</span>
          <select value={form.kind} onChange={upd('kind')} disabled={editingId !== null}>
            <option value="pve">Proxmox VE</option>
            <option value="pbs">Proxmox Backup Server</option>
          </select>
        </label>
        <label className="field">
          <span>Base URL</span>
          <input
            value={form.baseUrl}
            onChange={upd('baseUrl')}
            placeholder={form.kind === 'pbs' ? 'https://192.168.1.10:8007' : 'https://192.168.1.10:8006'}
            required
          />
        </label>
        <label className="field">
          <span>API token ID</span>
          <input value={form.tokenId} onChange={upd('tokenId')} placeholder="monitor@pve!dashboard" autoComplete="off" required />
        </label>
        <label className="field">
          <span>API token secret{editingId ? ' (blank = keep current)' : ''}</span>
          <input
            type="password"
            value={form.tokenSecret}
            onChange={upd('tokenSecret')}
            placeholder={editingId ? '•••••• unchanged' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
            autoComplete="off"
            required={editingId === null}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={form.tlsVerify} onChange={upd('tlsVerify')} />
          <span>Verify TLS certificate (leave off for self-signed)</span>
        </label>

        <details className="ssh-section" open={!!form.sshHost || editingId !== null}>
          <summary>Temperatures via SSH (optional)</summary>
          <p className="ssh-hint">
            Reads <code>sensors -j</code> from the {form.kind === 'pbs' ? 'backup server' : 'node'}.
            Requires <code>lm-sensors</code> and a read-only SSH key.
          </p>
          {editingId !== null && (
            <SshSetupWizard
              siteId={editingId}
              defaultHost={form.sshHost ?? ''}
              defaultPort={form.sshPort ?? ''}
              hasSshKey={site?.hasSshKey}
              onDone={() => {
                void load();
                onClose();
              }}
            />
          )}
            <div className="ssh-grid">
              <label className="field">
                <span>SSH host</span>
                <input value={form.sshHost ?? ''} onChange={upd('sshHost')} placeholder="192.168.1.10" autoComplete="off" />
              </label>
              <label className="field">
                <span>Port</span>
                <input value={form.sshPort ?? ''} onChange={upd('sshPort')} placeholder="22" autoComplete="off" />
              </label>
            </div>
            <label className="field">
              <span>SSH user</span>
              <input value={form.sshUser ?? ''} onChange={upd('sshUser')} placeholder="root" autoComplete="off" />
            </label>
            <label className="field">
              <span>Private key (PEM){editingId ? ' (blank = keep current)' : ''}</span>
              <textarea
                value={form.sshKey ?? ''}
                onChange={upd('sshKey')}
                placeholder={
                  editingId && site?.hasSshKey
                    ? '•••••• key unchanged'
                    : '-----BEGIN OPENSSH PRIVATE KEY-----'
                }
                rows={3}
                autoComplete="off"
              />
            </label>
          </details>

        {result && (
          <div className={`test-result ${result.ok ? 'ok' : 'bad'}`}>
            {result.ok ? '✓ ' : '✕ '}
            {result.message}
          </div>
        )}
        {error && <div className="form-error">{error}</div>}

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={doTest} disabled={busy !== null}>
            {busy === 'test' ? 'Testing…' : 'Test connection'}
          </button>
          <button type="submit" className="btn" disabled={busy !== null}>
            {busy === 'save' ? 'Saving…' : editingId ? 'Save changes' : 'Save site'}
          </button>
        </div>
        </form>
      )}
    </Modal>
  );
}
