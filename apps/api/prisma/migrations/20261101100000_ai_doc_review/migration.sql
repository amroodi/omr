-- «بررسی هوشمند مدارک»: AI check that each uploaded file is the document of its slot.
ALTER TABLE "PlatformConfig" ADD COLUMN "aiReviewEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlatformConfig" ADD COLUMN "aiConfig" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "aiReviewEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Document" ADD COLUMN "aiStatus" TEXT;
ALTER TABLE "Document" ADD COLUMN "aiDetectedCode" TEXT;
ALTER TABLE "Document" ADD COLUMN "aiConfidence" DOUBLE PRECISION;
ALTER TABLE "Document" ADD COLUMN "aiReason" TEXT;
ALTER TABLE "Document" ADD COLUMN "aiCheckedAt" TIMESTAMP(3);
ALTER TABLE "Document" ADD COLUMN "aiRequestId" TEXT;

CREATE TABLE "AiDocPrompt" (
    "code" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiDocPrompt_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "AiReviewJob" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "notifyPhone" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiReviewJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiReviewJob_documentId_key" ON "AiReviewJob"("documentId");
CREATE INDEX "AiReviewJob_status_runAfter_idx" ON "AiReviewJob"("status", "runAfter");
CREATE INDEX "AiReviewJob_claimId_status_idx" ON "AiReviewJob"("claimId", "status");

CREATE TABLE "CaseUploadLink" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "phone" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CaseUploadLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CaseUploadLink_tokenHash_key" ON "CaseUploadLink"("tokenHash");
CREATE INDEX "CaseUploadLink_claimId_idx" ON "CaseUploadLink"("claimId");

-- The API's limited role (deploy/rls-role.sh) needs rights on the new tables too.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omr_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AiDocPrompt", "AiReviewJob", "CaseUploadLink" TO omr_app;
  END IF;
END $$;
