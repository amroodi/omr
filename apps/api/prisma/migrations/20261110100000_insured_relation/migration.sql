-- نوع بیمه‌شده: a case is for the main insured or for one of their dependents; نسبت of each ذینفع.
ALTER TABLE "Claim" ADD COLUMN "insuredRelation" TEXT;
ALTER TABLE "Claim" ADD COLUMN "mainInsuredName" TEXT;
ALTER TABLE "Claim" ADD COLUMN "mainInsuredNationalCode" TEXT;
ALTER TABLE "Claim" ADD COLUMN "mainInsuredNationalCodeHash" TEXT;
CREATE INDEX "Claim_mainInsuredNationalCodeHash_idx" ON "Claim"("mainInsuredNationalCodeHash");
ALTER TABLE "ClaimHeir" ADD COLUMN "relation" TEXT;
