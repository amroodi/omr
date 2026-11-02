-- «علت فوت» → «علت خسارت»; a label an insurer edited itself stays.
UPDATE "ClaimFieldDef" SET "label" = 'علت خسارت' WHERE "key" = 'cause_of_death' AND "label" = 'علت فوت';
