'use client';
import { PolicyholderCase } from '../../../components/PolicyholderCase';

/** بیمه‌گزار / نماینده — «جزئیات پرونده» (shared with an organization's panel 1, see PolicyholderCase). */
export default function CustomerClaim() {
  return <PolicyholderCase realm="customer" />;
}
