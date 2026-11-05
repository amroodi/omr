'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** «پیگیری آخرین وضعیت» is now «وضعیت پرونده» (the case's whole process): old links land there. */
export default function EstelamTrack() {
  const router = useRouter();
  useEffect(() => { router.replace('/estelam/process'); }, [router]);
  return null;
}
