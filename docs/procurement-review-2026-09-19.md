# Procurement — UI/UX and integration pass, 19 Sep 2026

Asked: enhance the procurement component's UI/UX without breaking it, and make
sure no workflow between components has a missing piece.

## How it was checked
- **`scripts/check-i18n-links.mjs`** (new) — every literal translation key in
  `src/` against both message files under its namespace, ar/en parity, and every
  portal link against the route folders. Found two missing keys in the
  Purchasing inbox (they rendered as raw key names) and a dead link (below).
  Run it before any commit: `node scripts/check-i18n-links.mjs`.
- Every accounting hook and posting rule checked for a caller — the map of what
  reaches the ledger and what does not.
- The procurement lifecycle traced by reading: RFQ → offer → award → delivery →
  goods receipt → stock → books, and its seams with Manufacturing and Projects.

## Integration gaps found and fixed
| Gap | Effect | Fix |
|---|---|---|
| **Goods received from a supplier never posted** (`goods_receipt` had no rule, no writer) | Stock entered the warehouse, but the books had neither the inventory nor the debt. And Finance → Settlements' "pay a supplier" clears *Suppliers payable* — which nothing ever credited, so there was never a balance to pay. | `postGoodsReceipt` + `onGoodsReceived`: confirming a delivery posts Inventory (net) + input VAT 15% against Suppliers payable (gross), party = the supplier. **Offer prices are read EXCLUDING VAT** — the owner's decision; every price field a supplier or guest types now says so. |
| **Purchased stock landed without a cost** | Product cards (which take material cost from Inventory), inventory value and material-issue postings all saw "no cost" for bought goods. | The receipt carries a unit cost when it is exact (one line, one price) and merges into existing stock at the quantity-weighted average. A multi-line delivery has one total price and no honest per-line split, so it stays uncosted. |
| **Materials consumed by a project never posted** (`onMaterialIssued` existed, nothing called it) | Site consumption left Inventory without reaching the project's cost in the books. | `recordWasteConsumption` posts a material issue at each row's snapshotted cost (uncosted rows add nothing), from both the project page and the standalone waste page. |
| **Manufacturing's purchase request never closed** | An RFQ started from a purchase request stayed "RFQ started" after its goods were received. | Confirming that RFQ's delivery marks the request arrived and tells the workshop manager and the requester. |
| **A failed stock receipt was silent** | "Receipt confirmed" even when the quantities never reached the warehouse. | The toast says so and tells the user to add them by hand. |
| **Supplier portal: CRM "hand over to a project"** | The supplier portal has no Projects module — the button created a project nobody could open and its link 404'd. | On the supplier portal a won deal continues in Sales (a link to quotations); the handover is contractor-only. |
| **Awarded tender editable by a colleague** | The "has an accepted offer" check read only offers on tenders the viewer created. | Org-scoped. |

## UI/UX
- **One header and one rail across Procurement** (`ProcurementHeader`): the
  module's tile in its colour, the page title and actions, and tabs — RFQs ·
  Incoming purchase requests · Suppliers · Goods received — each gated by the
  same permission as its sidebar entry. The four pages used to share nothing
  but the sidebar. (RFQ detail stays as it is: it is also the Projects module's
  tender view.)
- **RFQ search spans every status** and folds Arabic spellings; the status tabs
  dim while searching.
- **Suppliers**: search and filter moved out of the header into a wrapping
  toolbar — the fixed-width row overflowed a 375px phone; the clear button has
  a label and a focus ring.
- **Right-to-left**: every physical direction class in Procurement replaced by
  its logical one; five were real bugs (text right-aligned in English, icon
  margins on the wrong side in one language).
- **Language**: 23 labels written as inline Arabic/English ternaries moved into
  the message files; the 12 contractor↔supplier notifications now carry
  translation keys, so each reader sees them in their own language (the
  stored Arabic text stays as the fallback for push and the mobile app).

## Left as they are, on purpose
- The offers comparison matrix keeps its inline styles: they are per-cell grid
  positions and colour values equal to the design tokens — rewriting them
  risks the layout for no visible change.
- The WhatsApp button keeps WhatsApp's brand green.
- **Not automated (manual vouchers cover them):** VAT settlement, expenses,
  payroll (HR not delivered yet), guarantee margins, supplier invoices as a
  separate step. A manual goods receipt on the Goods-received page has no
  price, so it posts nothing.

## Verified
Typecheck, lint (0 errors, no new warnings), 67 suites / 1,436 tests (9 new:
the receipt posting, weighted cost, material issue), the new checker clean,
production build. No firestore.rules change. Not clicked through with real data.
