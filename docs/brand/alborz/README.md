# Alborz Insurance (بیمه البرز) — theme notes for Phase 3

Source: screenshots of sinad.alborzinsurance.ir in `docs/Alborz/` (colours sampled from pixels,
2026-10-23). alborzinsurance.ir itself was unreachable from our tooling (timeouts / blocked), and no
official SVG logo was found publicly — **ask Alborz for the vector logo + brand guide at the meeting**.

## Palette

| Role | Hex | Where it appears |
|---|---|---|
| Logo green (brand) | `#097334` / `#007a32` | emblem ring + «بیمه البرز» wordmark |
| Primary action (teal) | `#00bd9c` | page titles, «جستجو», «معرفی امکانات سامانه» buttons |
| Login button green | `#57b846` | «ورود به سامانه» on the login card |
| Sidebar (navy-slate) | `#2f4358` | sidebar / icon rail background |
| Sidebar active row | `#3a4d63` | expanded menu rows |
| Sidebar deep | `#263648` / `#1e2c3a` | header strip, separators |
| Accent (indigo) | `#3e4095` | dashboard stat icons |
| Canvas | `#eff2f5` | content background |
| Tile strip | `#e6e6e6` | Work Desk queue strip |
| Login background | `#5a57cd → #c150c1` (gradient, with `#4458d0` bottom-left) | full-page login backdrop |
| Login link tiles | `#c8dcff` | «بیمه شده» / «پذیرش و ارزیابی» link buttons |

Typeface: Vazirmatn-like Persian sans (matches ours).

## Mapping onto our tokens (globals.css)

`--brand` → `#00bd9c` (teal is their interactive colour), `--brand-600/700` darker teal,
`--brand-soft` → `#e0f7f2`; sidebar navy → `#2f4358` (ours is already a close navy — the Sinad
structure we mirrored *is* this portal); logo circle stays white with the green emblem.
Login page: purple→magenta gradient + white card + green primary button.

## Files

- `alborz-logo-stacked.png` — emblem over wordmark (from the login card, ~155 px)
- `alborz-logo-horizontal.png` — wordmark + emblem lockup (~235 px)
- `alborz-logo-circle.png` — emblem in the white sidebar circle (~250 px)

Low-resolution crops — good enough for the demo; replace with Alborz's official vector files.

## Built (Phase 3)

- Theme lives on the tenant (`Tenant.theme`, preset `alborz` in `apps/api/src/modules/branding/theme.ts`);
  editable in **تنظیمات سازمان → قالب رنگی پنل** (or super-admin `PATCH /tenants/:id { theme: "alborz" }`).
  Tenants without a theme (Damuon) keep the default design.
- Alborz operators' login link: **`/org/login?org=alborz`** — Sinad-style gradient login with their logo.
- Demo data for the presentation (dev/demo DB only, `SMS_DRIVER=console`):

      cd apps/api && npx prisma db seed && npx ts-node --files prisma/seed-alborz-demo.ts

  Creates the tenant + theme + logo, 3 branches, one user per desk (passwords in
  `prisma/seed-output-alborz.local.txt`, git-ignored) and 5 claims at different stages, driven
  through the real workflow engine.
