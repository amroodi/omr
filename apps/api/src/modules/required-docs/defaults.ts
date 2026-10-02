import { DocAppliesTo } from '@prisma/client';

/**
 * Default required-document catalog seeded for a new INSURER. Business-editable afterwards.
 * Tagged by cause of death: BOTH (natural & accident) or ACCIDENT-only. The full list will be
 * provided later and simply added/edited here or via the config API — no code change needed.
 */
export const DEFAULT_REQUIRED_DOCS: {
  code: string;
  label: string;
  appliesTo: DocAppliesTo;
  order: number;
}[] = [
  { code: 'death_cert', label: 'گواهی فوت', appliesTo: 'BOTH', order: 1 },
  { code: 'burial_permit', label: 'جواز دفن', appliesTo: 'BOTH', order: 2 },
  { code: 'forensic_cert', label: 'گواهی پزشک قانونی مبتنی بر علت فوت', appliesTo: 'BOTH', order: 3 },
  { code: 'deceased_id_cancelled', label: 'شناسنامه تمام صفحات باطل‌شده متوفی', appliesTo: 'BOTH', order: 4 },
  { code: 'heirs_id_pages', label: 'صفحات اول و دوم شناسنامه وراث', appliesTo: 'BOTH', order: 5 },
  { code: 'heirs_national_card', label: 'کارت ملی وراث', appliesTo: 'BOTH', order: 6 },
  { code: 'medical_records', label: 'کلیه سوابق و مدارک پزشکی', appliesTo: 'BOTH', order: 7 },
  { code: 'accident_report', label: 'گزارش مشروح حادثه توسط مراجع ذی‌صلاح (با تاریخ و علت فوت)', appliesTo: 'ACCIDENT', order: 8 },
  { code: 'driving_license', label: 'گواهی‌نامه رانندگی (در صورت تصادف رانندگی)', appliesTo: 'ACCIDENT', order: 9 },
  { code: 'valid_license_vehicle', label: 'گواهی‌نامه مجاز و متناسب با وسیله نقلیه', appliesTo: 'ACCIDENT', order: 10 },
];
