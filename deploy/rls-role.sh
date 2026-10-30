#!/usr/bin/env bash
# One-time setup: a LIMITED database role for the running API, so PostgreSQL's row-level security
# (migration row_level_security) is actually enforced. The `omr` role from postgres.compose.yml is a
# superuser, and superusers skip row-level security — it stays for migrations and maintenance only.
#
# Run on the server (as a user that can use docker):
#   OMR_APP_PASSWORD='a-long-random-password' bash /opt/omr/deploy/rls-role.sh
# Then in /etc/omr/api.env:
#   MIGRATE_DATABASE_URL="postgresql://omr:<omr password>@127.0.0.1:15987/omr_damuon?schema=public"
#   DATABASE_URL="postgresql://omr_app:<OMR_APP_PASSWORD>@127.0.0.1:15987/omr_damuon?schema=public&connection_limit=10"
# and deploy as usual (deploy.sh runs migrations with MIGRATE_DATABASE_URL when it is set).
# Safe to run again (e.g. to change the password).
set -euo pipefail

: "${OMR_APP_PASSWORD:?set OMR_APP_PASSWORD (password for the new role)}"
CONTAINER="${DB_CONTAINER:-omr-postgres}"
OWNER="${DB_OWNER:-omr}"
DB="${DB_NAME:-omr_damuon}"
ROLE="${APP_ROLE:-omr_app}"

docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$OWNER" -d "$DB" -v role="$ROLE" -v pw="$OMR_APP_PASSWORD" -v owner="$OWNER" -v db="$DB" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE', :'role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
ALTER ROLE :"role" WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'pw';
GRANT CONNECT ON DATABASE :"db" TO :"role";
GRANT USAGE ON SCHEMA public TO :"role";
-- Read and write data only: no DDL, no owning anything.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"role";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO :"role";
-- Tables added by future migrations (created by the owner) get the same rights.
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO :"role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO :"role";
-- The migration history is the owner's business.
REVOKE INSERT, UPDATE, DELETE ON "_prisma_migrations" FROM :"role";
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = :'role';
SQL
echo "==> Role $ROLE ready. Point DATABASE_URL at it (see the top of this file) and redeploy."
