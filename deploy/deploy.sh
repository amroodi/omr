#!/usr/bin/env bash
# Pull, build, migrate, and restart. Run AS THE omr USER:
#   sudo -u omr bash /opt/omr/deploy/deploy.sh
# The restart step uses passwordless sudo for omr — see deploy/README or DEPLOYMENT.md
# (/etc/sudoers.d/omr-deploy). Override the public URL with: PUBLIC_API_BASE=... before the command.
set -euo pipefail

APP_DIR="/opt/omr"
API_ENV="/etc/omr/api.env"
# Public URL Nginx serves the panel on, baked into the web build. Override via env if needed.
PUBLIC_API_BASE="${PUBLIC_API_BASE:-https://omr.damuon.com/api/v1}"

cd "$APP_DIR"

echo "==> Pulling latest code"
git pull --ff-only

echo "==> Installing dependencies (clean, includes build tools)"
npm ci

echo "==> Prisma: generate client + apply migrations + sync system-role permissions"
set -a; source "$API_ENV"; set +a          # export DATABASE_URL for prisma
( cd apps/api && npx prisma generate && npx prisma migrate deploy && npx ts-node prisma/sync-roles.ts )

echo "==> Building API"
npm --workspace apps/api run build

echo "==> Building web (NEXT_PUBLIC_API_BASE=$PUBLIC_API_BASE)"
NEXT_PUBLIC_API_BASE="$PUBLIC_API_BASE" npm --workspace apps/web run build

echo "==> Restarting services"
# Restarted one unit per call so a single NOPASSWD sudoers line can match each exactly.
sudo systemctl restart omr-api
sudo systemctl restart omr-web

echo "==> Done. Status:"
systemctl --no-pager --lines=0 status omr-api omr-web || true
