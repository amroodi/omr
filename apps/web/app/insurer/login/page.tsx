'use client';
import { OrgLoginPage } from '../../components/OrgLoginPage';

/** «ورود بیمه‌گر» — one login for the insurer's شعبه, ستاد and شورای فنی; the account decides the panel. */
export default function InsurerLogin() {
  return <OrgLoginPage kind="INSURER" />;
}
