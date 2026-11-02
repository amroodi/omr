-- Model View: per-insurer workflow settings (NULL = the defaults, today's behaviour)
ALTER TABLE "Tenant" ADD COLUMN "workflowModel" JSONB;
