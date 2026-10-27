import { jalaliYear, toAsciiDigits } from '../../common/jalali/jalali.util';

type ClaimDb = {
  claim: {
    findMany: (a: { where: { claimNumber: { startsWith: string } }; select: { claimNumber: true } }) => Promise<{ claimNumber: string }[]>;
    findUnique: (a: { where: { claimNumber: string }; select: { id: true } }) => Promise<{ id: string } | null>;
  };
};

/**
 * Case number «سال/شماره بیمه‌نامه/n», e.g. 1405/618/01: the Jalali year (Tehran) the case belongs to, the
 * بیمه‌نامه (عمر or حوادث, renewed yearly) it was filed under, and a counter from 01 within that year and
 * policy. A case without a known policy number uses 0 in the middle (e.g. 1405/0/03).
 */
export async function nextClaimNumber(db: ClaimDb, policyNumber: string | null | undefined, at: Date = new Date()): Promise<string> {
  const pn = toAsciiDigits(policyNumber ?? '').trim().replace(/\s+/g, '') || '0';
  const prefix = `${jalaliYear(at)}/${pn}/`;
  const taken = await db.claim.findMany({ where: { claimNumber: { startsWith: prefix } }, select: { claimNumber: true } });
  // Highest counter so far for this year + policy (numbers of longer policy numbers that merely start
  // the same way, e.g. «14» vs «14/1032», aren't plain integers after the prefix and are ignored).
  let n = taken.reduce((max, c) => {
    const rest = c.claimNumber.slice(prefix.length);
    return /^\d+$/.test(rest) ? Math.max(max, Number(rest)) : max;
  }, 0) + 1;
  for (;;) {
    const num = `${prefix}${String(n).padStart(2, '0')}`;
    if (!(await db.claim.findUnique({ where: { claimNumber: num }, select: { id: true } }))) return num;
    n++;
  }
}
