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
};
