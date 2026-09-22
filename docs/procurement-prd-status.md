# Procurement — PRD 3.0 (20 Sep 2026) against the code, 22 Sep 2026

Asked: take the Procurement PRD and its reference prototype (`PRD-Mdmak-Procurement.html`,
`index.html`), see what the product already does, build what is missing and the UI/UX ideas
worth taking — without breaking what runs, the notifications above all.

## The decision that shaped everything
Until now an **accepted offer was the order**: the supplier's portal, the tender lock, the
project's money flow, the bell, the guest flow and the mobile app all read the offer's
Arabic status literals. The PRD's purchase order is therefore **laid over the award, not
put in its place**: awarding still writes the offer `مقبول` and the RFQ `Awarded` exactly as
before (same batch), and only then
`createPurchaseOrderFromAward` adds `purchaseOrders/{id}` and `poId`/`poNumber` on the offer.
An award made before this existed has no order, and every screen keeps working without one.
Since the 22 Sep review the award no longer TELLS the supplier: no chat, no
`offer_accepted`, and `awaitingOrderApproval` on the offer until Finance has
approved the order and it has been sent (`awardDisclosed` / `asSupplierSees`).
`deliveries` stays the store of the supplier's notice **and** the goods receipt, with optional
order fields; a delivery without them confirms as it always did.

## What was built (PRD §)
| PRD | Built |
|---|---|
| §4 PO `ط.ش-yyyy/NNN`, §6.1 blocks 1, 2, 3, 11, 12 | `purchaseOrders` with a yearly number in `mfgCounters`; approval routing by value (manager ≤ `managerApprovalLimit`, else owner), nobody approves their own order (the org owner excepted — a company of one — flagged in the log and the Exceptions report), retroactive = owner only; blocks are computed facts (no VAT number, unverified, CR expired, order splitting within 30 days above the direct-purchase cap) — the Approve button is disabled while any holds and the write and the rules refuse anyway |
| §5.1-6/7 approval, dispatch | Finance (`invoices.manage`) is told the commitment incl. VAT; receivers (`deliveries.confirm`) are told to expect an arrival — without an amount; the buyer sends via portal / WhatsApp / e-mail with a ready message (the system only sends to a registered supplier's portal; WhatsApp/e-mail open in the user's own tool and the channel, time and sender are logged) |
| §5.1-5 award | Reason mandatory when awarding away from the lowest live offer (six codes, free text for "other"), short-competition and no-official-quote warnings (non-blocking), the supplier facts that WILL block the approval shown at award, reject with a coded exclusion reason — all additive on the offer |
| §5.2 receiving | Supplier's delivery notice per shipment with lines, date & window, driver, plate, paper note, file; the receiver screen at 375 px: **blind count** (the notice quantity appears only after the count is typed), coded rejects, held for inspection with reason, non-blocking checklist, signature, over-receipt refused above outstanding + 5 %; the receipt `ا.س-yyyy/NNN` is immutable; stock lands at the accepted quantity and the line's unit price (this also fixes the old empty-items notice that posted to the books without landing stock), the books get Inventory + input VAT / Suppliers payable at the accepted value (lump-sum orders post on completion), Manufacturing's purchase request is closed, Finance and the supplier are told; arrival with no notice; manual receipt with no order → "No PO" queue → regularise as a retroactive order (owner approves) or mark as cash expense |
| §5.1-9 close-out & rating | An order completes arithmetically (accepted + cancelled ≥ ordered) or is closed short with a reason; rating = on time / in full / reject % / documents **computed from receipts** + two manual stars, optional anonymous publishing (writes the existing `reviews` doc) |
| §7.2 tabs | Today · RFQs · Purchase requests · Orders · Goods received (On the way · Receipts · No PO) · Suppliers · Reports · Settings, one rail, gated like the sidebar; three KPI numbers per role |
| §7.2 Today | "Needs your decision" (approve, awaiting someone's approval, approved-not-sent, supplier has not accepted, late, confirm before the date with a poor on-time supplier, rejected at receipt — decide, arrived today, notice on the way / overdue / later than promised, rate, receipt with no PO, RFQ draft / award / no offers / thin competition), sorted most urgent first; "Waiting on other modules" with no buttons; arriving within 7 days |
| §7.3 drawers | Order (next step, money trail, line progress bars, deliveries, award facts, documents, log) and receipt (line by line, what follows, attachments & checklist, where it went, trail) |
| §8 documents | PO (an expediter prints a copy without values), PO receipt statement, goods receipt — unified header, status banner, signatures, "issued electronically" footer; A4, bilingual; no riyal glyph in print |
| §9 reports | Spend by project, spend by supplier (30 % concentration flag), delivery performance, price drift vs last buy, cycle time & competition, exceptions (retroactive, direct, non-lowest, short competition, self-approval, no official quote, closed short, manual receipt, no PO, self-received), open commitments by due date; CSV each |
| §6.4 policies | `procurementSettings/{orgId}` — the ten policies with the PRD's reference values as defaults, edited by the owner or an approver |
| §3 roles | `po.approve` and `po.expedite` added (rules + client + team page); an expediter sees dates and quantities, never an amount (UI-level) |
| Dashboard | Two work-queue cards: orders awaiting my approval, orders needing attention (late / not accepted / not sent); the old "confirm delivery" card now lands on the receiving desk instead of a page with no action |

## Left as declared waits or out, on purpose
- **Finance's side of the three-way match** (supplier invoice, payment voucher, the eight
  held-payment reasons, `fin:PAY`/`fin:REJ`/`fin:PAID`): Finance has no supplier-invoice
  document yet. The order shows "fully received — invoice, match and payment are Finance's"
  as a wait; the invoicing ceiling (accepted value) is on the order and in Finance's
  notification. Build when Finance gets supplier invoices.
- **Need lines (`DEM`) and the automatic route** (agreement ⇒ direct ⇒ workshop ⇒ RFQ):
  Manufacturing's requests reach the inbox as before; project requests still do not, and
  there are no price agreements or price history to route on. The last-order-day maths is in
  `po.ts` (`lastOrderDay`, `dayParts`) for when need dates exist.
- **The platform directory as a separate segment, join invitations by WhatsApp,
  supplier master fields (payment terms, type)** — the supplier facts an approval
  needs (VAT, verified, CR expiry) are read from the supplier's own platform profile.
  (Price agreements and price history are now built — see below.)
- **One reduction round to all, manual (staff-keyed) offers, delegate approver,
  offline receiving** — not built. (Forwarding by link + code shipped 22 Sep;
  sealed offers and the receiver register are built — see below.)
- **Guest awards** (PRD 6.1-4 says register first): the shipped guest flow stays — a guest's
  order is created with `supplierOrgId: "guest"`, is never blocked on supplier facts, and the
  send form carries no portal link for them.

## What must stay true (guarded)
- No existing notification type or shape changed; the new kinds are `po_*` with both i18n
  keys and rendered text; the actor is never told.
- No Arabic status literal changed; new state lives on the new document.
- `firestore.rules`: every order transition is its own field list; identity fields are
  frozen; the supplier may write only sent → accepted. Deployed to **production** on
  22 Sep (live ruleset matches the file byte for byte); UAT still needs it.
- 1,652 tests (13 new procurement suites, 250 tests; an adversarial review of the change set found five real defects — order resolution for notices written before the order existed, empty-item legacy notices, retroactive approval dead-ending, receipts against a missing order, books posted with nothing landed — all fixed and pinned by tests), typecheck (the only errors are the
  pre-existing ones in `functions/`, `src/ai/generate.ts`, `lib-seo.test.ts`), lint 0 errors,
  `scripts/check-i18n-links.mjs` clean, production build.

## Closed since, against the PRD (22 Sep, second pass)
| PRD | Was | Now |
|---|---|---|
| §5.1-4 sealed prices | `sealOffersUntilDeadline` was stored and had a labelled switch in settings that **nothing read** — every price showed as it landed | `offersSealed` decides it, and while sealed the offers tab and the comparison show who quoted and how many, never a figure; "best price" is not computed either. Opens the day AFTER the deadline (a supplier may still quote on the day), and always opens with no deadline, a past deadline, or an award already made. Still ships OFF |
| §5.3 idempotency keys | a notification was written at a fresh auto-id, so a retry told somebody twice | the eight once-per-order events are written at `<kind>__<poId>`; the rules let a stranger CREATE a notification but never UPDATE one, so the resend is refused rather than delivered. A reminder, a new promised date, the next receipt and a re-return carry no key on purpose — each is a real second event |
| §9 exceptions | 10 kinds; a truck that arrived with **no notice** and a no-order receipt booked as a **cash expense** were stored on the receipt and never reported | both are rows in the report the owner reads (12 kinds) |

Deliberately NOT done in that pass: the buyer **self-issue limit** (§3, §6.4). It
relaxes "nobody approves their own order" and needs `firestore.rules` to read
`procurementSettings` and re-derive the order's value, so it belongs in its own
considered change rather than beside three repairs.

## Price agreements and price history (§4 `AGR` / `PH`, 23 Sep)
Both were blocked on having the reference prototype; with it in hand they are built.

| PRD | Built |
|---|---|
| §4 `AGR` | `priceAgreements/{id}` — a supplier, a window, a price per material, a note, a log. `AG-yyyy/NNN` (اتف) drawn in the same transaction that writes it, from the same yearly counters as the order. Three acts: sign, renew (a later end date and re-negotiated prices; the supplier and the materials are frozen because the orders placed on it name them), end early with a reason. The rules freeze the number, the supplier, the org and the start date, and let a renewal touch only `until`/`lines`/`note`/`endedAt`/`log` |
| §4 `PH` | `priceHistory/{id}` — every price we committed to, with its supplier and day. Written **at approval**, not at creation: a prepared order is a proposal, and a price nobody approved is not a price we paid. The row id is `{poId}__{lineId}`, so a retried approval overwrites its own point instead of adding a second one. Append-only by rule; a lump-sum line records nothing, because a total over a quantity is an invented unit price |
| §7.2 Suppliers | The tab now has the PRD's four segments — our suppliers · the platform · price agreements · price history — and `?segment=` opens one directly. Agreements list expiring-first, each material beside **what we last paid elsewhere** (two numbers, no verdict: the agreement is worth renewing only while it beats the market). Price history is one row per material, sharpest rise first, with a bar series, the last price, and a change badge that turns amber above 0 % and red above 3 % |
| §7.2 Today | An agreement inside 14 days of its end reaches the queue (blue, informational) for whoever could renew it — not the expediter, not the store. When it lapses its materials go back to the market by themselves, which is right, but expensive if nobody meant it |

Deviations from the prototype, both deliberate:
- It never read an agreement's **start date**, so one signed for next quarter priced
  an order today. Ours is not live before it starts.
- With two live agreements over one material it took whichever came first in its
  array. Ours takes the **cheapest**, then the one running longest, then the number —
  so the same question always gets the same answer.

Also fixed: the drift report keyed a material on `name|unit` lower-cased, which split
one material in two the first time somebody typed "حديد ١٢مم" where the last order said
"حديد 12مم" — and the drift against the last price silently vanished. It now uses the
same Arabic-folded key as the history.

Not built with them, on purpose: the automatic ROUTE (agreement ⇒ direct ⇒ workshop
⇒ RFQ) needs need lines, which do not exist yet; ordering ON an agreement needs that
same route; and the award warning "this offer is N % above our last price" is next —
it only applies to an offer that priced per line, which some do and some do not.

## Receivers and the forwarding window (§4 `RCVR`, §5.2-3, 23 Sep)

| PRD | Built |
|---|---|
| §4 `RCVR` | `procurementReceivers/{id}` — a name, what they are called, a mobile, their module, and the warehouses they receive at; an empty place list means they can stand in anywhere. Kept in Procurement settings by whoever prepares or approves an order, so a store keeper cannot add himself to another site. Never deleted, only retired: a delivery forwarded to somebody names them |
| §5.2-3/4 forwarding | The forward dialog now opens on the REGISTER, and offers the people named for this delivery's place first — the project's own warehouse, else the central one, the same order `resolveLandingWarehouse` uses at receipt. An entry with an account forwards as that member; one without is a name and a mobile, which is exactly what the link and its code are for. "Any member" and "someone with no account" remain for whoever is not in the register yet |
| §6.4 | `forwardWindowDays` (1 day, the PRD's reference) — with a consumer, not a dead switch |
| §5.2-3b | A pending notice now SAYS whether anyone has been told to receive it, and turns amber inside the forwarding window; the overdue row says "and nobody was ever told". One row per notice, not two |

Not built, and why: **auto-forward**. The PRD forwards by itself once the window
lapses. Nothing in this product runs on a schedule — no job, no cron, no queue —
so an automatic forward would be a function nobody calls. The notice colouring
above is the honest half of it; the flagged `auto_forward` exception waits for the
same scheduler. Receiving centrally without forwarding at all stays perfectly
valid, which is why none of this blocks anything.

Still absent from §6.4, each for the same reason — no consumer yet, and a switch
that does nothing is worse than a missing one: the buyer self-issue limit (it also
relaxes "nobody approves their own order" and needs the rules to re-derive the
order's value), the inventory/workshop reply window (needs need lines), delivery-
notice routing, the no-separate-receiver toggle, and the price-variance threshold
(there is no variance document yet).

## Go-live checklist (owner)
1. `node scripts/deploy-rules.js <env> --check`, then deploy the rules (the app writes
   `purchaseOrders`/`procurementSettings` only after that).
2. `node scripts/migrate-po-permissions.js <env>` (dry run), then `--apply`, so existing
   groups holding `offers.accept` / `rfq.manage` gain `po.approve` / `po.expedite`.
3. Deploy `firestore.indexes.json` (three `purchaseOrders` composites).
4. Deploy the rules again for `priceAgreements`, `priceHistory` and
   `procurementReceivers` (23 Sep) — those screens write nothing until they are
   live. All three queries are a single `organizationId ==`, so none needs a
   composite index.
