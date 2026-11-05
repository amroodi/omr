#!/usr/bin/env bash
# Daily backup of the database and the uploaded documents — run by omr-backup.timer (as root), or by hand:
#   sudo bash /opt/omr/deploy/backup.sh
#
# On this server, in /var/backups/omr (root only):
#   db/omr_<date>.dump          the whole database (pg_dump custom format; restore with pg_restore)
#   storage/<date>/             a snapshot of the documents — unchanged files are hard links to the day
#                               before, so 14 days of snapshots take little more space than one copy
# The newest BACKUP_KEEP_DAYS of each are kept (default 14 — two weeks of nightly runs).
#
# Off the server (recommended — a backup on the same disk dies with the disk): set in /etc/omr/api.env
#   BACKUP_REMOTE="backup@203.0.113.7:/srv/omr-backups"   # an SSH destination (another server / NAS)
#   BACKUP_REMOTE_PORT="22"                               # its SSH port
#   BACKUP_SSH_KEY="/root/.ssh/omr_backup"                # a key that may log in there (no password)
# and every run copies /var/backups/omr there too (mirrored: same days kept).
#
# NOT in the backup, on purpose: /etc/omr/api.env. The documents and personal data are encrypted with the
# keys in it; keep a copy of it OFFLINE (password manager / USB), never next to the backups. Without it a
# restore is unreadable; with it next to the backups, the encryption protects nothing.
set -euo pipefail

API_ENV="${API_ENV:-/etc/omr/api.env}"
set -a; . "$API_ENV"; set +a
DEST="${BACKUP_DIR:-/var/backups/omr}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
CONTAINER="${DB_CONTAINER:-omr-postgres}"
DB="${DB_NAME:-omr_damuon}"
OWNER="${DB_OWNER:-omr}"
STORAGE="${STORAGE_DIR:-/var/lib/omr/storage}"
NOW="$(TZ=Asia/Tehran date +%Y-%m-%d_%H%M)"

umask 077
mkdir -p "$DEST/db" "$DEST/storage"
chmod 700 "$DEST"
log() { echo "[$(TZ=Asia/Tehran date '+%F %T')] $*"; }

log "Database → $DEST/db/omr_$NOW.dump"
docker exec "$CONTAINER" pg_dump -U "$OWNER" -Fc "$DB" > "$DEST/db/omr_$NOW.dump.part"
# A dump that pg_restore can't read is no backup: check it before keeping it.
docker exec -i "$CONTAINER" pg_restore --list < "$DEST/db/omr_$NOW.dump.part" > /dev/null
mv "$DEST/db/omr_$NOW.dump.part" "$DEST/db/omr_$NOW.dump"

log "Documents → $DEST/storage/$NOW"
if [ -d "$DEST/storage/latest" ]; then LINK=(--link-dest="$DEST/storage/latest"); else LINK=(); fi
rsync -a --delete "${LINK[@]}" "$STORAGE/" "$DEST/storage/$NOW.part/"
mv "$DEST/storage/$NOW.part" "$DEST/storage/$NOW"
ln -sfn "$NOW" "$DEST/storage/latest"

log "Keeping the newest $KEEP of each"
# By name (the date is in it), not by file time: rsync -a gives a snapshot the documents folder's own time.
find "$DEST/db" -maxdepth 1 -name '*.part' -delete
find "$DEST/storage" -mindepth 1 -maxdepth 1 -type d -name '*.part' -exec rm -rf {} +
ls -1 "$DEST/db" | grep -E '^omr_.*\.dump$' | sort | head -n "-$KEEP" | while read -r f; do rm -f "$DEST/db/$f"; done
find "$DEST/storage" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort | head -n "-$KEEP" | while read -r d; do rm -rf "${DEST:?}/storage/$d"; done

if [ -n "${BACKUP_REMOTE:-}" ]; then
  log "Copying off the server → $BACKUP_REMOTE"
  rsync -a -H --delete -e "ssh -p ${BACKUP_REMOTE_PORT:-22} -i ${BACKUP_SSH_KEY:-/root/.ssh/omr_backup} -o BatchMode=yes -o StrictHostKeyChecking=accept-new" \
    "$DEST/" "$BACKUP_REMOTE/"
else
  log "BACKUP_REMOTE is not set: the backup stays on this server only."
fi

log "Done: $(du -sh "$DEST" | cut -f1) in $DEST — $(ls "$DEST/db" | wc -l) database copies, $(find "$DEST/storage" -mindepth 1 -maxdepth 1 -type d | wc -l) document snapshots."
