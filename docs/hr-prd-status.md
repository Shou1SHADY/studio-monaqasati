# HR 1.0 — status against the delivery package

Against `Delivery-HR-1.0` (PRD-HR-1.0: 128 requirements — 59 P0 · 63 P1 · 6 P2; `Prototype-HR-v11.html`;
`HR-Pipeline-1.0.html`; the four QA packs). Two passes:

- **1 Oct 2026 — audit.** The R1 core (15 commits of 27 Sep) checked area by area; the rules blocker found and
  fixed (live on UAT and prod since 1 Oct, ruleset `0997e2be…` on prod); 18 defects verified and left open;
  the core gaps listed.
- **4–5 Oct 2026 — completion of the R1 core** (the owner's scope: every open defect and every core gap; the
  optional R2/R3 features stay off). Six work packages, each test-first, merged on `main` (`7fa79ae` … `92b5bcd`).

**State (5 Oct 2026):** committed on `main`, **not pushed, rules not deployed.** Full suite 3,810 tests (242
suites; HR 30 suites, 337 tests), `tsc` only the known errors, `check-i18n-links` 0 / 0 / 0, production build
green. The ruleset with comments and whitespace stripped is 142,952 characters (production releases at 145,514;
150,113 was refused on 1 Oct) — see §5.

## 1. The 18 defects of 1 Oct — all closed

| # | Requirement | Fixed by | What it does now |
|---|---|---|---|
| 1 | EM-04, PY-04 | P1 `2d6e310` | A pay change keeps a history (`employeePay.steps`); `payOn`/`paySegments` split a month between old and new pay; `changePay` reads the closed payrolls itself — the last closed month makes a retro item, older is refused, a future date waits for its day. |
| 2 | EX-04 | P1 `3ec55f3` | The settlement's last month is the payroll's own line (`employeeLine`) up to the last day; a month already paid pays 0, later paid months are named. |
| 3 | PN-03/04 | P1 `0336e1b` | Upheld after its payroll: not deducted again. Cancelled after deduction: refunded through the month's supplementary (fines fund 210205). |
| 4 | LV-04 | P2 `2f587e1` | Every non-Saudi's leave is travel; a document lapsing by the last leave day blocks approval; a blank date is not "lapsing". |
| 5 | LV-02, AT-06 | P2 `d2e6333` | `holidays.ts` — the statutory table 2024–2030 (art. 112, Umm al-Qura); not counted in leave nor as unrecorded days; Ramadan's six hours shown as a note. |
| 6 | PY-04 | P1 `2d6e310` | Supplementaries `-D`, `-D2`, … per month, each item paid once, posted on the day Finance posts it. |
| 7 | PY-03, AC-04 | P1 `13ec7a9` | Finance sees held and returned lines of every paid payroll and records a return on any of them; the owner may fix a returned IBAN. |
| 8 | AD-01 | P1 `34c1409` | The instalment starts the month after the payout, once a month. |
| 9 | EX-01/02 | P1 `3ec55f3` | Service by the calendar; art. 77 on a fixed term from `contract.end`. |
| 10 | DC-05, EM-03 | P2 `f52fd57` | An arrival without an iqama after 90 days is illegal on a site; no promotion into a Saudi-only trade. |
| 11 | EM-05 | P2 `f52fd57` | Ending probation starts the exit; a probation past its end with no decision is "lapsed". |
| 12 | DC-07, PN-01 | P4 `ecbd08c` | The supervisor records injuries and violations on his site page (`HrSiteWorkers`). |
| 13 | PY-01, DC-03 | P1 `aeced07`, `41190ef` | Commission (recorded by the HR manager) reaches the line, or the settlement; a renewal's fee goes to Finance as `hr:PR` (Dr 520106). |
| 14 | — | P2, R2-A | Riyadh's day everywhere (`riyadhDay`/`todayDay`); an expected joiner is active from his join day, "Started work" records the real day. |
| 15 | RL-02 | P2 `d95ae8e` | Who decides follows the EMPLOYEE (his linked user's default group), checked again at the decision and in the rules (`hrUserManages`). |
| 16 | LV-03, LV-07 | P2 `2f587e1` | Above the balance: HR chooses "balance only" or "excess unpaid"; the employee cancels his own pending request. |
| 17 | RL-01 | R2-B `40d8e62` | The seeded `finance` group no longer holds `employees.manage`; five seeded HR groups (`hr_manager`, `hr_gov`, `hr_payroll`, `hr_supervisor`, `management`). **Existing companies need the migration — §4.** |
| 18 | Rules hardening | R2-B `425c44b`, `89ccda7` | A month cannot be closed before it ends; declarations are append-only; the objection's 16-day window and "cancel before it starts" are the server's; a supervisor reads only his workplaces' people (one query per site, `useScopedCollection`); one person's journal entries name no person. Also closed: a supervisor's site on someone else's worker, an injury naming any user, a request carrying any site, self-approval of a fixed IBAN, management setting any IBAN. |

## 2. The core gaps of 1 Oct — built

| Requirement | Package | What exists |
|---|---|---|
| RP-01/02 Reports | P4 `a6b2087` | Twelve live reports (`reports.ts`, `HrReportsView`, `/x/hr/reports`), CSV, Mudad and GOSI files for pay roles; riyal reports only to pay roles. |
| Notifications (TD-05) | R2-A `b5ae6a9` | `notify.ts` `emitHrNotice` — every act the PRD names tells its audience (requests, penalties and objections, letters, payroll, transfers and IBANs, exits and custody, settlements, manpower, corrections, injuries, arrivals, an expired iqama on a site). No amount in any HR notification. |
| EM-08, WF-24 Letters | P3, R2-A | `letters.ts`/`letter-writes.ts`, `hrLetters` + `hrLetterPay` (figures apart, RL-03); five types, signer by level, nobody signs his own, serial `LT-yyyy/NNN` (shown خ-); print in the letter's language; queue in Today; the experience certificate is issued with the settlement. |
| TD-04 Today | P4 `df4cbf9` | Three KPIs per role, role panels; overdue returns and pending corrections (R2-A). `leakage()` stays 0. |
| ST-05 Build path | P4 | Ten steps (`build-path.ts`) and the gaps panel. |
| AT-05 Return from leave | P2 `2f15aa4` | `recordReturn`; days late; the art. 80 stages on the sheet and the file. |
| AS-03 Assignment correction | P2, R2-B | `hrAssignFixes`; a supervisor names the worker by ID number, the HR manager resolves it to the record or refuses. |
| DC-04 Officer's list | P4 | One row per person, renewal order passport → insurance → iqama; 120-day queue. |
| EM-07 Attachments | P2 `4636589` | Storage under `organizations/{org}/hr/employees/{id}/`, append-only `employees/{id}/files`. |
| IM-04 Opening balance | P2 `db5877e` | From the card, once, capped by what service accrues. |
| The new employee file | P4 `ecbd08c` | Header, four tiles (pay tile masked for roles without pay), five segments. |
| My file for staff users | P4 | Works for all six roles; nobody approves his own (own-record guards in the write layer too, R2-A). |
| AC-12 Per-role render | P4 `c3112d4` | `render-hr-roles.test.tsx`: 7 roles × 10 screens, and every query a supervisor runs is one the rules can prove. |
| One user, one record | R2-A | `linkUser`/`createEmployee` refuse a user already linked. |

Found to be R2, not built: PY-08/09 (pre-Mudad check, reconciliation — the PRD's build order puts them with
the platforms); ST-03's two missing policies (hiring); six reports tied to optional features.

## 3. Still open

- **Not exercised by a signed-in user.** The click-through on UAT is owed: new employee · first sheet · prepare
  and approve a payroll (and a `-D`) · a letter · start an exit and approve the settlement · a supervisor's site
  page (his per-site queries rely on the rule reading `hrSites/{siteId}` from the query's equality filter — no
  emulator here).
- Eid 2026: the table follows the regulation (from the day after 29 Ramadan: 19–22 Mar); the prototype starts on
  1 Shawwal (20–23 Mar). Confirm with the owner.
- GOSI new-scheme rate for September 2026 (10.25 / 12.25 per the PRD, or stepped up in July) — to confirm with
  the authority.
- The employee cannot cancel his own APPROVED leave before it starts (the rules would need him to write his own
  balance); an early return is refused; late days at an office are deducted only if recorded on its sheet.
- Paying back the excess after a back-dated last day is a manual decision (the settlement names the months).
- Rules still lax: a leave request's `lineManagerUserId` is chosen by the client; management or Finance can write
  `advance` on any record; the renewal-fee entry names the employee number; a cost centre or payroll with one
  held line reveals that amount through its totals; supervisors read `hrExits` org-wide (no money in them).
- `storage.rules`: the HR folder has its own rule, but the catch-all still lets any signed-in user read and write
  every path — narrowing it needs an emulator test first.
- A supervisor cannot open an employee file (the route sits under People).
- HR numbers (LV/AV/HQ/LT) show Latin in the bell (the Arabic prefix table lives in the mirrored
  `sales-numbering.ts`); the push text renders them in Arabic.

## 4. Before it goes live

1. **Deploy the rules to UAT** (`node scripts/deploy-rules.js uat --check`, then deploy) — then prod, each with
   the owner's OK. The release is refused above the compiled ceiling; at 142,952 stripped there is room.
2. **Seeded groups for existing companies:** `node scripts/migrate-hr-seed-groups.js <uat|prod>` (dry run;
   `--apply`). Removes `employees.manage` only from an untouched seeded finance group; lists edited ones as kept
   and companies that would lose their only HR manager as "review" (`--include-review` to change them);
   `--seed-hr-groups` adds the five HR groups where missing.
3. **Mobile mirrors:** `src/lib/permissions.ts` and `src/lib/accounting/{accounts,journal,posting-rules,source-links}.ts`
   changed — re-copy into the mobile app and run `node scripts/check-mirrors.mjs <webDir>` there (the mobile repo
   is not on the machine that did this work).
4. Data written before 4 Oct: pay without `steps` computes as before; leave approved before the holiday table
   keeps its stored counts.

## 5. The ruleset's size

`30e35c1` folded six repeated shapes into `orgReadable()`, `createsInOrg()`, `keepsOrg()`, `pmOnly(keys)`,
`bySeq()`, `warehouseOrg()` (150,283 → 141,925 stripped); R2-B added `hrNotOwn()`, `hrOffice()`,
`hrSupervises()`, `hrOnSite()` and others. Measure before any rules change:

```bash
python3 -c "import re;s=open('firestore.rules').read();s=re.sub(r'//[^\n]*','',s);s=re.sub(r'/\*.*?\*/','',s,flags=re.S);s=re.sub(r'\s+',' ',s);print(len(s))"
```
