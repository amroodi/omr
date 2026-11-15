'use client';
import { useLayoutEffect } from 'react';
import { client } from '../../lib/client';
import { applyTheme } from '../../lib/theme';
import { entryLogin } from '../../lib/panel';
import { HomeHub, HubVariant } from '../components/HomeHub';

// Alborz's colours until its branding (Super Admin) arrives, so the page doesn't open in Damuon's orange.
const ALBORZ_THEME = { brand: '#00bd9c', title: '#00a386' };

const ALBORZ: HubVariant = {
  key: 'alborz',
  heading: 'سامانه اعلام و پیگیری خسارت های عمر و حوادث',
  support: { label: 'امور مشتریان بیمه البرز', phone: '۰۲۱-۱۵۷۴' },
  entryTitle: 'ورود بیمه گر',
  panel1: entryLogin('alborz'),
  panel2: '/insurer/login?org=alborz',
  // eslint-disable-next-line @next/next/no-img-element
  rightLogo: <a href="https://alborzinsurance.ir" target="_blank" rel="noopener noreferrer" aria-label="بیمه البرز"><img src="/brand/alborz-emblem.webp" alt="بیمه البرز" style={{ height: 112, width: 'auto' }} /></a>,
  // eslint-disable-next-line @next/next/no-img-element
  leftLogo: <img src="/brand/alborz-logo.webp" alt="بیمه البرز" style={{ height: 42, width: 'auto' }} />,
};

/** Alborz's home page: Damuon's, with Alborz's logos and colours, its entry buttons opening Alborz's panels. */
export default function AlborzHome() {
  useLayoutEffect(() => {
    applyTheme(ALBORZ_THEME);
    let active = true;
    fetch(`${client.base}/tenant/branding`, { headers: { 'x-tenant-slug': 'alborz' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (active && b?.theme) applyTheme(b.theme); })
      .catch(() => {});
    return () => { active = false; applyTheme(null); };
  }, []);
  return <HomeHub variant={ALBORZ} />;
}
