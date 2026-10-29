'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Shell } from '../../components/Shell';
import { AuthCard } from '../../components/auth-card';
import { MfaSetup } from '../../components/MfaSetup';
import { ORG_NAV } from '../nav';

/**
 * «ورود دومرحله‌ای». With `?required=1` (the org requires it and this user hasn't set it up) the page
 * stands alone — their session reaches nothing else until it's on — then continues to the panel.
 */
function Security() {
  const router = useRouter();
  const required = useSearchParams().get('required') === '1';
  if (required) {
    return (
      <AuthCard title="ورود دومرحله‌ای الزامی است" subtitle="سازمان شما برای همهٔ کاربران ورود دومرحله‌ای را الزامی کرده است">
        <MfaSetup realm="org" onEnabled={() => setTimeout(() => router.push('/org/login?mfa=done'), 1500)} />
      </AuthCard>
    );
  }
  return (
    <Shell title="ورود دومرحله‌ای" subtitle="امنیت حساب کاربری شما" nav={ORG_NAV} realm="org">
      <div className="card p-5 max-w-2xl"><MfaSetup realm="org" /></div>
    </Shell>
  );
}

export default function SecurityPage() {
  return <Suspense fallback={null}><Security /></Suspense>;
}
