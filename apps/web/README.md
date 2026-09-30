# Web frontend (@omr/web)

Next.js 14 (App Router) frontend. Full RTL, Persian typography, light/dark toggle, Jalali dates.

## Run

```bash
cd apps/web
npm install
# API must be running (see apps/api). Optionally set:
#   NEXT_PUBLIC_API_BASE=http://localhost:4000/api/v1
#   NEXT_PUBLIC_TENANT_SLUG=damuon
npm run dev   # http://localhost:3000
```

## What's implemented

- **Secure inquiry page** (`app/page.tsx`) — the full OTP-gated flow that replaces the legacy
  IDOR: National ID + phone → SMS OTP → short-lived token → single-record view. The National ID
  is never placed in the URL.
- **Layout** with RTL, dark/light toggle (`app/theme-toggle.tsx`), and the developer credit.
- **API client** (`lib/api.ts`) sending the `x-tenant-slug` header for tenant resolution.

## Scaffolded (next steps)

Three route groups are planned; only the public inquiry is built:

- `app/(org)/…` — **Brokerage panel**: case table (filter/paginate/edit), batch import preview,
  renewal tracking, document queue, XLSX/PDF export with tenant branding.
- `app/(admin)/…` — **Super-admin**: tenant provisioning, granular RBAC editor, font upload,
  global audit-log viewer, carrier API config.
- `app/(user)/…` — **Insured dashboard**: policy overview, payment schedule, self-service
  document upload.

Build these against the API in `apps/api`; the auth, RBAC, tenant, and audit primitives are
already in place.
