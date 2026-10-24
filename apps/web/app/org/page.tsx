'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** The org panel opens on the Work Desk (case lists and search live there; reports at /org/reports). */
export default function OrgHome() {
  const router = useRouter();
  useEffect(() => { router.replace('/org/work-desk'); }, [router]);
  return null;
}
