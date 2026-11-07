-- «روند سیناد»: the شعبه evaluator's kartable (allocation, پزشک معتمد, fraud check) — on for Alborz.
ALTER TABLE "Claim" ADD COLUMN "evaluatorId" TEXT;
ALTER TABLE "Claim" ADD COLUMN "evaluatorAt" TIMESTAMP(3);
ALTER TABLE "Claim" ADD COLUMN "evaluatorLater" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Claim" ADD COLUMN "doctorState" TEXT;
ALTER TABLE "Claim" ADD COLUMN "doctorNote" TEXT;
ALTER TABLE "Claim" ADD COLUMN "fraudCheck" TEXT;
CREATE INDEX "Claim_evaluatorId_idx" ON "Claim"("evaluatorId");

CREATE TABLE "ClaimDeskEvent" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClaimDeskEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClaimDeskEvent_claimId_createdAt_idx" ON "ClaimDeskEvent"("claimId", "createdAt");
ALTER TABLE "ClaimDeskEvent" ADD CONSTRAINT "ClaimDeskEvent_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Alborz uses it. Editable later in Super Admin › Model View.
UPDATE "Tenant" SET "workflowModel" = jsonb_set(COALESCE("workflowModel"::jsonb, '{}'::jsonb), '{sinad}', '{"enabled": true}'::jsonb)
WHERE slug = 'alborz';

-- Alborz panel 1: a case with a کارگزاری (Damuon) starts at the کارگزاری; Alborz's own direct case at شعبه.
UPDATE "Tenant" SET "workflowModel" = jsonb_set(COALESCE("workflowModel"::jsonb, '{}'::jsonb), '{entry}', '{"way": "CHANNEL"}'::jsonb)
WHERE slug = 'alborz';
