-- A removed نماینده stays in the table (their cases point at it) but is hidden and cannot sign in.
ALTER TABLE "CustomerAccount" ADD COLUMN "removedAt" TIMESTAMP(3);
