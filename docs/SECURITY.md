# Security Runbook & Operator Guide

For an organization running this platform **without a dedicated security team**. It has three parts:

1. **What the platform already protects** — so you know what you don't have to build.
2. **What you (the operator) must do** — the short list that actually keeps data safe.
3. **How each organization stays isolated**, and how to connect it to an existing website safely.

A separate **learning path** at the end names exactly what to study, in order.

---

## Part 1 — What the platform already does for you

You are not starting from zero. The system is built so that a single mistake doesn't leak data:

- **Encryption at rest for personal data.** National IDs, phones, names, IBANs are stored encrypted (AES‑256‑GCM). The database alone is useless without the key.
- **Blind-index lookups.** The system finds a person by a keyed hash of their National ID, never by storing it in the clear — this is the fix for the old "look anyone up by National ID" hole.
- **OTP-gated access.** Policyholders log in with their phone + a one-time code, not a guessable identifier.
- **Role & attribute permissions (RBAC + ABAC).** Each user sees only what their role and branch allow.
- **Tenant isolation.** Every query is automatically scoped to the organization; one org cannot read another's data.
- **Tamper-evident audit log.** Every sensitive action is recorded in a hash-chained log — altering history is detectable.
- **Rate limiting** on OTP and inquiry endpoints to stop enumeration and SMS abuse.
- **Encrypted document storage.** Uploaded files are encrypted on disk and never served statically.
- **Secure headers + TLS** (helmet, HSTS, CSP) once deployed behind Nginx.

Your job is not to re-invent these. Your job is to **protect the keys, the server, and the backups**, and to **keep the system updated**.

---

## Part 2 — Operator responsibilities (the real list)

Do these in order. The first five prevent the vast majority of real-world breaches.

### 1. Protect the three secrets
`FIELD_ENCRYPTION_KEY`, `BLIND_INDEX_PEPPER`, `JWT_SECRET` live only in `/etc/omr/api.env` (chmod 600).
- Back them up **offline** (password manager + a sealed printed copy in a safe). Not in the same place as database backups.
- Never paste them into chat, email, tickets, or git.
- If `FIELD_ENCRYPTION_KEY` is lost, **encrypted data is gone forever**. Treat it like the master key to a vault.

### 2. Lock down the server
- SSH: **keys only**, no passwords, no root login. (`/etc/ssh/sshd_config`: `PasswordAuthentication no`, `PermitRootLogin no`.)
- Firewall: only 22, 80, 443 open. Database and app ports are localhost-only (the deploy config already does this).
- Keep the OS patched: `unattended-upgrades` for security updates.
- One admin account per real person; no shared logins.

### 3. TLS everywhere
- Certbot gives you HTTPS + auto-renewal. Confirm `certbot renew --dry-run` passes.
- Never serve the panel over plain HTTP.

### 4. Backups you have actually restored
- Daily: database dump + encrypted-storage archive, copied **off the server**.
- Once a quarter: **restore into a throwaway environment** and confirm it works. A backup you've never restored is a hope, not a backup.

### 5. Updates
- Deploy new versions with `deploy/deploy.sh`. Read the commit notes first.
- Subscribe to security advisories for Ubuntu, Node.js, and PostgreSQL.
- Run `npm audit` after each dependency change; fix high/critical.

### 6. Access hygiene
- Rotate the seeded admin password on day one; delete `seed-output.local.txt` from the server.
- Remove accounts the moment someone leaves.
- Give each staff member the **lowest role** that lets them do their job.

### 7. Watch for trouble
- Check `journalctl -u omr-api` for repeated 401/403/429 spikes (someone probing).
- Review the in-app audit log for unexpected PII views or payouts.
- Set a disk-space alert — a full disk takes the system down.

### 8. Have a one-page incident plan
If you suspect a breach: (1) snapshot the server, (2) rotate `JWT_SECRET` (logs everyone out) and provider API keys, (3) review the audit log for what was accessed, (4) if personal data was exposed, follow your legal/notification duties. Write these four steps on paper **before** you need them.

---

## Part 3 — Per-organization isolation & website integration

**Model: one organization = one VPS.** Each insurer/brokerage runs its **own** copy of this system on its **own** VPS, with its **own** database, keys, SMS account, and subdomain (e.g. `panel.theirorg.ir`). Nothing is shared between organizations. If one VPS is ever compromised, the others are untouched. This is the strongest isolation available and it's the recommended setup.

**Resourcing.** A pilot VPS of 2 vCPU / 4 GB RAM / 40 GB SSD is enough per organization. It does **not** need to be the same server as their public website — in fact it should not be.

### Connecting it to an existing website — safely

The platform VPS stands alone; the organization's marketing website just needs to *point* at it. Pick by what access they have:

| Their website runs on… | Safe way to connect | New code needed? |
| --- | --- | --- |
| Anything (even shared hosting, no terminal) | **Link / button** to `https://panel.theirorg.ir` | None — works today |
| They control DNS for their domain | **Subdomain** `panel.theirorg.ir` → A-record to the VPS IP; TLS on the VPS | None — works today |
| They want the inquiry form *inside* a page | **Embedded widget (iframe)** from the VPS, with a per-domain frame allowlist | Small feature (see below) |
| Their site has its own backend (PHP, etc.) | **Scoped API key** over HTTPS for status lookups | Feature (see below) |

**Golden rules for any integration:**
- The connection is always **HTTPS**, VPS-to-browser or server-to-server — never plain HTTP, never a shared database.
- **Never** put the platform's secrets, database credentials, or admin panel on the shared-hosting website.
- The public site only ever reaches **public, rate-limited endpoints** (inquiry/OTP) or gets a **narrowly scoped API key** — never an admin token.
- Keep the **admin panel on its own subdomain**, ideally IP-restricted to staff, separate from anything embedded in the public site.

> **Two integration features are not built yet:** (a) an **embeddable inquiry widget** with a per-tenant domain allowlist (CSP `frame-ancestors`), and (b) **scoped, rotatable API keys** for server-to-server calls from a customer's own backend. The link/subdomain approach needs neither and works today. Ask and these can be added.

---

## Learning path — what to study, in order

You said you'd learn whatever is needed. Here is the **minimum effective curriculum**, ordered so each week builds on the last. Aim for a few hours a week; you do **not** need to become a professional pentester — you need to operate one system safely.

**Week 1 — Linux server basics & SSH**
- Users, file permissions (`chmod`/`chown`), `sudo`, `systemd` (start/stop/logs), `journalctl`.
- SSH key authentication; disabling passwords and root login.
- Resource: *Linux Journey* (linuxjourney.com), and DigitalOcean's "Initial Server Setup with Ubuntu" guide.

**Week 2 — The firewall, TLS, and Nginx**
- `ufw` basics; why only 22/80/443.
- What TLS/HTTPS is and how Let's Encrypt/Certbot works.
- Reverse proxies: what Nginx is doing in front of your apps.
- Resource: DigitalOcean guides on UFW, Nginx, and Certbot.

**Week 3 — Secrets, backups, and recovery**
- Why secrets never go in git; using a password manager (Bitwarden/KeePassXC) for the master keys.
- `pg_dump`/restore; the 3-2-1 backup rule; actually doing a restore drill.
- Resource: PostgreSQL docs "Backup and Restore"; Bitwarden/KeePassXC getting-started.

**Week 4 — Web app security fundamentals (OWASP)**
- The **OWASP Top 10** — read it once end to end; you'll recognize what the platform already defends against.
- Phishing and social engineering — the #1 way small orgs actually get breached. Train your staff.
- Resource: owasp.org/Top10; Google "Phishing Quiz" (jigsaw) for staff.

**Week 5 — Authentication, access control, and data protection**
- MFA/OTP concepts; least privilege; why roles matter.
- Data-at-rest vs in-transit encryption (so you understand what the platform does and why keys matter).
- Iran data-residency / customer-data duties relevant to insurance.
- Resource: Cloudflare Learning Center (free articles on auth, encryption, DDoS).

**Week 6 — Monitoring & incident response**
- Reading logs for abuse patterns; setting basic alerts (disk, failed logins).
- Writing and rehearsing the one-page incident plan from Part 2.
- Resource: SANS "Incident Handler's Handbook" (free PDF).

**Optional, ongoing**
- *TryHackMe* "Pre Security" and "Cyber Security 101" paths — hands-on, beginner-friendly, gamified.
- Enable automatic security updates and a weekly 15-minute "check the dashboards" habit.

If you do Weeks 1–3 before go-live and Weeks 4–6 in the first month, you will be operating this system more safely than most small organizations manage. The platform carries the cryptography and isolation; this curriculum covers the operations around it.
