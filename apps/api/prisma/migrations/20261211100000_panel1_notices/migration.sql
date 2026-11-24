-- Panel 1 is no longer told about its own filings: the «ثبت پرونده خسارت» notices it was sent go.
DELETE FROM "NotificationRead" WHERE "notificationId" IN (
  SELECT "id" FROM "Notification" WHERE "audience" = 'ORG' AND "panel" = 'ENTRY' AND "title" = 'ثبت پرونده خسارت'
);
DELETE FROM "Notification" WHERE "audience" = 'ORG' AND "panel" = 'ENTRY' AND "title" = 'ثبت پرونده خسارت';

-- News of a case on panel 1 (approved, paid, rejected) is listed but no longer counted on the bell.
UPDATE "Notification" SET "kind" = 'INFO'
WHERE "audience" = 'ORG' AND "panel" = 'ENTRY' AND "title" IN ('تایید پرونده خسارت', 'پرداخت خسارت', 'رد پرونده خسارت');
