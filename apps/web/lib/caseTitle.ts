/**
 * How a case is named on screen: by its case number «سال/شماره بیمه‌نامه/n» (e.g. 1405/618/01).
 * `caseRef` is the bare number, `caseTitle` adds the word in front.
 */
export interface CaseNamed { claimNumber: string; policyNumber?: string | null }
const fa = (s: string) => s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
export const caseRef = (c: CaseNamed) => fa(c.claimNumber);
export const caseTitle = (c: CaseNamed) => `پروندهٔ ${caseRef(c)}`;
