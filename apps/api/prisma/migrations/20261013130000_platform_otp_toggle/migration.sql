-- Super-admin master switch for OTP on login/inquiry/signup (default on).
ALTER TABLE "PlatformConfig" ADD COLUMN "otpEnabled" BOOLEAN NOT NULL DEFAULT true;
