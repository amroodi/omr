-- «کد کارگزار» of Damuon at Alborz: 1280 (only where it is still empty; no-op where these organizations don't exist).
UPDATE "BrokerInsurerPartnership" p SET "brokerCode" = '1280'
FROM "Tenant" b, "Tenant" i
WHERE p."brokerTenantId" = b.id AND p."insurerTenantId" = i.id
  AND b.slug = 'damuon' AND i.slug = 'alborz' AND p."brokerCode" IS NULL;
