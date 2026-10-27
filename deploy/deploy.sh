#!/usr/bin/env bash
# Pull, build, migrate, and restart. Run AS THE omr USER:
#   sudo -u omr bash /opt/omr/deploy/deploy.sh
# The restart step uses passwordless sudo for omr — see DEPLOYMENT.md (/etc/sudoers.d/omr-deploy).
#
# PER-SERVER CONFIG lives in /etc/omr/api.env (never in git), so this script is identical on every
# server and `git pull --ff-only` never conflicts. Set these there for the web build:
#   PUBLIC_API_BASE=https://your-domain/api/v1     (required on a non-damuon server)
#   PUBLIC_TENANT_SLUG=your-slug                   (optional; default "damuon")
# A one-off run can still override, e.g.  PUBLIC_API_BASE=... bash deploy/deploy.sh
set -euo pipefail

APP_DIR="/opt/omr"
API_ENV="/etc/omr/api.env"

cd "$APP_DIR"

echo "==> Pulling latest code"
git pull --ff-only

echo "==> Installing dependencies (clean, includes build tools)"
npm ci

# Load per-server config. Capture any one-off shell overrides first so they win over api.env.
OVERRIDE_API_BASE="${PUBLIC_API_BASE:-}"
OVERRIDE_TENANT_SLUG="${PUBLIC_TENANT_SLUG:-}"
set -a; source "$API_ENV"; set +a          # DATABASE_URL (+ optional PUBLIC_* for the web build)
# Precedence: shell override > /etc/omr/api.env > built-in default.
PUBLIC_API_BASE="${OVERRIDE_API_BASE:-${PUBLIC_API_BASE:-https://omr.damuon.com/api/v1}}"
PUBLIC_TENANT_SLUG="${OVERRIDE_TENANT_SLUG:-${PUBLIC_TENANT_SLUG:-damuon}}"

echo "==> Prisma: generate client + apply migrations + sync system-role permissions + case numbers"
( cd apps/api && npx prisma generate && npx prisma migrate deploy && npx ts-node prisma/sync-roles.ts && npx ts-node prisma/renumber-claims.ts )

echo "==> Building API"
npm --workspace apps/api run build

echo "==> Building web (NEXT_PUBLIC_API_BASE=$PUBLIC_API_BASE, NEXT_PUBLIC_TENANT_SLUG=$PUBLIC_TENANT_SLUG)"
NEXT_PUBLIC_API_BASE="$PUBLIC_API_BASE" NEXT_PUBLIC_TENANT_SLUG="$PUBLIC_TENANT_SLUG" \
  npm --workspace apps/web run build

echo "==> Restarting services"
# Restarted one unit per call so a single NOPASSWD sudoers line can match each exactly.
sudo systemctl restart omr-api
sudo systemctl restart omr-web

echo "==> Done. Status:"
systemctl --no-pager --lines=0 status omr-api omr-web || true
