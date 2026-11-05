#!/usr/bin/env bash
# Moving to a new server, part 1 — run on the OLD server, as root:
#   sudo bash /opt/omr/deploy/move-export.sh
#
# Stops the site (so nothing changes after the copy), then packs into /root/omr-move/:
#   omr_damuon.dump    the database (pg_dump custom format)
#   roles.sql          the database roles (omr, and omr_app when row-level security is set up)
#   storage.tar.gz     the uploaded documents (/var/lib/omr/storage, encrypted at rest) + geoip, if any
#   api.env            /etc/omr/api.env — the SECRETS (encryption key, pepper, JWT, DB and SMS passwords)
#   nginx-omr.conf     the Nginx site;  letsencrypt.tar.gz  the TLS certificates (HTTPS works at once)
#   crontab-*.txt      any cron jobs (backups etc.) to set up again by hand
#   node-version.txt   so the new server installs the same Node major
#   SHA256SUMS         checked on the new server
#
# The site stays STOPPED afterwards. To cancel the move: systemctl start omr-api omr-web
set -euo pipefail

OUT="${OUT:-/root/omr-move}"
CONTAINER="${DB_CONTAINER:-omr-postgres}"
OWNER="${DB_OWNER:-omr}"
DB="${DB_NAME:-omr_damuon}"
SITE="${NGINX_SITE:-/etc/nginx/sites-available/omr}"

[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)."; exit 1; }
docker inspect "$CONTAINER" >/dev/null 2>&1 || { echo "Postgres container «$CONTAINER» not found (set DB_CONTAINER=…)."; exit 1; }

mkdir -p "$OUT"; chmod 700 "$OUT"; cd "$OUT"
rm -f omr_damuon.dump roles.sql storage.tar.gz geoip.tar.gz api.env nginx-omr.conf letsencrypt.tar.gz crontab-*.txt node-version.txt SHA256SUMS

echo "==> Stopping the site (no changes after the copy)"
systemctl stop omr-web omr-api || true

echo "==> Database: roles + dump"
docker exec "$CONTAINER" pg_dumpall -U "$OWNER" --roles-only > roles.sql
docker exec "$CONTAINER" pg_dump -U "$OWNER" -Fc "$DB" > omr_damuon.dump
[ -s omr_damuon.dump ] || { echo "!! The database dump is empty — stopping."; exit 1; }

echo "==> Uploaded documents"
STORAGE_DIR="$(set -a; . /etc/omr/api.env; echo "${STORAGE_DIR:-/var/lib/omr/storage}")"
tar czf storage.tar.gz -C "$(dirname "$STORAGE_DIR")" "$(basename "$STORAGE_DIR")"
if [ -d /var/lib/omr/geoip ]; then tar czf geoip.tar.gz -C /var/lib/omr geoip; fi
echo "   documents: $(find "$STORAGE_DIR" -type f | wc -l) files"

echo "==> Secrets, Nginx, TLS, cron"
cp /etc/omr/api.env api.env
if [ -f "$SITE" ]; then cp "$SITE" nginx-omr.conf; else echo "   (no $SITE — set NGINX_SITE=… or copy the Nginx config by hand)"; fi
if [ -d /etc/letsencrypt ]; then tar czf letsencrypt.tar.gz -C /etc letsencrypt; fi
crontab -l -u omr > crontab-omr.txt 2>/dev/null || true
crontab -l > crontab-root.txt 2>/dev/null || true
node -v > node-version.txt 2>/dev/null || echo v20 > node-version.txt

sha256sum ./* > SHA256SUMS
chmod 600 ./*
echo
ls -lh "$OUT"
echo
echo "==> Done. Copy $OUT to the new server, e.g. from the NEW server:"
echo "     rsync -av root@<OLD-IP>:$OUT/ /root/omr-move/"
echo "   The site here stays stopped. api.env holds every secret — keep the copy private."
