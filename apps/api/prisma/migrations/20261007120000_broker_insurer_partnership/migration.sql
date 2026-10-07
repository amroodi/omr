-- CreateTable
CREATE TABLE "BrokerInsurerPartnership" (
    "id" TEXT NOT NULL,
    "brokerTenantId" TEXT NOT NULL,
    "insurerTenantId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrokerInsurerPartnership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrokerInsurerPartnership_brokerTenantId_idx" ON "BrokerInsurerPartnership"("brokerTenantId");

-- CreateIndex
CREATE INDEX "BrokerInsurerPartnership_insurerTenantId_idx" ON "BrokerInsurerPartnership"("insurerTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BrokerInsurerPartnership_brokerTenantId_insurerTenantId_key" ON "BrokerInsurerPartnership"("brokerTenantId", "insurerTenantId");

