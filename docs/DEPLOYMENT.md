# Production Deployment — Linux VPS

How to run the OMR Damuon platform (NestJS API + Next.js web + PostgreSQL) on a single
Ubuntu VPS for the pilot. Supporting config files live in [`deploy/`](../deploy).

## Architecture

One VPS, one domain, Nginx as the only thing exposed to the internet:

```
                 ┌──────────────────────── VPS ────────────────────────┐
  Internet ─TLS─▶│  Nginx :443                                          │
                 │    ├─ /api/  ─▶ API (systemd omr-api)  127.0.0.1:17421│
                 │    └─ /      ─▶ Web (systemd omr-web)  127.0.0.1:29318│
                 │                                                       │
                 │  Postgres (docker)  127.0.0.1:15987  ◀── API only     │
                 │  /var/lib/omr/storage  (encrypted uploaded docs)      │
                 └───────────────────────────────────────────────────────┘
```

- **Postgres** runs in Docker (same as local), bound to `127.0.0.1:15987`.
- **API** and **web** run as native Node processes under **systemd** (auto-restart, start on boot, logs via `journalctl`), each **bound to `127.0.0.1`** on a **non-generic port** (17421 / 29318).
- **Nginx + Let's Encrypt** terminate TLS and route by path. Nothing but 22/80/443 is open.

> **Ports & binding.** The apps use non-default ports (17421/29318/15987) and bind to localhost, so they're reachable only through Nginx. The *real* protection is the localhost binding + firewall + TLS — the unusual port numbers are a thin extra layer, not a substitute. Want different numbers? Change `PORT`/`HOST` in `api.env`, `PORT` in `omr-web.service`, the Postgres host-port in `postgres.compose.yml` + `DATABASE_URL`, and the two `proxy_pass` lines in the Nginx config — keep them consistent.

> **Why not Docker for everything?** For a single-VPS pilot, systemd is fewer moving parts and easier to debug than orchestrating three containers. Postgres stays in Docker because it's the one piece where a pinned image + named volume genuinely simplifies ops.

---

## 0. Prerequisites

- A VPS: **Ubuntu 22.04 or 24.04 LTS**, ≥ 2 vCPU, ≥ 4 GB RAM, ≥ 40 GB SSD. (`argon2` and the Next build are the memory-hungry steps.)
- A domain, e.g. `panel.damuon.com`, with an **A record pointing at the VPS IP** (needed before TLS).
- A Kavenegar account + sender line (for production SMS OTP).
- SSH access as a sudo-capable user.

Throughout, replace `panel.damuon.com` with your real domain.

---

## 1. Base server setup

Run as your sudo user.

```bash
# System packages + build tools (argon2 native build needs these)
sudo apt update && sudo apt -y upgrade
sudo apt -y install git curl ca-certificates gnupg build-essential ufw nginx

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs
node -v   # expect v20.x

# Docker Engine + compose plugin (for Postgres)
curl -fsSL https://get.docker.com | sudo sh

# Firewall: SSH + HTTP + HTTPS only (Postgres is NOT exposed)
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

Create a dedicated service user and directories:

```bash
sudo useradd --system --create-home --shell /bin/bash omr
sudo usermod -aG docker omr                     # lets omr run the Postgres container
sudo mkdir -p /opt/omr /etc/omr /var/lib/omr/storage
# /etc/omr must be omr-owned too, or `deploy.sh` (run as omr) can't read /etc/omr/api.env.
sudo chown -R omr:omr /opt/omr /var/lib/omr /etc/omr
sudo chmod 750 /etc/omr
```

---

## 2. Get the code

```bash
sudo -u omr git clone https://github.com/amroodi/omr.git /opt/omr
cd /opt/omr
```

---

## 3. PostgreSQL (Docker)

```bash
# Choose a strong DB password and start Postgres (bound to localhost).
export POSTGRES_PASSWORD='CHOOSE_A_STRONG_PASSWORD'
sudo -u omr -E docker compose -f /opt/omr/deploy/postgres.compose.yml up -d

# Verify
docker ps                      # omr-postgres should be "healthy" after ~15s
```

The data lives in the Docker named volume `omr_pgdata` and survives container restarts.

---

## 4. Secrets & environment

Copy the template and fill it in. **The three crypto/auth secrets must be generated once and never changed after real data exists** — losing or rotating `FIELD_ENCRYPTION_KEY` makes encrypted PII unreadable, and changing `BLIND_INDEX_PEPPER` breaks every National-ID/phone lookup.

```bash
sudo cp /opt/omr/deploy/api.env.example /etc/omr/api.env

# Generate secrets:
node -e "console.log('FIELD_ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('BLIND_INDEX_PEPPER='+require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('JWT_SECRET='+require('crypto').randomBytes(48).toString('base64'))"

sudo nano /etc/omr/api.env        # paste the three secrets + DB password + Kavenegar keys + domain
sudo chown omr:omr /etc/omr/api.env
sudo chmod 600 /etc/omr/api.env
```

In `/etc/omr/api.env` make sure:
- `DATABASE_URL` uses the same password you set in step 3, host `127.0.0.1:15987`, user `omr`, db `omr_damuon`.
- `CORS_ORIGINS="https://panel.damuon.com"` (add every tenant/white-label domain, comma-separated).
- `PUBLIC_API_BASE="https://panel.damuon.com/api/v1"` — **this server's** public API URL; `deploy.sh` bakes it into the web build. (Optional: `PUBLIC_TENANT_SLUG` if the default org slug isn't `damuon`.)
- `STORAGE_DIR="/var/lib/omr/storage"`.
- `PORT=17421`, `HOST=127.0.0.1` (match the Nginx `proxy_pass`).
- SMS provider set — see **§8a** below (or keep `console` for a dry run; codes then go to `journalctl`).

---

## 5. First build, migrate, and seed

```bash
cd /opt/omr
sudo -u omr npm ci                                  # installs all workspaces (incl. build tools)

# Apply the DB schema (uses migrate deploy — never migrate dev in prod)
set -a; source /etc/omr/api.env; set +a
sudo -u omr -E bash -c 'cd apps/api && npx prisma generate && npx prisma migrate deploy'

# Build both apps (web bakes in the public API URL at build time!)
sudo -u omr npm --workspace apps/api run build
sudo -u omr -E NEXT_PUBLIC_API_BASE="$PUBLIC_API_BASE" NEXT_PUBLIC_TENANT_SLUG="${PUBLIC_TENANT_SLUG:-damuon}" \
     npm --workspace apps/web run build

# Provision the first tenant + super-admin + org admin for PRODUCTION.
# This creates NO fake data and NO dev OTP, and is safe to re-run (existing passwords are kept).
# Do NOT use `prisma db seed` in production — that is the dev seed (fake records + OTP 123456) and
# it refuses to run when NODE_ENV=production.
sudo -u omr -E SUPER_ADMIN_EMAIL="you@damuon.com" bash -c 'cd apps/api && npx ts-node prisma/provision.ts'
sudo -u omr cat apps/api/prisma/provision-output.local.txt   # note the credentials, store safely, then delete the file
```

> **`NEXT_PUBLIC_API_BASE` is compile-time.** It is inlined into the web bundle by `next build`. If you ever change the domain or path, you must rebuild the web app — setting it only at runtime does nothing.

---

## 6. systemd services

```bash
sudo cp /opt/omr/deploy/omr-api.service /etc/systemd/system/
sudo cp /opt/omr/deploy/omr-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now omr-api omr-web

# Verify both are active, and tail logs
systemctl status omr-api omr-web --no-pager
journalctl -u omr-api -f
```

Let the `omr` user restart the services without a password (used by `deploy.sh`):

```bash
echo 'omr ALL=(root) NOPASSWD: /usr/bin/systemctl restart omr-api, /usr/bin/systemctl restart omr-web, /usr/bin/systemctl start omr-api, /usr/bin/systemctl start omr-web, /usr/bin/systemctl stop omr-api, /usr/bin/systemctl stop omr-web' \
  | sudo tee /etc/sudoers.d/omr-deploy
sudo chmod 440 /etc/sudoers.d/omr-deploy
```

Quick local check before Nginx:

```bash
curl -s -H "x-tenant-slug: damuon" http://127.0.0.1:17421/api/v1/tenant/branding | head -c 200
curl -sI http://127.0.0.1:29318 | head -1      # expect HTTP/1.1 200
```

---

## 7. Nginx + TLS

```bash
sudo cp /opt/omr/deploy/nginx.conf.example /etc/nginx/sites-available/omr
sudo nano /etc/nginx/sites-available/omr      # set server_name to your domain
sudo ln -s /etc/nginx/sites-available/omr /etc/nginx/sites-enabled/omr
sudo rm -f /etc/nginx/sites-enabled/default   # drop the welcome page
sudo nginx -t && sudo systemctl reload nginx

# Issue a certificate and auto-configure HTTPS + HTTP->HTTPS redirect
sudo apt -y install certbot python3-certbot-nginx
sudo certbot --nginx -d panel.damuon.com
```

Certbot installs a renewal timer automatically. Confirm with `sudo certbot renew --dry-run`.

---

## 8. Smoke test

1. Open `https://panel.damuon.com/org/login`, sign in with the org admin from `provision-output.local.txt`.
2. **تنظیمات سازمان** → seed default required-documents and claim-fields, add a branch and approval levels.
3. **بیمه‌گزاران** → create a policyholder (National ID + mobile).
4. Log out → `https://panel.damuon.com/customer/login` → request an OTP. With a real provider configured (§8a) the code is texted; with the `console` driver run `journalctl -u omr-api -f` and read the `[SMS:console]` line.
5. File a test claim, upload a document, view it back.

---

## 8a. SMS provider

One provider per deployment, chosen with `SMS_DRIVER` in `/etc/omr/api.env`. Supported out of the box: `console` (dev only), **`magfa`** (Damuon), `kavenegar`, `ghasedak`, `smsir`, `melipayamak`. Fill only the fields your provider needs:

| Provider | Required | OTP pattern field |
| --- | --- | --- |
| magfa | `SMS_USERNAME`, `SMS_PASSWORD`, `SMS_DOMAIN`, `SMS_SENDER` | — (normal send) |
| kavenegar | `SMS_API_KEY`, `SMS_SENDER` | `SMS_OTP_PATTERN` (template name) |
| ghasedak | `SMS_API_KEY`, `SMS_SENDER` | `SMS_OTP_PATTERN` (template name) |
| smsir | `SMS_API_KEY`, `SMS_SENDER` | `SMS_OTP_TEMPLATE_ID` (numeric) |
| melipayamak | `SMS_USERNAME`, `SMS_PASSWORD`, `SMS_SENDER` | `SMS_OTP_PATTERN` (bodyId) |

> **OTP patterns matter in Iran.** Gateways usually require OTP/service text to use a *pre-approved pattern* ("الگو") sent through a verify endpoint; free-text service SMS is often filtered. Register an OTP pattern in your provider's panel, put its name/id in the pattern field above, and the system will use the pattern endpoint automatically. Leave it blank only if your account is approved for free-text.

**Add a provider not listed here:** create one file in `apps/api/src/modules/auth/sms/drivers/` implementing the `SmsDriver` interface, add one line to the `REGISTRY` map in `apps/api/src/modules/auth/sms.service.ts`, and set `SMS_DRIVER` to its name. Each driver is ~40 lines; use `magfa.driver.ts` as a template.

After changing provider config: `sudo systemctl restart omr-api`, then run one real OTP from `/customer/login` and confirm delivery.

## 8b. Sign-in locations («امنیت ورود»)

Super Admin → «امنیت ورود» records every sign-in with its device and IP. To also show the **city and
internet provider** (and catch «two distant places in minutes»), install the free DB-IP Lite databases
(CC BY 4.0, refreshed monthly) and point the API at them:

```bash
sudo mkdir -p /var/lib/omr/geoip && cd /var/lib/omr/geoip
M=$(date +%Y-%m)
sudo curl -fsSLO https://download.db-ip.com/free/dbip-city-lite-$M.mmdb.gz && sudo gunzip -f dbip-city-lite-$M.mmdb.gz && sudo mv dbip-city-lite-$M.mmdb dbip-city-lite.mmdb
sudo curl -fsSLO https://download.db-ip.com/free/dbip-asn-lite-$M.mmdb.gz && sudo gunzip -f dbip-asn-lite-$M.mmdb.gz && sudo mv dbip-asn-lite-$M.mmdb dbip-asn-lite.mmdb
sudo chown -R omr:omr /var/lib/omr/geoip
```

Then in `/etc/omr/api.env` set `GEOIP_CITY_DB=/var/lib/omr/geoip/dbip-city-lite.mmdb` and
`GEOIP_ASN_DB=/var/lib/omr/geoip/dbip-asn-lite.mmdb`, and `sudo systemctl restart omr-api`. Re-run the
download monthly to keep it current. Alert SMS numbers and switches are set in Super Admin → «امنیت ورود».

## 9. Backups (do this before real data)

Three things must be backed up. Losing the secrets is as catastrophic as losing the database.

```bash
# a) Database — daily dump
docker exec omr-postgres pg_dump -U omr omr_damuon | gzip > /var/backups/omr_$(date +%F).sql.gz

# b) Encrypted document storage
tar czf /var/backups/omr_storage_$(date +%F).tar.gz -C /var/lib/omr storage

# c) The secrets file — store OFFLINE (password manager / sealed envelope), NOT next to the backups
sudo cat /etc/omr/api.env
```

Automate (a) and (b) with a daily cron/systemd-timer and copy off-box. Restore test: `gunzip -c dump.sql.gz | docker exec -i omr-postgres psql -U omr -d omr_damuon`.

---

## 10. Updating to a new version

After the first setup, every deploy is two commands:

```bash
cd /opt/omr && sudo -u omr git pull --ff-only
sudo -u omr bash /opt/omr/deploy/deploy.sh
```

`deploy.sh` pulls, `npm ci`, generates the Prisma client, runs `migrate deploy` + `sync-roles`, rebuilds both apps (with `PUBLIC_API_BASE`/`PUBLIC_TENANT_SLUG` read from `/etc/omr/api.env`), and restarts the services. It never re-seeds.

> **Do not edit `deploy.sh` on the server.** The per-server public URL lives in `/etc/omr/api.env`
> (`PUBLIC_API_BASE=`), not in the tracked script — so `git pull --ff-only` never conflicts and the
> exact same two commands work on every server. (`deploy.sh` already does `git pull` itself; the
> explicit first command above is just so you see the pull result before building.)

---

## 11. Security checklist

- [ ] `ufw` allows only 22/80/443; Postgres is on `127.0.0.1` only.
- [ ] `/etc/omr/api.env` is `chmod 600`, owned by `omr`; secrets were generated on the server and never committed.
- [ ] `FIELD_ENCRYPTION_KEY`, `BLIND_INDEX_PEPPER`, `JWT_SECRET` are backed up offline.
- [ ] `SMS_DRIVER` is `kavenegar` (not `console`) before go-live.
- [ ] Provisioned admin/super-admin passwords were rotated after first login; `provision-output.local.txt` was deleted from the server.
- [ ] TLS works and HTTP redirects to HTTPS; `certbot renew --dry-run` passes.
- [ ] Daily DB + storage backups run and a restore has been tested.
- [ ] SSH is key-only (`PasswordAuthentication no`) and root login is disabled.

---

## 12. Troubleshooting

| Symptom | Check |
| --- | --- |
| API won't start | `journalctl -u omr-api -n 50` — usually a missing/malformed var in `/etc/omr/api.env` or DB not reachable |
| `migrate deploy` fails | `DATABASE_URL` wrong, or Postgres not healthy (`docker ps`); special chars in the password must be URL-encoded |
| Web loads but every API call fails | web was built with the wrong `NEXT_PUBLIC_API_BASE` — rebuild (step 5); or `CORS_ORIGINS` missing the domain |
| 502 from Nginx | the app isn't listening — `systemctl status omr-api omr-web` |
| 413 on upload | raise `client_max_body_size` in the Nginx config |
| OTP never arrives | `SMS_DRIVER`/keys wrong; with `console` driver read `journalctl -u omr-api` |

---

## 13. Iran-specific notes

- **Let's Encrypt** issuance works from Iranian IPs. If certbot's HTTP-01 check is flaky, retry or use `--preferred-challenges http`.
- **`npm ci`** occasionally stalls against the public registry; if so set a mirror: `npm config set registry https://registry.npmmirror.com` (or your org's).
- Docker Hub image pulls may need a mirror/proxy. If `postgres:16` won't pull, configure a registry mirror in `/etc/docker/daemon.json` or load the image from a tarball.
- Keep everything **on-prem/in-country** for data residency — this setup already does; don't add foreign object storage or OCR endpoints without a data-residency review. OCR stays stubbed for this pilot.

---

## 14. Standing up an additional server (second VPS)

Goal: a new VPS where the same two update commands work:

```bash
cd /opt/omr && sudo -u omr git pull --ff-only
sudo -u omr bash /opt/omr/deploy/deploy.sh
```

Decide the scenario first — the **crypto keys are irreversible**:

**A) Independent deployment** (different domain/client, its own fresh data)
Follow §1–§9 on the new VPS. **Generate NEW secrets** (§4), set `PUBLIC_API_BASE` to the new domain in `/etc/omr/api.env`, and **provision** its own super-admin/org (§5).

**B) Replica / migration of the SAME site** (must read the same data)
Do §1–§3 and §6–§7 as usual, but in §4 **copy the crypto secrets** (`FIELD_ENCRYPTION_KEY`, `FIELD_ENCRYPTION_KEY_VERSION`, `BLIND_INDEX_PEPPER`) verbatim from the old server — encrypted PII and National-ID/phone lookups only work with the identical keys. Then **restore** instead of provisioning (§9):
```bash
gunzip -c omr_YYYY-MM-DD.sql.gz | docker exec -i omr-postgres psql -U omr -d omr_damuon
tar xzf omr_storage_YYYY-MM-DD.tar.gz -C /var/lib/omr
```
`JWT_SECRET` may be new (logs everyone out) or copied (keeps sessions valid).

**Condensed checklist (both cases):**
1. Base server + `omr` user + dirs + firewall (§1).
2. **Repo access for the `omr` user.** Public repo → nothing to do. Private repo → add a read-only **deploy key**: `sudo -u omr ssh-keygen -t ed25519 -f ~omr/.ssh/id_ed25519 -N ''`, add the `.pub` to GitHub → repo → *Settings → Deploy keys*, and clone via SSH (`git@github.com:amroodi/omr.git`). (Needed or `git pull --ff-only` will fail on the new box.)
3. Clone to `/opt/omr` (§2).
4. Start Postgres (§3).
5. `/etc/omr/api.env`: secrets + `DATABASE_URL` + `CORS_ORIGINS` + **`PUBLIC_API_BASE`** = the new domain (§4).
6. First build, then **provision (A)** or **restore (B)** (§5 / §9).
7. systemd units + the `omr-deploy` sudoers NOPASSWD line (§6).
8. Nginx + certbot for the new domain (§7).
9. Point the new domain's **DNS A record** at the new VPS IP.

From then on, only the two commands above — `PUBLIC_API_BASE` comes from `/etc/omr/api.env`, so `deploy.sh` is never edited and `git pull --ff-only` never conflicts.

## Cleaning test data while keeping «میز کار مستقل»

`apps/api/prisma/purge-test-data.ts` deletes test claims and test companies and never touches the spare desk's cases or files. Run it without `--confirm` first: it lists what it would delete and how many spare cases stay.

**Do not** run `prisma migrate reset`, drop the database, or empty `STORAGE_DIR`. Those delete the spare desk too. Spare cases need the same `Tenant` row and the same encryption keys to stay readable, so keep `/etc/omr/api.env` and don't recreate the brokerage.

Back up the spare desk before any cleanup. The storage copy holds its files:

```bash
docker exec omr-postgres pg_dump -U omr --data-only -t '"SpareCase"' -t '"SpareDocument"' omr_damuon | gzip > /var/backups/omr_spare_$(date +%F).sql.gz
tar -czf /var/backups/omr_storage_$(date +%F).tar.gz -C /var/lib/omr storage
```

To restore into the same database, after the spare tables have been emptied:

```bash
gunzip -c /var/backups/omr_spare_YYYY-MM-DD.sql.gz | docker exec -i omr-postgres psql -U omr omr_damuon
```

---

## 15. Moving everything to a new server

Two scripts do it: [`deploy/move-export.sh`](../deploy/move-export.sh) on the old server packs the database
(with its roles), the uploaded documents, `/etc/omr/api.env`, the Nginx site and the TLS certificates into
`/root/omr-move/`; [`deploy/move-import.sh`](../deploy/move-import.sh) on a fresh Ubuntu server installs
everything (as §1–§7), restores all of it, and runs `deploy.sh`. The secrets travel unchanged — a new
`FIELD_ENCRYPTION_KEY` / `BLIND_INDEX_PEPPER` would make the encrypted data unreadable.

1. **Old server** (the site stops here; `systemctl start omr-api omr-web` cancels):
   `curl -fsSL https://raw.githubusercontent.com/amroodi/omr/main/deploy/move-export.sh -o /root/move-export.sh && sudo bash /root/move-export.sh`
2. **New server**: copy the files over, then run the import:
   `rsync -av root@<OLD-IP>:/root/omr-move/ /root/omr-move/`
   `curl -fsSL https://raw.githubusercontent.com/amroodi/omr/main/deploy/move-import.sh -o /root/move-import.sh && sudo bash /root/move-import.sh`
3. **Test before DNS**: `curl -s --resolve omr.damuon.com:443:<NEW-IP> https://omr.damuon.com/api/v1/health`,
   or point the domain at the new IP in your own computer's hosts file and sign in.
4. **Outside services that allow by IP**: add the new server's IP wherever the old one is allowed — the SMS
   gateway (Magfa / Kavenegar …), the insurers' فن‌آوران coverage service, AvalAI.
5. **DNS**: change the domain's A record to the new IP. Set up again any cron jobs the import printed
   (backups). `sudo certbot renew --dry-run` once DNS points here.
6. **Old server**: keep it stopped for a few days, then wipe it — it holds personal data and the secrets.

---

## 16. Nightly backups (database + documents)

[`deploy/backup.sh`](../deploy/backup.sh), run every night at 02:30 Tehran time by `omr-backup.timer`:
the whole database (checked readable with `pg_restore --list`) and a snapshot of the documents into
`/var/backups/omr` (root only). Unchanged documents are hard links to the night before, so two weeks of
snapshots take little more room than one copy. The newest 14 of each are kept (`BACKUP_KEEP_DAYS`).

```bash
sudo apt-get install -y rsync
sudo cp /opt/omr/deploy/omr-backup.service /opt/omr/deploy/omr-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now omr-backup.timer
sudo systemctl start omr-backup.service && journalctl -u omr-backup -n 20 --no-pager   # first run now
systemctl list-timers omr-backup.timer                                                  # next run
```

**Off the server** (a backup on the same disk is lost with the disk): another server / NAS reachable by
SSH, with a key that logs in without a password:

```bash
sudo ssh-keygen -t ed25519 -N '' -f /root/.ssh/omr_backup
sudo cat /root/.ssh/omr_backup.pub        # add this line to ~/.ssh/authorized_keys of the backup user there
```

then in `/etc/omr/api.env`: `BACKUP_REMOTE="backup@<host>:/srv/omr-backups"`, `BACKUP_REMOTE_PORT="<port>"`
(and `BACKUP_SSH_KEY` if not `/root/.ssh/omr_backup`). The next run copies everything there.

**Not in the backup:** `/etc/omr/api.env` — keep it offline (password manager / USB). The data is encrypted
with its keys: without it a restore is unreadable, and stored next to the backups it protects nothing.

**Restore** (e.g. on a new server after `move-import.sh`-style setup, or to go back a day):

```bash
sudo systemctl stop omr-api omr-web
docker exec -i omr-postgres pg_restore -U omr -d omr_damuon --clean --if-exists < /var/backups/omr/db/omr_<date>.dump
sudo rsync -a --delete /var/backups/omr/storage/<date>/ /var/lib/omr/storage/ && sudo chown -R omr:omr /var/lib/omr/storage
sudo systemctl start omr-api omr-web
```
