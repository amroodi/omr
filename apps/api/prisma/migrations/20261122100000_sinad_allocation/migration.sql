-- «روند سیناد» تخصیص: per-evaluator settings
ALTER TABLE "OrgUser" ADD COLUMN "evalBatch" INTEGER;
ALTER TABLE "OrgUser" ADD COLUMN "evalPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OrgUser" ADD COLUMN "evalTypes" TEXT[] DEFAULT ARRAY[]::TEXT[];
