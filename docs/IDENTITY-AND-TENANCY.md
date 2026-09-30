# Identity realms & tenancy hierarchy

This is the model behind the three login surfaces and the organization hierarchy, including how
organizations keep their data private by default and share it only by explicit agreement.

## The hierarchy

```
Platform (Damuon, the owner/reseller)
└── Organization  = Tenant            e.g. "آتیه اندیشان دامون", or a reseller's brokerage
    ├── Branch     (شعبه)             each org has many branches
    │   ├── Org users (branch admin, expert, assessor, …) scoped to the branch
    │   └── Customers registered at that branch
    └── Org-level users (org admin) see all branches
```

An **Organization is a Tenant.** Everything below it — branches, org users, customers, policies,
cases, documents, audit — carries that tenant's `tenantId` and is invisible to every other tenant
by default (enforced by the Prisma tenant extension, `docs/SECURITY.md` §5).

## Three login realms (three token kinds)

The system has three separate sign-in surfaces. Each issues a JWT with a distinct `kind`, and the
`JwtAuthGuard` grants a different scope for each. They never cross.

| Realm | Who | Sign-in | Token `kind` | Scope |
|-------|-----|---------|--------------|-------|
| **Platform** | Damuon super-admins | email + password (+TOTP) | `super` | provision tenants; no implicit case-data access |
| **Organization** | Org staff: org admin, branch admin, expert, assessor, … | tenant + username + password (+TOTP) | `org` | their tenant; optionally one branch; permissions from role |
| **Customer** | Insured people & beneficiaries | tenant + National ID + phone + OTP | `customer` | only their own linked cases within that tenant |
| _(anonymous inquiry)_ | one-off public lookup | National ID + phone + OTP | `record` | exactly one case, ~10 min |

The `customer` realm is a real, persistent account (a dashboard across all of that person's own
cases), distinct from the one-shot anonymous `record` token used by the public inquiry page.

### Why separate realms and not one user table

An org employee and an insured customer are different trust levels with different lookup keys
(username/password vs National-ID/OTP) and must never authenticate through each other's endpoint.
Keeping them as separate models (`OrgUser`, `SuperAdmin`, `CustomerAccount`) removes whole classes
of privilege-confusion bugs.

## Branch scoping (ABAC on top of RBAC)

An org user may be `branchId`-bound. A **branch admin** is just an org role holding `user:manage`
plus branch binding: they manage users and customers of their branch only. Enforcement is a
request-context flag (`branchScoped`) applied to case/customer queries; org-level users
(no branch, or an org-wide permission) see all branches. See `RBAC.md` for the permission catalog.

## Data isolation & optional cross-org sharing

**Default: fully isolated.** No tenant can read another's rows. This is the safe default and needs
no configuration — an org that says nothing shares nothing.

**Opt-in sharing** is modeled explicitly by a `DataSharingAgreement` between two tenants:

- `ownerTenantId` — the data owner. `partnerTenantId` — the tenant granted access.
- `scope` — how much: `CASE_STATUS` (read-only status/workflow, no PII) or `FULL` (read all,
  still subject to the partner's own RBAC).
- `direction` — one-way by default; a mutual share is two agreements.
- `isActive` + `revokedAt` — either side can revoke; revocation is immediate and audit-logged.

Sharing is **never** wired into the default query scope. A partner reads shared data only through
explicit "shared with me" endpoints that call `SharingService.assertAccess(owner, partner, scope)`
first. This keeps the strict-isolation default intact: a bug in a normal endpoint cannot leak
across tenants, because normal endpoints only ever see the caller's own `tenantId`.

Consent note: for `FULL` sharing of customer PII, the platform should also capture the customer's
consent (a flag on `CustomerAccount`), so sharing is lawful, not just technically enabled. That
consent capture is a documented next step.

## Reseller / white-label fit

Because an Organization is a Tenant with its own branding, users, customers, and data, Damuon can
onboard another brokerage as a new tenant and hand its admin the org realm — that brokerage then
runs its own branches and customers without ever seeing Damuon's data, and shares back only if it
signs an agreement. This is the SaaS-resale model from the brief.

## Build status

- Org realm + super realm + anonymous record token: **done**.
- Customer realm (accounts + OTP login + "my cases"): **added this round**.
- `DataSharingAgreement` model + management + `assertAccess` helper: **added this round**
  (enforcement endpoints for partners: scaffold).
- Branch-scoped ABAC enforcement: **helper + flag added**; apply to each org query as those
  endpoints are built.
