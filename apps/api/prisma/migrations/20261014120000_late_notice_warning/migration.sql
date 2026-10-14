-- Per-org toggle to show/hide the "خارج از مهلت مقرر" late-notice warning on claims.
ALTER TABLE "Tenant" ADD COLUMN "lateNoticeWarning" BOOLEAN NOT NULL DEFAULT true;
