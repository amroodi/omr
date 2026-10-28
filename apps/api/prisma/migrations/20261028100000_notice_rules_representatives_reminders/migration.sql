-- Document reject reasons, «اعلام خسارت» rules, reminder SMS switch (per org).
ALTER TABLE "Tenant" ADD COLUMN "rejectReasons" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Tenant" ADD COLUMN "claimNoticeRules" JSONB;
ALTER TABLE "Tenant" ADD COLUMN "reminderSms" BOOLEAN NOT NULL DEFAULT false;
-- «شاهکار» identity check (super admin).
ALTER TABLE "PlatformConfig" ADD COLUMN "shahkarEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlatformConfig" ADD COLUMN "shahkarConfig" TEXT;
-- Operator mobile (reminder SMS).
ALTER TABLE "OrgUser" ADD COLUMN "phone" TEXT;
-- نماینده password login + شاهکار result.
ALTER TABLE "CustomerAccount" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "CustomerAccount" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerAccount" ADD COLUMN "shahkarVerifiedAt" TIMESTAMP(3);
-- Reminders.
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "claimId" TEXT,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "sms" BOOLEAN NOT NULL DEFAULT false,
    "firedAt" TIMESTAMP(3),
    "smsSentAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Reminder_tenantId_assigneeId_doneAt_idx" ON "Reminder"("tenantId", "assigneeId", "doneAt");
CREATE INDEX "Reminder_firedAt_dueAt_idx" ON "Reminder"("firedAt", "dueAt");
