# Procurement — boundaries, links and what is not built

Moved off the Settings screen on 20 Oct 2026 (Procurement 1.5, PUR-08: «الإعدادات» shows only what the customer sets). This is the team's reference; the texts are the ones the screen used to show.

## Need to payment — nine steps, one owner each — من الحاجة إلى السداد — تسع خطوات، لكل خطوة مالك واحد

1. **1 · The need** / ١ · الاحتياج — An approved material request from a project · a workshop shortfall on a work order · a stock gap _Rule:_ We never create the need — it reaches us
2. **2 · Stock check** / ٢ · فحص المخزون — Computed on arrival and confirmed by Inventory: what we hold free is issued, not bought _Rule:_ One day — then we proceed
3. **3 · Make or buy** / ٣ · نصنّع أم نشتري — What our workshop makes, we ask it first — it accepts in full, in part, or declines with a reason _Rule:_ One day — then we buy
4. **4 · The path** / ٤ · المسار — Live agreement → an order at its price · under the cap → a direct order · otherwise → an RFQ _Rule:_ Computed, not chosen
5. **5 · Quotes & award** / ٥ · العروض والترسية — Our suppliers · platform suppliers · a guest link with no registration — sealed until close, awarded line by line _Rule:_ A non-lowest award carries its reason
6. **6 · Purchase order** / ٦ · أمر الشراء — Prepared by one, approved by another within his limit — then sent, with the supplier's acceptance and date recorded _Rule:_ Pending sample, expired CR or no VAT number = no approval
7. **7 · Finance** / ٧ · المالية — The approved order reaches Finance as a commitment and the first leg of the match — it pays any advance the supplier asked for _Rule:_ We never pay nor record a payment
8. **8 · Delivery & receipt** / ٨ · التوريد والاستلام — We follow the supplier's date — Inventory receives in the store or directly on site and records the quantity and the rejects _Rule:_ We never record a receipt
9. **9 · Invoice & payment** / ٩ · الفاتورة والسداد — Finance matches the invoice to our order and Inventory's receipt, and pays — its payment closes the order. A price variance comes back to us as a decision _Rule:_ The price variance is our call

## The two ideas — الفكرتان

- **The need line is the backbone** — No RFQ or PO is typed from scratch: both are built from lines that reached us. And every quantity lives in one place: from stock + made + awaiting purchase + in offers + on an order + cancelled = what was asked for.
- **Last order day** — Need date − lead time − the RFQ cycle. We sort the work by it, because the line that arrived yesterday may be more urgent than one that arrived a week ago.

## What the module owns

The supplier master, price agreements and price history · the path decision and the make-or-buy decision · the RFQ, the recorded offer, the comparison, the award and its reason · the purchase order, its approval, its revisions and the cancellation of its remainder · following the supplier's date · the decision on rejects and on a price variance · the reference price Manufacturing reads.

## The integration contract — what reaches us and what we send

We request and read state — never act for another module

- **col** — in: We receive · out: We send · late: If late or missing · keys: ``
- **Projects** — in: The approved material request (its purchase part) with item, quantity, date and destination · the item's sample status · the item's remaining budget · the site receipt (counted, rejected with reason) · "stop what has not arrived" when the material is closed · out: Each part's state: offers → made → PO → part arrived → received · the PO number and price as a commitment on the item · the supplier's date and its updates · confirmation that the remainder is cancelled · late: Sample not approved: we collect offers but issue no order · budget overrun undecided: the order waits "on the budget decision" · keys: `prj:MR:[no.]:proc · prj:MRC:[no.]:[line]`
- **Manufacturing** — in: A purchase request for a work order's shortfall (material, quantity, "needed before") · the workshop's make-or-buy answer · a request to claim from a supplier for waste or a quality report on a block · out: A project need we decided to make, with its material request and item · the reference purchase price of each product · the arrival date of the requested material · late: No answer within a day: we go on to buy, and their request closes "moved to purchase" · keys: `proc:MK:[request]:[line] · mfg:PRQ:[work order]:[material]`
- **Inventory** — in: The stock check (what is issued and what is left to buy) · a shortfall at issue · a gap before the need · the receipt: counted, accepted, rejected with reason, held for inspection and its result · a receipt with no PO · out: The approved PO with its lines, supplier, date and destination ("on its way to you") · date updates · cancelling the remainder · late: No stock-check confirmation within a day: we proceed on what was computed · a receipt more than 5% over the order: Inventory refuses it and asks us to amend the order · keys: `inv:GRN:[receipt no.] · proc:PO:[PO no.]`
- **Finance** — in: A notice of every payment on our order: the voucher · which invoice · net, VAT and advance recovery · value date · bank reference and the last four digits of the supplier's account · who approved it · the transfer copy — and its share of the order · every payment hold with its coded reason · approval limits and the direct-order cap · out: The approved PO: the first leg of the three-way match and a commitment not yet invoiced · a request for a supplier advance · our decision on a price variance (a revised order or a refusal) · the supplier master, VAT number and payment terms · late: An order that never reached Finance: its invoice is held "no PO" · an advance not paid: the supplier's lead time has not started and the honest date slips · keys: `proc:PO:[PO no.] · proc:ADV:[request no.] · proc:FRJ:[hold no.] · fin:PAY:[voucher] · fin:REJ:[hold no.]`
- **Supplier** — in: An offer (from his platform account · from the guest link with no registration · or recorded by the buyer) · a query · acceptance of the order and its date · a delivery notice per shipment: lines, quantities, date, driver and paper note number · out: The RFQ and its link · the answer to a query, to every invitee · a reduction request with a target price · the PO with its link, place and receiver · the receipt result: accepted, rejected with reason, outstanding (what he may invoice) · late: The system does not message the supplier beyond the portal and the order: it copies the text and the link, your own tool sends it, and we log that it was sent · keys: `Guest-link token per RFQ · sup:ASN:[notice no.]`

Sales and CRM never deal with Procurement directly. HR only refers temporary-labour contracts to us — not built yet.

## What Procurement never does

- Recording receipts and their report — whoever receives does: Inventory for its stores, Projects for its sites
- The invoice, the match, the payment and the supplier ledger — Finance
- Creating the need or changing its quantity — its owner in Projects or Manufacturing
- The subcontract and its certificates — Projects
- Approving a sample — the consultant, through Projects (we only ask the supplier for it)
- Site petty cash under the cap — Projects and Finance (ours is a direct order with no offers, never cash)
- The item card, its code and unit — Inventory
- Messaging suppliers by WhatsApp or e-mail from inside the system

## Not built

- An "urgent buy" on a phoned approval documented within 24 hours — instead of finding out after the pour
- A delegate approver when the limit-holder is away
- A second sealed round after the prices are opened
- A cumulative direct-order cap (material × supplier × project × 30 days) — today there is the per-supplier split window
- Returning materials to a supplier after acceptance — with a debit note in Finance
- Temporary-labour supply contracts (Ajeer) referred by HR
- Timed equipment rental (daily / monthly) and its extension
- Importing supplier offers from Excel
- Supplier pre-qualification by documents and criteria before inviting him

## Conflicts

- Inventory calls our document a "purchase request" (ش-…); Finance and Projects call it a purchase order (ط.ش-…). We adopt the latter: the request is what reaches us, the order is what we issue.
- Manufacturing reads «ط.ش» as a purchase request that precedes it — we have no intermediate document: the need line carries the material request number itself.
- Finance expects the receipt number «ا.س-…» and Inventory numbers it «إد-…». We read it in Finance's form.
- Supplier returns: Inventory sends a debit note to Finance, and Finance expects it from us. Correct: Inventory moves the stock, we agree with the supplier, Finance issues the note.
- Projects says Procurement registers an uncatalogued item, yet the item card is Inventory's. Here: it is bought as free text for direct supply, and if it enters a store Inventory registers it at receipt.
- Supplier names differ between Projects, Inventory and Finance. The supplier master here is the reference.
- «ط.ع» is a customer's inbound request in Sales and a labour request in HR — so our outbound RFQ to suppliers is numbered «ع.ش».
- Procurement's chip is violet in two modules and teal in three. Every module now takes its own colour from the registry.

The boundary log (what crossed into or out of Procurement) is computed by `boundaryLog` in `src/lib/procurement/boundary.ts`.
