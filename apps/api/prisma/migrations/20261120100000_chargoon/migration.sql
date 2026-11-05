-- «شماره چارگون» on letters (مکاتبات) of organizations that use the چارگون correspondence system.
ALTER TABLE "Tenant" ADD COLUMN "chargoonEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ClaimLetter" ADD COLUMN "chargoonNo" TEXT;
-- Alborz and Damuon use چارگون.
UPDATE "Tenant" SET "chargoonEnabled" = true WHERE slug IN ('alborz', 'damuon');
