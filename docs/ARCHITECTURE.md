# Architecture

## Overview

A multi-tenant SaaS insurance case-management and inquiry platform. One deployment serves many
brokerages; each is a **Tenant** with isolated data, branding, and users. Atieh Andishan Damuon
is the default tenant and can resell the platform (white-label) to other brokerages.

```
                       ┌──────────────────────────────┐
  Insured / Claimant → │  Public inquiry (OTP-gated)   │
                       ├──────────────────────────────┤
  Brokerage staff   →  │  Org panel (RBAC + tenant ABAC)│ →  NestJS API  →  PostgreSQL
                       ├──────────────────────────────┤        │            (Prisma, tenant-scoped)
  Platform owner    →  │  Super-admin (provisioning)   │        │
                       └──────────────────────────────┘        ├→ Object storage (documents)
                                                                ├→ SMS gateway (OTP)
                                                                ├→ Carrier adapters (Alborz, …)
                                                                └→ OCR engine (adapter)
```

## Multi-tenancy model

**Shared database, shared schema, row-level isolation by `tenantId`.** Every tenant-owned table
carries `tenantId`. Isolation is enforced in three layers so a single missed `where` clause
cannot leak data:

1. `TenantGuard` resolves the tenant from the auth token / subdomain into a request context.
2. Prisma client extension injects `tenantId` into every query and rejects cross-tenant writes.
3. Unique constraints are `(tenantId, …)` composite, so ids are unique per tenant.

Chosen over database-per-tenant for operational simplicity at this scale; the Prisma layer is
isolated enough to move hot tenants to their own database later.

## Modules (`apps/api/src`)

| Module | Responsibility | Status |
|--------|----------------|--------|
| `common/crypto` | AES-256-GCM field encryption + blind index | **done** |
| `common/audit` | Hash-chained audit log service + interceptor | **done** |
| `common/prisma` | Prisma service + tenant-scoping extension | **done** |
| `common/tenant` | Request tenant context + guard | **done** |
| `common/rbac` | Permissions, roles, `RolesGuard`, decorators | **done** |
| `common/rate-limit` | Per-IP / per-key limiter for OTP + inquiry | **done** |
| `common/guards` | JWT auth guard, record-scoped token guard | **done** |
| `modules/auth` | Org login (argon2 + optional TOTP), claimant OTP | **core done** |
| `modules/inquiry` | OTP-gated, tokenized National-ID lookup (IDOR fix) | **core done** |
| `modules/policies` | Policies + cases + installments/payments CRUD | scaffold |
| `modules/tenants` | Tenant provisioning + white-label config | scaffold |
| `modules/roles` | Custom role CRUD + permission catalog (no escalation) | **done** |
| `modules/users` | Org user CRUD, role/branch assignment, password reset | **done** |
| `modules/documents` | Authenticity assessment workflow + queue (upload/OCR: scaffold) | **core done** |
| `modules/audit-logs` | Query/filter audit trail | scaffold |
| `integrations/carriers` | Carrier adapter pattern + Alborz stub | interface + stub |

## Request lifecycle (secured)

1. Helmet + CORS + global rate limit.
2. `JwtAuthGuard` / record-token guard authenticates.
3. `TenantGuard` sets tenant context.
4. `RolesGuard` checks `@Permissions(...)`.
5. Controller → service → tenant-scoped Prisma.
6. `AuditInterceptor` records the action with Jalali timestamp into the hash chain.

## Carrier integration (adapter pattern)

`CarrierAdapter` interface (`inquire`, `getStatus`, `endorse`) with per-carrier implementations
(`AlborzAdapter`, …) selected by a `CarrierRegistry`. Credentials come from the tenant's
encrypted `carrierConfig`, so each brokerage uses its own upstream accounts.

## Frontend (`apps/web`)

Next.js App Router, Tailwind, full RTL, Jalali calendar throughout, light/dark toggle. Three
route groups: `(public)` inquiry, `(org)` brokerage panel, `(admin)` super-admin. Scaffolded —
see its own README.

## Status summary

Security-critical core and schema are implemented and reviewable. Business CRUD, exports,
OCR, SMS, and the frontend are scaffolded with real interfaces and clearly marked `TODO`s so the
next steps are unambiguous. This is a foundation to build on, not a shippable product.
