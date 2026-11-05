#!/usr/bin/env bash
# Moving to a new server, part 2 — run on the NEW server (fresh Ubuntu 22.04/24.04), as root, after the
# files from move-export.sh are in /root/omr-move/:
#   curl -fsSL https://raw.githubusercontent.com/amroodi/omr/main/deploy/move-import.sh -o /root/move-import.sh
#   sudo bash /root/move-import.sh
#
# Sets the server up as docs/DEPLOYMENT.md does (packages, Node, Docker, firewall, the omr user, the code),
# restores the database, the documents, the secrets, Nginx and TLS, installs the services, and runs
# deploy.sh (builds the latest main and applies its migrations). DNS is NOT changed — test first.
set -euo pipefail

IN="${IN:-/root/omr-move}"
REPO="${REPO:-https://github.com/amroodi/omr.git}"
CONTAINER="omr-postgres"; DB="omr_damuon"

[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)."; exit 1; }
cd "$IN"
echo "==> Checking the copied files"
sha256sum -c SHA256SUMS

echo "==> Packages, firewall"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl ca-certificates gnupg build-essential ufw nginx certbot python3-certbot-nginx
ufw allow OpenSSH; ufw allow 80/tcp; ufw allow 443/tcp; ufw --force enable

NODE_MAJOR="$(sed -E 's/^v?([0-9]+).*/\1/' node-version.txt)"; NODE_MAJOR="${NODE_MAJOR:-20}"
if ! node -v 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; then
  echo "==> Node.js ${NODE_MAJOR} (same as the old server)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
command -v docker >/dev/null || { echo "==> Docker"; curl -fsSL https://get.docker.com | sh; }

echo "==> The omr user, folders, code"
id omr >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash omr
usermod -aG docker omr
mkdir -p /opt/omr /etc/omr /var/lib/omr
[ -d /opt/omr/.git ] || { rm -rf /opt/omr; git clone "$REPO" /opt/omr; }
chown -R omr:omr /opt/omr /var/lib/omr /etc/omr; chmod 750 /etc/omr

echo "==> Secrets"
install -o omr -g omr -m 600 "$IN/api.env" /etc/omr/api.env
set -a; source /etc/omr/api.env; set +a
STORAGE_DIR="${STORAGE_DIR:-/var/lib/omr/storage}"
# The database owner's password, from the old server's URL (migrations use it).
OWNER_URL="${MIGRATE_DATABASE_URL:-$DATABASE_URL}"
PGPASS="$(U="$OWNER_URL" node -e 'console.log(decodeURIComponent(new URL(process.env.U).password))')"
OWNER="$(U="$OWNER_URL" node -e 'console.log(decodeURIComponent(new URL(process.env.U).username))')"
[ "$OWNER" = omr ] || echo "   (note: the database owner in api.env is «$OWNER», postgres.compose.yml creates «omr»)"

echo "==> PostgreSQL (docker, 127.0.0.1:15987)"
( cd /opt/omr && POSTGRES_PASSWORD="$PGPASS" docker compose -f deploy/postgres.compose.yml up -d )
for i in $(seq 1 60); do docker exec "$CONTAINER" pg_isready -U omr -d "$DB" >/dev/null 2>&1 && break; sleep 2; done
docker exec "$CONTAINER" pg_isready -U omr -d "$DB"

echo "==> Restoring the database"
# Roles first (omr_app for row-level security); «already exists» for omr is expected.
docker exec -i "$CONTAINER" psql -U omr -d postgres -q < "$IN/roles.sql" || true
# (a few warnings about the public schema / extensions are harmless; the counts below are what matter)
docker exec -i "$CONTAINER" pg_restore -U omr -d "$DB" --clean --if-exists < "$IN/omr_damuon.dump" || true
CASES="$(docker exec "$CONTAINER" psql -U omr -d "$DB" -tAc 'select count(*) from "Claim"' 2>/dev/null || echo 0)"
ORGS="$(docker exec "$CONTAINER" psql -U omr -d "$DB" -tAc 'select count(*) from "Tenant"' 2>/dev/null || echo 0)"
echo "   restored: $ORGS organizations, $CASES cases (compare with the old server)"
[ "${ORGS:-0}" -gt 0 ] || { echo "!! The database did not restore — stopping."; exit 1; }

echo "==> Uploaded documents"
mkdir -p "$(dirname "$STORAGE_DIR")"
tar xzf "$IN/storage.tar.gz" -C "$(dirname "$STORAGE_DIR")"
if [ -f "$IN/geoip.tar.gz" ]; then tar xzf "$IN/geoip.tar.gz" -C /var/lib/omr; fi
chown -R omr:omr /var/lib/omr "$STORAGE_DIR"
echo "   documents: $(find "$STORAGE_DIR" -type f | wc -l) files (compare with the old server)"

echo "==> Services"
cp /opt/omr/deploy/omr-api.service /opt/omr/deploy/omr-web.service /etc/systemd/system/
echo 'omr ALL=(root) NOPASSWD: /usr/bin/systemctl restart omr-api, /usr/bin/systemctl restart omr-web, /usr/bin/systemctl start omr-api, /usr/bin/systemctl start omr-web, /usr/bin/systemctl stop omr-api, /usr/bin/systemctl stop omr-web' > /etc/sudoers.d/omr-deploy
chmod 440 /etc/sudoers.d/omr-deploy
systemctl daemon-reload
systemctl enable omr-api omr-web

echo "==> Nginx + TLS"
if [ -f "$IN/letsencrypt.tar.gz" ]; then tar xzf "$IN/letsencrypt.tar.gz" -C /etc; fi
if [ -f "$IN/nginx-omr.conf" ]; then
  cp "$IN/nginx-omr.conf" /etc/nginx/sites-available/omr
  ln -sf /etc/nginx/sites-available/omr /etc/nginx/sites-enabled/omr
  rm -f /etc/nginx/sites-enabled/default
fi
nginx -t && systemctl reload nginx

echo "==> Build and start (deploy.sh: latest main, migrations, builds, restart)"
sudo -u omr bash /opt/omr/deploy/deploy.sh

echo
echo "==> Done on this server. Cron jobs from the old one (set up again by hand if needed):"
cat "$IN"/crontab-*.txt 2>/dev/null || true
echo
echo "Test BEFORE changing DNS (replace the domain and this server's IP):"
echo "  curl -s --resolve omr.damuon.com:443:<NEW-IP> https://omr.damuon.com/api/v1/health"
