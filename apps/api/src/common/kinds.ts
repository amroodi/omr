/**
 * نوع بیمه‌نامه catalog. Super Admin adds, renames, hides and deletes kinds (PlatformConfig.policyKinds);
 * KindsService loads it at start and after every change, and the rest of the server reads it from here.
 * A contract and a case store the kind's `code`; panel 1 works in one kind at a time.
 */
export interface PolicyKind { code: string; label: string; active: boolean }

/** The starting catalog (also what an empty PlatformConfig.policyKinds means). */
export const DEFAULT_KINDS: PolicyKind[] = [
  { code: 'LIFE', label: 'عمر گروهی', active: true },
  { code: 'ACCIDENT', label: 'حوادث گروهی', active: true },
  { code: 'CREDIT_LIFE', label: 'عمر انفرادی (مانده بدهکار)', active: true },
  { code: 'ACCIDENT_INDIVIDUAL', label: 'حوادث انفرادی', active: true },
  { code: 'LIABILITY', label: 'مسئولیت', active: false },
  { code: 'SAVINGS_LIFE', label: 'عمر پس‌انداز', active: false },
];

export const KIND_CODE = /^[A-Z][A-Z0-9_]{1,30}$/;

let catalog: PolicyKind[] = DEFAULT_KINDS;

/** A stored catalog, cleaned (valid codes, no duplicates); anything unusable falls back to the defaults. */
export function kindsFrom(stored: unknown): PolicyKind[] {
  if (!Array.isArray(stored)) return DEFAULT_KINDS;
  const seen = new Set<string>();
  const out: PolicyKind[] = [];
  for (const r of stored as any[]) {
    const code = typeof r?.code === 'string' ? r.code.trim() : '';
    const label = typeof r?.label === 'string' ? r.label.trim().slice(0, 60) : '';
    if (!KIND_CODE.test(code) || !label || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, label, active: r?.active !== false });
  }
  return out.length ? out : DEFAULT_KINDS;
}

export function setKinds(list: PolicyKind[]): void { catalog = list; }
export function allKinds(): PolicyKind[] { return catalog; }
export function activeKinds(): PolicyKind[] { return catalog.filter((k) => k.active); }
export function isKind(code: unknown): code is string { return typeof code === 'string' && catalog.some((k) => k.code === code); }
export function kindLabel(code: string | null | undefined): string | null { return code ? catalog.find((k) => k.code === code)?.label ?? code : null; }

/** A `?line=` query value, if it is a kind of the catalog (anything else = every kind). */
export const asLine = (v: unknown): string | undefined => (isKind(v) ? v : undefined);

/** The kinds an organization's panel 1 offers: its own choice (active ones), else every active kind. */
export function kindsOf(orgKinds: string[] | null | undefined): PolicyKind[] {
  const active = activeKinds();
  return orgKinds?.length ? active.filter((k) => orgKinds.includes(k.code)) : active;
}

/** Prisma filter for documents of a case's kind: those pointed to it, and those pointed to none (every kind). */
export function docKindWhere(line: string | null | undefined) {
  return line ? { OR: [{ kinds: { isEmpty: true } }, { kinds: { has: line } }] } : {};
}
