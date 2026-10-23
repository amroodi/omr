-- Backfill for workflow v2 (separate migration: a new enum value can't be used in the transaction that adds it).

-- The old COUNCIL checkpoint was "central management" → it is مدیریت ستاد (HQ) now.
UPDATE "DocumentReview" SET "stage" = 'HQ' WHERE "stage" = 'COUNCIL';

-- Tag existing steps with their desk.
UPDATE "ClaimStep" s SET "stage" = CASE
    WHEN s."partyType" = 'POLICYHOLDER' THEN 'POLICYHOLDER'::"WorkflowStage"
    WHEN s."partyType" = 'MOAREF' AND c."brokerTenantId" IS NOT NULL THEN 'BROKER'::"WorkflowStage"
    WHEN s."partyType" = 'MOAREF' THEN 'BRANCH'::"WorkflowStage"
    ELSE 'HQ'::"WorkflowStage" END,
  "purpose" = CASE WHEN s."partyType" = 'POLICYHOLDER' THEN 'DEFICIENCY'::"FlowPurpose" ELSE 'REVIEW'::"FlowPurpose" END
FROM "Claim" c WHERE c."id" = s."claimId";

-- Handling branch defaults to the selling branch (DIRECT channel).
UPDATE "Claim" SET "handlingBranchId" = "sellingBranchId" WHERE "sellingBranchId" IS NOT NULL;

-- Place each open claim at the desk of its pending step.
UPDATE "Claim" c SET
  "currentStage" = s."stage",
  "flowDirection" = CASE WHEN s."stage" = 'POLICYHOLDER' THEN 'DOWN'::"FlowDirection" ELSE 'UP'::"FlowDirection" END,
  "flowPurpose" = s."purpose"
FROM "ClaimStep" s
WHERE s."claimId" = c."id" AND s."state" = 'PENDING' AND c."imported" = false
  AND c."status" IN ('SUBMITTED', 'UNDER_REVIEW', 'RETURNED_INCOMPLETE');

-- Approved-but-unpaid claims wait at شعبه for payout.
UPDATE "Claim" SET "currentStage" = 'BRANCH', "flowDirection" = 'DOWN', "flowPurpose" = 'PAYMENT'
WHERE "status" = 'APPROVED' AND "imported" = false;
