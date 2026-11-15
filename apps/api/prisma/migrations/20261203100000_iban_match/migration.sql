-- «تطابق شبا و کد ملی» of ذینفعان: Super Admin's switch and the provider's settings
ALTER TABLE "PlatformConfig" ADD COLUMN "ibanMatchEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlatformConfig" ADD COLUMN "ibanMatchConfig" TEXT;
