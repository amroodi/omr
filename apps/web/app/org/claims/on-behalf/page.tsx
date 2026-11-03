'use client';
import { PolicyholderClaimForm } from '../../../components/PolicyholderClaimForm';

/**
 * «ثبت پرونده برای بیمه‌گزار» — a brokerage's panel 1 (claim:file-on-behalf): the بیمه‌گزار panel's own
 * «ثبت پرونده خسارت» form, with the company picked first; documents follow on the case page.
 */
export default function FileOnBehalf() {
  return <PolicyholderClaimForm realm="org" />;
}
