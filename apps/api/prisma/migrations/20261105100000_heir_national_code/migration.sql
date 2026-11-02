-- کد ملی of each ذینفع
ALTER TABLE "ClaimHeir" ADD COLUMN "nationalCode" TEXT;

-- «فرم تعیین/تغییر ذینفع»: only the catalog's own wording is renamed, an insurer's edited label stays.
UPDATE "RequiredDocument" SET "label" = 'فرم تعیین/تغییر ذینفع بدون خط‌خوردگی و با امضاء بیمه‌شده و با مهر تأیید بیمه‌گزار.'
WHERE "code" = 'beneficiary_form' AND "label" = 'اصل فرم تعیین ذینفع بدون خط‌خوردگی و با امضاء بیمه‌شده و با مهر تأیید بیمه‌گزار.';
