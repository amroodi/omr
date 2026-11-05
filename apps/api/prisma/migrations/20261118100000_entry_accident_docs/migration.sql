-- A کارگزاری's panel-1 documents required only in a traffic accident.
ALTER TABLE "Tenant" ADD COLUMN "entryAccidentDocs" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Damuon: the police report / crash sketch and the driving licence are required only after a crash.
UPDATE "Tenant"
SET "entryAccidentDocs" = ARRAY['traffic_crash_sketch', 'driver_license_valid'],
    "entryRequiredDocs" = array_remove(array_remove("entryRequiredDocs", 'traffic_crash_sketch'), 'driver_license_valid')
WHERE slug = 'damuon';
