-- «فرم گزارش خسارت ارفاقی»: section by section (شعبه → ستاد → شورای فنی), each registered with name and date
ALTER TABLE "ClaimConcession" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'BRANCH';
ALTER TABLE "ClaimConcession" ADD COLUMN "signatures" JSONB;
ALTER TABLE "ClaimConcession" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- the earlier, form-less notes of ستاد: closed
UPDATE "ClaimConcession" SET "status" = 'DONE';
