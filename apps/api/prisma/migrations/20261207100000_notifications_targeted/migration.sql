-- Notifications: per-user read state of shared notices, the desk / branch / panel a notice is for, and
-- colleagues' activity kept apart from things to do.
ALTER TABLE "Notification" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'ACTION';
ALTER TABLE "Notification" ADD COLUMN "stage" TEXT;
ALTER TABLE "Notification" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "panel" TEXT;
ALTER TABLE "Notification" ADD COLUMN "claimId" TEXT;
CREATE INDEX "Notification_tenantId_createdAt_idx" ON "Notification"("tenantId", "createdAt");
-- the admins' activity notes so far (personal, not reminders)
UPDATE "Notification" SET "kind" = 'ACTIVITY' WHERE "audience" = 'ORG' AND "recipientId" IS NOT NULL AND "title" NOT LIKE 'یادآور%';

CREATE TABLE "NotificationRead" (
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("notificationId","userId")
);
CREATE INDEX "NotificationRead_userId_idx" ON "NotificationRead"("userId");
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- شعبه: do the originals received match the uploaded copies?
ALTER TABLE "ClaimPhysicalRequest" ADD COLUMN "matchState" TEXT;
ALTER TABLE "ClaimPhysicalRequest" ADD COLUMN "matchNote" TEXT;
ALTER TABLE "ClaimPhysicalRequest" ADD COLUMN "matchedAt" TIMESTAMP(3);
ALTER TABLE "ClaimPhysicalRequest" ADD COLUMN "matchedById" TEXT;

-- «پیامک کد پذیرش»: Super Admin's settings, and when a case's code was sent
ALTER TABLE "PlatformConfig" ADD COLUMN "receiptSms" JSONB;
ALTER TABLE "Claim" ADD COLUMN "receiptSmsAt" TIMESTAMP(3);
