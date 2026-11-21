-- Alborz «تصادف»: «گزارش پزشک قانونی» and «تصویر جواز دفن» are back, optional («برحسب نیاز»), after the list.
UPDATE "RequiredDocument" d
SET "label" = v.label, "order" = v.ord, "isActive" = true, "requiredTypes" = '{}'::text[]
FROM "Tenant" t, (VALUES
  ('da_crash_forensic_report', 'گزارش پزشک قانونی مبنی بر علت فوت (بر حسب ضرورت)', 312),
  ('da_crash_burial_permit', 'تصویر جواز دفن (ممهور به مهر برابر با اصل)', 313)
) AS v(code, label, ord)
WHERE t.id = d."tenantId" AND t.slug = 'alborz' AND d.code = v.code;
