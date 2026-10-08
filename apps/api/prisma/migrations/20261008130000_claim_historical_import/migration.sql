-- Historical (legacy) claim import: archived settled records migrated in bulk.
ALTER TABLE "Claim" ADD COLUMN "imported" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Claim" ADD COLUMN "legacyStatus" TEXT;
ALTER TABLE "Claim" ADD COLUMN "beneficiaryType" TEXT;
ALTER TABLE "Claim" ADD COLUMN "employerName" TEXT;
ALTER TABLE "Claim" ADD COLUMN "causeOfDeath" TEXT;
ALTER TABLE "Claim" ADD COLUMN "legacyData" JSONB;
