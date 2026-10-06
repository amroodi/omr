-- CreateEnum
CREATE TYPE "CustomerSignupStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED');

-- AlterTable
ALTER TABLE "CustomerAccount" ADD COLUMN     "signupStatus" "CustomerSignupStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "smsConfig" TEXT;

