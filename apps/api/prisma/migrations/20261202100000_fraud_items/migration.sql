-- شعبه's four-point check in place of the single «تقلب» choice
ALTER TABLE "Claim" ADD COLUMN "fraudItems" JSONB;
