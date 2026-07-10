import type { ReactNode } from 'react';
import { BrandMark } from './BrandMark';
import { LoginEmojiBackground } from './LoginEmojiBackground';

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function AuthCard({ title, subtitle, children }: Props) {
  return (
    <div className="landing">
      <LoginEmojiBackground />
      <div className="card">
        <div className="brand">
          <BrandMark />
          <h1>ProxView</h1>
        </div>
        <h2 className="auth-title">{title}</h2>
        {subtitle && <p className="tagline">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
