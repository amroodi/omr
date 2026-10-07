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
sudo chown -R omr:omr /opt/omr /var/lib/omr
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
sudo -u omr -E NEXT_PUBLIC_API_BASE="https://panel.damuon.com/api/v1" \
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

After the first setup, every deploy is one command (edit `PUBLIC_API_BASE` at the top of the script once to match your domain):

```bash
sudo -u omr bash /opt/omr/deploy/deploy.sh
```

It pulls, `npm ci`, generates the Prisma client, runs `migrate deploy`, rebuilds both apps, and restarts the services. It never re-seeds.

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
