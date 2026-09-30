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

## Screens implemented

- **Public inquiry** (`/`) — OTP-gated single-record lookup.
- **Organization** (`/org/login`, `/org`): case table with filters and search, XLSX export,
  plus `/org/assessor` (document-authenticity queue), `/org/import` (CSV/XLSX validate-preview
  and commit), `/org/users` (role editor with permission toggles + user creation),
  `/org/sharing` (grant/revoke cross-org access).
- **Customer** (`/customer/login`, `/customer`): OTP login and "my cases".
- **Super-admin** (`/admin/login`, `/admin`): provision organizations, activate/deactivate.

Tokens are stored per realm in `localStorage` via `lib/client.ts`.

## Next steps

Font upload UI, global audit-log viewer, per-case detail/edit screen, document upload widget,
and renewal tracking. The API primitives for these are in `apps/api`.
