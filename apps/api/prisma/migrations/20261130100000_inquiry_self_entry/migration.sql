-- panel 3 entry without a case (Super Admin «اعلام خسارت» on, کد ملی registered at فن‌آوران)
ALTER TABLE "OtpChallenge" ADD COLUMN "selfInsurerId" TEXT;
ALTER TABLE "OtpChallenge" ADD COLUMN "nidHash" TEXT;
