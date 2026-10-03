-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('DEATH_ILLNESS', 'DEATH_ACCIDENT', 'DISABILITY_ACCIDENT');

-- AlterTable
ALTER TABLE "Claim" DROP COLUMN "causeOfDeath",
ADD COLUMN     "claimType" "ClaimType" NOT NULL DEFAULT 'DEATH_ILLNESS';

-- AlterTable
ALTER TABLE "RequiredDocument" DROP COLUMN "appliesTo",
ADD COLUMN     "appliesToTypes" "ClaimType"[];

-- DropEnum
DROP TYPE "CauseOfDeath";

-- DropEnum
DROP TYPE "DocAppliesTo";
