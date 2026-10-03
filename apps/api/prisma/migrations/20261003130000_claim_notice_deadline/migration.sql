-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "eventDate" TIMESTAMP(3),
ADD COLUMN     "lateNotice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "noticeDeadline" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "noticeDays" INTEGER NOT NULL DEFAULT 30;
