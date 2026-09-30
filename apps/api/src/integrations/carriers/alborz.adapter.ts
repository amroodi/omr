import { Injectable, Logger } from '@nestjs/common';
import {
  CarrierAdapter,
  CarrierCredentials,
  CaseStatusResult,
  PolicyInquiryResult,
} from './carrier-adapter';

/**
 * Alborz Insurance (بیمه البرز) adapter — STUB.
 *
 * Replace the bodies with real HTTP calls to Alborz's API once endpoint/contract are available.
 * The shape and error handling are here so callers can be written against the real interface now.
 */
@Injectable()
export class AlborzAdapter implements CarrierAdapter {
  readonly key = 'alborz';
  private readonly logger = new Logger(AlborzAdapter.name);

  async inquirePolicy(policyNumber: string, creds: CarrierCredentials): Promise<PolicyInquiryResult> {
    this.logger.warn('AlborzAdapter.inquirePolicy is a stub — wire the real Alborz API.');
    // Example of intended shape:
    // const res = await fetch(`${creds.baseUrl}/policies/${policyNumber}`, {
    //   headers: { Authorization: `Bearer ${creds.apiKey}` },
    // });
    // if (!res.ok) throw new Error(`Alborz inquiry failed: ${res.status}`);
    // const data = await res.json();
    return { policyNumber, status: 'UNKNOWN', raw: { stub: true } };
  }

  async getCaseStatus(externalCaseId: string, _creds: CarrierCredentials): Promise<CaseStatusResult> {
    this.logger.warn('AlborzAdapter.getCaseStatus is a stub — wire the real Alborz API.');
    return { externalCaseId, stage: 'unknown', raw: { stub: true } };
  }
}
