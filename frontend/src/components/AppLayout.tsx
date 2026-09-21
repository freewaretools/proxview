import { useEffect, useRef, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useLive } from '../store/live';
import { useUi } from '../store/ui';
import { BrandMark } from './BrandMark';

const iconProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function AppLayout({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const demo = useLive((s) => s.demo);
  const connected = useLive((s) => s.connected);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const sidebarRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const lastPath = useRef(pathname);

  // Auto-collapse when the sidebar is expanded and the user clicks outside it.
  useEffect(() => {
    if (collapsed) return;
    const onDown = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        toggleSidebar();
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [collapsed, toggleSidebar]);

  // Collapse after navigating (e.g. clicking Settings). Skipped on first render so a
  // sidebar the user left expanded isn't snapped shut on page load.
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (!useUi.getState().sidebarCollapsed) toggleSidebar();
  }, [pathname, toggleSidebar]);

  return (
    <div className="app-shell-side">
      <aside ref={sidebarRef} className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="side-top">
          <button className="side-menu" onClick={toggleSidebar} aria-label="Toggle sidebar" title="Toggle sidebar">
            <svg {...iconProps}>
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <div className="side-brand collapse-hide">
            <BrandMark />
            <span className="side-brand-name">ProxView</span>
          </div>
        </div>

        <nav className="side-nav">
          <NavLink to="/" end className="side-link" title="Overview">
            <svg {...iconProps}>
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            <span className="collapse-hide">Overview</span>
          </NavLink>
          <NavLink to="/settings" className="side-link" title="Settings">
            <svg {...iconProps}>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 6 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H2a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9.4a1.7 1.7 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H22a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
            <span className="collapse-hide">Settings</span>
          </NavLink>
        </nav>

        <div className="side-spacer" />

        <div className="side-bottom">
          <div className="side-controls">
            <span className={`conn ${connected ? 'on' : 'off'}`} title={connected ? 'Live' : 'Reconnecting'}>
              <span className="conn-dot" />
              <span className="collapse-hide">{connected ? 'Live' : 'Offline'}</span>
            </span>
            {demo && <span className="pill pill-warn collapse-hide">demo</span>}
            <span className="side-controls-spacer collapse-hide" />
          </div>
          <div className="side-user-card">
            <div className="side-avatar" title={user?.username}>
              {user?.username?.[0]?.toUpperCase() ?? '?'}
            </div>
            <span className="side-user-name collapse-hide">{user?.username}</span>
            <button
              className="side-signout"
              onClick={() => logout()}
              title="Sign out"
              aria-label="Sign out"
            >
              <svg {...iconProps}>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <main className="content-scroll">{children}</main>
    </div>
  );
}
