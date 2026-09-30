# OMR — Damuon Insurance Platform (Re-architected)

Enterprise, multi-tenant B2B/B2C insurance management and inquiry platform, rebuilt from
`omr.bimmes.ir` with a security-first core.

> Developed by **Milad Amroodi (میلاد امرودی)** — Atieh Andishan Damuon Insurance Brokerage
> (کارگزاری رسمی بیمه مستقیم برخط آتیه اندیشان دامون — damuon.com / bimmes.ir)

## Why this rebuild exists

The legacy system exposed full insurance records through an unauthenticated query string:

```
/insurance_status?national_code=<national id>
```

Anyone who could guess or enumerate a National ID could read a stranger's identity documents,
policy terms, payment history and agent details. This is a classic **IDOR** (Insecure Direct
Object Reference) combined with missing authentication and no rate limiting — a data-scraping
hole. The rebuild removes it permanently (see `docs/SECURITY.md`).

## Monorepo layout

```
.
├── apps/
│   ├── api/     NestJS + Prisma backend (security core, RBAC/ABAC, OTP, audit, carrier adapters)
│   └── web/     Next.js frontend scaffold (RTL, Jalali, light/dark, 3 dashboards)
└── docs/
    ├── ARCHITECTURE.md     System design, multi-tenancy model, module map
    ├── DATA-DICTIONARY.md  Every inquiry field mapped to a DB model + export column
    └── SECURITY.md         Threat model, IDOR fix, encryption, audit, rate limiting
```

## Tech stack

| Layer      | Choice                                             |
|------------|----------------------------------------------------|
| Backend    | NestJS 10 (TypeScript), modular + guards           |
| Database   | PostgreSQL 15+ via Prisma ORM                      |
| Auth       | OTP (SMS) + JWT sessions, RBAC + tenant ABAC       |
| Crypto     | AES-256-GCM field-level encryption (envelope-ready)|
| Frontend   | Next.js 14 (App Router), Tailwind, RTL, dark mode  |
| Dates      | Solar Hijri (Jalali) end to end                    |

## Implementation status

This repository is a **working, security-correct foundation**, not a finished product. What is
fully implemented vs. scaffolded is tracked honestly in each file and in `docs/ARCHITECTURE.md`
(section "Status"). The security-critical core — field encryption, the OTP-gated inquiry flow
that replaces the IDOR endpoint, RBAC/ABAC guards, tenant isolation, audit logging, and rate
limiting — is written out in full. Business modules (policies, documents, batch import, OCR,
exports) ship with real interfaces and stubs marked `TODO`.

## Quick start (backend)

```bash
cd apps/api
cp .env.example .env          # then fill secrets — see below
npm install
npx prisma migrate dev        # creates schema in a local Postgres
npm run start:dev
```

Generate the required secrets:

```bash
# 32-byte key, base64 — for AES-256-GCM field encryption
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# JWT signing secret
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Never commit `.env`. See `docs/SECURITY.md` for key rotation and production KMS notes.
