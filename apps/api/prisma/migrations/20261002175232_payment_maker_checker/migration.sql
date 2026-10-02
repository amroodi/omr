-- CreateEnum
CREATE TYPE "PaymentApproval" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_PROPOSE';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_APPROVE';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_REJECT';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "approval" "PaymentApproval" NOT NULL DEFAULT 'PENDING_APPROVAL',
ADD COLUMN     "approvalNote" TEXT,
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "proposedById" TEXT;

-- CreateIndex
CREATE INDEX "Payment_tenantId_approval_idx" ON "Payment"("tenantId", "approval");
