'use client';
import { OrgLoginPage } from '../../components/OrgLoginPage';

/** «ورود کارگزاری» — the brokerage's operators. The insurer's desks sign in at /insurer/login. */
export default function OrgLogin() {
  return <OrgLoginPage kind="BROKER" />;
}
