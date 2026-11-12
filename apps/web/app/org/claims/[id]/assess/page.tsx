'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

/** The old «ارزیابی» page: every panel now uses the Sinad-style window (`/evaluate`); old links land there. */
export default function AssessRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => { router.replace(`/org/claims/${id}/evaluate`); }, [id, router]);
  return null;
}
