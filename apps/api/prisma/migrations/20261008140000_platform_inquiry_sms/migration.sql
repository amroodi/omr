-- Super-admin toggle: route quick-inquiry (استعلام سریع) OTPs through the platform SMS gateway.
ALTER TABLE "PlatformConfig" ADD COLUMN "inquiryUsePlatform" BOOLEAN NOT NULL DEFAULT true;
