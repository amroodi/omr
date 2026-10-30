# Proposal: a separate database per organization

**Status:** proposal only. Nothing here has been built yet.

## The question

Should each organization (the کارگزاری, Alborz and every insurer added later) have its own database instead of sharing one?

## Why it is not a simple split

A claim is **shared**. The same پرونده is filed at the کارگزاری, handed to the insurer's شعبه, then to ستاد and شورای فنی, and back. Both organizations work on the same record: its steps, documents, letters and messages. The record holds `brokerTenantId` and `insurerTenantId`.

If each organization had its own database:

- the hand-off from کارگزاری to بیمه‌گر would become a copy between two databases;
- every later action (return for missing documents, payment order) would have to be copied back;
- the two copies can drift apart, and a copy that fails half-way leaves a case in two states;
- reports that span both sides (the brokerage's view of its cases at Alborz) would need two databases joined in code.

That is a lot of risk for a benefit we mostly already have.

## What protects each organization today

- Every row carries its organization (`tenantId`). The data layer (`prisma.scoped`) adds the organization filter to every query automatically, so a user of one organization cannot read another's rows.
- Shared claims are reachable only by the two organizations named on them.
- Personal data (names, national codes, phones, IBANs) is encrypted per field (AES-256-GCM). A database dump alone does not expose it.
- Logins, panels and permissions are separate per organization and per desk.

## Recommendation: three steps, in order of value

1. **Now (no app change): one database, stronger walls.**
   - Turn on PostgreSQL **row-level security** for the main tables, keyed on the organization. The database itself then refuses cross-organization reads, even if application code had a bug.
   - Keep encrypted fields, backups and the read replica as they are.
2. **When an insurer requires it by contract: a separate database for that insurer's private data only.**
   - Their own settings, users, internal notes and archives go into their own database or schema.
   - Shared claims stay in the shared database, since both sides must see the same record.
   - The app already has a single place that picks the database client (`PrismaService`), so this can be added per organization without touching the screens.
3. **Only if a regulator demands full physical separation:** run a separate copy of the whole platform for that insurer, with the brokerage connecting to it through an API. This is the most expensive option and should only be done when it is mandatory.

## Suggested next step

Step 1 (row-level security) is a self-contained change: a migration plus setting the organization on each database connection. It gives the "separate database" protection users actually care about, without the risks above.
