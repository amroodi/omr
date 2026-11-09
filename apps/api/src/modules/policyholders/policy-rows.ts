import { toJalali } from '../../common/jalali/jalali.util';
import type { ModelStore } from '../model-view/model-store.service';
import { dependentsFor, Line, lineForm, typesFor } from '../claims/workflow';
import { kindLabel } from '../../common/kinds';


interface ContractRow { id: string; line: Line | null; policyNumber: string | null; insurerTenantId: string; startDate: Date | null; endDate: Date | null; isActive: boolean }

/** Does a contract belong in panel 1's chosen نوع بیمه‌نامه? One with no kind set fits every kind. */
export const fitsLine = (k: { line: Line | null }, line?: Line | null) => !line || !k.line || k.line === line;

/** In force today (no dates = always). */
export const inForce = (k: { startDate: Date | null; endDate: Date | null }, now = new Date()) => (!k.startDate || k.startDate <= now) && (!k.endDate || k.endDate >= now);

/** Active contracts, newest first (عمر before حوادث within a year). */
export const activeContracts = <T extends ContractRow>(all: T[]): T[] => all.filter((k) => k.isActive)
  .sort((a, b) => (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0) || (a.line === 'LIFE' ? 0 : 1) - (b.line === 'LIFE' ? 0 : 1));

/**
 * A company's بیمه‌نامه‌ها as the filing form needs them: dates, which نوع پرونده each covers and the
 * insurer's Model View form (labels, birth date / cause rules, cause lists, نوع بیمه‌شده). Shared by the
 * بیمه‌گزار panel and an organization's panel 1 filing for that company. `chain` = company + parents.
 */
export function policyRows(contracts: ContractRow[], insurerNames: Map<string, string>, store: ModelStore, chain: string[]) {
  return contracts.map((k) => {
    const m = store.get(k.insurerTenantId);
    return {
      id: k.id, line: k.line, lineLabel: k.line ? kindLabel(k.line) : null, policyNumber: k.policyNumber,
      insurerName: insurerNames.get(k.insurerTenantId) ?? '—',
      startDate: k.startDate ? toJalali(k.startDate, false) : null, endDate: k.endDate ? toJalali(k.endDate, false) : null,
      startIso: k.startDate?.toISOString() ?? null, endIso: k.endDate?.toISOString() ?? null,
      inForce: inForce(k), claimTypes: k.line ? typesFor(m, k.line, chain) : null,
      form: {
        insuredLabel: lineForm(m, k.line ?? 'ACCIDENT').insuredLabel, causeLabel: lineForm(m, k.line ?? 'ACCIDENT').causeLabel, eventLabel: m.form.eventLabel, birthDate: m.form.birthDate, cause: m.form.cause,
        causeLists: m.form.causeLists, caseTypes: m.form.caseTypes, dependents: dependentsFor(m, chain),
      },
    };
  });
}
