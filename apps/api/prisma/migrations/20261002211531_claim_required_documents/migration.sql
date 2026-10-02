-- CreateEnum
CREATE TYPE "CauseOfDeath" AS ENUM ('NATURAL', 'ACCIDENT');

-- CreateEnum
CREATE TYPE "DocAppliesTo" AS ENUM ('NATURAL', 'ACCIDENT', 'BOTH');

-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "causeOfDeath" "CauseOfDeath" NOT NULL DEFAULT 'NATURAL';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "docCode" TEXT;

-- CreateTable
CREATE TABLE "RequiredDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "appliesTo" "DocAppliesTo" NOT NULL DEFAULT 'BOTH',
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequiredDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequiredDocument_tenantId_idx" ON "RequiredDocument"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "RequiredDocument_tenantId_code_key" ON "RequiredDocument"("tenantId", "code");

-- AddForeignKey
ALTER TABLE "RequiredDocument" ADD CONSTRAINT "RequiredDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
