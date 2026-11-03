'use client';
import { client } from '../../../lib/client';
import { lineQuery } from '../../../lib/line';
import type { MyClaim } from '../../customer/case-table';

/** An org case list row, read as the بیمه‌گزار panel's table row (panel 1 of an organization). */
type OrgRow = MyClaim & { currentStage?: string | null };

/** The organization's cases for panel 1 (in the chosen نوع بیمه‌نامه), with «نیازمند اقدام» = sent back for رفع نقص. */
export async function entryCases(): Promise<MyClaim[]> {
  const rows = await client.get<OrgRow[]>(`/claims${lineQuery()}`, 'org');
  return rows.map((c) => ({ ...c, needsAction: c.status === 'RETURNED_INCOMPLETE' || c.currentStage === 'POLICYHOLDER' }));
}

/** Panel 1's case page (the case in the same design, without assessment). */
export const entryCaseHref = (id: string) => `/org/claims/${id}`;

/** Search a loaded list like the بیمه‌گزار panel does: کد ملی, name or case number. */
export function matchCase(c: MyClaim & { deceasedNationalCode?: string | null }, q: string): boolean {
  const n = q.trim().replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  if (!n) return false;
  return [c.claimNumber, c.policyNumber, c.deceasedName, c.deceasedNationalCode].some((v) => !!v && v.includes(n));
}
