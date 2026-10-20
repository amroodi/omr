import { ReactNode } from 'react';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

export function ErrorBox({ message }: { message?: string }) {
  if (!message) return null;
  return <div className="alert-error fade-up">{message}</div>;
}

export function StatCard({ label, value, icon, tone = 'brand' }: { label: string; value: ReactNode; icon?: ReactNode; tone?: 'brand' | 'success' | 'warning' | 'muted' }) {
  const toneColor = {
    brand: 'var(--brand)',
    success: 'var(--success)',
    warning: 'var(--warning)',
    muted: 'var(--muted)',
  }[tone];
  return (
    <div className="card card-hover p-4 flex items-center gap-3">
      <span className="flex items-center justify-center rounded-xl" style={{ width: 44, height: 44, background: 'color-mix(in srgb, ' + toneColor + ' 14%, transparent)', color: toneColor }}>
        {icon}
      </span>
      <div>
        <div className="text-2xl font-extrabold leading-none">{value}</div>
        <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{label}</div>
      </div>
    </div>
  );
}

/** Reference-style stat tile: label + big value on the right, a large outline icon on the left. */
export function PanelStat({ label, value, unit, icon, tone = 'navy' }: { label: string; value: ReactNode; unit?: string; icon: ReactNode; tone?: 'navy' | 'brand' | 'success' | 'warning' | 'danger' }) {
  const color = {
    navy: 'var(--topbar-accent)', brand: 'var(--brand)', success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)',
  }[tone];
  return (
    <div className="pcard p-5 flex items-center justify-between gap-3" style={{ minHeight: 118 }}>
      <div className="min-w-0">
        <div className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>{label}</div>
        <div className="text-2xl font-extrabold mt-2 leading-none">{value}</div>
        {unit && <div className="text-xs mt-2" style={{ color: 'var(--muted)' }}>{unit}</div>}
      </div>
      <span style={{ color, flexShrink: 0 }} aria-hidden>{icon}</span>
    </div>
  );
}

/** A large (outline) icon for PanelStat / action diamonds. */
export function BigIcon({ path, size = 44 }: { path: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

/** Fancy loading indicator — the operator's cue that the system is working, not stuck. */
export function FancyLoader({ label = 'در حال بارگذاری…' }: { label?: string }) {
  return (
    <div className="fancy-loader">
      <div className="fancy-spinner"><span className="fancy-spark" /></div>
      {label && <div className="lbl">{label}</div>}
    </div>
  );
}

/** Centered notice modal (error / info / success), mirroring the reference's خطا / tip dialogs. */
export function NoticeModal({ variant = 'info', title, children, confirmLabel = 'متوجه شدم', onClose, onConfirm, cancelLabel }:
  { variant?: 'error' | 'info' | 'success'; title?: string; children: ReactNode; confirmLabel?: string; onClose: () => void; onConfirm?: () => void; cancelLabel?: string }) {
  const accent = variant === 'error' ? 'var(--danger)' : variant === 'success' ? 'var(--success)' : 'var(--brand)';
  const defaultTitle = variant === 'error' ? 'خطا' : variant === 'success' ? 'انجام شد' : 'توجه';
  return (
    <div className="pmodal-backdrop" onClick={onClose}>
      <div className="pmodal" style={{ maxWidth: 520, borderTop: `4px solid ${accent}` }} onClick={(e) => e.stopPropagation()}>
        <div className="pmodal-head">
          <span className="pmodal-title" style={{ color: accent }}>{title ?? defaultTitle}</span>
          <button className="pmodal-x" onClick={onClose} aria-label="بستن">×</button>
        </div>
        <div className="pmodal-body text-sm" style={{ lineHeight: 2 }}>{children}</div>
        <div className="flex border-t" style={{ borderColor: 'var(--border)' }}>
          {cancelLabel && (
            <button onClick={onClose} className="flex-1 py-3 font-bold" style={{ color: 'var(--muted)', borderInlineEnd: '1px solid var(--border)' }}>{cancelLabel}</button>
          )}
          <button onClick={onConfirm ?? onClose} className="flex-1 py-3 font-bold" style={{ color: accent }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/** Amber non-error system message (like the reference's bottom validation tip). */
export function InfoBar({ children }: { children: ReactNode }) {
  return <div className="pinfo-bar">{children}</div>;
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  PAID: { label: 'پرداخت شده', cls: 'badge-success' },
  REVIEWING: { label: 'در حال بررسی', cls: 'badge-warning' },
  UNPAYABLE: { label: 'غیرقابل پرداخت', cls: 'badge-danger' },
  OTHER: { label: 'سایر', cls: 'badge-neutral' },
  VERIFIED: { label: 'تایید اصالت', cls: 'badge-success' },
  REJECTED: { label: 'رد شده', cls: 'badge-danger' },
  NEEDS_INFO: { label: 'نیاز به اطلاعات', cls: 'badge-warning' },
  PENDING: { label: 'در انتظار', cls: 'badge-neutral' },
  // Claim statuses
  DRAFT: { label: 'پیش‌نویس', cls: 'badge-neutral' },
  SUBMITTED: { label: 'ثبت‌شده', cls: 'badge-info' },
  UNDER_REVIEW: { label: 'در حال بررسی', cls: 'badge-warning' },
  RETURNED_INCOMPLETE: { label: 'نقص مدارک', cls: 'badge-danger' },
  APPROVED: { label: 'تایید نهایی', cls: 'badge-success' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] || { label: status, cls: 'badge-neutral' };
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

export const CLAIM_TYPE_LABELS: Record<string, string> = {
  DEATH_ILLNESS: 'فوت ناشی از بیماری',
  DEATH_ACCIDENT: 'فوت ناشی از حادثه',
  DISABILITY_ACCIDENT: 'نقص عضو / ازکارافتادگی ناشی از حادثه',
  MEDICAL_ACCIDENT: 'جبران هزینه‌های پزشکی ناشی از حادثه',
  DISABILITY_ILLNESS: 'از کار افتادگی ناشی از بیماری',
};

// A distinct color per claim type, for at-a-glance recognition in lists and headers.
const CLAIM_TYPE_STYLE: Record<string, { fg: string; bg: string; dot: string }> = {
  DEATH_ILLNESS: { fg: '#1d4ed8', bg: 'rgba(37,99,235,0.12)', dot: '#2563eb' }, // blue — بیماری
  DEATH_ACCIDENT: { fg: '#b91c1c', bg: 'rgba(220,38,38,0.12)', dot: '#dc2626' }, // red — حادثه
  DISABILITY_ACCIDENT: { fg: '#b45309', bg: 'rgba(217,119,6,0.14)', dot: '#d97706' }, // amber — نقص عضو
  MEDICAL_ACCIDENT: { fg: '#047857', bg: 'rgba(5,150,105,0.12)', dot: '#059669' }, // teal — هزینه پزشکی
  DISABILITY_ILLNESS: { fg: '#6d28d9', bg: 'rgba(124,58,237,0.12)', dot: '#7c3aed' }, // purple — ازکارافتادگی بیماری
};

/** Colored, dotted chip for a claim (death) type. */
export function ClaimTypeBadge({ type }: { type: string }) {
  const s = CLAIM_TYPE_STYLE[type] || { fg: 'var(--muted)', bg: 'var(--surface-2)', dot: 'var(--muted)' };
  return (
    <span className="badge" style={{ color: s.fg, background: s.bg, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: s.dot, flexShrink: 0 }} />
      {CLAIM_TYPE_LABELS[type] || type}
    </span>
  );
}
