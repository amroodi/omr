# Access control (RBAC + tenant ABAC)

## Model

- Each **Tenant** (organization) has its own set of **Roles**. A Role is a name plus a list of
  permission strings. Each **OrgUser** has exactly one Role and an optional Branch.
- Permissions are enforced globally: `JwtAuthGuard` authenticates and loads the user's
  permissions into the request context; `RolesGuard` checks `@Permissions(...)` on each route.
- Tenant isolation is separate and automatic (the Prisma extension scopes every query to the
  caller's `tenantId`), so a role in one org can never touch another org's data.

## Who can manage what

- **Super-admin** (platform owner) provisions tenants and holds `tenant:manage`. It does not get
  implicit read access to any tenant's case data.
- **Org admin** (seeded role «مدیر سازمان») holds every permission except `tenant:manage`,
  including `user:manage` and `role:manage`. So each organization runs itself: its admin creates
  custom roles, toggles their permissions, and assigns users to branches.

## Anti-escalation rules (enforced in code)

An org admin cannot mint power they don't have:

1. A role can only be granted permissions the **creator themselves holds**
   (`RolesService.validatePermissions`).
2. `tenant:manage` can never be granted through the org API — super-admin only.
3. A user can only be assigned a role whose permissions are a **subset of the assigner's**
   (`UsersService.assertRoleAssignable`).
4. System roles cannot be edited or deleted; a role in use cannot be deleted.

Every role/user change is written to the hash-chained audit log.

## Permission catalog

Cases: `case:read` `case:create` `case:edit` `case:delete` · Policies: `policy:read`
`policy:edit` · Exports: `export:list` `export:pii` · Documents: `doc:upload` `doc:read`
`doc:verify` `ocr:run` · PII on screen: `view:pii` · Import: `import:batch` · Org admin:
`user:manage` `role:manage` `branch:manage` `audit:read` `tenant:settings` · Platform:
`tenant:manage`.

`GET /api/v1/roles/catalog` returns this list so the admin UI can render permission toggles.

## Seeded roles

| Role (fa) | Purpose | Key permissions |
|-----------|---------|-----------------|
| مدیر سازمان | Org admin | everything except `tenant:manage` |
| کارشناس | Case expert | read/create/edit cases, docs, OCR, import/export |
| ارزیاب اصالت مدارک | **Document-authenticity assessor** | `case:read`, `doc:read`, `doc:verify` |
| مسئول ورود و خروج داده | Import/export operator | `case:read`, `import:batch`, `export:list` |
| فقط مشاهده | View-only | `case:read`, `policy:read`, `doc:read` |

Org admins can create any other role by combining catalog permissions.

## Document-authenticity assessor workflow

The assessor (ارزیاب اصالت مدارک) checks uploaded documents for integrity and accuracy:

- `GET /api/v1/documents/verification-queue` — documents with `verificationStatus = PENDING`.
- `POST /api/v1/documents/:id/verify` `{ status, note }` — records a decision
  (`VERIFIED` / `REJECTED` / `NEEDS_INFO`), stamped with the assessor's id and time, audit-logged.

## Design choices worth your call

Separate `view:pii` (unmask National ID on screen) from `export:pii` (unmask in exports) so an
assessor can read a scan without being able to bulk-export identity numbers. Both are optional and
off by default. See the open questions raised with you for maker-checker approvals, branch-scoped
visibility, and temporary/time-boxed roles.
