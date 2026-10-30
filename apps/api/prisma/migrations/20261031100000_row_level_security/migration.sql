-- Database-level separation of organizations (row-level security).
--
-- The API tells the database who is asking, per query, inside a transaction (PrismaService):
--   app.tenant_id   — an organization's own screens (the tenant-scoped client): its private tables
--                     show only its own rows.
--   app.claim_party — an organization's claim screens: a case and everything under it (steps, field
--                     values, letters, documents, messages …) show only to the brokerage and the insurer
--                     named on it, or an organization taking part in it (ClaimParticipant).
-- When a setting is absent the rule is open: the public inquiry (one case per SMS-verified token), the
-- Super Admin, background jobs, migrations and maintenance scripts keep exactly the access they had.
--
-- NOTE: PostgreSQL superusers and BYPASSRLS roles skip these rules entirely. The running API must
-- connect as a limited role (deploy/rls-role.sh creates `omr_app`); migrations keep using the owner.

CREATE OR REPLACE FUNCTION rls_tenant() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.tenant_id', true), '') $$;

CREATE OR REPLACE FUNCTION rls_party() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.claim_party', true), '') $$;

-- ── Cases: the brokerage and the insurer named on them (and participants) ──
-- ClaimParticipant itself has no policy: the Claim rule reads it, and a policy there that read Claim
-- back would recurse.
ALTER TABLE "Claim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Claim" FORCE ROW LEVEL SECURITY;
CREATE POLICY claim_party ON "Claim" USING (
  rls_party() IS NULL
  OR "insurerTenantId" = rls_party()
  OR "brokerTenantId" = rls_party()
  OR EXISTS (SELECT 1 FROM "ClaimParticipant" p WHERE p."claimId" = "Claim"."id" AND p."tenantId" = rls_party())
);

-- Everything under a case follows the case (the inner Claim lookup is itself filtered by the rule above).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ClaimStep', 'ClaimFieldValue', 'ClaimFieldLog', 'ClaimLetter', 'ClaimDeficiency',
                           'ClaimPhysicalRequest', 'ClaimPhysicalEvent', 'InquiryMessage'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY claim_child ON %I USING (rls_party() IS NULL OR EXISTS (SELECT 1 FROM "Claim" c WHERE c."id" = %I."claimId"))', t, t);
  END LOOP;
END $$;

-- ── Each organization's private tables ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Branch', 'Role', 'OrgUser', 'CustomerAccount', 'InsuredParty', 'Beneficiary', 'Policy',
                           'Case', 'Payment', 'OtpChallenge', 'AuditLog', 'ApprovalLevel', 'RequiredDocument',
                           'ClaimFieldDef', 'ApiKey', 'Notification', 'PolicyholderCompany', 'Reminder'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_own ON %I USING (rls_tenant() IS NULL OR "tenantId" = rls_tenant())', t);
  END LOOP;
END $$;

-- Documents are both: an organization's own files, and the files of a case it takes part in.
ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Document" FORCE ROW LEVEL SECURITY;
CREATE POLICY document_access ON "Document" USING (
  (rls_tenant() IS NULL OR "tenantId" = rls_tenant())
  AND (rls_party() IS NULL OR "tenantId" = rls_party()
       OR ("claimId" IS NOT NULL AND EXISTS (SELECT 1 FROM "Claim" c WHERE c."id" = "Document"."claimId")))
);
