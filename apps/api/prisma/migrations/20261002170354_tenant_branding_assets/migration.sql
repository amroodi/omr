-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "faviconKey" TEXT,
ADD COLUMN     "fontKey" TEXT,
ADD COLUMN     "logoKey" TEXT,
ALTER COLUMN "primaryColor" SET DEFAULT '#ff9500',
ALTER COLUMN "fontFamily" SET DEFAULT 'Vazirmatn';
