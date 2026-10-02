# Death-claim workflow — structural design (proposal)

Goal: replace physical document forwarding (city-to-city, branch-to-branch) with a digital,
auditable approval hierarchy for life-insurance death claims — sellable to **any** insurer
(بیمه‌گر) or brokerage (کارگزاری / معرف).

This is a proposal for review. Open questions at the end are now resolved — see "Confirmed
decisions" immediately below.

## 0. Confirmed decisions

1. **Cross-tenant.** Each insurer (INSURER) and each brokerage (BROKER) is its own organization,
   and a claim is routed BETWEEN them. Claim access follows the **parties to the claim** (the
   filing بیمه‌گزار, the معرف org, the insurer org and its levels) via a `ClaimParticipant` grant,
   not the global per-tenant scope.
2. **Configurable hierarchy.** Each insurer defines its own ordered approval levels and ceiling
   amounts; the four-level set (بیمه‌گر → مدیریت فنی → معاون شورای فنی → شورای فنی) is the default.
3. **رفع نقص restarts the whole chain.** After rectification the claim re-enters at the first
   reviewer and passes through every level in sequence again — no skips, no straight-forwarding to
   the level that raised the deficiency. The upward climb still stops at the first level whose
   ceiling covers the amount (that level approves → payment); escalation is strictly sequential
   L1→L2→L3→L4, never jumping a level.
4. **معرف identity.** DIRECT channel: the معرف is the **insurer branch that sold the policy** (e.g.
   Alborz, Kerman branch). BROKER channel: the معرف is the **brokerage tenant**. In both cases معرف
   is a mandatory control step (کنترل مدارک) before the insurer's authority chain.

## 1. Participants (the chain)

| Party (fa) | Role | What they do |
|------------|------|--------------|
| **بیمه‌شده (متوفی)** | Insured, deceased | The policyholder's insured person who has died. Subject of the claim, not a user. |
| **بیمه‌گزار** | Policyholder / claim filer | Handles the deceased's affairs. Files the claim: نامه اعلام خسارت + بارگذاری مدارک + ثبت‌نام. Replaces today's «پورتال مشتری». |
| **معرف** | Introducer | A **broker** (when the policy was bought through one) or the **insurer's own intake** (direct sales). Does: بارگذاری/کنترل مدارک + ارسال برای بیمه‌گر. |
| **بیمه‌گر** | Insurer (claims unit) | The insurance company that sold the policy. Entry reviewer; approves within its authority or escalates. |
| **مدیریت فنی مربوطه** | Technical Management | Next authority level; approves within its ceiling or escalates. |
| **معاون شورای فنی** | Council Deputy | Gateway that forwards high-value claims to the council. |
| **شورای فنی** | Technical Council | Final authority for the highest-value claims. |

## 2. Organizations & tenancy

Each platform customer is a **Tenant** with a **kind**:

- `INSURER` (بیمه‌گر) — owns an internal approval hierarchy (claims unit → technical management →
  council deputy → technical council) and authority ceilings.
- `BROKER` (کارگزاری) — acts as معرف, introduces claims to one or more insurers.

A claim can therefore span **two independent tenants** (a broker and an insurer). The platform
operator (Damuon) provisions both and governs the trust relationship between them (which brokers
may submit to which insurer), building on the existing cross-org sharing model.

## 3. Authority ceilings (سقف اختیارات)

Each insurer configures an ordered list of **approval levels**, each with a monetary **ceiling**:

```
L1  بیمه‌گر (claims unit)        ceiling C1
L2  مدیریت فنی مربوطه            ceiling C2  (C2 > C1)
L3  معاون شورای فنی              gateway → council
L4  شورای فنی                    final (unlimited)
```

Levels and ceilings are **configurable per insurer** (companies differ), with this 4-level set as
the default. This is essential for selling to many companies.

## 4. Routing & escalation engine

Let `A` = claimed/insured amount. A claim entering the insurer starts at **L1** and moves by this
rule at each level `Lk` (ceiling `Ck`):

1. **Docs deficient** → `RETURN_INCOMPLETE` with a deficiency list → claim travels **down** the
   chain to بیمه‌گزار (through معرف if broker channel).
2. **Docs OK and `A ≤ Ck`** → `APPROVE` at this level → final approval → decision cascades **down**
   to بیمه‌گر, who executes **payment (پرداخت)**.
3. **Docs OK and `A > Ck`** → `ESCALATE` to `L(k+1)`.
4. **Substantive rejection** → `REJECT` (final) → cascades down.

The council (unlimited) must end in APPROVE / REJECT / RETURN_INCOMPLETE. "High prices usually
reach the Technical Council" falls out of this naturally.

**Decision cascade:** once a level finalizes (approve or reject), the outcome flows back down
L(k-1)…L1 → بیمه‌گر → (معرف) → بیمه‌گزار. Intermediate levels record acknowledgement; the entry
بیمه‌گر performs the payout on approval.

## 5. Sales-channel routing

The policy carries a **channel**:

- **DIRECT** (bought from the insurer): بیمه‌گزار → بیمه‌گر, where the معرف step is performed by the
  insurer's own intake unit.
- **BROKER** (bought through a brokerage): بیمه‌گزار → معرف (broker) → بیمه‌گر.

So معرف is always a control step; **who** performs it (broker tenant vs insurer intake unit)
depends on the channel.

## 6. Deficiency loop (نقص مدارک ↔ رفع نقص)

Any reviewer (معرف, بیمه‌گر, مدیریت فنی, council) may return the claim as **نقص مدارک** with a list
of specific missing/invalid documents. The claim returns down to بیمه‌گزار, who performs **رفع نقص**
(fix + re-upload) and resubmits, sending it back up the chain. Each loop is fully recorded.

## 7. Proposed data model (evolves the current schema)

- **Tenant.kind**: `INSURER | BROKER`.
- **ApprovalLevel** (per insurer): `{ tenantId, name, order, ceiling (Decimal, null = unlimited),
  kind: INSURER_CLAIMS | TECHNICAL_MGMT | COUNCIL_DEPUTY | TECHNICAL_COUNCIL }`.
- **Claim** (evolves today's `Case`): `{ deceasedInsuredId, policyHolderId, policyId,
  claimedAmount, salesChannel, brokerTenantId?, insurerTenantId, status, currentStepId }`.
  - `status`: `DRAFT | SUBMITTED | UNDER_REVIEW | RETURNED_INCOMPLETE | APPROVED | REJECTED | PAID`.
- **ClaimStep** (one hop in the chain): `{ claimId, order, partyType (POLICYHOLDER | BROKER |
  INSURER_LEVEL), levelId?, holderTenantId, holderUserId?, state (PENDING | APPROVED | FORWARDED |
  ESCALATED | RETURNED_INCOMPLETE | REJECTED), direction (UP | DOWN), decidedById, decidedAt,
  note }`. The ordered steps are the claim's audit-grade routing history.
- **ClaimDeficiency**: `{ claimId, stepId, items: string[], raisedById, resolvedAt? }`.
- **ClaimDocument**: a `Document` typed by the required-documents list (provided later), attached to
  the claim and re-usable across resubmissions.

The existing maker-checker on `Payment` becomes the **final payout authorization** inside بیمه‌گر
after claim approval, which fits the four-eyes control already built.

## 8. Role & realm renames

- Realm «پورتال مشتری» → **بیمه‌گزار** (policyholder realm): files claims, uploads docs, does رفع نقص,
  tracks status and sees the final result.
- New org roles: معرف (broker control), بیمه‌گر claims reviewer, مدیریت فنی reviewer, معاون شورای فنی,
  عضو شورای فنی — each mapped to approval levels and permissions.

## 9. Access model

A claim is visible to: its بیمه‌گزار (own claims only), the معرف tenant that introduced it, and the
بیمه‌گر tenant processing it — each seeing only the fields appropriate to their step. Enforced by
claim-scoped grants layered on the per-tenant isolation already in place; never the global scope.

## 10. Migration approach

`Case` is renamed/extended to `Claim` with the routing fields; existing cases map to claims in the
DIRECT channel at L1. Done as a Prisma migration once the structure is agreed.

## Open questions (see the questions asked alongside this doc)

1. Cross-tenant claims (broker ⇆ insurer as separate tenants) vs single-company deployments.
2. Configurable levels/ceilings vs a fixed 4-level hierarchy.
3. On رفع نقص, re-enter at the returning level or restart from the first reviewer.
4. In DIRECT channel, keep a معرف control step (insurer intake) or submit straight to بیمه‌گر.
