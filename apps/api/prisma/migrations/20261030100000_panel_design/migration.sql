-- Per-panel themes and logos (each falls back to the organization's own theme / logo).
ALTER TABLE "Tenant" ADD COLUMN "panelThemes" JSONB;
ALTER TABLE "Tenant" ADD COLUMN "panelLogos" JSONB;
