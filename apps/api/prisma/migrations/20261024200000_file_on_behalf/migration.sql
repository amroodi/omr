-- New permission claim:file-on-behalf: the کارگزاری opens a case and uploads its documents for a
-- بیمه‌گزار company. Granted to the built-in admin role of every brokerage; other roles get it only
-- when an admin adds it to them.
UPDATE "Role" r
SET "permissions" = array_append(r."permissions", 'claim:file-on-behalf')
FROM "Tenant" t
WHERE r."tenantId" = t."id"
  AND t."kind" = 'BROKER'
  AND r."isSystem" = true
  AND r."name" = 'مدیر سازمان'
  AND NOT ('claim:file-on-behalf' = ANY (r."permissions"));
