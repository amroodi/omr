'use client';

/**
 * The فن‌آوران coverage answer on the panel-1 filing forms: is the insured (their کد ملی, their بیمه‌نامه and
 * its period) defined in the insurer's system, and what that does to the case — Super Admin decides in
 * «اتصال فن‌آوران» whether an uncovered person is refused or only warned about.
 */
/** The فن‌آوران answer as the form shows it. */
export interface Coverage { status: string; name: string; message: string; blocked: boolean; policy: { number: string | null; start: string | null; end: string | null } | null }

/** The answer and what it does to this case (Super Admin decides: refuse, or only warn). */
export function coverageText(c: Coverage): string {
  if (c.status === 'VALID') return `پوشش بیمه‌ای معتبر است${c.name ? ` — ${c.name}` : ''}${c.policy?.number ? ` — بیمه‌نامه ${c.policy.number}` : ''}`;
  if (c.status === 'ERROR') return `استعلام انجام نشد: ${c.message}`;
  if (c.status === 'NOT_CHECKED') return `${c.message}؛ ${c.blocked ? 'تا پاسخ آن پرونده ثبت نمی‌شود — کمی بعد دوباره تلاش کنید.' : 'می‌توانید ثبت کنید و بررسی بعداً خودکار انجام می‌شود.'}`;
  return `${c.message}؛ ${c.blocked ? 'پرونده برای پرداخت خسارت ثبت نمی‌شود.' : 'پرونده با هشدار ثبت می‌شود.'}`;
}

export function CoverageNote({ c }: { c: Coverage | 'checking' | null }) {
  if (!c) return null;
  if (c === 'checking') return <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>در حال استعلام از سامانهٔ بیمه‌گر (فن‌آوران)…</div>;
  const ok = c.status === 'VALID';
  return (
    <div className={`text-xs mt-1 ${ok ? 'alert-success' : c.blocked ? 'alert-error' : ''}`} style={!ok && !c.blocked ? { background: 'var(--warning-soft)', borderRadius: 8, padding: '6px 8px' } : undefined}>
      {coverageText(c)}
    </div>
  );
}
