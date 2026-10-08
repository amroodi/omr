-- Quick-inquiry can now unlock a new-model Claim (self-service بیمه‌گزار), not just a legacy Case.
ALTER TABLE "OtpChallenge" ADD COLUMN "claimId" TEXT;
