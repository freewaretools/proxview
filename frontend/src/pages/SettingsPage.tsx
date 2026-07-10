import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { AccountPanel } from '../components/AccountPanel';
import { AlertRulesPanel } from '../components/AlertRulesPanel';
import { ColumnSelect } from '../components/ColumnSelect';
import { ConnectivityPanel } from '../components/ConnectivityPanel';
import { NotificationsPanel } from '../components/NotificationsPanel';
import { SiteFormModal } from '../components/SiteFormModal';
import { useLive } from '../store/live';
import { useSites } from '../store/sites';
import type { SitePublic } from '../types';

export default function SettingsPage() {
  const { sites, loaded, load, remove, importConfig } = useSites();
  const demo = useLive((s) => s.demo);

  const [modal, setModal] = useState<{ open: boolean; site: SitePublic | null }>({
    open: false,
    site: null,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replaceOnImport, setReplaceOnImport] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setNotice(null);
    try {
      const parsed = JSON.parse(await file.text()) as { sites?: unknown[] };
      if (!Array.isArray(parsed.sites)) throw new Error('bad file');
      if (replaceOnImport && !confirm('Replace ALL existing sites with the imported ones?')) return;
      const n = await importConfig(parsed.sites, replaceOnImport);
      setNotice(`Imported ${n} site${n === 1 ? '' : 's'}.`);
    } catch {
      setError('That file is not a valid ProxView config export.');
    }
  };

  return (
    <div className="settings settings-stack">
      {demo && (
        <div className="banner">
          Demo mode is active — the overview shows synthetic data. Sites you add here won't appear
          until you restart without <code>DEMO=1</code>.
        </div>
      )}
      {notice && <div className="notice">{notice}</div>}
      {error && <div className="form-error">{error}</div>}

      <section className="panel">
        <div className="panel-head">
          <h2>Sites</h2>
          <button className="btn" onClick={() => setModal({ open: true, site: null })}>
            + Add new site
          </button>
        </div>
        {sites.length === 0 ? (
          <p className="muted">No sites configured yet. Add your first Proxmox VE or PBS server.</p>
        ) : (
          <div className="site-list">
            {sites.map((s) => (
              <div key={s.id} className="site-row">
                <div className="site-row-info">
                  <div className="site-row-name">
                    <span className={`kind-chip ${s.kind}`}>{s.kind.toUpperCase()}</span>
                    {s.name}
                  </div>
                  <div className="site-row-url">
                    {s.tokenId} @ {s.baseUrl}
                    {s.hasSshKey && <span className="ssh-on"> · temps on</span>}
                    {!s.tlsVerify && <span className="tls-warn"> · TLS unverified</span>}
                  </div>
                </div>
                <div className="site-row-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setModal({ open: true, site: s })}>
                    Edit
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      if (!confirm(`Remove "${s.name}" from ProxView?`)) return;
                      const cleanup =
                        s.hasSshKey &&
                        confirm(
                          `Also remove the ProxView API token and SSH key from "${s.name}"?\n\nRecommended — cleans up what onboarding placed on the machine. Requires the host to be reachable.`,
                        );
                      void remove(s.id, cleanup);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Display</h2>
            <p className="ssh-hint" style={{ margin: '4px 0 0' }}>
              Number of machine columns on the overview.
            </p>
          </div>
          <ColumnSelect />
        </div>
      </section>

      <NotificationsPanel />

      <AlertRulesPanel />

      <AccountPanel />

      <ConnectivityPanel />

      <section className="panel">
        <h2>Backup &amp; restore</h2>
        <p className="ssh-hint">
          Export all sites (including credentials) to move ProxView to a new instance. The file
          contains secrets — keep it safe.
        </p>
        <div className="config-actions">
          <a className="btn btn-ghost btn-sm" href="/api/config/export" download="proxview-config.json">
            Export config
          </a>
          <button className="btn btn-ghost btn-sm" onClick={() => fileInput.current?.click()}>
            Import config
          </button>
          <label className="check config-replace">
            <input
              type="checkbox"
              checked={replaceOnImport}
              onChange={(e) => setReplaceOnImport(e.target.checked)}
            />
            <span>replace existing</span>
          </label>
          <input ref={fileInput} type="file" accept="application/json,.json" onChange={onImportFile} hidden />
        </div>
      </section>

      {modal.open && (
        <SiteFormModal site={modal.site} onClose={() => setModal({ open: false, site: null })} />
      )}
    </div>
  );
}
