# PM 1.0 — status against the delivery package

Audit of 1 Oct 2026 against `Delivery-PM-1.0` (PRD-PM-1.0: 126 requirements — 52 P0 · 64 P1 · 10 P2, plus 12
non-functional and 23 invariants; `Prototype-PM-v21.html`; `PM-Pipeline-1.0`; the QA packs; `R1-start/boq-template.csv`).
Method: nine area reviews of the code against the PRD and the prototype's own functions, each finding then re-read
in the code before anything was changed; every fix has a test that failed before it.

A second session pushed PM and Procurement parity work the same day (`17dbd58` … `c5442df`); it is merged in
(`b6a1b61`) and what it built is not repeated here.

**State (1 Oct 2026):** the rules are **live on UAT** (12:29 UTC, ruleset `46392b47…`) **and on prod** (12:31 UTC,
ruleset `4a0a660b…`); both match `firestore.rules` as committed in `86508ce`. The code is committed on `main` and
`uat` and reaches each site when its branch is pushed. **Not yet exercised by a signed-in user** — the click-through
in §6 is still owed, on UAT first.

## 1. What the package asks for and the product has

All 117 actions of the prototype have a product equivalent; the six role templates and the three system ceilings
match the PRD's matrix (`pm-access.test.ts`); no translation key is missing in either language (5,190 checked).
Built and working as specified: handover inbox and acceptance, manual projects, terms before start and the frozen
original, addenda, BOQ import and pricing, measurement and its inspection gate, certificates (§8.6 maths), variations,
claims and the programme, submittals, NCR, punch list, units, weekly plan, daily report, obstacles, HSE, documents,
letters, supply requests and the project store, plant on site, subcontracts and their certificates, cost and the
monthly reconciliation, provisional and final handover, the close-out gate and the archive, sections governance,
Today and the portfolio.

## 2. Security — closed in the rules (live on both environments)

The Jest suites run over an in-memory Firestore with no rules, so none of this showed in tests. Traced from the
rule text to the client's exact writes (no emulator on this machine); pinned by `src/__tests__/pm-rules.test.ts`
(16 of its 17 cases fail on the previous rules).

| What was possible | Fix |
|---|---|
| **Account takeover, platform-wide.** Any signed-in user could create an invitation addressed to his own e-mail with any organisation and role, then rewrite his own user record from it — owner of any company, or platform Admin. | Invitations are created by the server only and are never rewritten (answered, cancelled or re-sent). The "invitation addressed to me" branch of the user self-update is removed. The accept API never confers `Admin`. The team page no longer joins from a token-less legacy invitation — it says the invitation is outdated. |
| Any signed-in account of any company could **list every company's** projects, handover files and Finance events. | `list` on `projects`, `pmHandovers`, `pmEvents` is the caller's organisation's. |
| Two companies' `PJ-2026/001` shared one outbox document: the second company's handover acceptance, first certificate, handover, unit handover, financial addendum and reconciliation were refused. | An event's id is `{organisation}__{key}` (`pmEventDocId`); the journal's source id stays the key. |
| A seat could carry any permission group — a QS could seat himself with the super-admin group on a project. | A seat's group is the person's own default group, or none. |
| `team.manage` could create or rewrite PM seats (role, removed duties, exit, log); any `projects.edit` holder could adopt a project into PM. | PM seats move only through the PM branches; adoption is the owner's. |
| A project with its manager cleared (`null`) still counted as managed. | "Has a manager" asks for a real id. |
| The warehouse manager could approve a PM request; Procurement could buy one the project manager had not approved (REQ-02). | Refused in the rules and in the write (`need_awaits_pm`). |

Legitimate operations the rules refused, now allowed: the owner replacing or removing the project manager; a
`prep` holder numbering an addendum; the acceptance wizard's BOQ groups; Finance recording a collection on a
certificate of an archived project; an adopted project's manager (a seat with no group) using his default group;
a withdrawn or self-approved subcontract certificate; a subcontract certificate settled at zero; setting a plant
day rate; the award's link on a project request; a stop on an order awaiting approval or raised for several projects.

## 3. Fixed, each with a failing test first

| Area | What was wrong | Test |
|---|---|---|
| Contract value (INV-01, RET-01, AMD-09) | Certificates and addenda measured the retention cap and the advance against the handover figure — approved variations ignored, and zero on a project created without a value (nothing was ever retained) | `pm-contract-value` |
| Contract in force (CON-05, AMD-04) | A signed addendum never reached the screens and writes of people who may not read addenda: measurement kept the original basis, units kept the original retention, the payer stayed the original | `pm-terms-inforce` |
| Start (CON-01, P0) | The package's own BOQ template through the acceptance wizard imported 2 of 10 lines, with dates for codes and no unit cost — and said "loaded". A CSV is now read as the template is written; a file with a rejected row is never imported in part | `pm-boq-template` |
| Advance (WF-01) | An advance entered while completing the terms never reached Finance. Sent once when the project goes live (Start or the first approved measurement) | `pm-advance-start` |
| Finance | Collections stored as a share rounded to 4 places refused the true remainder; a collection or release in a locked month left the certificate changed and the entry missing; a subcontract certificate whose recoveries took its net could never be paid, and blocked closing | `pm-finance-collection`, `accounting-pm-postings` |
| Archive (CST-04) | Cost and margin always "—" (the table read a field the snapshot never wrote); actual duration ran to FINAL acceptance, so every project was a year late; earned excluded variations | `pm-closeout`, `pm-portfolio` |
| Close-out | Plant still on site did not block closing (it could then never be handed back); rework cost summed the first estimate | `pm-closeout` |
| Claims, variations | A time claim approved with 0 days; a variation's executed share lowered below what was billed | `pm-audit-contract` |
| Measurement | On re-measurement an item at 100% could no longer be measured; the inspection gate ignored the section being off; the measuring day was checked only in the dialog; the approver got "could not save" instead of the reason | `pm-measurement` |
| Team | Seating a manager before he had his group saved all his duties as removed, for good | `pm-team` |
| Adoption | Started "today" (elapsed 0), an invented 5% cap frozen as original, a cancelled project half-adopted | `pm-adopt` |
| Sections | Switching ANY section off on an infrastructure or maintenance preset also dropped certificates and collection | `pm-sections` |
| Today | One record with a missing date took down Today, Projects, the inbox and Pulse; "certificate ready" ignored variations and returned deductions; decisions of switched-off sections were still raised; a line whose order awaits approval counted as incoming | `pm-fixwave-a`, `pm-exec-parity` |
| Plant | A unit received by a site engineer had no day rate and no way to get one (cost 0, idle never flagged); breakdown days counted as idle; the charge ran after the desk's confirmation; off-hire dates out of order; nobody named on a rewritten day | `pm-plantsub-plant` |
| Subcontracts | No way to withdraw a prepared certificate (a one-person company was stuck); a recovery larger than the certificate; the custody gap grew with later issues and could be recovered twice | `pm-plantsub-certs`, `pm-plantsub-custody` |
| Units | An equal split rounded every share up — the last unit could not be handed over; a handover always freed half the retention whatever the release term; units set up before the BOQ were permanent; "Infinity%" | `pm-execfix-units`, `pm-units` |
| Weekly plan, documents, inspections | A week not closed in time could never be closed; "stale drawing" had two definitions (MS-05: after the last approved measurement); an inspection showed its booked day as the day raised | `pm-execfix-*` |
| Supply ↔ Procurement | **Material bought through an RFQ could never be received** — the award never told the request its order; two lines of one material collapsed on the desk; a stop flagged the wrong order line, or none before the order was accepted; receipts were per line, not per portion (100 received when the store issued 40); 99.5% closed a line "full"; a change decided after sourcing never reached Procurement; the sample mark was dropped on rewrites; Inventory's reason was a stored sentence | `pm-supplyfix-*` |

## 4. Verified and still open

Money first. Each needs a decision or a larger change than this audit made.

| # | Requirement | Defect |
|---|---|---|
| 1 | CST-01, CST-03, CVR-01 | **"Actual cost" counts material when it is RECEIVED, and compares it with the budget of what was EXECUTED.** Material delivered ahead of the work shows as a bleeding item, a negative margin, and a forecast multiplied by 1/progress — which the monthly reconciliation sends to Finance as the estimate at completion. The prototype's actual is the cost of executed work. Proposed: count project-store material at use (the store logs it per item), not at receipt. A change of what a figure means on five screens — the owner's decision. |
| 2 | HO-01 (P0) | The CRM handover file never carries the BOQ: the wizard's "from the winning bid" source is unreachable; the region is not sent either. |
| 3 | STK, P-receipts | A site receipt and Procurement's goods receipt are not connected: the order's accepted quantity stays 0, or stock is counted twice if both are recorded. Inventory's "issue" to a project does not reduce the main store. |
| 4 | STK-11 | Confirming an inter-project transfer is refused: the receiver has no duty on the sending project (rules). |
| 5 | Rules hardening | The `pm` block is one map: whoever may write one counter may write any (lifecycle, `retentionHeld`, `retentionReleased`). BOQ gate fields and `billedQuantity` are writable by `projects.edit`. The project store's second-person rule and a request's lines are client-only. Any member can forge a Finance event of his own organisation. Amounts hidden on screen (variations, claims, rates) are readable by any member through the API. |
| 6 | Platform | `storage.rules` is open to every signed-in user. About 24 other collections still have `list: if isSignedIn()` with no organisation condition (only the three PM ones were closed here). |
| 7 | Rules size | **The ruleset is at Google's compiled-size ceiling (250 KB).** This audit's additions were refused until three repeated guard chains were folded into functions (`inProject`, `inOpenProject`); the file is now 0.3% smaller than before the audit. The next module's rules will not fit without more of the same. |
| 8 | Portal links | Link creation: any `pm.manage` holder in the organisation, unthrottled, SMS to any number; no lockout on the one-time code. |
| 9 | Dates | "Today" is the device's day or UTC in several writes (00:00–03:00 Riyadh is yesterday); `PJ-yyyy` uses the UTC year. |
| 10 | Loading | `useCollection` reports "not loading" before its first query: empty/no-access flashes on Projects, the inbox and the project page; decisions are published from half-loaded data. |
| 11 | i18n | 15 Arabic messages have only one/other plural forms; the handover's reject reason and notification texts are stored as sentences in the sender's language. |
| 12 | Plant | Off-hire and hand-back are guarded by `daily` (the PRD says `req`) — kept, because an owner-reviewed parity test fixes it; a blank licence date passes the gate; the QS registration limit for subcontracts is 0. All three are recorded owner decisions to confirm. |
| 13 | Supply | A work order's purchase request has the same missing award link as the project request had; a request split into two RFQs links only the first; a late line is not offered to Inventory before buying. |
| 14 | Performance | Suspected: the project update rule (about 22 branches) may pass the 1,000-expression limit for a non-owner on its last branches — to be tried on UAT as a site engineer. |

## 5. Not built

P0/P1 in the PRD: the plant desk and its events (`prj:EQ`, `prj:EQOFF` — conflict 18: no plant module exists, the
requester answers himself); plant availability and double booking (EQP-06/07); the 24-hour fault record (EQP-08);
`prj:MR`, `prj:GRN`, `prj:SHORT` (the status change is the message today); petty-cash settlement; subcontract
retention release; reports as CSV; the "invoiced" state between certified and collected. Finance has not defined
`prj:AMD` (conflict 17) or the loss / transfer / site-cash events (conflict 15) — they are sent and shown, not posted.

## 6. Follow-ups this audit leaves

1. **Push `main` and `uat`** (the owner's). Until then the deployed builds run the old code against the new rules;
   every tightened rule was checked against what the deployed build writes, with these visible effects: a
   token-less legacy invitation can no longer be accepted, and Procurement's "proceed" on a pending PM request is refused.
2. **After both branches are deployed, remove the transitional line** in `match /pmEvents` (it still accepts an
   event under its key alone, for the old build) — marked `TRANSITIONAL` in the file.
3. **The mobile app was not checked** (its repository is not on this machine). Three rules could affect it: client-side
   creation of an invitation, and any query on `projects` / `pmHandovers` / `pmEvents` that does not filter on
   `organizationId`. UAT carries the same rules — try the mobile UAT build there.
4. Events written before today keep their old ids; they are found by query (organisation + key), never by id.
   A project whose addenda were signed before today has no `pm.inForce` until its next signature — it reads the
   original, as before.
5. **Click-through owed on UAT** with signed-in users: accept a handover with an advance · import the BOQ template in
   the wizard · Start · measure and approve · prepare, approve and certify a certificate · Finance collects ·
   request material → RFQ → award → receive on site · stop a line · the owner replaces the manager · sign an addendum.

## 7. Checks at the end of the audit

`npx jest` 3,463 passed (216 suites) · `npx tsc --noEmit` only the known errors · `check-i18n-links` 0 / 0 / 0 ·
eslint: no new warnings on the changed files · `npm run build` passes.
