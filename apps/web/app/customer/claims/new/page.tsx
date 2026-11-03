'use client';
import { PolicyholderClaimForm } from '../../../components/PolicyholderClaimForm';

/** بیمه‌گزار / نماینده — «ثبت پرونده خسارت» (shared with a brokerage's panel 1, see PolicyholderClaimForm). */
export default function CustomerNewClaim() {
  return <PolicyholderClaimForm realm="customer" />;
}
