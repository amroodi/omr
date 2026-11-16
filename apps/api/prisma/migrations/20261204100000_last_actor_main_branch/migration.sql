-- «آخرین اقدام کننده» per organization, «تطابق ذینفعان» by the کارگزاری, and the main branch that sees every branch
ALTER TABLE "Claim" ADD COLUMN "lastActors" JSONB;
ALTER TABLE "Claim" ADD COLUMN "heirsMatchedAt" TIMESTAMP(3);
ALTER TABLE "Claim" ADD COLUMN "heirsMatchedById" TEXT;
ALTER TABLE "Branch" ADD COLUMN "isMain" BOOLEAN NOT NULL DEFAULT false;
-- Alborz: شعبه کریمخان (1057), at the main building in Tehran
UPDATE "Branch" SET "isMain" = true WHERE "code" = '1057' AND "tenantId" IN (SELECT "id" FROM "Tenant" WHERE "slug" = 'alborz');
