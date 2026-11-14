-- Panel 3 login: phone (+OTP) or کد ملی + password, chosen by Super Admin
ALTER TABLE "PlatformConfig" ADD COLUMN "inquiryPhoneLogin" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE "InquiryPassword" (
  "nidHash" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InquiryPassword_pkey" PRIMARY KEY ("nidHash")
);
