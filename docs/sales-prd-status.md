# Sales module — status against the PRD

**Spec:** Sales Module PRD 1.0 (14 Sep 2026) and its reference prototype (`mdmak-sales-module.html`).
**Audited and reworked:** 17 Sep 2026.

The module that existed implemented an earlier, simpler design. A line-by-line audit of the
PRD's 79 requirements found **none fully met** in the delivery, pricing, Today, reports and
integration families, plus several places where two modules disagreed or a write was refused
by the security rules. This document records what changed and — just as important — what is
still open, so nobody has to rediscover it.

Legend: **Met** · **Partial** (works, with a named gap) · **Open** (not built).

---

## 1. What was broken between modules, and is fixed

These failed regardless of any new feature.

| # | What happened | Fix |
|---|---|---|
| 1 | A client work order that carried only its quotation (`Q-…`) appeared **nowhere** in Sales — the drawing result could not be recorded. | One rule, `belongsToSalesOrder`, used by the down-payment gate, release, Sales' screens, coverage and the "advance confirmed" notice. A Sales inbox lists every drawing waiting on the client. |
| 2 | Inventory had **no part** in a customer delivery. The seller "confirmed delivery" in one click, at the requested quantity, with no signer. | Three steps: Sales requests → Inventory authorises (Warehouses → Delivery notes → *Customer issues*) → the client signs for what arrived. |
| 3 | A shipment "held" could be delivered anyway by pressing *Confirm*; the seller set the hold and saw its reason; Finance could not write a hold at all. | A hold and its release are Finance's. Sales sees the state only and asks for the release. A held note cannot be authorised or signed. |
| 4 | A storekeeper confirming an order's **last** note failed: the batch also closed the sales order, which the rules denied. | Signing is Sales' act, authorising is Inventory's — each within its own permission. |
| 5 | A sales manager accepting a made-to-order quote: the work-order write was denied **before** the sales order was created → quote "accepted", no order, no retry. | The order and the "won" flip are one atomic batch, order first; pressing again is safe. |
| 6 | Two ways to confirm an advance that never met: one released the order without recording the payment (the instalment stayed "awaiting Finance" forever); the other never told the workshop. | `confirmAdvance`: both doors end the same — notice answered, instalment settled, order released, ledger told, workshop told. |
| 7 | The advance was detected by a magic instalment id (`"deposit"`). A seller who deleted the default row and added his own lost the gate silently. | An explicit `beforeProduction` flag; the order remembers which instalment is its advance. |
| 8 | Confirming **any** amount released the order (1,000 of 19,734). | Release only when the advance instalment is settled in full. |
| 9 | The discount cap and the below-cost block could be dodged: save as draft, then "Mark as sent". | The checks run at **Issue**, in the write, not only in the form. |
| 10 | A Finance-only user could not reach the transfer-notice inbox (it sat behind `sales.manage`). | Finance → *Sales desk* (`/accounting/sales-desk`). Notifications now link to it. |
| 11 | An accountant (`accounting.post`) saw *Answer* but *Confirmed* was always denied. | The rules let whoever may answer a notice finish the act. |
| 12 | The plant's decline reason was filtered out of the order drawer; the request button simply reappeared. | The reason shows on the line: "adjust the order or tell the client". |
| 13 | `promiseDate` was read in four places and written in none. | Set at conversion (required); reset with a reason into the order's trail. |
| 14 | A quotation recorded **no author**. | `createdByUserId/Name` on every new quotation (INV-07) — which is what makes rep scoping and staff reports possible. |
| 15 | `npm run test` was red on this machine: a stray `.kilo` worktree's Playwright specs ran under Jest. | `.kilo/` ignored in `jest.config.ts`. |

## 2. The PRD's screens

| PRD tab | Now |
|---|---|
| Today | **Met** — three KPIs (sales in 30 days *by signed delivery*; promised-not-delivered and how much has no supply; live quotes and how many expire this week), the flow strip, the decision queue, live promises, from manufacturing, pipeline and why we lost. |
| Requests & quotes | **Met** — CRM inbox (price it · cannot price · finish the draft); quotes by live · issued · expired · draft · won · lost · all; sorted by expiry, value or newest. |
| Orders | **Partial** — segments, supply per line, the promise and its trail. No supply bar on list rows; the order "drawer" is a dialog. |
| Delivery & payments | **Partial** — split across two tabs (*Delivery & billing*, *Payments*), as before. |
| Reports | **Met** — Company · Sales · Staff over 30/90/365 days, printable. |
| Products & prices | **Partial** — a price list with margin and "no cost" for cost roles. No agreements, tiers or review list (§4). |
| Settings & boundary | **Met** — the 12-step flow map, owns / reads / not owned, boundary events, document sources, roles, defaults, deliberately not built. |

## 3. "Needs your decision" — 14 of 15 rows

Built: request to price / finish the draft · issued not sent · draft never issued · expiring or
expired · order awaits its advance (only until the transfer is reported) · Finance could not
find a transfer · shipment held · line with no supply · the plant declined · gate closed ·
production request unanswered (the clock does not run before Finance confirms) · promise
passed · authorised not signed · return awaits decision (manager only) · price to review
(cost roles only). One action per row, nearest risk first, four groups.

**Open — row 12, "goods delivered, installation pending".** There is no installation model (§4).
**Partial — row 11.** "Promise earlier than readiness" is shown as "the promise has passed with
goods still owed": Sales does not compute a readiness date (§4).

## 4. Still open

Ordered by what it blocks.

1. **INV-01 — instalments are computed on the NET amount**, while the order total and the printed
   PDF are VAT-inclusive. A client paying the printed figure over-pays the instalment on screen,
   and the Payments page and the order drawer disagree. *Not changed on purpose:* it alters what
   the ledger posts for an advance. **Needs an owner decision.**
2. **PRC-02 / QC-04 — the price ladder** (client agreement → quantity tier → list). `resolvePrice`
   exists but there is no agreements or tiers data and no screen, and the helper prefers the
   agreement even when a tier is cheaper — the PRD wants the cheaper of the two.
3. **SO-07 / INT-04 — reservation.** Nothing is reserved in Inventory for 21 days after release;
   supply is an advisory calculation.
4. **SO-09 / SO-10 / T22 — amending an order**, with reported instalments frozen and the last
   carrying the difference (19,734 + 51,474 = 71,208). Needs the order to own its instalment
   amounts, which depends on (1).
5. **DLV-04 / T20 — installation**: a line kind, a certificate, and the order closing on it.
6. **SO-12 — frameworks**: call-offs work, but nothing creates a framework order.
7. **SO-15 — the non-blocking checklist.** **UX-05 — one search.** **QC-10/11 — terms templates**
   and terms derived from the lines. **QC-20 — minimum-order warning.**
8. **UX-03 — overlays and the Back button**: dialogs do not share a browser-history entry, so
   Back leaves the page (scenario S9 fails).
9. **INV-08 at data level**: screens no longer show cost to a rep, but `salesPriceItems.cost` and
   `salesOrders.lines[].unitCost` are still readable by any member in Firestore. Closing it
   needs cost in its own collection — rules cannot hide one field.
10. **INV-03 — numbering.** Quotations are now sequential (`QT-2026/NNN`, revisions `-2`, `-3`,
    drawn in the write). Transfer notices, quote requests, delivery notes and returns are still
    random; sales orders are `max+1` from a client read (two conversions at once can collide).
    `sales-numbering.ts` already has the types — they only need wiring.
11. **UX-07 — server enforcement.** The rules now enforce the delivery handshake, returns, the
    quotation lifecycle and the price list. Still client-only: the discount cap, below cost, the
    100% schedule, the made-to-order advance, the transfer date, the call-off cap, rep scoping.
    Most need a server function — a rule cannot read the price list.

## 5. Differences from the PRD kept on purpose

- **Converting a quote needs `sales.approve`** (or `crm.close`); the PRD lets a rep convert. Kept
  because `CLAUDE.md` records it as a decision and the rules enforce it.
- **Sales approvers may still answer a transfer notice and record a payment.** The PRD says only
  Finance. Kept for the same reason; Finance now has its own desk, so this can be tightened by
  removing `sales.approve` from three rules.
- **CRM writes quotations directly** (`CrmValueDialog` creates one as "sent"; the lead page adds
  one). D1 says one door. Left alone so as not to break CRM; its edit and delete are now
  draft-only.
- **The CRM opportunity is not closed by Sales.** Closing a deal needs `crm.close` and the record
  is CRM's. Sales writes a done activity on the client's file (quote sent · won · lost with its
  reason) for CRM to act on.
- **A legacy work order still opens at acceptance** — only for an org with no product cards. An
  org on the product-card workshop gets none: production is asked for by a request (D8).

## 6. Deploying this

Code and `firestore.rules` changed **together** and must ship together:

- Rules without code: the old "Confirm delivery" and status buttons are refused.
- Code without rules: the new steps work but are not enforced, and an accountant still cannot
  confirm a notice.

Deploy rules with `node scripts/deploy-rules.js <uat|prod>` after `git fetch` and a diff against
`origin/main` (see `CLAUDE.md`).

Data already in Firestore keeps working: a delivery note in `requested` now needs Inventory's
authorisation before it can be signed; a quotation stored as `sent` is locked; an order whose
advance was the `deposit` row keeps its gate.

**The mobile app** mirrors `manufacturing-writes.ts`, `manufacturing-view.ts`,
`manufacturing-requests.ts` and `mfg-events.ts`; re-copy them at its next sync
(`check-mirrors.mjs` reports the drift).

**Not verified in a browser.** Everything above is covered by unit, scenario and render tests on
an in-memory Firestore, a clean typecheck, lint and a production build — none of which is a
person clicking through it with real data.
