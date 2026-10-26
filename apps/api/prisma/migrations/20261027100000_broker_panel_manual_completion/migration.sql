-- Brokerage: manual case completion switch + «broker» login of the بیمه‌گزار panel; company default-password flag.
ALTER TABLE "Tenant" ADD COLUMN "manualCompletion" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tenant" ADD COLUMN "brokerPanelPasswordHash" TEXT;
ALTER TABLE "PolicyholderCompany" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
