# Security design

The legacy system's core failure was that sensitive records were reachable by National ID alone.
This document defines how the rebuild closes that and hardens the rest.

## 1. Killing the IDOR

**Before:** `GET /insurance_status.php?national_code=<id>` and `POST /api/get_fields.php` returned
a full record to anyone. National IDs are short and enumerable → whole-DB scraping.

**After — OTP-gated, tokenized lookup:**

1. Claimant enters their National ID **and** a phone number on file.
2. Server verifies the pair exists, then issues a 6-digit OTP by SMS to the on-file number.
   The National ID never appears in a URL.
3. Claimant submits the OTP. On success the server issues a **short-lived, single-record,
   signed session token** (JWT, ~10 min) scoped to exactly that case id — not the National ID.
4. The status page is fetched with that token. The token authorizes one record only, so a
   stolen or guessed token cannot pivot to other people's cases.

Controls layered on top:
- **Per-IP + per-National-ID rate limiting** on OTP issue and verify (see `rate-limit`).
- **Blind index** (`nationalCodeHash`, HMAC-SHA-256 with a server pepper) for lookup, so the
  plaintext National ID is never queried or indexed directly.
- National IDs never placed in query strings, logs, or referrers.

Org/admin access to records goes through authenticated sessions with RBAC + tenant scoping
instead — never the public lookup path.

## 2. Encryption

- **In transit:** TLS 1.2+ everywhere; HSTS.
- **At rest — field level, AES-256-GCM** (`common/crypto/field-crypto.service.ts`) for National
  IDs, phone numbers, names, IBANs, identity-document OCR text, and carrier credentials.
  - Each value: random 12-byte IV, GCM auth tag stored alongside, `keyVersion` prefix for
    rotation. Format: `v<version>:<iv_b64>:<tag_b64>:<ciphertext_b64>`.
  - Master key from `FIELD_ENCRYPTION_KEY` (32 bytes, base64). **Production: wrap with a KMS**
    (envelope encryption) — the service is written so the data key can be swapped for a
    KMS-decrypted key without touching call sites.
- **Blind index** for searchable encrypted columns: `HMAC-SHA256(pepper, normalizedValue)`.
- **Passwords:** argon2id. **OTP codes:** stored only as a salted hash, never plaintext.

## 3. Key rotation

`keyVersion` is embedded in every ciphertext. To rotate: add the new key as current, keep old
keys for decrypt, re-encrypt lazily on write or via a background job. No downtime, no schema
change.

## 4. Audit logging (tamper-evident)

Every read, export, edit, upload, delete, login, and OTP issue is written to `AuditLog` with
actor, target, IP, User-Agent, UTC time, and a rendered Jalali timestamp. Each row stores
`prevHash` and `hash = SHA256(prevHash + canonical(row))`, forming a per-tenant hash chain so
any deletion or edit of history is detectable. Logs are append-only at the application layer
(no update/delete endpoints).

## 5. Access control

- **RBAC:** roles map to permission strings (`case:read`, `case:edit`, `export:pii`,
  `tenant:manage`, …). Enforced by `RolesGuard` + `@Permissions()`.
- **Tenant ABAC:** every query is scoped to the caller's `tenantId` by `TenantGuard` +
  Prisma middleware, preventing cross-tenant reads even if an id is guessed.
- **Super-admin** is a distinct scope that can provision tenants but does not get implicit
  read access to tenant case data.

## 6. Transport & app hardening

Helmet (CSP, HSTS, no-sniff, frame-deny), strict CORS allowlist per tenant domain, body-size
limits, global rate limiting, input validation via DTOs (`class-validator`), and no PII in
logs (a redaction serializer strips known-sensitive keys).

## 7. What is NOT yet implemented (honest status)

- SMS gateway is behind an interface with a console-logging dev driver; wire a real Iranian SMS
  provider in `modules/auth/otp`.
- KMS envelope wrapping is stubbed to a local key; swap in AWS KMS / HashiCorp Vault for prod.
- OCR runs through an adapter interface with a stub; connect a real OCR engine.
- Anti-automation (CAPTCHA) on OTP issue is left as a hook, not wired.
