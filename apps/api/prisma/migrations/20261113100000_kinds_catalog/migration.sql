-- نوع بیمه‌نامه becomes data that Super Admin manages (add, rename, hide, delete) instead of a fixed enum.
ALTER TABLE "PolicyholderContract" ALTER COLUMN "line" TYPE TEXT USING "line"::text;
ALTER TABLE "Claim" ALTER COLUMN "line" TYPE TEXT USING "line"::text;
DROP TYPE "InsuranceLine";

-- The catalog itself (null = the default five: عمر، حوادث، مسئولیت، عمر مانده بدهکار، عمر پس‌انداز).
ALTER TABLE "PlatformConfig" ADD COLUMN "policyKinds" JSONB;

-- Which kinds each organization's panel 1 offers (empty = every active kind).
ALTER TABLE "Tenant" ADD COLUMN "policyKinds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Which kinds each document belongs to (empty = every kind).
ALTER TABLE "RequiredDocument" ADD COLUMN "kinds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
