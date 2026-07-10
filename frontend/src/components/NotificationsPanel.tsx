import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../lib/api';
import { enableWebPush } from '../lib/push';
import { useNotify, type ChannelType, type TestResult } from '../store/notify';

const TYPE_LABELS: Record<ChannelType, string> = {
  email: 'Email (SMTP)',
  telegram: 'Telegram',
  slack: 'Slack',
  webpush: 'Browser push',
};

type Cfg = Record<string, string | boolean>;

export function NotificationsPanel() {
  const { channels, loaded, load, test, create, toggle, setMinLevel, remove } = useNotify();
  const [type, setType] = useState<ChannelType>('telegram');
  const [name, setName] = useState('');
  const [cfg, setCfg] = useState<Cfg>({});
  const [result, setResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | 'push' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const set =
    (k: string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const t = e.target;
      const v = t instanceof HTMLInputElement && t.type === 'checkbox' ? t.checked : t.value;
      setCfg((c) => ({ ...c, [k]: v }));
      setResult(null);
    };

  const buildConfig = (): Record<string, unknown> => {
    if (type === 'email')
      return {
        host: String(cfg.host ?? ''),
        port: Number(cfg.port ?? 587),
        secure: !!cfg.secure,
        user: String(cfg.user ?? ''),
        pass: String(cfg.pass ?? ''),
        from: String(cfg.from ?? ''),
        to: String(cfg.to ?? ''),
      };
    if (type === 'telegram')
      return { botToken: String(cfg.botToken ?? ''), chatId: String(cfg.chatId ?? '') };
    if (type === 'slack') return { webhookUrl: String(cfg.webhookUrl ?? '') };
    return {};
  };

  const doTest = async () => {
    setBusy('test');
    setError(null);
    try {
      setResult(await test(type, buildConfig()));
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
      const res = await create(type, name.trim() || TYPE_LABELS[type], buildConfig());
      setResult(res.test);
      setName('');
      setCfg({});
    } catch {
      setError('Could not save the channel.');
    } finally {
      setBusy(null);
    }
  };

  const doTestSaved = async (id: number) => {
    setBusy('test');
    try {
      setResult(await api.post<TestResult>(`/api/channels/${id}/test`));
    } catch {
      setResult({ ok: false, message: 'Test failed.' });
    } finally {
      setBusy(null);
    }
  };

  const doEnablePush = async () => {
    setBusy('push');
    setError(null);
    try {
      const r = await enableWebPush();
      setResult(r);
      if (r.ok) {
        if (!channels.some((c) => c.type === 'webpush'))
          await create('webpush', 'Browser push', {});
        else await load();
      }
    } catch {
      setError('Could not enable browser notifications.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="panel">
      <h2>Notifications</h2>
      <p className="ssh-hint">
        Get alerted when a node goes offline, a datastore fills up, a backup goes stale, or a CPU
        runs hot.
      </p>

      {channels.length > 0 && (
        <div className="site-list chan-list">
          {channels.map((c) => (
            <div key={c.id} className="site-row">
              <div className="site-row-info">
                <div className="site-row-name">
                  <span className={`chan-chip ${c.type}`}>{TYPE_LABELS[c.type]}</span>
                  {c.name}
                </div>
                <div className="site-row-url">{c.summary}</div>
              </div>
              <div className="site-row-actions">
                <select
                  className="level-select"
                  value={c.minLevel}
                  title="Which alerts this channel receives"
                  onChange={(e) => void setMinLevel(c.id, e.target.value as typeof c.minLevel)}
                >
                  <option value="info">All alerts</option>
                  <option value="warn">Warnings &amp; critical</option>
                  <option value="crit">Critical only</option>
                </select>
                <label className="switch" title={c.enabled ? 'Enabled' : 'Disabled'}>
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    onChange={(e) => void toggle(c.id, e.target.checked)}
                  />
                  <span className="slider" />
                </label>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => void doTestSaved(c.id)}
                  disabled={busy !== null}
                >
                  Test
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (confirm(`Remove "${c.name}"?`)) void remove(c.id);
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form className="form chan-form" onSubmit={doSave}>
        <label className="field">
          <span>Channel type</span>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as ChannelType);
              setCfg({});
              setResult(null);
            }}
          >
            <option value="telegram">Telegram</option>
            <option value="slack">Slack</option>
            <option value="email">Email (SMTP)</option>
            <option value="webpush">Browser push</option>
          </select>
        </label>

        {type === 'webpush' ? (
          <div className="push-enable">
            <p className="ssh-hint">
              Enable notifications in this browser. Repeat on each device you want alerts on.
            </p>
            <button
              type="button"
              className="btn"
              onClick={doEnablePush}
              disabled={busy !== null}
            >
              {busy === 'push' ? 'Enabling…' : 'Enable on this device'}
            </button>
          </div>
        ) : (
          <>
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={TYPE_LABELS[type]} />
            </label>

            {type === 'telegram' && (
              <>
                <label className="field">
                  <span>Bot token</span>
                  <input value={String(cfg.botToken ?? '')} onChange={set('botToken')} placeholder="123456:ABC-DEF..." autoComplete="off" required />
                </label>
                <label className="field">
                  <span>Chat ID</span>
                  <input value={String(cfg.chatId ?? '')} onChange={set('chatId')} placeholder="-1001234567890" autoComplete="off" required />
                </label>
              </>
            )}

            {type === 'slack' && (
              <label className="field">
                <span>Incoming webhook URL</span>
                <input value={String(cfg.webhookUrl ?? '')} onChange={set('webhookUrl')} placeholder="https://hooks.slack.com/services/..." autoComplete="off" required />
              </label>
            )}

            {type === 'email' && (
              <>
                <div className="ssh-grid">
                  <label className="field">
                    <span>SMTP host</span>
                    <input value={String(cfg.host ?? '')} onChange={set('host')} placeholder="smtp.gmail.com" required />
                  </label>
                  <label className="field">
                    <span>Port</span>
                    <input value={String(cfg.port ?? '')} onChange={set('port')} placeholder="587" required />
                  </label>
                </div>
                <label className="check">
                  <input type="checkbox" checked={!!cfg.secure} onChange={set('secure')} />
                  <span>Use TLS/SSL (port 465)</span>
                </label>
                <div className="ssh-grid">
                  <label className="field">
                    <span>Username</span>
                    <input value={String(cfg.user ?? '')} onChange={set('user')} autoComplete="off" />
                  </label>
                  <label className="field">
                    <span>Password</span>
                    <input type="password" value={String(cfg.pass ?? '')} onChange={set('pass')} autoComplete="off" />
                  </label>
                </div>
                <label className="field">
                  <span>From</span>
                  <input value={String(cfg.from ?? '')} onChange={set('from')} placeholder="proxview@example.com" required />
                </label>
                <label className="field">
                  <span>To</span>
                  <input value={String(cfg.to ?? '')} onChange={set('to')} placeholder="you@example.com" required />
                </label>
              </>
            )}

            {result && (
              <div className={`test-result ${result.ok ? 'ok' : 'bad'}`}>
                {result.ok ? '✓ ' : '✕ '}
                {result.message}
              </div>
            )}
            {error && <div className="form-error">{error}</div>}

            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={doTest} disabled={busy !== null}>
                {busy === 'test' ? 'Sending…' : 'Send test'}
              </button>
              <button type="submit" className="btn" disabled={busy !== null}>
                {busy === 'save' ? 'Saving…' : 'Add channel'}
              </button>
            </div>
          </>
        )}
        {type === 'webpush' && result && (
          <div className={`test-result ${result.ok ? 'ok' : 'bad'}`}>
            {result.ok ? '✓ ' : '✕ '}
            {result.message}
          </div>
        )}
      </form>
    </section>
  );
}
