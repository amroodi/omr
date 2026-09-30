# Data dictionary — legacy fields → new models

Maps the fields discovered on `omr.bimmes.ir` to the rebuilt schema (`apps/api/prisma/schema.prisma`).
Legacy names are the raw `id`/`name` attributes and CSS hooks found in the site's JS/CSS.
Sensitivity column drives encryption: **E** = AES-256-GCM field encryption, **H** = hashed
(blind-index) for lookup, **P** = plaintext.

## Tenant (new — did not exist in legacy)

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | tenant id, on every downstream row |
| slug | string | subdomain / white-label key |
| name | string | e.g. "آتیه اندیشان دامون" |
| logoUrl, faviconUrl | string | white-label branding |
| primaryColor | string | theme |
| contactHeader | string | injected into PDF/Excel exports |
| carrierConfig | json (E) | upstream carrier creds (Alborz etc.), encrypted |

## Branch & Org users (new)

| Field | Type | Notes |
|-------|------|-------|
| Branch.name, .code | string | brokerage branch (شعبه) |
| OrgUser.roleId | uuid | RBAC role within tenant |
| OrgUser.username | string | replaces legacy admin login |
| OrgUser.passwordHash | string | argon2id (legacy: unknown/weak) |
| OrgUser.totpSecret | string (E) | optional MFA |

## InsuredParty — policyholder / deceased

| Legacy hook | Field | Type | Sens. | Notes |
|-------------|-------|------|:----:|-------|
| `national_code` | nationalCode | string | **E** | plus `nationalCodeHash` (H) blind index for lookup — replaces the IDOR key |
| `.info-value` (name section) | fullName | string | E | |
| — | fatherName | string | E | |
| — | birthDate | jalali date | P | stored ISO, shown Jalali |
| `tarikh_fot` | dateOfDeath | jalali date | P | date of death (فوت) |
| `tarikh_elam_fot` | deathReportedAt | jalali date | P | death notification date |
| — | phone | string | E + H | |
| — | address | string | E | |

## Beneficiary — claimant(s)

| Legacy hook | Field | Type | Sens. | Notes |
|-------------|-------|------|:----:|-------|
| `.beneficiary-type` | beneficiaryType | enum | P | spouse/child/parent/other (ذینفع) |
| — | nationalCode | string | E + H | |
| — | fullName | string | E | |
| — | relationship | string | P | |
| — | sharePercent | decimal | P | payout share |
| — | iban | string | E | payout account |

## Policy

| Legacy hook | Field | Type | Sens. | Notes |
|-------------|-------|------|:----:|-------|
| `tarikh_bime` | startDate | jalali date | P | policy/insurance date |
| — | policyNumber | string | P | |
| — | carrier | string | P | e.g. Alborz (البرز) |
| — | productType | string | P | life/death coverage |
| — | sumInsured | decimal | P | coverage amount |
| — | status | enum | P | active / inactive (`.status-active/-inactive`) |

## Case (پرونده) — the claim workflow

| Legacy hook | Field | Type | Sens. | Notes |
|-------------|-------|------|:----:|-------|
| `#vaziat_parvandeh` | status | enum | P | `paid` / `reviewing` / `unpayable` / `other` |
| `marhale_parvandeh_date` | stageDate | jalali date | P | current stage date |
| `elam_kargozari_date` | brokerageNotifiedAt | jalali date | P | |
| `elam_kargozari_shobe_date` | branchNotifiedAt | jalali date | P | |
| `darkhast_madarek_date` | docsRequestedAt | jalali date | P | |
| `darkhast_kasri_madarek_date` | missingDocsRequestedAt | jalali date | P | |
| `ersal_madarek_date` | docsSentAt | jalali date | P | |
| `takmil_naghs_date` | deficiencyCompletedAt | jalali date | P | |
| `ersal_setad_date` | sentToHqAt | jalali date | P | ارسال به ستاد |
| `taeed_parvandeh_date` | approvedAt | jalali date | P | |
| `bargasht_shobe_date` | returnedToBranchAt | jalali date | P | |
| `pardakht_date` | paidAt | jalali date | P | |

## Payment (from `#paymentModal` / `.payment-item`)

| Legacy hook | Field | Type | Sens. | Notes |
|-------------|-------|------|:----:|-------|
| `.payment-date` | date | jalali date | P | |
| `.payment-details` | description | string | P | |
| `.payment-amount`/`.amount` | amount | decimal | P | Rial/Toman |
| `.status` (`success`/`pending`) | status | enum | P | paid / pending |

## Document (new — legacy had no OCR upload)

| Field | Type | Sens. | Notes |
|-------|------|:----:|-------|
| kind | enum | P | nationalIdScan / policyScan / deathCert / other |
| storageKey | string | P | object-storage key (private bucket) |
| ocrText | text | E | extracted text may contain PII |
| ocrFields | json | E | auto-populated form values |

## AuditLog (new — legacy had none)

| Field | Type | Notes |
|-------|------|-------|
| actorType, actorId | enum/uuid | who (org user, insured, system) |
| action | enum | VIEW / EXPORT / EDIT / UPLOAD / DELETE / LOGIN / OTP_ISSUE |
| targetType, targetId | string | what record |
| ip, userAgent | string | request context |
| jalaliTimestamp | string | rendered Shamsi time (plus UTC `createdAt`) |
| prevHash, hash | string | hash chain for tamper-evidence |

## Export column mappings

Both legacy exports were print-only or stubbed. The rebuild produces real XLSX/PDF. Default
case-list export columns (per tenant-overridable template):

`ردیف, کد ملی (masked), نام بیمه‌گذار, نوع ذینفع, تاریخ فوت, مرحله پرونده, وضعیت پرونده, مبلغ پرداختی, تاریخ پرداخت`

National ID is **masked** by default in exports (`•••••1478`); full value requires an explicit
permission (`export:pii`) and is audit-logged.
