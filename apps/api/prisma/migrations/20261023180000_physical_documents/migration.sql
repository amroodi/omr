-- Physical (original) documents: custody on the claim + request/event log.
CREATE TYPE "PhysicalStatus" AS ENUM ('REQUESTED', 'SENT', 'RECEIVED');

ALTER TABLE "Claim" ADD COLUMN "physicalAt" "WorkflowStage";
ALTER TABLE "ClaimLetter" ADD COLUMN "physicalEventId" TEXT;

CREATE TABLE "ClaimPhysicalRequest" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "requesterStage" "WorkflowStage" NOT NULL,
    "holderStage" "WorkflowStage" NOT NULL,
    "status" "PhysicalStatus" NOT NULL DEFAULT 'REQUESTED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    CONSTRAINT "ClaimPhysicalRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClaimPhysicalRequest_claimId_status_idx" ON "ClaimPhysicalRequest"("claimId", "status");
ALTER TABLE "ClaimPhysicalRequest" ADD CONSTRAINT "ClaimPhysicalRequest_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ClaimPhysicalEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "stage" "WorkflowStage" NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "trackingNo" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClaimPhysicalEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClaimPhysicalEvent_claimId_idx" ON "ClaimPhysicalEvent"("claimId");
CREATE INDEX "ClaimPhysicalEvent_requestId_idx" ON "ClaimPhysicalEvent"("requestId");
ALTER TABLE "ClaimPhysicalEvent" ADD CONSTRAINT "ClaimPhysicalEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClaimPhysicalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
