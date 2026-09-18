# Customer review, 17 Sep 2026 — what was checked, what was true, what changed

**Source:** meeting notes, Shady × Salman, ERP components review. Notes are a
memory of a demo, not a bug report — so every item was checked against the code
before anything was touched. Several were true, a few were true but not for the
reason written down, and a few were not true.

Legend: **Real** (defect, fixed) · **Real, other cause** · **Not as written** · **Not ours** (data / another repo / a decision) · **Open**.

---

## 1. Manufacturing

| Note | Verdict | What was found, what changed |
|---|---|---|
| "The sales order (Q-MFG…) couldn't be found in Sales search." | **Real** | `Q-MFG…` is a *quotation* number. The Sales **Orders page had no search box at all**, and the Quotations search was ANDed with the state chip, which opens on "Live" — an accepted quote is "Won", so it was hidden. Orders now has a search (order no., quotation no., client, project, product, the work-order reference) that looks in **every** segment; the quotation search looks in every state, finds the Arabic display number (ع.س-…) and product names, and folds Arabic letter forms (`src/lib/search-text.ts`). `?q=` deep links land on a search. |
| "An order at drawing approval pointed to Sales." | **Real** | The drawer said *"Waiting for Sales — done there… no button in Manufacturing"* and offered **no way there**. Every "waiting for ‹module›" is now a link to where that module does its part (`moduleLinkOf`): the sales order (or the orders inbox searched by the quotation number), Finance's sales desk, Inventory's manufacturing desk, the project, Procurement. |
| Salman's flow: accept → advance confirmed → manufacturing starts → **no return to Sales until finished**. | **Decision, met half-way** | The PRD has Sales record the client's drawing answer. Kept — and the **workshop manager may now record it himself** ("Record the result here"), logged under his name, so an order no longer *has* to travel back. No rules change: `manufacturing.manage` already writes every work-order field. Whether Sales should lose the act entirely is Salman's call. |
| "Materials showed as *not received* at inventory." | **Real, other cause** | The handshake is requested → issued (Inventory) → **received (the station)**; cost lands at the receipt. It works — but a station that names a lead let **only that user** confirm. Anyone else, *including the org owner running the demo*, saw "waiting", and issued materials sat at "not received". The lock existed only in the client; the security rules know no station lead. **The owner may now stand in at any non-QC station** (`Actor.owner`); the workshop manager still may not (PRD D9 — he can reassign the lead). |
| "A permissions problem surfaced and was confirmed." | **Real (two found)** | (1) the station-lead lock above. (2) **Legacy owners read as members**: `firestore.rules` treats an account with *no* `organizationRole` field as the owner of its own org; the client read the missing field as "member" → every button hidden and every tile locked for someone the server would never refuse. `usePermissions` now mirrors the rule (`legacyAwareRole`), as do the team page and notification recipients. |
| "A price is required when adding a BOM item." | **Not as written** | The product card saves with the cost **empty**; it auto-fills from Inventory when the material exists there; a missing cost is only a warning. But the field read "Unit cost snapshot" with nothing saying so. Now "Unit cost (optional)", placeholder "leave empty", and a line saying no price is needed. |
| "Riyal symbol… must be replaced with the official one ASAP." | **Real** | The module printed **U+FDFC ﷼**, the generic "rial" ligature (Iran/Oman/Yemen share it), in 10 places in code and 73 strings — and the Arabic unit label `mfg4_sar` itself was that glyph. See §8. |
| "Marco may not have pushed his latest Sales changes." | **Not ours** | Everything of his on the remote is merged to `main` (latest 16 Sep). Nothing unmerged exists on GitHub; anything else is on his machine. |
| "The Sales dashboard hasn't been tuned." | Done earlier | Rebuilt as *Today* on 17 Sep (`docs/sales-prd-status.md`). |

**Why the demo looked the way it did:** UAT was two commits behind `main` — it did not yet have the Sales↔Manufacturing relation fix (`faa7cab`).

## 2. Mobile app — **another repo** (`~/mdak/mdmak-mob`, changes uncommitted there)
| Note | Verdict | What changed |
|---|---|---|
| "The 'profile incomplete' issue is still being fixed." | **Real** | The website creates *every* invited account with `profileCompleted: false` and then only shows a banner (none on UAT). The app **hard-redirected** anyone with the flag to onboarding — every team member (the company identity is the owner's; a member cannot "complete" it) and every invited owner. Now only the owner of a primary company whose company still has no name sees the first-run screen (`needsOnboarding`); everyone else goes straight in. |
| "The app opens straight into the Procurement dashboard. It likely needs a new dashboard." | **Real** | The contractor home was the RFQ dashboard for every role. It now opens on **Your modules** — the same registry and permission checks as the launcher — and the RFQ hero, actions, chart and list appear only for a role that includes Procurement. A Sales- or Manufacturing-only member sees their modules and a line saying Procurement is not part of their role. |
| Mirrors | Done | Nine mirrored libs had drifted (`crm`, `permissions`, `sales-orders`, `sales-transfers`, `manufacturing-engine/-writes/-view/-requests`, `mfg-events`); re-copied verbatim, `search-text.ts` added to the map, the registry given the website's new screens (Sales reports & settings, Finance sales desk — opened on the web), lock refreshed. Typecheck clean; 9 suites / 106 tests pass. **Not built or run on a device.** |
| "Mobile design is one of Shady's focus areas." | **Open** | Design work beyond the above was not attempted. |

## 3. Procurement
| Note | Verdict | |
|---|---|---|
| "Remove items that don't exist, such as the Al-Yamama cement entry." | **Real — data, with a code cause** | "أسمنت اليمامة" is `users/sup-2`, one of three fake suppliers written by the **`/admin/seed` page**, along with `rfqs/rfq-demo-1..3`. They surface in the supplier directory, admin suppliers, the landing count and the assistant's context. The page is now **off in production** (UAT and local dev only). `scripts/cleanup-seed-demo.js <uat\|prod>` lists what it would delete (dry run by default, `--apply` to delete; it checks id **and** content, and only *reports* anything still pointing at those suppliers). **Running it is the owner's act.** |
| "Still not clear." | **Open** | No specific defect named. |

## 4. Finance & Accounting
| Note | Verdict | What changed |
|---|---|---|
| "Details don't open — account statements, general ledger." | **Real** | Rows were plain `<tr>`s. Every movement now opens **the full entry in a side panel** (`JournalEntrySheet`): both sides, who captured it and when, cost centre/branch, and **the document behind it** with a link (`sourceDocumentPath`). |
| "…asset icons." | **Real** | No single element; all the candidates were inert and now open: the dashboard's cash/bank rows (the ones with the bank icon), Receivables/Payables figures, an **open** group heading in a statement (it could only collapse), "where money is locked" rows, and account **names** in the chart of accounts (rollups had no click target at all) and trial balance. |
| "The cash flow register navigates to the wrong place." | **Real, other cause** | Every link labelled *cash flow* was right. Two others were not: `journal?entry=<id>` (from the dashboard, the audit trail, "entry saved") opened nothing when the entry was outside the selected period — it now opens in the panel regardless; and the *Cash conversion cycle* figure opened a page titled *Where money is locked* — it now lands on the cycle card. *Cash on hand* and a shortcut now lead to the cash-flow statement, which nothing on the dashboard did. |
| "Daily report details are unclear." | **Real** | دفتر اليومية is the general journal. It now reads as a **day book** (day headings with the day's posted total), rows show they expand, and an open row carries the facts and the source-document link its own description promised. |
| Not fixed | **Open** | Auto entries' descriptions are Arabic text stored on the entry, so the English UI shows Arabic. Needs keys + params at posting time, not a view change. |

## 5. Inventory
"Group all central warehouses together, project warehouses separately, add search" — **Real.** The page interleaved central → its projects → next central. Now: search → **Central warehouses** → **Project warehouses** (filter chips per central when there is more than one; each card names the central it draws from).

## 6. Project Management — waits for Salman's prototype (Friday). Not started.

## 7. Other
| Note | Verdict | |
|---|---|---|
| "Logo upload is untested." | **Real (two gaps)** | A quotation written *before* the first upload printed bare for ever (a sent quote's `branding` is locked) — it now inherits the org's logo when its own is missing. The only upload control lived inside the *new quotation* composer — it is now also in **Sales → Settings**. Legacy owners never saw it (the role fix above). |
| Dashboard | **Real** | A Sales- or Manufacturing-only member scrolled past seven locked tiles to reach their own. Their modules now come first. |
| CRM, HR, Abdullah's notes | — | Nothing to do. |

## 8. The Riyal symbol
`U+20C1 SAUDI RIYAL SIGN` (Unicode 17). Installed fonts do not draw it yet, so `public/fonts/saudi-riyal.otf` does — **one glyph**, built from SAMA's published artwork by `scripts/build-riyal-font.js`, registered in `globals.css` with `unicode-range: U+20C1` so it competes with Noto/Inter for nothing else. One face covers every weight and italic, so the browser never fakes a bold or a slant (SAMA forbids distorting it). SAMA's placement rule — **left of the figure, one space, in both scripts** — is `src/lib/riyal.ts`: in an LTR run the sign comes first; in Arabic flow the figure comes first and the line puts the sign on its left. English strings were reordered accordingly. Rendered and checked in Edge, both directions, regular/bold/italic.

**Not for** CSV/Excel, e-mail, push text or the print windows that write their own HTML — no font there. None of the 56 sign-bearing strings is used in any of them (checked). Sales, CRM and Accounting still write "ر.س"/"SAR" — and cannot simply switch: their formatters (`formatSar` in `crm.ts`, `formatMoney` in `accounting/display.ts`, `formatCurrency` in `invoice-utils.ts`) are **verbatim mirrors shared with the phone**, where no font draws U+20C1, so the sign there would be an empty box on every mobile screen. Rolling it out needs either a web-only presentation wrapper or the font loaded in the app with the sign wrapped in its own `<Text>` — a decision for the owner, not a sweep.

## 9. Flagged, not changed — needs the owner
1. **`storage.rules` is one line: any signed-in user may read and write everything** — and `FirebaseClientProvider` signs every visitor in anonymously. Any visitor can overwrite or delete any company's logo or documents. Needs per-path rules (size, type, org membership) and a Storage rules deploy, which `scripts/deploy-rules.js` does not do.
2. Many Firestore collections `allow list: if isSignedIn()` — also satisfied by an anonymous session.
3. **UAT rules are not deployed** (no `gcloud` on this machine) and **UAT code is behind `main`**.
4. INV-01 (instalments on net vs VAT-inclusive) — still open from `docs/sales-prd-status.md`.

## 10. Verified how
Typecheck clean (bar the three known files), lint 0 errors, 64 suites / 1,407 tests pass (24 new: search, source links, the owner stand-in, the legacy role, the Riyal guards — plus the logo fallback inside an existing test), production build (317 pages; both font faces and the stacks are in the shipped CSS). **No Firestore rules changed.** Not clicked through with real data.
