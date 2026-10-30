import { redirect } from 'next/navigation';

/** Kept so old links keep working: بیمه‌گزار and نماینده share one login page. */
export default function Page() {
  redirect('/customer/login');
}
