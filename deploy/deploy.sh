#!/usr/bin/env bash
# Pull, build, migrate, and restart. Run on the server as the operator (needs sudo
# for the final systemctl restart):   bash /opt/omr/deploy/deploy.sh
set -euo pipefail

APP_DIR="/opt/omr"
API_ENV="/etc/omr/api.env"
# Must match the public URL Nginx serves the panel on. Baked into the web build.
PUBLIC_API_BASE="https://panel.damuon.com/api/v1"

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
sudo systemctl restart omr-api omr-web

echo "==> Done. Status:"
systemctl --no-pager --lines=0 status omr-api omr-web || true
