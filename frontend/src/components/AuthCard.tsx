import type { ReactNode } from 'react';
import { useAuth } from '../store/auth';
import { BrandMark } from './BrandMark';
import { LoginIconBackground } from './LoginIconBackground';

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function AuthCard({ title, subtitle, children }: Props) {
  const version = useAuth((s) => s.version);
  return (
    <div className="landing">
      <LoginIconBackground />
      <div className="card">
        <div className="brand">
          <BrandMark />
          <h1>ProxView</h1>
        </div>
        <h2 className="auth-title">{title}</h2>
        {subtitle && <p className="tagline">{subtitle}</p>}
        {children}
      </div>
      {version && (
        <div className="landing-version">
          ProxView {/^\d/.test(version) ? `v${version}` : version}
        </div>
      )}
    </div>
  );
}
