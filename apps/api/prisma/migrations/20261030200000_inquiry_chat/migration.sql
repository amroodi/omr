-- «گفتگو»: two-way inquiry chat between the requester and the کارگزاری
ALTER TABLE "InquiryMessage" ADD COLUMN "phoneIdx" TEXT;
ALTER TABLE "InquiryMessage" ADD COLUMN "fromStaff" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InquiryMessage" ADD COLUMN "replyToId" TEXT;
ALTER TABLE "InquiryMessage" ADD COLUMN "authorId" TEXT;
CREATE INDEX "InquiryMessage_claimId_phoneIdx_idx" ON "InquiryMessage"("claimId", "phoneIdx");
CREATE INDEX "InquiryMessage_replyToId_idx" ON "InquiryMessage"("replyToId");
