import { redirect } from 'next/navigation';

/** Kept so old links keep working: شعبه, ستاد and شورای فنی share «ورود بیمه‌گر». */
export default function Page() {
  redirect('/insurer/login');
}
