'use client';
import { ReactNode } from 'react';
import { BrandMark } from './brand';

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <BrandMark size={48} />
          <h1 className="text-xl font-extrabold mt-3">{title}</h1>
          {subtitle && <p className="text-sm mt-1 text-center" style={{ color: 'var(--muted)' }}>{subtitle}</p>}
        </div>
        <div className="card p-6 fade-up" style={{ boxShadow: 'var(--shadow-lg)' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
