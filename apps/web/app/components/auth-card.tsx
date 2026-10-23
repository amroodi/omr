'use client';
import { ReactNode } from 'react';
import { BrandMark } from './brand';

/** `bg` sets a full-screen background image behind the card (light + dark variants). */
export function AuthCard({ title, subtitle, children, bg }: { title: string; subtitle?: string; children: ReactNode; bg?: { light: string; dark: string } }) {
  return (
    <div className="min-h-[calc(70*var(--zvh))] flex items-center justify-center">
      {bg && (
        <>
          <div className="auth-bg auth-bg-light" style={{ backgroundImage: `url(${bg.light})` }} aria-hidden />
          <div className="auth-bg auth-bg-dark" style={{ backgroundImage: `url(${bg.dark})` }} aria-hidden />
        </>
      )}
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <BrandMark size={48} />
          <h1 className="text-xl font-extrabold mt-3" style={bg ? { textShadow: '0 1px 10px rgba(0,0,0,0.12)' } : undefined}>{title}</h1>
          {subtitle && <p className="text-sm mt-1 text-center" style={{ color: 'var(--muted)' }}>{subtitle}</p>}
        </div>
        <div className={bg ? 'glass p-6 fade-up' : 'card p-6 fade-up'} style={{ boxShadow: 'var(--shadow-lg)', borderRadius: 'var(--radius)' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
