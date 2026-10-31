-- ذینفع / وراث قانونی of a case (name + شبا each, both encrypted by the API).
CREATE TABLE "ClaimHeir" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClaimHeir_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClaimHeir_claimId_idx" ON "ClaimHeir"("claimId");
ALTER TABLE "ClaimHeir" ADD CONSTRAINT "ClaimHeir_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Follows its case, like every other table under a claim (see 20261031100000_row_level_security).
ALTER TABLE "ClaimHeir" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClaimHeir" FORCE ROW LEVEL SECURITY;
CREATE POLICY claim_child ON "ClaimHeir" USING (rls_party() IS NULL OR EXISTS (SELECT 1 FROM "Claim" c WHERE c."id" = "ClaimHeir"."claimId"));
