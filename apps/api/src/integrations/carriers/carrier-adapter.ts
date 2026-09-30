/**
 * Carrier adapter pattern — one implementation per upstream Iranian insurer (Alborz, …).
 * Credentials come from the tenant's encrypted `carrierConfig`, so each brokerage uses its own
 * upstream accounts. Register concrete adapters in CarrierRegistry.
 */

export interface CarrierCredentials {
  baseUrl: string;
  apiKey?: string;
  username?: string;
  password?: string;
  [k: string]: unknown;
}

export interface PolicyInquiryResult {
  policyNumber: string;
  status: 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
  productType?: string;
  sumInsured?: number;
  startDate?: string; // ISO
  raw?: unknown;
}

export interface CaseStatusResult {
  externalCaseId: string;
  stage: string;
  updatedAt?: string;
  raw?: unknown;
}

export interface CarrierAdapter {
  readonly key: string; // e.g. "alborz"
  inquirePolicy(policyNumber: string, creds: CarrierCredentials): Promise<PolicyInquiryResult>;
  getCaseStatus(externalCaseId: string, creds: CarrierCredentials): Promise<CaseStatusResult>;
  // endorse(...) — extend as needed
}
