'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** The old «پرونده‌های خسارت» list moved into the Work Desk; links and notifications pointing here land there. */
export default function ClaimsListMoved() {
  const router = useRouter();
  useEffect(() => { router.replace('/org/work-desk'); }, [router]);
  return null;
}
