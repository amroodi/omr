-- Alborz: شعبه records «اعلام خسارت» with one click (no number / date). Editable later in Super Admin › Model View.
UPDATE "Tenant" SET "workflowModel" = jsonb_set(COALESCE("workflowModel"::jsonb, '{}'::jsonb), '{lossNoticeAsksNumber}', 'false'::jsonb)
WHERE slug = 'alborz';
