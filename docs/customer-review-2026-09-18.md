# Customer review call, 18 Sep 2026 — verified against the code, and what changed

**Source:** auto-extracted notes of the Shady × Salman call (manufacturing, warehouse,
purchasing, finance). Every item was checked against the code before anything was
touched. Legend: **Real** · **Real, other cause** · **Not as written** · **Decision** · **Open**.

## 1. Product card

| Note | Verdict | What was found / what changed |
|---|---|---|
| Only متر مربع and متر exist; add a full list, no free-text "other" | **Real** | `STONE_UNITS` was two entries. Now `PRODUCT_UNITS` (14: m², m, pcs, set, kg, ton, m³, lt, box, sheet, bundle, roll, bag, drum) in `MfgPrdBits.tsx`, one place for the product unit and the BOM unit suggestions; the engine's whole-piece rounding knows the counted ones. |
| "One unit appears duplicated in the picker" | **Real, other cause** | A card storing a unit outside the list was appended a second time. The list is now de-duplicated; a legacy value shows once, as it is. |
| The 16h / 24h "working hours" field was unreadable | **Real** | It is workers × hours per worker (worker-hours a day). Relabelled: "Hours per worker per day", "{n} worker-h/day", and the arithmetic is shown on the card's route rows ("16 worker-h/day · 2×8") and in the note ("2 workers × 8 h = 16"). Kept, as decided. |
| Add an edit control for the name inside the card | **Not as written** | The drawer has "Edit product & route" — for `manufacturing.manage` only. A non-manager sees no button, which is what the demo showed. Edits to the name and BOM cascade to open orders (they read the product live); route order, unit and flags lock while orders are live. Unchanged. |
| Ctrl+K needs fixing on this screen | **Real** | It compared `e.key`, which is "ن" on an Arabic layout; it targeted the orders box even on Products; it fired over open dialogs. Now `e.code`, the Products search on that tab, and never over a dialog or an active field. |

## 2. BOM and the warehouse

| Note | Verdict | |
|---|---|---|
| "An item can only be added to a BOM if it exists in the warehouse" | **Not as written** | The card accepts any name and writes nothing into Inventory — already the decided principle. The order then stalls at the material request (nothing available) and Inventory's issue dialog (not in this store); the shortfall is the workshop manager's purchase request. The card's note said "we do not create an item here" as if that were a limitation — reworded to say the flow. |
| Shortfalls travel manufacturing → warehouse → purchasing, never straight from the warehouse | **Real, other cause** | No warehouse screen has a "send to purchasing" button (the note's "earlier build" is gone) — but the **rules** let a `warehouses.manage` / `rfq.*` user append one via the API. The clause now allows changing existing entries only (size unchanged). **`firestore.rules` changed — deploy needed.** |
| The order stays blocked until materials are issued | **Real** (confirmed) | The block is driven by stock, not by the request's state. Gap fixed: an *arrived* request no longer re-surfaces as "no purchase requested" — it shows "arrived, awaiting booking into stock" (Inventory's), and only a request Purchasing *sent back* returns to the manager, with the reason. |
| Duplicate item names — enforce unique names at creation | **Decision, built** | Both item dialogs refuse a second item with the same (Arabic-folded) name and unit in the same warehouse, unless it is a block (lot). Transfers now merge case-insensitively, as the BOM matches. Rule and message: "An item with this name and unit already exists in this warehouse: «…» — adjust its quantity instead, or choose a different name." |
| Waste vs custody wording not understood | **Real** | Rewritten from what the flags do: *main material (slab)* — requested per order at net + planned waste, tracked by block; *consumable from the station's custody* — never requested per order, never blocks, charged by what the station produced, not deducted from stock here. |

## 3. Labour and standard cost

| Note | Verdict | |
|---|---|---|
| Make labour and standard cost optional; off = disappears everywhere | **Decision, built** | New switch *Labour & overhead costing* (`features.labourCost`, default on, needs *Time & capacity*). Off: the engine prices no hours — the card, the products list, the production order's cost and the estimates are materials only; the labour/overhead lines and the hourly-rate column disappear; hours, capacity and dates stay. |
| When on, a short explainer | **Built** | The switch carries what it does, how to customise it (rates in HR, overhead in Accounting settings, standard time on the card) and the real use — outsourcing, entered as a material line at a known cost. |
| The cost breakdown must be legible | **Real** | The card's review now shows the arithmetic under each figure: per BOM line `qty × (1+waste) × cost`, per station `hours × rate`, overhead `hours × rate`. |

## 4. Production order

Measurement log: mandatory with a photo/PDF — **confirmed** (`sketch_required` server-side). "Does it go to finance": **exists**, a derived read-only section on the order, not a control. Request number "not populating": **not reproducible** from the code (the counter is drawn inside the transaction); a row from before numbering now shows "—" rather than nothing; the Sales-side fallback to a random number is left as it was and is the likeliest cause of a "different number on retry".

## 5. Purchasing, Finance, shared UI

| Note | Verdict | |
|---|---|---|
| Purchasing "not built in any real sense" | **Half right → built** | A card of rows existed on the RFQs page, hidden when empty, no history or link to the RFQ. Now **Procurement → Incoming purchase requests** (`/contractor/rfqs/requests`): a table of every request in every state (open · RFQ started · arrived · sent back), need-by with overdue, what is on hand now, the order and its source, search across states; actions: start an RFQ (the RFQ remembers the request and the request learns the RFQ), record arrival (tells Manufacturing *and* Inventory), send back with a reason (the manager sees it on the order). The dashboard tile lands there. |
| Finance dashboard on the manufacturing pattern | **Built** | An always-open head (integrity, four performance figures, quick links) over five collapsible sections that remember their state — Finance board, Where money is locked, Financial vouchers, Financial statements, Projects — each with its key figure while closed. The statement trees open to their headings on the dashboard and one level deep on their own pages; the journal pages 25 at a time; the period toolbar is sticky. The six-row navigation box became one tab rail with the group's pages under it. |
| Each component its own colour, through icons and inner screens | **Built** | A `module` colour token driven by `data-accent` on the portal frame: the sidebar's active item, the shell's icon tile and tabs, section icons, links. Finance = green; Sales and HR, which shared blue and amber with Procurement and Manufacturing, got indigo and violet. Manufacturing's own kit still uses its literal colour (same result). |
| Restore the mind map as an optional view | **Built** | Restored from history and re-pointed at PRD 1.2 orders: source (client · project · stock) → order → each station with what it has done → the product → where the notes went. Workshop → view: *Mind map*. |

## 6. Not done here
- HR component and the Project Management format — not received yet.
- "The financial statements screens need cleaning up" beyond depth/sticky/paging — no further specifics were given.
- Automatic journal descriptions are still stored Arabic text (English UI shows Arabic).

## 7. Deploy note
`firestore.rules` changed (the purchase-request clause). The mobile app's mirrored libs (`manufacturing-engine/-view/-writes`, `mfg-events`) drifted again and must be re-copied.
