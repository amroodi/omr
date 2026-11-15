'use client';
import { HomeHub, HubVariant } from './components/HomeHub';
import { entryLogin } from '../lib/panel';

/**
 * The organization this site serves (Damuon). Its home-page buttons open its own panels; Alborz has its own
 * home page (/alborz), linked from the header.
 */
const HOME_ORG = process.env.NEXT_PUBLIC_TENANT_SLUG || 'damuon';

const DAMUON: HubVariant = {
  key: 'damuon',
  heading: 'کارگزاری بیمه مستقیم برخط دامون',
  support: { label: 'امور مشتریان کارگزاری دامون', phone: '۰۲۱-۵۷۳۸۹۰۰۰' },
  entryTitle: 'ورود بیمه گزار',
  panel1: entryLogin(HOME_ORG),
  panel2: `/org/login?org=${encodeURIComponent(HOME_ORG)}`,
  rightLogo: <a href="https://damuon.com" target="_blank" rel="noopener noreferrer" className="plogo plogo-damuon" aria-label="آتیه اندیشان دامون" style={{ height: 66, width: 190 }} />,
  leftLogo: <a href="https://bimmes.ir" target="_blank" rel="noopener noreferrer" className="plogo plogo-bimmes" aria-label="بیمس" style={{ height: 48, width: 140 }} />,
};

export default function Landing() {
  return <HomeHub variant={DAMUON} />;
}
