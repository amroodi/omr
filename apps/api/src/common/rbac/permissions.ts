/**
 * Permission catalog. Roles hold a subset of these strings; controllers require them via
 * @Permissions(). Keep flat and explicit — granular toggles map cleanly to admin UI switches.
 */
export const PERMISSIONS = {
  // Cases / policies
  CASE_READ: 'case:read',
  CASE_CREATE: 'case:create',
  CASE_EDIT: 'case:edit',
  CASE_DELETE: 'case:delete',
  POLICY_READ: 'policy:read',
  POLICY_EDIT: 'policy:edit',

  // Payouts (maker-checker / four-eyes)
  PAYMENT_PROPOSE: 'payment:propose', // create a payout awaiting approval (maker)
  PAYMENT_APPROVE: 'payment:approve', // approve/reject a proposed payout (checker)

  // Exports
  EXPORT_LIST: 'export:list',
  EXPORT_PII: 'export:pii', // unmask National IDs in exports (audit-logged)

  // Documents / OCR
  DOC_UPLOAD: 'doc:upload',
  DOC_READ: 'doc:read',
  DOC_VERIFY: 'doc:verify', // assess authenticity/integrity of uploaded documents
  OCR_RUN: 'ocr:run',

  // PII visibility
  VIEW_PII: 'view:pii', // unmask National IDs on screen (separate from export:pii)

  // Import
  IMPORT_BATCH: 'import:batch',

  // Org administration
  USER_MANAGE: 'user:manage',
  ROLE_MANAGE: 'role:manage',
  BRANCH_MANAGE: 'branch:manage',
  AUDIT_READ: 'audit:read',
  TENANT_SETTINGS: 'tenant:settings', // white-label, branding, carrier config

  // Platform (super-admin only, checked separately)
  TENANT_MANAGE: 'tenant:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Default system roles seeded per tenant. */
export const SYSTEM_ROLES: Record<string, Permission[]> = {
  'مدیر سازمان': Object.values(PERMISSIONS).filter(
    (p) => p !== PERMISSIONS.TENANT_MANAGE,
  ) as Permission[],
  کارشناس: [
    PERMISSIONS.CASE_READ,
    PERMISSIONS.CASE_CREATE,
    PERMISSIONS.CASE_EDIT,
    PERMISSIONS.POLICY_READ,
    PERMISSIONS.DOC_UPLOAD,
    PERMISSIONS.DOC_READ,
    PERMISSIONS.OCR_RUN,
    PERMISSIONS.EXPORT_LIST,
    PERMISSIONS.IMPORT_BATCH,
    PERMISSIONS.PAYMENT_PROPOSE,
  ],
  // Four-eyes approver: can authorize payouts but cannot propose them.
  'تاییدکننده پرداخت': [PERMISSIONS.CASE_READ, PERMISSIONS.PAYMENT_APPROVE],
  'فقط مشاهده': [PERMISSIONS.CASE_READ, PERMISSIONS.POLICY_READ, PERMISSIONS.DOC_READ],
  // Assessor of document authenticity — reviews uploaded docs for integrity/accuracy.
  'ارزیاب اصالت مدارک': [
    PERMISSIONS.CASE_READ,
    PERMISSIONS.DOC_READ,
    PERMISSIONS.DOC_VERIFY,
  ],
  // Handles bulk data in/out only.
  'مسئول ورود و خروج داده': [
    PERMISSIONS.CASE_READ,
    PERMISSIONS.IMPORT_BATCH,
    PERMISSIONS.EXPORT_LIST,
  ],
};
