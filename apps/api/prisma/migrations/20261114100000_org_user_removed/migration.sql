-- «حذف» of an organization user: hidden and signed out, kept for attribution.
ALTER TABLE "OrgUser" ADD COLUMN "removedAt" TIMESTAMP(3);
