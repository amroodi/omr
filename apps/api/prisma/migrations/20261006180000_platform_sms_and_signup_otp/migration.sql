-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "smsUsePlatform" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smsUsePlatformRequested" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PlatformConfig" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "smsConfig" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("id")
);

