# Reconnaissance report — legacy `omr.bimmes.ir`

Captured by structural inspection of the front-end code and DOM only. **No insurance record
was rendered, and no personal-data values were read or stored.** Field names and section
structure below come from the site's own JavaScript, CSS class names, and form markup.

## 1. Routes & endpoints

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET  | `/` , `/panel` | Public inquiry landing — National ID form | none |
| POST | `/api/get_fields.php` | Returns rendered case HTML for a `national_code` | **none** |
| GET  | `/insurance_status.php?national_code=<id>` | Full status page for a National ID | **none** |
| GET  | `/admin` | Admin login (username + password) | form login |
| —    | admin "fields" page | Case management: filter, table, edit, export | session |

Stack: server-rendered PHP, jQuery + Bootstrap RTL, IRANYekanX font, MySQL (inferred).

## 2. Confirmed security defects

1. **IDOR + missing auth (critical).** `get_fields.php` (POST) and `insurance_status.php`
   (GET) return a person's full record for any `national_code`, with no session, token, OTP,
   or rate limit. National IDs are enumerable, so the entire database is scrapeable.
2. **PII in the query string.** `insurance_status.php?national_code=<id>` puts a National ID
   in the URL — captured in browser history, server logs, referrer headers, and CDN caches.
3. **Weak admin auth.** Single username/password form, no MFA, no visible rate limiting or
   lockout, no RBAC/roles.
4. **Single-tenant.** No organization/tenant concept anywhere in the markup or routes.
5. **No encryption at rest** (inferred): PHP/MySQL storing National IDs and identity data in
   plaintext.
6. **Fake export.** `downloadPDF()` in `main.js` is a stub — it downloads a placeholder
   `.txt` reading "this feature will be added in future versions." Only `printResult()`
   (a print window) actually works.

## 3. Surfaces & their structure (from CSS/JS class maps)

### 3a. Public status page (`insurance_status.css`)
- `.status-overview` → `.overview-card` summary tiles (success / warning states).
- `.info-section` → `.section-header`/`.Section-Title` → `.info-list` → `.info-item`
  (`.info-label` + `.info-value`). Repeated label/value sections.
- `.status-badge` `.status-active` / `.status-inactive`.
- `.payment-info-btn` opens `#paymentModal` → `.payment-history` → `.payment-list` →
  `.payment-item` (`.payment-date`, `.payment-details`, `.payment-amount`/`.amount`,
  `.status` success/pending).

### 3b. Admin case management (`fields.css`)
- `.filters-card` → `.filter-form` filters, `.filter-actions`.
- `.fields-table`/`.table` paginated (`.fields-pagination`) list with `.beneficiary-type`
  column and per-row `.action-buttons`/`.action-btn`.
- Case-status control `#vaziat_parvandeh` with badge states:
  `paid`, `reviewing`, `unpayable`, `other` (mirrored `.status-*` and `.input-status-*`).
- `.results-summary` + `.export-btn` (list export). `.edit-mode-badge`, `.loading-overlay`.
- Edit form: `.fields-form` → `.form-label` + `.form-control`, `.date-input` (Jalali).

### 3c. User panel (`panel.css`)
- `.insurance-header`/`.company-name`, card grid (`.insurance-card`, `.col-md-4`) of policies
  with `.info-item` and active/inactive status, plus a `.search-card`.

## 4. Domain model discovered

This is a **life-insurance death-claim (فوت) case tracker**: a beneficiary files a claim on a
deceased policyholder, and the brokerage tracks it through workflow stages to payout.

Workflow date fields (from `main.js` datepicker init) — see `DATA-DICTIONARY.md` for the full
mapping:

`tarikh_fot`, `tarikh_elam_fot`, `tarikh_bime`, `takmil_naghs_date`, `ersal_madarek_date`,
`pardakht_date`, `marhale_parvandeh_date`, `elam_kargozari_date`, `elam_kargozari_shobe_date`,
`darkhast_madarek_date`, `darkhast_kasri_madarek_date`, `ersal_setad_date`,
`taeed_parvandeh_date`, `bargasht_shobe_date`.
