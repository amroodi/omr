/**
 * How a case is named on screen: by its شماره بیمه‌نامه once the system knows it, otherwise by the
 * internal claim number (CLM-…). `caseRef` is the bare identifier, `caseTitle` adds the word in front.
 */
export interface CaseNamed { claimNumber: string; policyNumber?: string | null }
export const caseRef = (c: CaseNamed) => c.policyNumber || c.claimNumber;
export const caseTitle = (c: CaseNamed) => (c.policyNumber ? `بیمه‌نامهٔ ${c.policyNumber}` : `پرونده ${c.claimNumber}`);
