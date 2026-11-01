-- «امنیت ورود»: sessions per sign-in, security alerts, alert settings, and device info on audit rows.
ALTER TABLE "PlatformConfig"
  ADD COLUMN "securityAlertsSms" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "securityAlertPhones" TEXT,
  ADD COLUMN "securityAlertKinds" TEXT[] DEFAULT ARRAY['NEW_DEVICE', 'CONCURRENT', 'IMPOSSIBLE_TRAVEL', 'SHARED_DEVICE', 'OFF_HOURS']::TEXT[],
  ADD COLUMN "securityAlertRealms" TEXT[] DEFAULT ARRAY['ORG', 'SUPER']::TEXT[],
  ADD COLUMN "workHoursStart" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "workHoursEnd" INTEGER NOT NULL DEFAULT 22,
  ADD COLUMN "offHoursFriday" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "AuditLog"
  ADD COLUMN "deviceId" TEXT,
  ADD COLUMN "fingerprint" TEXT,
  ADD COLUMN "deviceLabel" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "sessionId" TEXT;

CREATE TABLE "LoginSession" (
    "id" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorLabel" TEXT,
    "tenantId" TEXT,
    "tenantName" TEXT,
    "deviceId" TEXT,
    "fingerprint" TEXT,
    "deviceLabel" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "location" TEXT,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "endedBy" TEXT,
    CONSTRAINT "LoginSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LoginSession_realm_actorId_createdAt_idx" ON "LoginSession"("realm", "actorId", "createdAt");
CREATE INDEX "LoginSession_deviceId_idx" ON "LoginSession"("deviceId");
CREATE INDEX "LoginSession_fingerprint_idx" ON "LoginSession"("fingerprint");
CREATE INDEX "LoginSession_endedAt_lastSeenAt_idx" ON "LoginSession"("endedAt", "lastSeenAt");

CREATE TABLE "SecurityAlert" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorLabel" TEXT,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "smsSent" BOOLEAN NOT NULL DEFAULT false,
    "seenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecurityAlert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SecurityAlert_createdAt_idx" ON "SecurityAlert"("createdAt");
CREATE INDEX "SecurityAlert_seenAt_idx" ON "SecurityAlert"("seenAt");
ALTER TABLE "SecurityAlert" ADD CONSTRAINT "SecurityAlert_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LoginSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
