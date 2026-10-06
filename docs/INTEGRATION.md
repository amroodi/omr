# Website Integration Guide

Two safe ways to connect an organization's public website to its platform VPS. Neither shares the
database or exposes the admin panel. Configure both from the panel under **اتصال و API** (`/org/integration`).

> Context: each organization runs its own VPS (see [SECURITY.md](SECURITY.md) Part 3). The public
> website only ever talks to **public, rate-limited** endpoints (the widget) or a **scoped API key**
> (server-to-server) — never an admin token, never the database.

---

## Option A — Embeddable inquiry widget (iframe)

Best when the website has no backend (even shared hosting). The policyholder enters National ID +
mobile, receives an OTP by SMS, and sees their claims' status — all inside a sandboxed iframe served
by the VPS.

### Setup
1. In **اتصال و API → ویجت استعلام**, add every website domain that may show the widget (e.g.
   `https://damuon.ir`, `https://www.damuon.ir`).
2. Copy the embed snippet and paste it into any page of the website:

```html
<iframe src="https://panel.damuon.ir/api/v1/embed/inquiry?tenant=damuon"
        width="100%" height="560" style="border:0;max-width:440px"
        title="استعلام پرونده خسارت"></iframe>
```

### Why it's safe
- The widget page is served with `Content-Security-Policy: frame-ancestors 'self' <your domains>`, so
  **only the domains you allow-listed can frame it** (blocks clickjacking). Any other site is refused
  by the browser.
- It loads **no external scripts, fonts, or styles** (tight CSP), and calls only the VPS's own
  public OTP endpoints (same-origin to the iframe).
- No API key or secret is placed on the website. Authentication is the policyholder's own OTP.

---

## Option B — Scoped API key (server-to-server)

Best when the website has its own backend (PHP, Node, etc.) and wants to show claim status in its own
UI. The website's **server** calls the VPS API with a key; the browser never sees the key.

### Create a key
In **اتصال و API → کلیدهای API**: name it, pick scopes, create. **The full key is shown once** —
copy it immediately; only a hash is stored. Format: `omr_live_<prefix>.<secret>`. Revoke anytime.

### Scopes
| Scope | Grants |
| --- | --- |
| `claim:status` | Read-only claim status by claim number + National ID. No names, amounts, or documents. |

### Endpoint: claim status
```
GET /api/v1/partner/claim-status?claimNumber=<CLM-…>&nationalCode=<کدملی>
Header: x-api-key: omr_live_<prefix>.<secret>
```
Returns (only when the National ID matches the claim's insured — otherwise `404`, identical to a
missing claim so nothing leaks):
```json
{
  "claimNumber": "CLM-MUWDLEJP-E824",
  "status": "UNDER_REVIEW",
  "statusLabel": "در حال بررسی",
  "claimType": "DEATH_ILLNESS",
  "lastUpdated": "2026-10-06T07:47:11.465Z",
  "noticeDeadline": null,
  "missingDocuments": ["…"]   // only when status is RETURNED_INCOMPLETE
}
```

### PHP example (shared hosting)
```php
<?php
$key = getenv('OMR_API_KEY'); // store in server config, NEVER in client-side code
$q = http_build_query(['claimNumber' => $_POST['claim'], 'nationalCode' => $_POST['nid']]);
$ch = curl_init("https://panel.damuon.ir/api/v1/partner/claim-status?$q");
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => ["x-api-key: $key"],
]);
$res = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
echo $code === 200 ? $res : 'پرونده یافت نشد';
```

### Rules
- **Keep the key on the server only.** Never put it in HTML, JavaScript, or a mobile app.
- Both National ID **and** claim number are required, so a leaked key alone can't enumerate records;
  requests are rate-limited (per key and per IP) and every lookup is audited.
- **Rotate** by creating a new key, switching the website to it, then revoking the old one.
- Keys are tenant-scoped: a key only ever sees its own organization's claims.

---

## Which to choose

| Website situation | Use |
| --- | --- |
| Shared hosting / no backend | **Widget** (Option A) |
| Wants status inside its own pages, has a backend | **API key** (Option B) |
| Just wants to send users to the panel | A plain link to `https://panel.<org>.ir` |

Both can be used together. For anything beyond status lookup, add a new scope + endpoint rather than
widening an existing key.
