# HR — parity with the prototype (Prototype-HR-v11)

Inventory of 5 Oct 2026: every tab, panel, column, action, form field and state of `Prototype-HR-v11.html`
(per role and company type) against the built HR module, after the R1 completion of 4–5 Oct
(`docs/hr-prd-status.md`). Nine slices, each verified against the code. ✅ present · 🟡 partial (what differs is
stated) · ❌ missing. PRD column: requirement · priority · release (R1 core · R2 punches/shifts/platforms/hiring/
training · R3 performance/raises/P2) · "optional: <switch>" when behind a feature switch in HR Settings.

| Slice | ✅ | 🟡 | ❌ |
|---|---|---|---|
| 1 Today · bell · letters | 84 | 32 | 43 |
| 2 People · employee file · documents | 63 | 45 | 45 |
| 3 Sites · attendance · punches · shifts | 26 | 32 | 45 |
| 4 Payroll · files · advances · platforms | 38 | 35 | 27 |
| 5 Hiring · training · performance | 2 | 27 | 114 |
| 6 Tabs · settings · reports · simulator | 67 | 33 | 43 |
| 7 My file | 14 | 34 | 37 |
| 8 Core forms (field by field) | 154 | 73 | 39 |
| 9 Optional-feature forms | 63 | 15 | 72 |

(Counts are emoji occurrences per slice, a guide not a census.)

## Build plan

Defaults where the slices asked for an owner decision — the prototype is the reference, so its behaviour is the
default unless the owner says otherwise:

1. A recorded day locks; past days only through the missing-days declaration (WF-04).
2. The line manager's probation view ships with the core (EM-05 P0), not behind `perf`.
3. Management changes the HR manager's own pay (RL-02), as in the prototype.
4. Government relations may record a work injury (DC-07), as in the prototype.
5. The employee may cancel his own APPROVED leave before it starts; the balance is restored (LV-07).
6. Import: a blank basic stays blank (PRD IM-02), not filled with the trade's default.
7. A workshop's attendance stays HR's (one attendance record — the prototype's own design note); Manufacturing does
   not write it.
8. Punches: from My file in the browser (location asked with consent; inside/outside the workplace's radius) and
   device files imported as CSV; no device push API.
9. Government platforms: no integration — tasks and reconciliations are recorded by government relations, as the
   prototype simulates; wages in reconciliation are shown only to pay roles.
10. A Mudad "-R" release file for held lines paid after the month is built.
11. Hiring batches: issued visas are a record by trade with an arrival date; an arrival spends an issued visa, not
    the raw balance (no visa counted twice).
12. The simulator is not a product feature: each simulated event is produced by the real module that owns it.

Packages — phase 1 (core, in parallel), then phase 2 (optional modules, in parallel, behind their switches):

| # | Package | From slices | Owns |
|---|---|---|---|
| A | My file & self-service: Home (needs-attention, My day, requests in progress, last salary), the four tiles, quick actions, requests with detail/dates/holder/decider, attendance correction request (`attfix`, the no-punch types), payslip states (with Finance / held / returned), masked IBAN, cancel approved leave, data update (qualification, bank letter), leave & advance decision dialogs with their facts | 7, 8, 9 | `HrMyFile`, `HrRequestList`, `NewRequestDialog`, `requests.ts`, `request-writes.ts` |
| B | People & employee file: document rows and numbers, GOSI facts, contract on create and renewal (`ct`), line manager (form + derivation + probation view), overview alerts, attendance & pay segments, supervisor opens his workers' files, People list segments/filters/sort, raise request, management on the HR manager's pay, move/assign checks (licence, future date, closes corrections, names the manpower request) | 2, 8 | `HrEmployeeFile`, `HrPeopleView`, `EmployeeActionDialogs`, `NewEmployeeDialog`, `employee*.ts`, `documents.ts` |
| C | Sites, Attendance tab & manpower: site page (present today, month status, by trade, documents, move), unassigned page, per-company tab label, a core Attendance tab across workplaces, the declared-days bug, missing days from first arrival, manpower answer that acts (assign, schedule transfers, visas, hire / transfer / Ajeer / uncovered choice, plan acceptance by Projects) | 3, 8 | `HrSitesView`, `HrSiteAttendance`, `HrSiteWorkers`, `HrManpowerPanel`, `sites.ts`, `site-writes.ts`, `attendance*.ts`, `manpower.ts` |
| D | Today, tabs, settings, reports, notifications: row facts lines and groups, missing R1 rows (licences, sheet not recorded, contract decision, exit re-entry, final exit, waiting rows with age), role panels, tab counts and labels, Platforms tab rule, establishment fields (English name, Mudad no., Nitaqat band, threshold), policy log, Ajeer policy, reset to defaults, reports gaps, iqama-renewed notice | 1, 6 | `today.ts`, `HrTodayView`, `HrShell`, `access.ts`, `settings*.ts`, `HrSettingsView`, `reports.ts`, `HrReportsView`, `notify.ts` |
| E | Payroll, files & advances: exceptions view by cost centre, the `net_below_90` rule, Mudad file columns and preview, "-R" release file, supplementary file, advances on the Payroll page, reconciliation with Finance (GOSI paid, EOS vs ledger) | 4, 8 | `HrPayrollView`, `payroll*.ts`, `pay.ts`, `finance-writes.ts`, `FinanceHrDesk` |
| F1 | Punches, devices, geofence, shifts (optional: punch) | 3, 9 | new `punches.ts`, `shifts.ts`, Attendance tab punch views |
| F2 | Government platforms, Nitaqat, pre-Mudad check, platform reconciliation (optional: gov, mudad) | 4, 6, 9 | new `platforms.ts`, Platforms tab |
| G1 | Hiring & onboarding, visa batches (optional: hire) | 5, 9 | new `hiring.ts`, Hiring tab |
| G2 | Training & certificates; performance & raises (optional: train, perf) | 5, 9 | new `training.ts`, `performance.ts`, their tabs |

Rules budget: the ruleset is at ~143,000 stripped characters (production released 145,514; 150,113 was refused).
Core packages add at most a clause each in existing blocks; the optional modules ride existing collections with a
`kind` field where possible and fold existing shapes to pay for any new block.

---

<!-- slice 1-today -->
# Slice 1 — Today (every role), Notifications / bell, Letters

Sources read: proto.html `decisions()` 882–934, `waitingOthers` 935–942, `othersPanel`/`sitesPanel`/`endingPanel`/`nitaqatPanel` 990–1005, `DG`/`dGroup`/`groupedDec`/`decPanel` 1039–1046, `todayHr` 1047, `todayGov` 1058, `todayPay`+`attClosePanel` 1067–1069, `todaySup`+`tradeRows` 1083–1090, `todayMgmt` 1091, `todayNew` 1105, `TABS` 1008–1010, `notify` 793, `myNtf`/`renderBell` 1660–1663 + click 1703, every `notify(` site, `featOfGo` 1728, `x5Decisions` 2170–2190, letters `LTR` 1278 + 2552–2553, `letterHTML` 1281–1292, `ltrN`/`LTR_HINT`/`X5F.reqletter` 2554–2566, `letterBody` 2567, `letterAny` 2571, `X5F.letter` 2572–2583, exp letter at settlement 1555.
Ours read: `lib/hr/today.ts`, `hooks/useHrToday.ts`, `hooks/useHrTodayKpis.ts`, `components/hr/HrTodayView.tsx`, `components/hr/HrShell.tsx`, `components/hr/HrRequestList.tsx`, `components/hr/HrViolationList.tsx` (`violationWaits`), `lib/hr/notify.ts` + every emit site, `components/layout/portal-layout.tsx` (bell), `lib/hr/letters.ts`, `lib/hr/letter-writes.ts`, `components/hr/HrLetters.tsx`, `HrLetterDialogs.tsx`, `LetterDocument.tsx`, `lib/hr/exit-writes.ts` (exp letter), `lib/hr/build-path.ts`, `lib/hr/access.ts` (HR_GUARD), `messages/en.json` `Portal.HR.today`.

Severity legend: prototype r/a/b = ours red/amber/blue. Prototype groups (`dGroup`): `g` if set, else r → now, `mod` → ext, `form:(leave|adv|letter|raise|fix|assign)` or `form:pen` → req, otherwise due.

### Today — common (decision groups, waiting on other modules, KPIs)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Today = first tab / landing per role | `TABS` puts `today` first for every role but emp; `VIEWS.today` dispatches hr/gov/pay/sup/mgmt; emp → `meView` | `components/hr/HrShell.tsx` (redirects a role with no Today to its first tab = My file); `lib/hr/access.ts:hrTabs` | ✅ | TD-01 P0 R1 |
| Today tab count | `TABS` shows `decisions().length` as the tab's count | `HrShell.tsx` builds the rail with no `count` (ModuleHeader supports `count`/`urgent`) | 🟡 no count on the Today tab — pass `items.length + waiting requests + violations + letters` (urgent when any red) | TD-01 P0 R1 |
| «يحتاج قرارك» — one panel, four fixed group headers in order now · ext · req · due, each with its count | `decPanel` → `groupedDec`: headers `DG` يعطّل العمل الآن / من وحدة أخرى / طلبات الناس / مواعيد تحلّ, count per group | `HrTodayView.tsx` — four separate `Panel`s blocking · other · requests · due, each with count | ✅ (layout as four panels, same order) | TD-02 P0 R1 |
| Three per group + «عرض N أخرى» / «أقلّ» | `groupedDec` slices 3, `dmore` toggles `VS.more['dec:'+g]` both ways | `shown()`/`moreButton()` per group, n = 3 | 🟡 expands only — no «أقلّ» (collapse back) | TD-02 P0 R1 |
| Rows sorted by severity | `D.sort(sevK desc)` | `todayItems` sorts red→amber→blue | ✅ | TD-02 P0 R1 |
| Row anatomy: severity dot · icon · title · SECOND LINE (`s`) with the facts · source badge (`srcb(mod)`) · first action (red = filled button) · optional second action (`b2`) | `dline` | `DecisionRow` — title, severity, icon, action (red = default variant); detail only for source badge and `doc_due` order | 🟡 no second line on any row except doc order: prototype's `s` facts (balance, coverage, EOS figure, wage/instalment, "no decision = renewed", art. 80 text…) are missing; no `b2` second button anywhere | TD-02 P0 R1 |
| Empty state | «لا شيء ينتظرك — كل ما يخصّك قُرّر» | per-group `today.none.*` | ✅ | TD-02 P0 R1 |
| «عند وحدة أخرى» panel — waits held by another module, NO button, source + age (`rel(w.at)`) | `othersPanel(waitingOthers())`, subtitle «لا زر لنا — يصل الحدث من وحدته» | merged into the «other» group panel: `waiting: true` rows with `SourceBadge`, no action | 🟡 no age («منذ …») on a waiting row; incoming-with-action (manpower) and pure waits share one panel (prototype: incoming = `ext` group inside decisions, waits = separate panel) | TD-03 P0 R1 |
| Wait: advance above HR's limit with Finance | `REQ adv state fin` → fin, at `hrAt` | `wait_advance` (request.decide) | ✅ | TD-03 P0 R1 · AD-03 |
| Wait: payroll sent — payment with Finance | `PAY state sent` | `wait_post` (approved) / `wait_pay` (posted) for pay.view | ✅ | TD-03 P0 R1 |
| Wait: «إعادة صرف N حوالات مرتجعة بعد التصحيح» with Finance | any `iban==='ret'` → one fin row | — (IBAN approval only notifies Finance `hr_iban_approved`) | ❌ add a waiting row per approved-IBAN line not yet paid (payment state `fixed`→approved, line held) — source payments | TD-03 P0 R1 · PY-03 P0 R1 |
| Wait: custody clearance with Inventory | `exit.custody>0` → inv, items count | `wait_custody` (exit.manage) | 🟡 no item count | TD-03 P0 R1 · EX-03 |
| Wait: settlement payment with Finance | `exit.settled && !paid` → fin, net | `wait_settlement` | ✅ (no amount, by design RL-03 on shared rows) | TD-03 P0 R1 · EX-04 |
| Wait: «ردّنا على ط.ع — قبول الخطة» with Projects | `MREQ state answered && !ack` → `PROF.mrMod` | — (`ManpowerRequest.state` has no `ack`/accepted step) | ❌ | TD-03 P0 R1 · AS-02 P0 R1 |
| Leakage = 0 (a held row never carries an action) | `selfTest` counts rows whose `go` starts paid/reissue/cust/ack/finadv with a button | `lib/hr/today.ts:leakage` + tests (`hr-today`, `hr-manpower`, `hr-write-leftovers`) | ✅ (letters/requests/violations lists are outside `leakage()` — they only list what the viewer may act on) | TD-03 P0 R1 |
| KPIs: three per role, each a door to the list it counts | `kpiBox` with `go` | `todayKpis` + `useHrTodayKpis` → header | ✅ (per-role differences below) | TD-04 P1 R1 |
| Role picked when a person holds several | one user = one role | `kpiRole`: manager → payroll → gov → supervisor → management | ✅ | TD-04 P1 R1 |
| «أماكن العمل اليوم» — per site present ÷ assigned bar, pills: N absent (r), N unrecorded (a), N leave/exit; «بلا تسجيل منذ D» when none recorded; bench row with count and (moneyOk) ≈cost/month | `sitesPanel` (hr, mgmt) | `HrTodayView.tsx` `sitesToday` via `dutyToday` (manager, management, payroll, supervisor-own) | 🟡 a site with nothing recorded says "none" without the since-date (`ATT.thru`); the unassigned row has no ≈ monthly cost for money roles (AS-04); prototype shows it to hr/mgmt only | TD-04 P1 R1 · AS-04 P1 R1 |
| «مواقع تنتهي قريباً» — sites with `end ≤ 45`: «name — in N days», «N will be unassigned without a plan · PM name», «خطّط» (CAN assign) → that site; source badge pm | `endingPanel` (hr, mgmt) | `endingPanel` in `HrTodayView.tsx` | 🟡 no PM name, no Projects source badge, «Plan» opens the sites list, not the site (`sites/{id}`) | AS-02 P0 R1 |

### Today — HR manager

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| KPI «على رأس العمل اليوم» | `onDuty()` of `A.length`; sub absent+sick · unrecorded · bench (+ ≈cost/mo if moneyOk); warn if bench > 5; → people | `todayKpis` `on_duty` | 🟡 no bench cost in the note; tone warns on unrecorded instead of bench > 5; no link | TD-04 P1 R1 · AS-04 |
| KPI «وثائق منتهية أو تنتهي خلال renewWin» | `worstDoc ≠ ok`; sub «N iqamas expired — M on sites» | `documents` → `people?filter=docs` | ✅ | TD-04 P1 R1 · DC-01 |
| KPI «الرواتب» | last main net + state; sub supplementary awaiting / returned count; none → «الأول بعد … وإقفال الحضور» | `payroll` | ✅ | TD-04 P1 R1 |
| Manpower request (new) | sev r if coverage `short||late` else a; title «طلب عمالة ط.ع — q × trade for site from D»; sub coverage: on time · late · uncovered · excluded (expired iqama/licence); «اقرأ وردّ» → `form:mr:id`; mod pm → ext | `manpower` row: other, amber, action answer → `sites` | 🟡 severity not from `coverage()` (red when short/late); no coverage line; opens the sites page, not the request | AS-02 P0 R1 |
| Pending leave (not own) | sev a if annual & days > balance else b; sub site · balance · «exceeds by N» · endorsed by X / «no supervisor endorsement»; «قرّر» → req | `HrRequestList` in «requests» (`requestActions` approve/decline) | 🟡 row shows type · dates · days only — no site, balance, over-balance warning, endorsement line (pill "endorsed" only); no severity | LV-02/03/05 P0 R1 · TD-02 |
| Pending advance | b; sub trade · site · wage · instalment 10 % × months · outstanding advance yes/no · reason | `HrRequestList` | 🟡 amount only (money roles) — no wage, instalment × months, outstanding flag, reason | AD-01/02 P0 R1 · TD-02 |
| Assignment correction («يعمل في …») | a, group req; «صحّح الإسناد» → `form:assign` | `assign_fix`: blocking, amber, decide → site | 🟡 group blocking instead of people's requests | AS-03 P1 R1 |
| Drivers with expired licences | ONE aggregated row, r: «N drivers with expired licences — they do not drive until renewed», names, «reassign to non-driving work or stop them», «أبقِهم أم أوقفهم» → people docs | — (`documents.ts:mayDrive` exists, unused on Today) | ❌ | DC-06 P1 R1 |
| Expired iqamas on sites | ONE aggregated row, r: «N on sites with expired iqamas», first 3 names +N, «renewal is government relations'», «أبقِهم أم أوقفهم» → people docs | `iqama_on_site` one row PER person, red, «Move» → person | 🟡 per person, not aggregated (acceptable; prototype's "keep or stop" choice is a move-to-unassigned here) | DC-02 P0 R1 |
| Settlement for a leaver | sev a if last day ≤ 7 else b; sub EOS amount + leave balance + custody items; custody > 0 → wait inv (no button), else «أعدّ المخالصة» → `form:fs` | `settlement_ready` (blocking, amber, only when custody cleared) + `wait_custody` | 🟡 no row for a leaver whose custody was never requested; severity not from last-day proximity; no EOS/leave line | EX-03/04 P0 R1 |
| Contracts ending within 45 days | b, due; one person → «عقد X ينتهي …», several → ONE row «N contracts end within 45 days — nearest X»; sub «بلا قرار يتجدّد لمدة مماثلة»; «قرّر» → `form:ct` (renew +730 days, or not renew → exit `k:'end'` with `last = ct`) | `contract_end` per person, blue, 60 days, «Open» → person | 🟡 window 60 vs 45; no "no decision = renewed" line; no renew / not-renew decision write (only an exit with reason `contract_end`) | EX-01 P0 R1 · EM-01 |
| Draft payroll | a; «pyName — N lines · net · held»; «راجع واعتمد» → payroll | `payroll_approve` (blocking, amber; never the preparer) | 🟡 group blocking instead of due; no lines/held count in title | PY-05 P0 R1 |
| New IBAN to approve | a, g req; «غيّره محاسب الرواتب · فصل مهام»; «اعتمد» → `do:ibanok` | `iban_approve` (blocking, amber) | 🟡 group blocking instead of people's requests | PY-03 P0 R1 |
| Letter to sign (who = hr) | b, req; «خطاب X — name · to Y · «purpose…70»»; sub free → «write it, then sign or decline» / standard → «computed from the record — review & sign»; «راجع ووقّع» | `lettersToSign` → `HrLetterList` in «requests» | ✅ (no free/standard hint line) | EM-08 P1 R1 |
| Objection to a penalty | a, g req; «ابتّ فيه أو أحله للجنة — الجزاء موقوف»; two buttons «أبقِه» / «ألغِه» | `violationWaits` (state `objected`) → `HrViolationList` | ✅ | PN P0 R1 |
| Violation to decide | a, req; sub note · by · penalty per regulation · occurrence N | `violationWaits` (state `recorded`) | ✅ | PN P0 R1 |
| Probation ending within 15 days | a, due; sub trade · site · «بلا قرار يصبح مثبَّتاً»; «ثبّت · مدّد · أنهِ» → `form:prob` | `probation_end` amber, due, ≤ 14 days, «Decide» → person | 🟡 14 vs 15 days; no "no decision = confirmed" line | EM-05 P0 R1 |
| Raise / promotion request | b, req; «طلب ترقية — name · basic ← newBasic», sub why · effective; «قرّر» → `form:raise` | — (`HR_REQUEST_KINDS` = leave, advance, data) | ❌ | EM-04 P0 R1 |
| Attendance not recorded since D (per site, month open, `thru < TD-1`) | a; sub «N days missing — recorded day by day, never bulk · no payroll before it»; «ذكّر المشرف» (`do:remind`) | — for the HR manager (`sheet_today` only for supervisors; `close_month` only for LAST month) | ❌ row + remind action | AT-03/04 P0 R1 |
| Close last month (ours) | — (pay's `attClosePanel`) | `close_month` red blocking for attendance.close | ✅ extra (stricter than prototype) | AT-03 P0 R1 |
| Prepare last month's payroll (ours) | — | `payroll_prepare` | ✅ extra | PY-01 |
| Not back from leave | x5: a, g now; «انتهت إجازته D ولم تُسجَّل مباشرته», art. 80 sub; «باشر اليوم» + «البطاقة» | `leave_return_due` (due) / `_warning` (blocking amber) / `_termination` (blocking red); «Record» | 🟡 before 10 days ours files it under due (prototype always blocking); no second «Card» button | AT-05 P1 R1 |
| Injury report (when no gov user) | gov only | `injury_*` for injury.report (manager too) | ✅ | DC-07 P0 R1 |
| Documents per person (gov's renewal rows) | HR does NOT get per-person doc rows (KPI only; platform tasks row points HR to Documents when a gov user exists) | `doc_due` for documents.manage = manager AND gov | 🟡 HR manager gets every renewal row too — duplicate of the officer's queue; show only when the org has no gov holder | DC-04 P1 R1 |
| Side panels | others · sites today · ending | sites today · ending (+ build path / gaps while moving in) | ✅ | TD-04 |

### Today — government relations

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| KPI «إقامات منتهية الآن» | count; sub on sites · expired medical insurance | `iqama_expired` → `people?filter=iqama` | ✅ | TD-04 P1 R1 |
| KPI «تنتهي خلال 30 يوماً» | documents d30 (off ≥ 0); sub «و N أخرى خلال 60» | `expiring` | ✅ | TD-04 P1 R1 |
| KPI «وافدون بلا إقامة» | arrivals with `iq === null`; sub nearest 90-day deadline; warn when < 15 days | `arrivals` | ✅ | TD-04 P1 R1 · DC-05 |
| Renewal row per PERSON (not per document) | docs exp/d30/d60 excl. contract; sev by worst; title: pending iqama issue «90-day window, N left» / «X expired since N» / «X expires …»; sub trade · site · «one trip, in order: passport ← insurance ← iqama» · «passport first» (`ppBeforeIq`) · **on site** for an expired iqama; «سجّل الإصدار»/«سجّل التجديد» → `form:doc` (passport first when chained); red → now group | `doc_due` per person (renewalChain), `iqama_clock` for arrivals; «Renew» → person | 🟡 always in «due» (red ones belong in blocking); no "passport first" flag, no "on site" mark, no trade/site line; action opens the file, not the renewal form for the right document | DC-03 P0 · DC-04 P1 · DC-05 P0 R1 |
| GOSI injury report | sev r when past `at + 3 working days`, else a; sub description · deadline · «wages during treatment are GOSI's»; «سجّل البلاغ» | `injury_overdue` (blocking red) / `injury_due` (due amber) | ✅ (no sub line) | DC-07 P0 R1 |
| Letter to sign (who = gov: embassy) | as HR's | `lettersToSign` (signerLevel gov) | ✅ | EM-08 P1 R1 |
| Exit re-entry before travel | approved leave, non-Saudi, `from > 0`, `!exitVisa` → b «خروج وعودة — name · travels D»; «سُجّلت» (`do:exitvisa` sets `q.exitVisa`) | notification `hr_exit_reentry` only | ❌ no Today row, no "recorded" flag on the leave | LV-08 P1 R1 |
| Final exit | leaver with `last ≤ 14` → b «خروج نهائي — name · D», no button; wait «المخالصة» (hr) until settled | notifications `hr_exit_started`, `hr_settlement_paid` only | ❌ no Today row / wait | EX-06 P1 R1 |
| «التجديد بالترتيب» — 120 days, 8 people, chips per non-ok document | `todayGov` panel | `queuePanel` (`renewalQueue`, 8 + more) | ✅ | DC-04 P1 R1 |
| «ملف المنشأة» (Nitaqat) panel | `nitaqatPanel`: band (manual `FIRM.band`, pill green/other) · Saudi ratio computed (sa of total) · green threshold `FIRM.minPct` · safety margin («ينقص N سعوديين» / «يمكن أن تفقد N») · CR · establishment · GOSI reg · visas available + as-of | — (`Establishment` has name, cr, mol, gosi, visas, visasAsOf; no band, no minPct) | ❌ | ST-04 P1 R1 |
| Platform tasks row | x5 (feature gov): «أعمال على المنصات: N — M late» → platforms | — | ❌ optional: gov (see feature section) | GV-02 P1 R2 · optional: gov |

### Today — payroll officer

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| KPI «مسير الشهر — تقدير الإجمالي من العقود» | sum of wages (not exit); sub «recorded through yesterday at X of Y workplaces»; → payroll current | `estimate` → payroll | 🟡 note lacks "recorded through yesterday at X of Y workplaces" | TD-04 P1 R1 |
| KPI «حوالات مرتجعة» | count + net; sub «unpaid until fixed» | `returned` | ✅ | TD-04 P1 R1 · PY-03 |
| KPI «سلف قائمة» | sum of balances; sub N employees · 10 % automatic; → payroll advances | `advances` → `reports?report=advances` | ✅ | TD-04 P1 R1 |
| Returned transfer | r, mod fin; sub trade · site · «unpaid since»; «صحّح الآيبان» → `form:iban` | `iban_fix` blocking red | ✅ (no sub line) | PY-03 P0 R1 |
| Draft payroll — open, review lines, send for approval | a; «افتح» → payroll | `payroll_prepare` (last month's main missing) | ✅ (different state model: prepare vs approve) | PY-05 P0 R1 |
| Attendance stopped at a site this month | a, «No September payroll before it closes», «ذكّر المشرف» | — | ❌ (same gap as HR) | AT-03/04 P0 R1 |
| Approved advance to schedule | b «قسّطها على N أشهر», «قسّط» | — (instalments fixed at decision) | ✅ by design (no manual scheduling step) | AD-02 P0 R1 |
| «إقفال حضور الشهر السابق — الشهر انتهى» panel: each unclosed workplace, «recorded through day N», close button | `attClosePanel` (pay; new company) | `close_month` rows (blocking) for attendance.close | 🟡 rows instead of panel; no "recorded through day N" | AT-03 P0 R1 |
| «الحضور — الشهر الحالي» panel: per site bar closed / through yesterday / stopped since D | `attClosePanel` second part | sites-today panel (present ÷ assigned today) | 🟡 the month-progress view (recorded through which day, stopped since) is missing | AT-03/04 P0 R1 |
| «عند وحدة أخرى» filtered to Finance, advances excluded | `othersPanel(waitingOthers().filter(fin && !advance))` | `wait_post`/`wait_pay` (pay.view); `wait_advance` needs request.decide | ✅ | TD-03 P0 R1 |
| Device / punch rows | x5 (punch) | — | ❌ optional: punch (see feature section) | PT-03/05 P1 R2 |

### Today — supervisor

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| KPI «عمالي اليوم» | present of my active; sub absent · sick · unrecorded · leave/exit outside the count | `my_workers` | ✅ | TD-04 P1 R1 |
| KPI «بلا تسجيل» | count; «سجّل قبل نهاية اليوم» / «اكتمل» | `unrecorded` | ✅ | TD-04 P1 R1 |
| KPI «وثائق تنتهي لعمالي» | count; red tone when any expired; «Renewal is government relations'» | `my_docs` | 🟡 tone is warn even when one is expired | TD-04 P1 R1 |
| Today's sheet ON Today (left column: `attSheet(site)` — all present, exceptions, OT, violation flag, "a worker here but not listed", close previous month) | `todaySup` | `sheet_today` row (due, blue) → `sites/{id}`; sheet lives on the workplace page | 🟡 the sheet is one click away, not on Today (sheet itself: attendance slice) | AT-01 P0 R1 |
| Row «حضور اليوم — N بلا تسجيل» | a; «الكل حاضر ثم عدّل الاستثناءات»; «سجّل» | `sheet_today` per site, blue | 🟡 severity blue vs amber; no unrecorded count in title | AT-01 P0 R1 |
| Leave to endorse | b; «توصيتك تُرفق للقرار — القرار لمدير الموارد»; «أوصِ» (`do:rec`) | `HrRequestList` with `endorse` (`mayEndorse`: site supervisor / line manager) | ✅ | LV-05 P0 R1 |
| Not back from leave (own site) | x5: a, now; «باشر اليوم» | `leave_return_*` with leave.return (site-scoped) → `sites/{id}` | ✅ (group nuance as HR) | AT-05 P1 R1 |
| «عمالي بحسب المهنة» panel: per trade present/total bar + «N expired iqama» pill | `tradeRows(scope())` | — (sites-today panel for own sites instead) | ❌ | TD-04 P1 R1 (prototype panel; no own ID) |
| Perf / training / attendance-correction rows | x5 (perf, train, punch) | — | ❌ optional (see feature section) | — |

### Today — management

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| KPI 1 «بلا إسناد — يُدفع لهم» (bench cost/mo, N workers; sub «+N from site X (≈ cost) join in D without a plan») else «قرارات أشخاص خلال 60 يوماً» (contracts ending ≤ 60 + probations ≤ 30; + site ending) | `todayMgmt` | `bench` / `decisions` | 🟡 bench note lacks the soonest-ending site's people and cost; `decisions` counts probations ≤ 60 (prototype ≤ 30) and omits the ending site | TD-04 P1 R1 · AS-04 P1 R1 |
| KPI 2 «تكلفة العمالة — الشهر» (gross + employer GOSI) | sub average per head · admin share % (hq + bench of cost) · Saudi % | `labour_cost` → `reports?report=cost` | 🟡 no admin-share % | TD-04 P1 R1 |
| KPI 3 «إقامات منتهية على المواقع» | sub returned (unpaid) count since N days · «payroll paid on day 7 vs policy day 5» | `iqama_on_site` → `people?filter=iqama_site` | 🟡 no "paid on day X vs policy pay day" fact | TD-04 P1 R1 |
| «تكلفة العمالة بحسب مركز التكلفة» table: cost centre · account (`ccOf`) · employees · cost + per head · share bar; bench row «بلا إنتاج»; total; footnote «مركز التكلفة يتبع الإسناد … لا تُوزَّع بالنِّسب» | `todayMgmt` left column | — on Today (exists as a report — reports slice) | ❌ on Today | AS-04 P1 R1 · RP-02 |
| Sites today · sites ending | `sitesPanel`, `endingPanel` | same panels | ✅ (see common) | TD-04 |
| Decisions panel for management (HR manager's own leave/advance; letters at management level) | `decisions()` builds mgmt rows but `todayMgmt` does NOT render `decPanel` (only the tab count shows them) | requests/letters for management shown in «requests» | ✅ ours better (prototype gap) | LV-05 P0 R1 |

### Today — new company

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Replaces the HR Today until the build path is done | `todayHr` → `todayNew` when `CO==='new' && !buildSteps().every(done)` | `HrTodayView` shows build + gaps panels (settings.manage) beside the normal decisions while steps remain (any company) | ✅ | ST-05 P1 R1 |
| KPIs «الموظفون» (on record; present today · unassigned) · «أماكن العمل» (count; names) · «المسير» (last net · month · state; «current month · today») | `todayNew` | — (manager's normal three KPIs) | ❌ | ST-05 P1 R1 · TD-04 |
| Build path panel (10 steps) | `buildPanel` | `lib/hr/build-path.ts:buildSteps` → `buildPanel` | ✅ (detail: settings slice) | ST-05 P1 R1 |
| «ما تبيّن ناقصاً» | `gapsPanel` | `setupGaps` → `gapsPanel` | ✅ | ST-05 P1 R1 |
| Close previous month panel when someone worked last month | `attClosePanel` if `prevOpen` | `close_month` rows | ✅ | AT-03 P0 R1 |
| Decisions only when any | `D.length ? decPanel : ''` | decisions always shown | ✅ | TD-02 |

### Today — feature decisions (x5Decisions)

All are gated by `featOfGo(go)` → `FEAT(f)` (hire / perf / train / punch / gov). None is built in ours (no hiring, perf, training, punch, platforms tabs).

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Platform tasks (hr, gov) | `govTasks()` count, M late → sev a else b, g due; gov (or HR when no gov user) → platforms, else HR → Documents | — | ❌ | GV-02 P1 R2 · optional: gov |
| Not back from leave (hr; sup own site) | always on (no feature) | `leave_return_*` | ✅ (see HR) | AT-05 P1 R1 |
| Opening will miss its date (hr) | `JOBS.filter(jobLate)` a, due: «late by N» · needed · expected · why; → job | — | ❌ | HI-03 P1 R2 · optional: hire |
| Candidates waiting on you (hr) | count: new to screen · after interview · accepted not converted; b, req | — | ❌ | HI-02 P1 R2 · optional: hire |
| On duty without a valid safety certificate (hr) | `certGaps().filter(gapBad)` r, now; «N in a scheduled session» → training | — | ❌ | TR-02 P1 R2 · optional: train |
| Training session today (hr) | session `plan` & `at ≤ 0` a, due; «سجّل» → `form:sessdone` | — | ❌ | TR-04 P1 R2 · optional: train |
| Reviews awaiting approval (hr) | `rv.st==='done'` count, b, req; flag a rater mostly «outstanding» | — | ❌ | PF-05 P1 R3 · optional: perf |
| Punch exceptions (hr) | late · no punch · OT · missing out counts, b, due → attendance | — | ❌ | PT-04/05 P1 R2 · optional: punch |
| Device file late (hr, pay) | site with device `lastImp < -1`, a, now; «استورد» → `form:impdev` | — | ❌ | PT-03 P1 R2 · optional: punch |
| Attendance corrections (hr, when no supervising manager user) | `attfix` pending count, b, req → attendance | — | ❌ | PT-07 P1 R2 · optional: punch |
| Candidate accepted — convert (gov) | a, req; «حوّله» → `form:newemp:cand` | — | ❌ | HI-06 P1 R2 · optional: hire |
| Recruitment batch stage (gov) | b, due; agency · expected; «سجّل التالي» | — | ❌ | HI-02 P1 R2 · optional: hire |
| New joiners missing Qiwa/GOSI (gov) | onboarding mandatory items not ok, b, due | — | ❌ | HI-06 P1 R2 · optional: hire |
| Punch OT / missing outs before month close (pay) | b, due; «unapproved overtime never reaches payroll» | — | ❌ | PT-05 P0 R2 · optional: punch |
| Rate your workers (sup) | cycle open, unrated team count, a, due | — | ❌ | PF-02 P1 R3 · optional: perf |
| Your view on X's probation (sup = line manager) | `prob ≤ 30`, no `pe`, a, due → `form:pe` | — | ❌ | EM-05 P0 R1 (line manager's view attaches) · prototype gates it on perf |
| Your workers lack a safety certificate (sup) | r, now; next session date | — | ❌ | TR-05 P1 R2 · optional: train |
| Attendance correction accept / decline (sup) | b, req; two buttons «اقبل»/«ارفض» | — | ❌ | PT-07 P1 R2 · optional: punch |
| New position to approve (mgmt) | `JOBS state wait` a, req; ≈ loaded monthly cost | — | ❌ | HI-01 P1 R2 · optional: hire (+ `POL.strict.jobApprove`) |
| Offer above band (mgmt) | a, req; basic vs band ceiling | — | ❌ | HI-05 P1 R2 · optional: hire |
| Annual review raises (mgmt) | `CYC.raise.state==='mg'` a, req; total/month, N, effective | — | ❌ | PF-06 P1 R3 · optional: perf |

### Notifications / bell

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Model | `notify(to, tx, go, at, mod)` → `NTF` (`to` = `role:x` or a user id), read per user `rd[USER]` | `lib/hr/notify.ts:emitHrNotice` → `users/{uid}/notifications` (role resolved to its holders at send time; actor and `except` never told; `once` = fixed id) | ✅ (a person who takes a role later does not see older role notices — by design) | TD-05 P1 R1 |
| Bell: unread count, list newest first, click marks read and opens `go` | `renderBell`/`myNtf`, click 1703 | `components/layout/portal-layout.tsx` (badge, `handleNotificationClick` → `read: true` → `notificationHref(link)`); text re-rendered per reader (`notificationCopy`, `Portal.Shared.pn_hr_*`) | ✅ | TD-05 P1 R1 |
| Source module + relative time on each notice | `rel(n.at)` · `MODN[n.mod]` | time shown; no source-module tag | 🟡 no module tag (inv / fin / pm) on HR notices | TD-05 P1 R1 |
| Empty: «لا إشعارات لدورك» | yes | portal bell empty state | ✅ | TD-05 |
| No amount in any notice | (prototype puts amounts in text) | RL-03: no amount ever | ✅ ours stricter | RL-03 |
| SMS to the employee in his language | PRD: «في المنتج: رسالة جوال للموظف بلغته» | — (no SMS from HR notices) | ❌ | TD-05 P1 R1 (PRD Notifications note) |
| Leave request → supervisor/LM (endorse) + HR (or management for HR's own) | 1541 → hr / mgmt | `hr_leave_to_endorse` + `hr_request_filed` (`request-writes.ts`) | ✅ | LV-05 P0 R1 |
| Advance request → HR | 1542 | `hr_request_filed` | ✅ | AD-01 |
| Data update request → HR | 2337 | `hr_request_filed` (kind data) | ✅ | EM-01 |
| Any request decided → requester | PRD table | `hr_request_decided` | ✅ | TD-05 |
| Advance above limit → Finance | — | `hr_advance_to_finance` | ✅ extra | AD-03 |
| Approved leave of a non-Saudi → gov «خروج وعودة قبل D» | 1530 | `hr_exit_reentry` | ✅ | LV-08 P1 R1 |
| Iqama renewed (person on a site) → HR «يمكن نقله وإسناده» | 1545 | — (`recordRenewal` emits nothing) | ❌ | DC-03 P0 R1 |
| New non-Saudi without iqama → gov «إصدار الإقامة خلال 90 يوماً» | 1561 | `hr_iqama_clock` (`employee-writes.ts:createEmployee`) | ✅ | DC-05 P0 R1 |
| Expired iqama on a site → gov | seed 2600 | `iqamaOnSiteNotices` + `hr_iqama_on_site`, sent from the HR manager's Today (once a day per browser, fixed id per lapse) | 🟡 only fires when someone with employee.assign opens Today — no scheduled sweep | TD-05 · DC-02 P0 R1 |
| Assignment correction → HR; decision → supervisor | 1553 | `hr_assign_fix_raised` / `hr_assign_fix_decided` | ✅ | AS-03 P1 R1 |
| Letter request → signer role | 1570/2566 | `hr_letter_filed` → signer level (gov / manager / management), link Today | ✅ | EM-08 P1 R1 |
| Letter issued / declined (with reason) → employee | 2582/2583 | `hr_letter_issued` / `hr_letter_declined` | ✅ | EM-08 P1 R1 |
| Violation → HR (and employee) | 1571 | `hr_violation_recorded` | ✅ | PN P0 |
| Penalty on you (with objection window) → employee | PRD table | `hr_penalty_applied` (+ `hr_penalty_dismissed`) | ✅ | PN P0 |
| Objection filed → HR; decided → employee | 1586 | `hr_objection_filed` / `hr_objection_decided` | ✅ | PN P0 |
| IBAN corrected → HR approve | 1580 | `hr_iban_to_approve` (+ `hr_iban_approved` → Finance) | ✅ | PY-03 P0 R1 |
| Returned transfer → payroll + employee | seed 2597 | `hr_iban_to_fix` + `hr_transfer_returned` (`finance-writes.ts`) | ✅ | PY-03 P0 R1 |
| Payroll prepared → approver; approved → Finance; payslip → employee | — | `hr_payroll_prepared` / `hr_payroll_approved` / `hr_payslip_ready` | ✅ extra | PY-05 |
| Manpower request → HR; answer → asker | 1612 / seed 2596 | `hr_manpower_requested` / `hr_manpower_answered` (`manpower.ts`) | ✅ | AS-02 P0 R1 |
| Custody clearance requested → HR (inv source) | seed 2598 → role:hr | `hr_custody_requested` → Inventory (HR is the actor) | ✅ (audience per our flow) | EX-03 |
| Custody cleared → HR «أعدّ المخالصة» | 1619 | `hr_custody_cleared` | ✅ | EX-03 P0 R1 |
| Exit started → gov; settlement approved → Finance | — | `hr_exit_started` / `hr_settlement_approved` | ✅ extra | EX-04/06 |
| Settlement paid → gov «الخروج النهائي» | 1618 | `hr_settlement_paid` | ✅ | EX-06 P1 R1 |
| Work injury → gov | — | `hr_injury_recorded` | ✅ extra | DC-07 |
| Promotion requested → HR | seed 2601 | — | ❌ | EM-04 P0 R1 |
| Probation view of the line manager → HR | 2006 | — | ❌ | EM-05 P0 R1 (prototype gates on perf) |
| New position / above-band offer → mgmt; position / offer approved → HR; candidate via link → HR | 1859, 1882, 1900, 1907, 2226 | — | ❌ | HI-01/05/09 P1–P2 R2 · optional: hire |
| Reviews sent / returned / approved; annual raises → mgmt | 1999, 2014, 2033, 2035, 2037 | — | ❌ | PF-05/06 P1 R3 · optional: perf |
| Training session scheduled → site supervisor | 2024 | — | ❌ | TR-03 P1 R2 · optional: train |
| Overtime refused with reason → employee; attendance correction → line manager | 2108, 2114 | — | ❌ | PT-05/07 R2 · optional: punch |

### Letters

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Five types and their signer | `LTR`: sal (hr), emb (gov), exp (hr, only when leaving), noc (hr), oth (hr) | `lib/hr/letters.ts:LETTER_KINDS`, `LETTER_SIGNER`, `requestableKinds` | ✅ | EM-08 P1 R1 |
| Ask from My file | «اطلب خطاباً» → `X5F.reqletter` | `HrLettersPanel` in My file → `NewLetterDialog` → `fileLetter` | ✅ (fields: forms slice) | EM-08 P1 R1 |
| HR asks for the employee | (prototype: emp only) | `HrLettersPanel` in the employee's file (`letter.file`, manager) | ✅ extra (PRD §4) | EM-08 |
| Nobody signs his own | not enforced (`CAN('approve')||gov`) | `letterSignerLevel` (HR manager's own → management; gov's own embassy → HR manager) + `maySignLetter` | ✅ ours stricter | RL-02 P0 R1 |
| Request notifies signer | `notify('role:'+who)` | `hr_letter_filed` | ✅ | EM-08 |
| Signer queue on Today («people's requests») | rows per pending letter of my `who` | `lettersToSign` → `HrLetterList` (purpose quoted, «with: signer») | ✅ (`letterTodayRows` in letters.ts is unused — logic only) | EM-08 P1 R1 · TD-02 |
| Sign sheet: issue & sign / decline with reason; free letters edit text starting from the employee's words; employee's ask shown; leaving-employee warning (not exp) | `X5F.letter` | `LetterDialog` (`initialLetterText`, `issueBlocks`/`declineBlocks`, `letter.leaving_warn`) | ✅ | EM-08 P1 R1 |
| Serial on issue (`خ-2026/NNN`), date, signer name + role | `q.serial = 'خ-2026/'+LNO++`, `okBy`, `okRole` | `drawYearlyDocNumber` LT-yyyy/NNN (shown خ-), `decision.role` | ✅ | EM-08 |
| Letter body from the card: header (company, CR, establishment no., HR), No./date, To, Mr/Ms name (nationality) ID/iqama no.; sal: job since + basic/housing/transport/total table + no-liability; emb: job, total wage, no objection to travel during the approved leave dates; exp: from join to last day, good conduct; noc: "no objection to the following" + text; oth: title + employed since + text; «مصدر البيانات: بطاقة الموظف» | `letterHTML`, `letterBody` | `LetterDocument.tsx` (card + head frozen at signing; pay from `hrLetterPay`, masked for gov) | ✅ | EM-08 P1 R1 · RL-03 |
| Embassy letter names the approved leave | auto: first approved leave with `from > 0` | signer picks the leave (`travelRequestId`, validated in the write) | ✅ (manual pick) | EM-08 |
| Rendered in the letter's language | `letterAny` swaps `LANG` to `q.lang` | `LetterInLanguage` | ✅ | EM-08 |
| Print | `window.print()` | `printLetter` (self-written window) | ✅ | EM-08 |
| Experience certificate issued with the settlement (art. 64) | 1555: settlement prepared → `k:'letter', lt:'exp', state ok` | `exit-writes.ts` files + issues `exp` (stays pending in the HR manager's queue if the issue fails) | ✅ | EX-04 · EM-08 |
| Issued / declined visible to the employee with serial or reason | My file requests list «اعرض الخطاب» | `HrLetterList` (serial, reason on the line, View) | ✅ | EM-08 |
| Never edited after issue | implicit | `issueBlocks` "stale"; rules | ✅ | EM-08 |

#### Build notes — Today / Notifications / Letters

1. **Second line and second button on Today rows (TD-02).** Add `detail?: { key: string; params }` and `action2?`/`href2?` to `TodayItem` (`lib/hr/today.ts`), render in `HrTodayView.tsx`. Facts per kind from the prototype's `s`: manpower coverage (onTime/late/short/excluded from `manpower.ts:coverage`), settlement (EOS + leave days; money only for money roles), contract («no decision = renewed»), probation («no decision = confirmed»), injury deadline, doc chain (trade · site · passport-first · on site), leave-return art. 80 text. For requests in `HrRequestList`: leave → site · balance at start · «exceeds by N» · endorsed by/«no endorsement»; advance → wage · instalment × months · outstanding flag · reason (money roles via `access.seesPay`). No data-model change; i18n keys under `Portal.HR.today.s.*`.
2. **Group placement.** Move `assign_fix` and `iban_approve` to the «requests» group (needs `TodayItem.group` to admit `"requests"` and the requests panel to render `TodayItem`s under the lists), `payroll_approve` to due, red `doc_due` to blocking, `leave_return_due` to blocking amber. Pure change in `today.ts`; tests in `hr-today.test.ts`.
3. **Today tab count** — `HrShell.tsx` rail: `count` for `today` (items + waiting requests + violations + letters), `urgent` when any red. Needs `useHrToday` in the shell (already used by `useHrTodayKpis`); no rules impact.
4. **Missing decision rows (R1):**
   - *Drivers with expired licences* (DC-06): one aggregated row (HR manager, employee.assign) over `live` with `drives` set and `!mayDrive(e, today)`, red, → `people?filter=…` (new People filter `licence`, add to `PEOPLE_FILTERS`).
   - *Attendance not recorded since D* (AT-03/04) for HR manager and payroll: per active non-office site in the current month whose last recorded day < yesterday (from `WorkplaceMonth.days` keys), amber, due, action «Remind» → a new `hr_sheet_reminder` notice to the site's supervisor (`hrSites.supervisorUserId`) — add the kind to `HR_NOTICE_KINDS` + both message files; no new collection (notification only).
   - *Raise/promotion request* (EM-04): new `HR_REQUEST_KINDS` value `raise` with `raise: { newBasic, kind: 'raise'|'promo', effectiveOn, reason }` on `hrRequests` (rides the existing collection and its rules — add `raise` to the kind list in rules, keep amounts readable only by pay roles as for advances); decision applies `changePay`. Notice `hr_request_filed` covers it. Owner decision: who files it (line manager? HR manager only?) — the prototype only seeds one.
   - *Contract renewal decision* (EX-01): `renewContract(employeeId, { end })` write in `employee-writes.ts` (sets `contract.end`, logs) + «Not renewed» = start exit with reason `contract_end` and `lastDay = contract.end`; Today row window 45 days (prototype) vs ours 60 — owner to pick; aggregate when > 1 like the prototype.
   - *Exit re-entry row* (LV-08): `exitVisa?: Stamp` on the approved leave request (`hrRequests`, existing rules — gov may update only that field: one extra clause in the hrRequests update rule, no new block). Row for gov: approved, travel, `from ≥ today`, no `exitVisa`; action «Recorded».
   - *Final exit row* (EX-06): from `hrExits` for gov — leaver with `lastDay ≤ today+14`; waits on HR until `hrSettlements` approved (waiting row, source HR), then a gov action «final exit recorded» → `hrExits.finalExit: Stamp` (existing collection; add field to its update rule). Overlaps the platforms slice (GV-02) — owner to decide whether it lives on Today or only on Platforms.
   - *Waiting rows*: «returned transfers being re-issued» (payments) from `employeePay.ibanState === 'approved'`-like state with a held line on a posted payroll; «our manpower answer — plan acceptance» needs an `accepted?: Stamp` on `manpowerRequests` written by Projects (existing collection; rules: let the requester set only `accepted`).
   - *Age on waiting rows*: add `since` param (request `finance.at`, payroll `approved.at`, exit `custody.requestedAt`) and render «منذ N أيام».
5. **Manpower row**: severity red when `coverage(m).short || late`, href `sites?mp={id}` opening that request in `HrManpowerPanel`.
6. **Doc rows**: action deep-links to the renewal dialog for the right document (`people/{id}?renew=passport` when passport expires before iqama); hide `doc_due` from the HR manager when the org has a gov holder (`heldRoles` already computed in `HrTodayView`).
7. **Panels:**
   - *Nitaqat / establishment panel* (ST-04) on gov Today: add `band?: string|null`, `bandAsOf?`, `greenMinPct?: number|null` to `Establishment` in `settings.ts` (lives in `hrSettings/{orgId}` — no new rules block, field validation only); Saudi ratio computed from `live`; margin = ceil(n × min%) − Saudis.
   - *Payroll officer's month panel* (recorded through day N per site, stopped since D, closed) — computed from `WorkplaceMonth.days`, no data change.
   - *Supervisor's «my workers by trade»* — computed from employees; no data change.
   - *Management's cost-centre table on Today* — reuse the Reports cost function (`lib/hr/reports.ts`); KPI notes: admin share %, soonest-ending site's people + cost, pay day vs policy day (`payroll.paid.on` vs `policies.payDay`).
   - *New-company KPIs* (ST-05): `todayKpis` variant `moving` when `buildSteps` not all done: employees (present today · unassigned), workplaces (names), payroll (last state).
   - *Sites today*: «unrecorded since D», unassigned row ≈ monthly cost for money roles.
   - *Ending sites*: PM name (project's manager from `projects/{id}.pm`), source badge, link to `sites/{id}`.
8. **Notifications:** add `hr_iqama_renewed` (→ HR manager, link person) in `recordRenewal` when the person is on a site or unassigned with an expired iqama before; `hr_sheet_reminder` (above). Expired-iqama-on-site sweep runs only from a browser — a scheduled sweep would need a server job (none exists; owner decision). SMS to the employee (PRD note) — `lib/sms.ts` exists; owner decision on cost/consent and which kinds (decided requests, payslip, penalty). Module tag on bell rows: map `type` prefix → source badge in `portal-layout.tsx` (shared file — other modules too).
9. **Rules impact:** none of the above needs a new collection. Fields ride `hrRequests` (raise kind, exitVisa), `hrExits` (finalExit), `manpowerRequests` (accepted), `hrSettings` (band). Each is a clause in an existing block; reuse `hrRole(...)` / org-member helpers. The ruleset is near its ceiling — fold the new field checks into the existing `affectedKeys().hasOnly([...])` lists rather than new functions.
10. **Feature rows (x5Decisions)** wait for their modules (hire/train/punch/gov R2, perf R3). One exception to decide: the **line manager's probation view** (EM-05 P0 says "the line manager's view attaches, never blocks") is gated on `perf` in the prototype — owner to decide whether it ships in R1 (a `probation.view: { by, rec: ok|ext|end, note }` field on `employees`, a supervisor Today row ≤ 30 days, and a notice to HR).

<!-- slice 2-people -->
## Slice 2 — People list · Employee file · Documents

Prototype reference: `VIEWS.people` (1116), `PSEG`/`inSeg` (1114–1115), `openEmp` **2422** (overrides 1323), `efAlerts` 2374,
`efOverview` 2384, `efDocs` 2392, `efAtt` 2398, `efPay` 2408, `efLog` 2416, `x5EmpActs` 2193, `x5EmpSecs` 2195 (called only by
the 1323 version), `mgrOf` 1749, `docs`/`worstDoc`/`dState` 820–826, `docSummary`/`nextDue`/`stPill` 832–840.
Ours: `components/hr/HrPeopleView.tsx`, `HrEmployeeFile.tsx`, `EmployeeActionDialogs.tsx`, `HrEmployeeFiles.tsx`,
`HrInjuryPanel.tsx`, `HrExitPanel.tsx`, `HrLetters.tsx`, `HrRequestList.tsx`, `HrViolationList.tsx`, `lib/hr/employee.ts`,
`employee-writes.ts`, `documents.ts`, `format.ts`, `access.ts`, `hooks/useHrPeople.ts`; routes `contractor|supplier/hr/people`
and `people/[id]` (both portals present).

**Prototype employee record** (`mk` 610 + `gen` 731 + story rows): `id`, `no` (1000+n, permanent), `n[ar,en]`, `nat`, `g` ('f'),
`trade` → `cat` lab|staff, `site` (or `'bench'`), `st` active|leave|exit|visa, `join` (day offset), `basic`, `hous` (25%),
`trans` (10%), `comm` (Sales commission), `taken` (leave days), `sick`, `iban` ok|ret|fixedp|fixed, `ibanNo`, `bank`, `att{month:{p,a,ot,otLate,s,lv,s75,s0,lateN}}`,
`today` p|a|s|l|x|null, `docs{iq,pp,ins,ct,dl,fk}` (day offsets; `ct:null` = open-ended; `iq:null`+`arrived` = not issued yet),
`arrived`, `prob` (probation end), `adv{amt,bal,inst}`, `pen[{m,amt,code,step,x,at,by,inv,obj,cancelled}]`, `viol[{code,at,applied}]`,
`changes[{kind,from,to,eff,why,by}]`, `hist[{from,to,at,by}]` (assignment history), `benchSince`, `leave{from,to,type}`,
`exit{k,last,at,custody,settled,paid}`, `injury{at,d,rep,ref}`, `shift` m|e|n, `shHist`, `dbl`/`otToday` (second shift),
`pn`/`py` (punch today/yesterday), `mgr` (explicit line manager), `pe{by,o,rec,note}` (line manager's probation view),
`rv`/`pendRaise`/`pip` (performance), `certs`, `files[{name,size,at,by}]`, `info{edu,phone,addr,emg}`, `src` imp|visa|xfer|local,
`open{leave,adv,by}` (opening balance), `since` (imported: payroll from), `log[{at,by,t,i,c,mod}]`, `balTarget` (demo only).
Ours (`lib/hr/employee.ts:HrEmployee`): `no`, `names{ar,en}`, `nationality`, `gender`, `idNo`, `trade`, `category`, `siteId`,
`managerId`, `userId`, `join`, `since`, `source`, `contract{type,end}`, `probation{end,consentOn,decision,decidedOn}`, `status`
expected|active|leave|leaving|left, `lastDay`, `docs{iqama,passport,insurance,contract,licence,forklift}` (ISO dates),
`leaveTaken`, `openingLeave`, `opening`, `sick{year,days}`, `hajjTaken`, `contact{mobile,address,emergency}`; pay apart in
`employeePay` (basic/housing/transport/iban/ibanState/advance/retro/steps/commissions); log, files as subcollections; injuries,
exits, violations, requests, payslips in their own collections. **Not in ours:** document numbers (passport/insurance/licence),
`info.edu`, `bank`, `benchSince`/site-since, `shift`/`shHist`, `pe`, `rv`/`pip`, `certs`.

### People list

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who is listed | `scope()`: everyone but `st==='visa'`; supervisor = own site; employee = self | `hooks/useHrPeople.ts` + `lib/hr/access.ts:hrPeopleScope` (supervisor by site; company for other HR roles) | ✅ | RL-01 P0 R1 |
| Tab visibility | People tab for hr, gov, pay, mgmt; supervisor reaches people from Sites only | `access.ts:ROLE_TABS` (supervisor has no `people`) | ✅ | RL-01 P0 R1 |
| Segment strip with live counts | `PSEG` buttons `data-seg="people:k"`, each with count computed AFTER search+filters (`cnt[k]`) | `HrPeopleView` status chips (all · expected · active · leave · leaving · left) with counts over ALL employees (not after search/site filter) + separate doc chips without counts | 🟡 different segmentation; counts ignore search/filters; doc chips have no count | §5 People · EM-01 P0 R1 |
| «الكل» | `s==='all'` | status chip "All" | ✅ | §5 |
| «المواقع» (siteWord) | `!['hq','dept','bench'].includes(ST(e.site).k)` — every non-office workplace | — (site picker only, one site at a time) | ❌ needs a segment = `site.type` not in `isOffice` and not unassigned | §5 · AS-01 P0 R1 |
| «المكتب» | `['hq','dept'].includes(ST(e.site).k)` | — (`lib/hr/sites.ts:isOffice` exists, unused here) | ❌ | §5 · AS-01 P0 R1 |
| «بلا إسناد» | `e.site==='bench'` | site picker option `UNASSIGNED_SITE` | 🟡 present as a filter option, not a counted segment | AS-01 P0 R1 |
| «في إجازة» | `e.st==='leave'` | status chip `leave` (count) | ✅ | §5 |
| «وثائق تنتهي» | `worstDoc(e).st!=='ok'` (exp, d30, d60, pending iqama) | doc chip `docs` (`today.ts:inPeopleFilter` → `needsRenewal`) + `iqama` + `iqama_site` (Today KPI deep links `?filter=`) | ✅ (ours adds expired-iqama and on-site filters; no count on the chip) | DC-01 P0 R1 · TD-04 |
| «قيد الخروج» (PRD segment) | not in prototype (status pill only) | status chip `leaving` | ✅ ours follows PRD | §5 People |
| Search `#pq` | name AR/EN, `no`, trade name, site name; then segment applied | `matchesSearch` over name AR/EN, `no`, `idNo`, trade; searches across status chips | 🟡 site name not searched (ours adds ID number) | §5 · search rule |
| Filter trade `data-fsel="trade"` | select of trades present in scope, sorted by name | — | ❌ | §5 People (filters: trade, place, document) |
| Filter site `data-fsel="site"` | all sites + unassigned | `SearchableSelect` workplaces + unassigned | ✅ | §5 |
| Filter document state `v.doc` | logic for exp/d30/d60/any exists, no select rendered | doc chips (see above) | ✅ | DC-01 |
| Sort | worst document first (`dRank` exp 3 > d30 2 > d60 1 > ok), then `no` | by `no` only | ❌ urgent documents do not float to the top | DC-01 P0 R1 |
| Column «الموظف» | `pcell`: initials avatar (green for Saudi), name, `no · trade · nationality` | columns No. (`empNo` 4 digits) · Name (+ nationality line) · Trade | ✅ (no avatar) | EM-02 P0 R1 |
| Column «الإسناد» | site name + `ends {fd(ST.end)}` for projects, `منذ N` days for unassigned (`benchSince`) | Workplace name / "Unassigned" | 🟡 no project end date (`HrSite.endDate` exists) and no "unassigned since" (no field) | AS-01 P0 · AS-04 P1 R1 |
| Column «الوثائق» | `docSummary`: worst doc chip (`DOCK` name · expired / date / "not issued") or ✓ «سليمة»; + mini «الجواز أولاً» when `ppBeforeIq` | `nearestDocument` → pill "{doc}: {state}", "No documents entered" | 🟡 nearest-by-date not worst-by-state (same in most cases); no "valid" tick when all fine (shows the nearest valid one); no passport-first marker; a missing arrival iqama is not shown | DC-01/03/05 P0 R1 |
| Column «الأجر الشهري» | only `moneyOk()` (hr, pay, mgmt) | only `pay.view`; wage from `useOrgPay` (`payOn` today) | ✅ | RL-03 P0 R1 |
| Column «الحالة · التالي» | `stPill`: leaving · last day / on leave until date / recruiting / unassigned since date / absent today / sick today; else `nextDue`: nearest of probation end or next document date | `StatusPill` of `statusOn` (no dates) | 🟡 no "until/since" dates, no today's absence/sickness, no "next: probation/document date" | EM-01 P0 R1 |
| Long list clipping | `clipped(L,…,'people',40)` + «عرض N أخرى» | renders all rows | ✅ (acceptable) | — |
| Row → file | `data-emp` opens drawer `openEmp` | `Link` to `/{portal}/hr/people/{id}` | ✅ page instead of drawer | EM-01 |
| «موظف جديد» | `TAB==='people'&&(CAN('admin')||CAN('onboard'))` = hr, gov → `form:newemp` | `NewEmployeeDialog` when `employee.create` (manager, gov) | ✅ | EM-03 P0 R1 |
| «استورد من ملف» | `x5Acts`: `CAN('admin')` = hr only → `form:imp` | `HrImportDialog` when `employee.import` (manager, gov) | ✅ ours matches PRD matrix (GR ● no pay) | IM-01…03 P0/P1 R1 |
| Empty company | new company: build checklist "أول موظف" → `form:newemp:` | `EmptyState` with New employee + Import | ✅ | EM-03 |

### Employee file — header & tiles

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Container | wide drawer (`.drawer.wide` 1080px), `VS.ef` keeps segment; closes with ✕ | full page `people/[id]` inside `HrShell tab="people"` | ✅ | EM-01 P0 R1 |
| Who may open | sup: only `e.site===CU().site`; emp: only self; others all | HrShell refuses anyone without the People tab → **a supervisor cannot open the file of his own workers** (docs/hr-prd-status.md §3); no site-sheet row links to the file | ❌ known gap | RL-01 P0 R1 · §5 |
| Avatar | `lg2` initials, green ring for Saudi | — | ❌ cosmetic | — |
| Name + passport name | `P2(e.n)` + `e.n[1]` LTR when Arabic UI | `displayName` + `names.en` when `locale==='ar'` | ✅ | EM-01 |
| Meta line | `#no · trade · site · nationality · N y service` | `empNo` badge, trade · site · nationality · years | ✅ | EM-02 |
| Status pill | `stPill(e)` with dates (leaving · last day, on leave until, unassigned since, absent/sick today) | `STATUS_TONE[statusOn]` without dates | 🟡 no dates / today state | EM-01 |
| Probation pill | `e.prob>=0` → «تجربة حتى {date}» | `onProbation` → `file.on_probation` | ✅ | EM-05 P0 R1 |
| Shift mini | `shN(e)` | — | ❌ | PT/shifts R2 · optional: punch |
| Tile «رصيد الإجازة» | `leaveBal` (red if <0), sub `ent(e)` a year | `leaveBalance(...)` + `per_year` | ✅ (no red for negative) | LV P0 R1 |
| Tile «الأجر الشهري» | money: wage + «تكلفة الشركة» (wage + GOSI co + `eosAcc`); else `•••` «مخفي لدورك» | `money`(seesPay incl. the employee himself): `hrMoney(wage)` + company cost; else `•••` | ✅ | RL-03 P0 R1 |
| Tile «أقرب وثيقة تنتهي» | `docs(e)` with `off!=null` sorted → name · date · `efLeft` coloured (expired N ago / ≤30 red / ≤window amber) | `nearestDocument` → name · date + pill "N days left" / state | ✅ | DC-01 P0 R1 |
| Tile «حضور {month}» | `att[CURM].p` days, sub "a absent · ot h OT" | `employeeMonth(thisWm)` present+declared; office → "Assumed" | 🟡 month shown as `YYYY-MM`, not month name | AT P0 R1 |
| Segment nav | 5 segments; «الأجر والمسير» only `moneyOk()`; count = pending requests on «الطلبات والسجل»; reset to Overview on another employee | `SegmentedNav` 5; pay only `money`; counts on docs (non-valid dated docs) and log (pending/endorsed) | ✅ | EM-01 P0 R1 |
| Action bar | `.dact`: first 4 buttons + «المزيد» dropdown | all permitted buttons in the header row | 🟡 cosmetic (can become long: up to 11 buttons) | — |
| Not-back-from-leave alert | in `efAlerts` (`e.leave.to<0`) | `leaveReturn` callout above segments + `ReturnFromLeave` action | ✅ | AT-05 P1 R1 |

### Employee file — Overview segment

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Blocking alerts first: expired iqama | `!legalOnSite` → red «لا يُسند ولا يُنقل حتى التجديد — وهو على {site} الآن» | `Callout block` `file.iqama_expired` / `iqama_overdue` | 🟡 does not name the site he is on now | DC-02 P0 R1 |
| Alert: passport before iqama | `ppBeforeIq` (pp < iq and iq ≤ 180 d) → amber «جدّد الجواز أولاً» | — (`documents.ts:passportFirst` only blocks the renewal dialog) | ❌ | DC-03 P0 R1 |
| Alert: no iqama yet (arrival) | `arrived` & `iq===null` → info «وصل {date} — المهلة حتى {arrived+90}» | only once overdue (`iqamaOverdue`) as a block | 🟡 no countdown before the deadline | DC-05 P0 R1 |
| Alert: work injury | red until reported (deadline `at+3`), green «بُلّغت {date}» | `HrInjuryPanel` in the Documents segment (states due/overdue/reported) | 🟡 not surfaced on Overview | DC-07 P0 R1 |
| Alert: bounced transfer | `iban==='ret'` → «السطر معلّق حتى تصحيح الآيبان» (all roles) | `IbanActions` callout in Pay segment only (money roles) | 🟡 invisible to GR / roles without pay | PY-03 P0 R1 |
| Alert: expired licence | `!canDrive(e)` → «لا عمل قيادة» | — (`documents.ts:mayDrive` used only by manpower coverage) | ❌ | DC-06 P1 R1 |
| Alert: missing/expired certificate | `FEAT('train')` → `reqCerts` miss/exp | — | ❌ | TR R2 · optional: train |
| Card «البيانات الشخصية»: name AR, passport name, nationality, gender, ID/iqama no. | `efRow`s; blank = «غير مسجّل» | `Panel file.personal` (name_ar, name_en, id_no, gender, nationality) | ✅ blanks show "—" not «غير مسجّل» | EM-01 P0 R1 |
| … passport number | `ppNo(e)` (non-Saudi) | — no field | ❌ | EM-01 P0 R1 |
| … qualification | `info.edu` | — no field | ❌ | EM-01 P0 R1 |
| … how joined | `e.src` imp/visa/xfer/local | `source` local/transfer/visa in Job panel | 🟡 "imported" not distinguished (`since` set but not shown) | EM-03 · IM-01 |
| Card «الوظيفة والعقد»: trade, category, workplace | trade (per contract), lab/staff, site | `Panel file.job` | ✅ | EM-01 |
| … project end on workplace | «ينتهي {ST.end}» | — (`HrSite.endDate` available) | ❌ | AS-01/02 P0 R1 |
| … cost centre | `ccOf(site)` + site name (5102/5107/6101/6108) | — (`sites.ts:costKindOf` exists) | ❌ | AS-01 P0 R1 |
| … line manager | `mgrOf`: `e.mgr` → site head (labour: supervisor user or foreman; staff: highest-paid staff on site) → mgmt → HR; HR manager → mgmt; mark «مشتق» when not explicit | `access.ts:lineManagerOf`: `managerId` → site's `supervisorEmployeeId` → "Management" | 🟡 no senior-staff fallback, no "derived" mark, HR manager not routed to management, cannot be set (see actions) | RL-04 P1 R1 |
| … joined | date + `Y y M m` | date only (years in header) | 🟡 | EM-01 |
| … contract | fixed until date + «يتجدد ما لم يُخطَر» / open-ended | `fixed_until` / open | ✅ (no auto-renew note) | EM-01 |
| … probation | until date / completed | `probation_until` / confirmed / ended / lapsed | ✅ | EM-05 P0 R1 |
| … shift | `sh.n in–out` | — | ❌ | R2 · optional: punch |
| … status | `stPill` or «على رأس العمل»/«بلا إسناد» | header pill | ✅ | — |
| … attendance source | `AMK[amOf(site)]` (supervisor sheet / device / mobile) | — (office "assumed" note only in Attendance) | ❌ | PT-01 R2 · optional: punch |
| Card «التواصل والبنك»: mobile, address, emergency | `info.phone/addr/emg` | `Panel file.contact` | ✅ | ES-03 P0 R1 |
| … bank name | `BANKS` by `e.bank` or derived from IBAN | — | ❌ | PY-03 P0 R1 |
| … IBAN | full for money roles & HR; masked `SA12AB…1234` for others; mini «مرتجعة»/«بانتظار الاعتماد» | Pay segment only, full, money roles only | 🟡 not on Overview; no masked form for GR | RL-03 · PY-03 P0 R1 |
| … note "changed only by the employee's request, approved by HR" | static line | — | ❌ minor | ES-03 P0 R1 |
| … platform user linked | — | `file.my_file` linked yes/no | ✅ ours-extra | ES-00 |
| Card «الأداء» | `FEAT('perf')||e.rv`: cycle state/band (hr, mgmt, line manager), attendance score `attScore/5`, `pe` probation view, approved raise | — | ❌ (probation view part is EM-05) | PF R3 · optional: perf; EM-05 P0 R1 for `pe` |
| Card «نهاية الخدمة» | reason, last day, custody (Inventory badge), settlement state | `HrExitPanel` (reason, last day, custody state/by/shortfall, settlement preview/approve, platform tasks, certificate) | ✅ richer | EX-01…06 P0 R1 |

### Employee file — Documents & certificates

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Documents table rows | `docs(e)`: only documents the person HAS (`k in e.docs`); no iqama for Saudi; `dl` only drivers, `fk` only forklift; `ct:null` = «غير محدد المدة» (state ok); `iq:null` + `arrived` = «لم تصدر» (d60 until day 90, then exp) | `DOC_TYPES` minus iqama for Saudi — **all six for everyone**: licence/forklift show "missing" for non-drivers; `contract` is never written into `docs` by `createEmployee` (end lives in `contract.end`) so the row is always "missing" and a fixed-term contract's expiry never reaches the tile/Today | 🟡 wrong rows; contract expiry lost | DC-01 P0 R1 · EM-01 |
| Column «الرقم» | `idOf`/`ppNo`/`insNo`/`dlNo`; contract «موثّق في قوى» | — | ❌ no numbers stored except `idNo` | EM-01 P0 R1 |
| Columns «تنتهي» · «المتبقي» · «الحالة» | `fdl` / `efLeft` coloured / `docChip` | date / plain day count / `StatusPill` | ✅ (left not coloured, "−12" instead of «منتهية منذ 12») | DC-01 P0 R1 |
| Row action «سجّل الإصدار»/«سجّل تجديداً» | per row, `gv` = gov or hr (not on contract) → `form:doc:{id}:{k}` | one header action "Record renewal" (`renew`, `documents.manage` = manager, gov) with a document picker | 🟡 no per-row buttons; no "record issue" wording for a never-issued doc | DC-03 P0 R1 |
| «رقم التأمينات» | `52-…` Saudi (pension + hazards) / `53-…` non-Saudi (hazards) | — | ❌ | EM-01 P0 R1 · platforms |
| «نظام التأمينات» | Saudi: new (after 3 Jul 2024) / old; non-Saudi 2% | — (`pay.ts:gosiRates` knows it; Pay seg shows %) | ❌ label not shown | PY P0 R1 |
| «فئة التأمين الطبي» | non-Saudi: labour C / staff B | — | ❌ | EM-01 |
| Count badge | non-ok, non-na docs | `docsDue` on the segment | ✅ | — |
| Card «الشهادات والتدريب» | `FEAT('train')`: required certs (`reqCerts`: ind/hgt/trade) with why/expiry/state + sessions log | — | ❌ | TR R2 · optional: train |
| Card «المرفقات» | hr, gov: list `files` (name, KB, date, by) + «أرفق ملفاً» (name only stored) | `HrEmployeeFiles`: kinds iqama/passport/contract/medical/penalty/bank/other, Storage upload ≤15 MB image/PDF, open by fresh link; upload `documents.manage`, view also money roles | ✅ | EM-07 P1 R1 |
| Injury register | (alert + action only) | `HrInjuryPanel` here: record (supervisor of site / HR manager), GOSI report no. (GR / HR manager), due/overdue/reported | ✅ ours-extra location | DC-07 P0 R1 |

### Employee file — Attendance & leave

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Two month cards | `emon`: last month (+«مقفل» if closed) and this month to date: present · absent · sick · leave · OT h | `monthLine` this/last month: present(+declared) · absent · sick · OT; office: "present by default · absent · sick" | 🟡 no leave-days figure, no "closed" marker | AT-01…04 P0 R1 |
| «اليوم» | today p/a/s/l/x/not recorded (+ "second shift") | — | ❌ (data exists in `hrAttendance.days[today]`) | AT P0 R1 |
| «الدوام» / «المصدر» / «بصمة اليوم» / «أمس» / «مرات التأخير» / shift history | `schOf`, `AMK`, `pn`, `py`, `lateN`, `shHist` | — | ❌ | PT R2 · optional: punch |
| Leave formula | `accrued − taken = balance` boxes (red if negative) | key-value rows: entitlement, accrued, opening, opening-from-card, taken, balance + formula text | ✅ | LV-01 P0 R1 · IM-04 |
| «الاستحقاق السنوي» + when it becomes 30 | `ent(e)` + «يصير 30 من {join+5y}» while < 5 y | entitlement only | 🟡 no date it becomes 30 | LV-01 P0 R1 |
| «المرضية هذه السنة» | `sick/120` + bands 30 full · 60 at ¾ · 30 unpaid | `sick.days` only | 🟡 no /120 and no band (STATUTORY.sick has it) | LV (art. 117) P0 R1 |
| «قيمة الرصيد نقداً» | `wage/30 × max(0,bal)`, `•••` without pay | — | ❌ | EOS/LV P0 R1 |
| «الإجازات» table | leave requests: type + no · from · to · working days (`leaveDays` minus holidays) · state | leave rows only inside the Requests list (log segment) | 🟡 no leave table in this segment | LV P0 R1 |
| «الإسناد» history | `hist[]` from → to · date · by + current with «منذ» | — (only "moved" lines in the Log) | 🟡 derivable from `log` kind `moved` | AS-03 P1 R1 |

### Employee file — Pay & payroll

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Visibility | segment only when `moneyOk()` | only when `seesPay(employeeId)` (money roles + the employee himself) | ✅ | RL-03 P0 R1 |
| Basic · housing (25%) · transport (10%) · wage | table | key-values from `employeePay` (in force today) | ✅ | PY P0 R1 |
| Commission line | `e.comm` «عمولة معتمدة» with «من المبيعات» badge | — (recorded by the `commission` action into `pay.commissions`, never shown in the file) | 🟡 not displayed; source is HR not Sales | PY-01 P1 R1 |
| «أجر ساعة الإضافي» (art. 107) | `otRate(e)` | — (`pay.ts:overtimeRate` exists) | ❌ | AT/PY P0 R1 |
| GOSI employee / employer % | `gosiR(e)` | `file.gosi_line` | ✅ | PY P0 R1 |
| Cost & liabilities: monthly cost, EOS accrual, gratuity if terminated (art. 84), if resigned (art. 85) | `efCard` | `Panel file.cost_title` | ✅ | EOS P0 R1 |
| … leave balance value | `wage/30×bal` | — | ❌ | EOS P0 R1 |
| … cost centre | `ccOf` + site | — | ❌ | AS-01 P0 R1 |
| «قسائم الرواتب» | every main payroll `paid`/`sent` since join: month · net · paid date or «عند المالية»; expandable `payslip(x)` | — (payslips only in My file; `hrPayslips` is already readable by money roles in firestore.rules) | ❌ | PY/ES P0 R1 |
| «السلفة» | amount · balance · instalment · months left | balance only | 🟡 no amount/instalment/months left | AV P0 R1 |
| Penalties table | code · date · penalty step · amount · «معترَض»/«أُلغي» | violations panel in the log segment (amount for pay roles) | 🟡 not in pay segment; no deduction month | PN P0 R1 |
| «سجل الأجر» | `changes[]`: kind · effective · basic from → to · reason · by | — (`employeePay.steps` holds the history; log names the change without amount) | ❌ | EM-04 P0 R1 |
| Returned IBAN fix / approve | (payroll screen) | `IbanActions` (fix = payroll/owner; approve = HR manager, never the fixer, never own) | ✅ ours-extra | PY-03 · RL-02 P0 R1 |
| Retro items | — | `pay.retro[]` rows | ✅ ours-extra | EM-04 P0 R1 |

### Employee file — Requests & log

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| «الطلبات» (all kinds except violations) | `reqTx` + `reqNo` · relative time · pending: «عند: {reqHolder}» · decided: by whom; pending count | `HrRequestList` (number, state pill, "to management", what, note; actions endorse/approve/decline/cancel per `requestActions`) | 🟡 no relative time, no current holder by name, no decider name | EM-01 · ES-04 P0 R1 |
| Letter «اعرض» | approved letter → `form:letter` | `HrLettersPanel` (ask / issue / print) | ✅ | EM-08 P1 R1 |
| Cancel an approved future leave | `do:cancelleave` (approve roles or the employee) | `cancelRequest` in `HrRequestList` | ✅ | LV P0 R1 |
| «المخالفات» | code · date · penalty step · «استُجوب» hearing date · «بلا جزاء — لا تُعدّ تكراراً»; note "recurrence within 180 days, applied only" | `HrViolationList`: code · state · date · source · step · kind · amount (pay roles) · objection; record button (`violation.record`) | 🟡 hearing date and the 180-day note not shown | PN-01…04 P0 R1 |
| «السجل» | every `log` entry: text · date · actor · source module | `log` subcollection: kind text · byName · date | 🟡 `source` module stored (`LogEntry.source`) but not rendered | EM-06 P0 R1 |

### Employee file — actions

Prototype = `openEmp` 2422 + `x5EmpActs` 2193 (form kinds; forms themselves are another slice).

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| «انقل» / «أسند لموقع» → `assign` | `CAN('assign')` = hr; `st==='active'` | `move` (`employee.assign` = manager; status ≠ left) → `assignEmployee` | ✅ | AS-01/03 · DC-02 P0 R1 |
| «إجازة» → `reqleave` | `CAN('approve')` (hr, mgmt) or emp; active | `NewRequestDialog leave` when `roles.has('manager')`; status ≠ left | ✅ (mgmt not offered — PRD: on behalf = HR manager only) | LV P0 R1 |
| «سلفة» → `reqadv` (disabled when `e.adv`) | hr, mgmt, emp; active | `NewRequestDialog advance` when manager + money | ✅ | AV P0 R1 |
| «سجّل تجديداً» → `doc` | gov only, non-Saudi; doc = `iq` if not issued else worst | `renew` (`documents.manage` = manager, gov; status ≠ left) | ✅ | DC-03 P0 R1 |
| «عدّل الأجر» → `raise` | `CAN('approve')` = hr AND mgmt; active | `pay` (`pay.change` = manager; money; not own) | 🟡 management cannot change the HR manager's own pay (PRD matrix: management decides HR manager's pay) | EM-04 · RL-02 P0 R1 |
| «مخالفة» → `viol` | `CAN('att')` = hr, pay, sup; active | in log segment panel: `violation.record` (manager; supervisor on his site) | ✅ ours follows PRD matrix (payroll —) | PN-01 P0 R1 |
| «قرار التجربة» → `prob` | `CAN('approve')`; `0 ≤ prob ≤ 30` days left; active | `probation` (`request.decide`; state `on`; not leaving/left; not own) | ✅ (available for the whole probation) | EM-05 P0 R1 |
| «إصابة عمل» → `inj` | hr, gov; active | `HrInjuryPanel` record (`injury.record` = manager + supervisor of site); GR only records the report no. | 🟡 GR cannot record the injury; button lives in Documents | DC-07 P0 R1 |
| «إنهاء خدمة» → `exit` | `CAN('exit')` = hr; active | `StartExitDialog` (`exit.manage`; active/expected/leave; not own) | ✅ | EX-01 P0 R1 |
| «أعدّ المخالصة» → `fs` / «بانتظار المخزون — إخلاء العهدة» | hr; `st==='exit'`, not settled; custody > 0 → wait badge | `HrExitPanel` approve settlement, blocked until custody cleared | ✅ | EX-03…05 P0 R1 |
| «الوردية» → `shiftset` | site has shifts; hr, or sup on his site; active | — | ❌ | PT R2 · optional: punch |
| «المدير المباشر» → `mgr` | hr; active; picks staff (same site first) → `e.mgr`, log «المدير المباشر: X» | — (`managerId` on the record, no write anywhere) | ❌ | RL-04 P1 R1 |
| «رصيد افتتاحي» → `open` | hr; `join < −30`, no `open`, imported (`since`) or new company | `opening` (`employee.edit`; no opening; leaveTaken 0; > 30 days) | ✅ | IM-04 P1 R1 |
| Line manager's probation view → `pe` (from Performance screen; shown on the file) | line manager / hr: rating 3/2/1 + recommend confirm/extend/end + note → `e.pe`, notifies HR | — | ❌ | EM-05 P0 R1 |
| «اطلب خطاباً» → `reqletter` (1323 only; 2422 dropped it) | emp on own file | `HrLettersPanel` ask (own or `letter.file`) | ✅ | EM-08 P1 R1 |
| — | — | `commission` (manager, money, not own) → `recordCommission` | ✅ ours-extra (prototype reads Sales' `comm`) | PY-01 P1 R1 |
| — | — | `start` "Started work" for `expected` (`employee.assign`) | ✅ ours-extra | WF-03 |
| — | — | `link` platform user (`employee.edit`, not own) | ✅ ours-extra (prototype has fixed USERS) | ES-00 P0 R1 |
| — | brief listed `user`, `cust`, `comm`, `reissue` | these form kinds do not exist in proto v11 (`grep data-form=`) | — | — |

**What the 1323 drawer had that 2422 dropped** (ours vs those): vehicle custody line for drivers («عهدة — شاحنة لوحة …» from Inventory, Finance asset) — ours ❌ (FleetRegistry is separate, not on the file); `x5EmpSecs` sections: line manager + "derived" mark + review band + approved raise + PIP + opening-balance note (ours: line manager only, opening in Attendance), punches (❌ optional: punch), certificates (❌ optional: train), attachments (✅ moved to Documents in both); violations with amounts and payroll month (ours 🟡 amount only); last month's payslip inline (ours ❌); pay history log (ours ❌); "Request a letter" for the employee (ours ✅ via letters panel).

### Documents (DC-01…07)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| DC-01 state from the date | `dState`: off<0 exp · ≤30 d30 · ≤`POL.renewWin` d60 · ok; undefined/null = na; missing stays missing | `documents.ts:docState` (expired/d30/d60/valid/missing; `renewWindowDays` policy) | ✅ (row-set issues above: non-applicable docs and contract shown as missing) | DC-01 P0 R1 |
| DC-02 expired iqama blocks | `legalOnSite`; assign form blocks site targets; Today red «على المواقع بإقامات منتهية» | `legalOnSite` (+ overdue arrival), `assignBlocks` `iqama_expired`, Today KPI `iqama_on_site`, file callout | ✅ | DC-02 P0 R1 |
| DC-03 renewal: new expiry + fee → Finance | `form:doc`: expiry, optional fee (sent to Finance), iqama → checkbox «التأمين الطبي جُدّد بنفس المدة» also sets `ins`; passport-first blocks iqama | `recordRenewal` (expiry later than current, fee → `hr:PR:DOC:<no>:<doc>:<expiry>` event; `renewalBlocks passport_first`) | 🟡 no "insurance renewed with the iqama" tick; passport-first only as a block in the dialog, not a file alert | DC-03 P0 R1 |
| DC-04 officer's list by person (passport → insurance → iqama) | Today GR list, one row per person (`chain`) | `today.ts:renewalChain` / `RENEWAL_ORDER` | ✅ (Today slice) | DC-04 P1 R1 |
| DC-05 iqama clock for arrivals (90 d) | `docs`: pending iqama `d60` until `arrived+iqamaGrace`, then `exp`; overview info alert | `iqamaDueBy`, `iqamaOverdue`, Today due row, creation notice `hr_iqama_clock` | 🟡 file shows nothing until overdue; table shows plain "missing" | DC-05 P0 R1 |
| DC-06 driving licence blocks driving work only | `canDrive` (dl / fk <0): file alert, assign form warning «لا يُسند لعمل قيادة», Today red «سائقون برخص منتهية» (on a site), excluded from coverage | `mayDrive` used only in `manpower.ts` coverage | 🟡 no file alert, no Today decision, no assign warning | DC-06 P1 R1 |
| DC-07 work injury + GOSI report in 3 working days | `injury{at,d,rep,ref}`; deadline `at+3`; file alert; GR decision | `injuries.ts` (`injuryReportDue` skips Fri/Sat), `HrInjuryPanel`, Today `injury_due`/`injury_overdue` for `injury.report` | ✅ (see actions row for who records) | DC-07 P0 R1 |

#### Build notes — People / Employee file / Documents

1. **Supervisor opens his workers' files (❌, RL-01 P0).** Data already readable (rules `employees` get/list + `log` allow `hrSupervises(siteId)`; attachments deliberately not). Needs: the file route to accept a supervisor whose `ctx.sites` holds `emp.siteId` (e.g. render `HrEmployeeFile` from `sites/[id]` or let `HrShell` pass for `people/[id]` when scope allows), and the site sheet rows (`HrSiteAttendance`/`HrSiteWorkers`) to link to it. Segments for him: Overview, Documents (read; no attachments), Attendance & leave, Requests & log (violations he records); no Pay. Files: `HrShell.tsx` (mayOpen), `people/[id]/page.tsx` (both portals), `HrSiteAttendance.tsx`. No rules change.
2. **People list parity (🟡/❌).** UI-only in `HrPeopleView.tsx`: segments Sites/Office/Unassigned/Leave/Docs/Leaving with counts computed after search+filters (use `isOffice(site.type)`), trade filter, worst-state-first sort (`dRank`), project end (`HrSite.endDate`), passport-first marker, status column with dates (`lastDay`, approved leave `to`, today's absence from `hrAttendance`) and "next: probation end / next document". "Unassigned since" needs a new field `siteSince` (set by `assignEmployee`/`createEmployee`, HR manager writes — covered by the existing `hrManager()` update rule) or derive from the last `moved` log entry (supervisor/office roles can read log). No rules change.
3. **Document rows and contract expiry (🟡, DC-01 P0).** Show only applicable docs: iqama non-Saudi; licence/forklift only if `tradeOf(trade).drives`; contract row from `emp.contract` (open → "open-ended", fixed → `contract.end` with state). Either make `nearestDocument`/`needsRenewal`/`renewalChain` read `contract.end`, or have `createEmployee`/import write `docs.contract = contract.end` for fixed terms (GR's renewal of a contract must then update `contract.end` too — GR may only change `docs`, so the first option avoids a rules change). Pending arrival iqama shown as "not issued · due {iqamaDueBy}" (d60 → expired at day 90). Files: `lib/hr/format.ts`, `documents.ts`, `today.ts`, `HrEmployeeFile.tsx`.
4. **Document numbers, GOSI facts (❌, EM-01 P0).** New fields: passport no., insurance policy no., licence no. Keep them INSIDE the `docs` map under separate keys (e.g. `docs.no = {passport, insurance, licence}`) so GR's existing rule `changedKeys().hasOnly(['docs','updatedAt'])` still covers them — no rules change; or a top-level `docNos` field = one-word rules edit. GOSI no. is not ours to invent (prototype fakes it) — needs an owner decision: store the GOSI subscriber no. on the card (GR enters it) or omit. GOSI scheme label = `gosiRates(nationality, join)` (no data). Medical class: owner decision (stored per person vs derived from category as the prototype does). `NewEmployeeDialog`, `HrImportDialog` (template columns), renewal dialog gain the number inputs.
5. **Line manager (❌ action, 🟡 derivation, RL-04 P1).** Add `setManager` write (HR manager; picker of staff, same site first; log `manager_set`) — `managerId` already on the record, rules allow `hrManager()`. Extend `lineManagerOf` with the prototype chain: explicit → site supervisor (labour) → highest-paid staff on the site (needs pay → not computable for non-money viewers; owner decision: use category+trade seniority, or only supervisor → management) → management; the HR manager's own line manager = management; show "derived". `reports.ts` already reports set/derived.
6. **Line manager's probation view `pe` (❌, EM-05 P0).** Fields on the employee: `probation.view = {by, byName, at, rating 1|2|3, recommend confirm|extend|end, note}`; written by the line manager (a relation, may be a supervisor or any staff user) → needs a rules clause letting `lineManager` (resolved user) update ONLY `probation.view` — new expression in the `employees` block (moderate cost against the size ceiling; could instead ride `hrRequests` with `kind: 'probation_view'`, which already has create rules for employees/supervisors — preferable for the ceiling). Shown on Overview and in the probation decision dialog; notify HR (`emitHrNotice`).
7. **Overview alerts (❌/🟡).** UI-only: passport-first (`passportFirst`), arrival countdown (`iqamaDueBy`), injury (query `hrInjuries` already loaded by `HrInjuryPanel` — lift it), returned transfer state visible to non-money roles needs `ibanState` without the IBAN: pay doc is unreadable for GR (RL-03) → owner decision, or mirror a boolean `ibanHeld` on the employee (HR manager / payroll writes; payroll can't write `employees` today → rules edit) — simplest: show it only to money roles (as now). Expired licence (`mayDrive`) — UI; also add a Today decision row `licence_expired` (today.ts) and an assign-dialog warning (`EmployeeActionDialogs` move).
8. **Overview/Job card fields (❌).** Cost centre = `costKindOf(site.type)` → account (510201/510701/520202/520101 per Finance desk) — UI. Project end — UI. Qualification: new optional `education` field (+ `data` request field in ES-03 list) — HR manager writes, no rules change. Bank name: derive from IBAN bank code (SA + 2 check + 2-digit bank code) with a static table — no data. Masked IBAN for non-money roles is impossible without reading `employeePay` → skip (owner decision).
9. **Attendance & leave segment (🟡/❌).** UI over data we have: today's state from `hrAttendance.days[today]`, leave days per month (`employeeMonth` may already count leave — add to line), "closed" marker (`WorkplaceMonth.closed`), date entitlement turns 30, sick x/120 with the band (`STATUTORY.sick`), balance in cash (money only), a leave table (filter `requests` kind leave), assignment history (log kind `moved`). Punch/shift rows wait for R2 (optional: punch).
10. **Pay segment (🟡/❌).** UI over data we have: overtime hour (`overtimeRate`), leave value, cost centre, commissions list (`pay.commissions`), advance amount/instalment/months left (`pay.advance`), pay history from `pay.steps` (kind/reason are on the log entries `pay_changed`/`promoted` — join by date, or add `reason/kind/by` to `PayStep` in `changePay`), payslips list from `hrPayslips` where `employeeId == id` (rules already allow `hrSeesPay()`; needs an index `organizationId+employeeId` — check `firestore.indexes.json`), penalties with deduction month (`HrViolation.deductMonth`).
11. **Requests & log (🟡).** `HrRequestList`: relative/filed date, "with: {name}" for pending (reuse My file's holder logic), decider name. Log: render `source` as a `SourceBadge`. Violations: hearing date and the 180-day note.
12. **Management on the HR manager's pay (🟡, EM-04/RL-02).** `HR_GUARD['pay.change']` is manager-only; management must change the HR manager's own pay. Needs a guard variant (management when `userIsHrManager(target)`) and the `employeePay` rule to admit `hrRole('hr.management')` for that target only — rules impact (the `employeePay` block); owner decision whether R1.
13. **Injury recording by GR (🟡, DC-07).** Prototype lets hr+gov record; ours manager+supervisor. Owner decision; if GR may record, add `gov` to `injury.record` and the `hrInjuries` create rule (one role term).
14. **Not in scope for R1:** shift action/field (R2 · punch), certificates card (R2 · train), performance card (R3 · perf), avatar/More menu (cosmetic).

<!-- slice 3-sites-att -->
# Slice 3: Sites, Site page, Attendance sheet & closing, Attendance tab (punch), Punches/devices/geofence, Shifts

Sources read. Prototype: `SITES` 556–577, `ST/ccOf/CCN` 578–584, `cover` 872, `covSrc/mrLine` 879–880, `addSite` 954, `endingPanel` 996, `attClosePanel` 1073, `attSheet` 1075–1082, `tradeRows` 1089, `VIEWS.sites` 1125, `benchOrTrades` 1131, `sitePanel` 1133, `mrPanel` 1139, `xferPanel` 1144. Forms: `assign` 1363/1408/1535, `mr`/`xq` 1367/1434/1546, `xreq` 1368/1442/1553, `site` 1375/1461/1564. Also `setAtt` 1595, the click handlers 1675–1716 (`data-allp`, `data-close-month`, `data-ot`), `SHDEF/shiftsOf/shOf/schOf` 1729–1736, `AMK/amOf/SCHD/graceOf/punchEx/EXK` 2043–2053, `missDays/x5CloseBtn` 2054–2057, `seedAtt` 2058, `exRow` 2065, `VIEWS.att` 2072–2080, and `X5F.am/impdev/fill/otno/attreq`, `demoPunches/readPunches` 2081–2116. The X5A actions `latex/npa/fixout/otok/attok/attno/fillatt` are at 2151–2158, the `data-devfile` reader at 2167, `devTx/x6DevOpts/X5S.devpush/seedV6` 2309–2317, `OTCAP/dblToggle/dblBtn/X5F.shiftset/X5F.shifts/shiftHdr/seedShifts` 2348–2365, the roster report 2366 and `x5Me` punch panel 2201–2206.
**Device file vs employee import:** `parseCSV` (2117) is shared. `demoCSV`/`readImp` (2122–2170, columns `IMPC`) are the **employee** import. The **device file** is `X5F.impdev`: `data-devfile` → `parseCSV` → rows `{no:r[0], t:hm(r[2]||r[1])}` → `readPunches`.
Ours: `lib/hr/sites.ts`, `site-writes.ts`, `attendance.ts`, `attendance-writes.ts`, `holidays.ts`, `manpower.ts`, `today.ts` (`dutyToday`, the close/sheet/assign-fix items), `employee.ts:assignBlocks`, `employee-writes.ts:assignEmployee`, `components/hr/HrSitesView.tsx`, `HrSiteAttendance.tsx`, `HrSiteWorkers.tsx`, `HrAssignFixPanel.tsx`, `HrManpowerPanel.tsx`, `FleetRegistry.tsx`, `HrTodayView.tsx` (ending panel), `EmployeeActionDialogs.tsx` (move), `components/projects/ProjectManpowerPanel.tsx`, routes `contractor/hr/sites/page.tsx`, `sites/[id]/page.tsx`, `firestore.rules` (`hrSites`, `hrAttendance`, `hrAssignFixes`, `manpowerRequests`).
**Grep result:** `src/lib/hr` and `src/components/hr` contain **no** shift, punch, device, geofence, grace or attendance-correction logic. The only mentions are the `punch` switch (`settings.ts` HR_FEATURES, `access.ts` TAB_FEATURE `attendance`, and `HrSettingsView.tsx` `LATER`, which labels it "later release") and a comment in `reports.ts:7` ("shift roster … joins when built"). `HR_BUILT_TABS` leaves out `attendance`.

### Sites list

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Place types and cost account | `SITES[].k` prj/ws/wh/fleet/shop/dept/hq with `cc` 5102/5107/6108/6101 (`CCN`), plus `BENCH` (k `bench`, cc 6101) | `lib/hr/sites.ts:SITE_TYPES` (project/workshop/warehouse/fleet/showroom/department/hq) + `costKindOf` → direct/workshop/distribution/admin; `UNASSIGNED_SITE="__bench__"` | ✅ | AS-01 P0 R1 |
| Strip / list of places | `VIEWS.sites`: one strip card per place. Each card has an icon (`SICON[k]`) and the place name. It shows «حاضر» `p/L` (present today ÷ active assigned), «بلا تسجيل اليوم» when nobody is recorded today, «ينتهي» end date for a project, and «N إقامة منتهية» (`!legalOnSite`). | `HrSitesView.tsx` list rows: name, type pill, cost kind, supervisor, headcount (non-left), project name, «ends {date}» | 🟡 No present-today/assigned per place, no «unrecorded today» flag and no expired-iqama count per place. Today's numbers exist only on the Today tab (`today.ts:dutyToday`, «duty» panel). The list is a settings-style list, not the prototype's segment strip. | AS-01 P0 R1 · PRD §5 «Sites: per-place segments» |
| «الكل» card | `data-site="all"`: `active().length` employees · `MREQ` new count. Its left column holds `mrPanel()` and its right column holds `xferPanel()` and `endingPanel()`. | `HrSitesView`: `HrManpowerPanel` above the list; no «All» segment; corrections not listed across places | 🟡 There is no all-places corrections list (see Transfers) and no «N new requests» total on the card. | §5 Sites |
| «بلا إسناد» card + its SAR cost | Bench card: `bench().length` workers and, if `moneyOk()`, `M(benchCost())` ﷼/month (sum of `wage(e)`). | `HrSitesView` «Unassigned» row: count + «a cost with no output» text; no amount | 🟡 The monthly cost of the unassigned (management/HR with pay) is not shown on Sites. | AS-04 P1 R1 |
| Add a workplace (form `site`) | Fields: `n` (Arabic name), `en` (English name), `k` from 7 KINDS each showing its cc + `CCN` label. `end` is required when `k=prj` («read from Projects in the product»). `shifts` checkbox only for wh/ws/fleet. Submit → `addSite` creates `ATT[PREVM]` (closed) and `ATT[CURM]` docs, with `office` for hq/dept. | `HrSitesView` dialog + `site-writes.ts:saveSite`: name (one), type, end date (optional, any type), project (required for a project, `siteBlocks.project_needed`), supervisor (team member) | 🟡 Missing: the English name (`en`) and the `shifts` flag (see Shifts). The end date is typed by hand rather than **read from the linked project** (`projects/{id}.pm.startOn + durationDays`, which `HrSitesView` already loads but does not use). Ours adds the project link and the supervisor. | AS-01 P0 R1 · WF-01 step 3 · §data «Workplace: project/end (from Projects)» |
| Edit / deactivate a place | — (prototype never edits a place) | `HrSitesView` edit + `site-writes.ts:setSiteActive` (never deleted) | ✅ ours only | — |
| Supervisor of a place | `USERS[].role==='sup' && u.site===s.id`. HR sees the sheet only when **no** supervisor user exists for the place (`VIEWS.sites`: `!USERS.some(u=>u.role==='sup'&&u.site===v.site)`); otherwise HR sees `sitePanel`. | `HrSite.supervisorUserId` + `access.ts` `siteScoped`; the HR manager may always record | 🟡 PRD §6 WF-01 row 7 says HR records only if the place has no supervisor. Ours lets HR always record, which is more permissive. Owner decision: keep it, or hide/warn when a supervisor exists. | AT-01 P0 R1 · RL-01 |
| Sites ending soon | `endingPanel`: places with `end ≤ 45` days, «N سيصبحون بلا إسناد إن لم يُخطَّط لهم» · PM name · «خطّط» → place segment | `HrTodayView.tsx` `endingPanel` (45 days, people count, «Plan» → Sites) | ✅ on Today rather than Sites; no PM name | AS-02 P0 R1 · §5 Sites «projects that end» |
| Supervisor variant of the list | `r==='sup'` → no strip; his place directly: `attSheet` + `sitePanel` + `xferPanel` | `HrSitesView` filters to `access.ctx.sites` for a supervisor-only user → «Attendance» link → `/hr/sites/[id]` | ✅ one extra click | RL-01 P0 R1 |
| Fleet registry under Sites | — (fleet is a place kind `fleet`; drivers are employees with a licence) | `FleetRegistry.tsx` (vehicles + drivers for delivery notes, ORD-14) | ✅ ours only | — |

### Site page

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Route / layout | Place segment: left = `attSheet` (if `CAN('att')` and no supervisor) or `sitePanel`; right = `mrPanel(site)` + `benchOrTrades(site)` | `sites/[id]/page.tsx` → `HrSiteAttendance` (segments «Day sheet» / «Month & closing») + `HrSiteWorkers` | 🟡 Different composition. The manpower requests for this place and the by-trade panel are missing (rows below). | §5 Sites |
| Header subtitle | `sitePanel`: a project shows `NX(s.no)` (project no.) · «مدير المشروع» `s.pm` · «ينتهي» `fdl(end)` with a Projects source badge (`srcb('pm')`). The workshop (`s.ext='mfg'`) shows «حضورها يصل من التصنيع» with a Manufacturing badge. A shift place shows «ورديتان: صباحية ومسائية». | Page title «Workplace attendance» only; the site name appears in the close-confirm dialog | 🟡 Missing: project number, PM name, end date, the Projects/Manufacturing source badge and the shift note. | AS-01 · §Other modules «Manufacturing: workshop attendance is reported, not owned» |
| KPI «المسندون» | `L.length` + «منهم N إجازة/خروج» (`st!=='active'`) | — (`HrSiteWorkers` panel count = non-left, non-expected) | 🟡 It is a count only, with no on-leave or exit split. | §5 Sites |
| KPI «حاضر اليوم» | `today==='p'` of `st==='active'`; red if any absent | — on this page (`dutyToday` is on Today) | ❌ Not on the site page. | §5 Sites |
| KPI «حضور سبتمبر» | `ATT[CURM][site]`: «مقفل» / «حتى أمس» (`thru ≥ TD-1`) / «متوقف منذ X» (red) | The Month segment's missing-days count on the segment tab | 🟡 There is no «recorded through / stopped since» status line. | AT-03/04 P0 R1 |
| Ending warning on the page | `s.end ≤ 45` → «ينتهي خلال … — N عاملاً سيصبحون بلا إسناد. طلبات العمالة المفتوحة في مواقع أخرى تقرأهم كمصدر تلقائياً» | — | ❌ | AS-02 P0 R1 |
| People table | `sitePanel` table sorted by worst document (`dRank[worstDoc]`): columns الموظف (`pcell`), اليوم (`stPill` or «على رأس العمل»), الوثائق (`docSummary`), and for `CAN('assign')` a «انقل» button (`form:assign:id`); clipped at 25 | `HrSiteWorkers.tsx` «People here»: name, number, trade + «Work injury» / «Violation» buttons; shown only to someone who may record an injury/violation | 🟡 Missing: today's status, the documents summary (the supervisor sees document states, not pay), the sort by worst document, and «Move» per row for the HR manager. Ours adds injuries and violations from this page (not in the prototype's site table). | AS-01 P0 R1 · DC P0 R1 |
| By trade (`benchOrTrades`/`tradeRows`) | Bars per trade: present ÷ assigned (`by[trade].p/n`), «N إقامة منتهية» per trade; sorted by count | — | ❌ | §5 Sites «labour by trade» |
| Unassigned page | `sitePanel('bench')`: table العامل · منذ (`benchSince`) · الوثائق · «أسند» (`form:assign`). `benchOrTrades('bench')`: by trade with since date, «إقامة منتهية» pill, «أسند» — «يُدفع لهم بلا إنتاج — أول مصدر للتغطية». | `/hr/sites/__bench__` → `HrSiteAttendance` (presence assumed); `HrSiteWorkers` returns `null` for the bench | 🟡 No list of unassigned people with since-date, documents and «Assign». There is no `benchSince` either (derivable from the `employees/{id}/log` «moved» entry). | AS-04 P1 R1 · AS-01 |
| Injury register for the place | — | `HrSiteWorkers` «Injuries at this place» (GOSI due, state) | ✅ ours only (DC-07 lives elsewhere) | DC-07 |
| Expired iqama on a site | Pill on every sheet row, place card and trade row; assigning to a site is blocked | `today.ts` blocking item `iqama_on_site` (HR manager); `assignBlocks.iqama_expired` | 🟡 It is not visible on the site page or sheet rows, so the supervisor does not see it. | DC-02 P0 R1 · AS-01 |
| Today's headcount by trade to Projects | §Other modules: «نرسل لإدارة المشاريع: عدد العمالة اليوم بالمهنة لتقريرها اليومي» | — | ❌ No outbound feed to the project's daily report. | WF-12 step 3 · §Other modules |
| Workshop attendance from Manufacturing | `s.ext='mfg'`: «حضورها يصل من التصنيع» (reported, not owned) | — (HR records the workshop like any place) | ❌ Owner decision needed (see build notes). | §Other modules |

### Manpower requests & coverage

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Request record | `MREQ {id, no:'ط.ع-2026/031', site, trade, q, from, at, by, state:new\|answered, why, plan[[src,n,when]], short, rest, ack, ansAt}` | `lib/hr/manpower.ts:ManpowerRequest {projectId, projectName, siteId, trade, count, from, note, state open\|answered\|withdrawn, requested, answer{plan, excluded, note, by, at}}` in `manpowerRequests` | 🟡 There is no document number (ط.ع-yyyy/NNN) and no `ack`, `short` or `rest`. | AS-02 P0 R1 · WF-12 |
| Raised by Projects | `simItems`: «طلب عمالة جديد» from PM (`PROF.mrMod`) | `ProjectManpowerPanel.tsx` + `raiseManpowerRequest` (project editor / PM; rules `manpowerRequests` create) | ✅ | WF-12 trigger |
| Requests list (`mrPanel`) | Sorted with new first, then by `from`. Per place (`mrPanel(site)`) on a place segment. Each line: `mrLine` (no · q × trade · place · from). A new request shows «التغطية الممكنة: N في الموعد · N بعده · N بلا تغطية»; an answered one shows the plan line by source with dates. Pills: «بانتظار ردّنا» / «N بلا تغطية» / «قُبلت الخطة» / «أُجيب — بانتظار إدارة المشاريع». Severity dot red if short. | `HrManpowerPanel.tsx` on Sites: last 10 by request time, project badge, line, state pill (open/answered), note, the answer's `CoverageLines` | 🟡 Missing: the coverage preview (on time / late / short) **before** answering, the per-place filter on the site page, new-first sorting, the «N uncovered» pill and the «plan accepted» state. There is no «show more» beyond 10. | AS-02 P0 R1 |
| Coverage order | `cover`: (1) bench, same trade; (2) same trade on a project site with `end ≤ from+7` (sorted by end, available `end+1`); (3) `VISA` batches of that trade (`v.q`, arrival `v.arr`, not `used`). Exclusions: `!legalOnSite \|\| !canDrive`. `short`, `late` (`when > from`), `onTime`. | `manpower.ts:coverage` — unassigned → site_ending (≤ from+7) → visas (`establishment.visas` count, arrival today+90) → hire (+90) and ajeer (+45, ×1.4); excluded by name (`iqama_expired`, `licence_expired`) | 🟡 Visas are a company-wide count, not trade-specific batches with their own arrival date and number (`VISA {trade,q,nat,arr,no,job}`; these come from hiring batches, R2 hire). There is no on-time vs late classification per line. | AS-02 P0 R1 · HI-01 R2 |
| Answer form, step 1 «التغطية» | KPIs في الموعد / بعد الموعد / بلا تغطية / مستبعدون. Each candidate is listed with source + date (green on time, amber late). The excluded are listed with the reason. If short: «توظيف خارجي: أقرب وصول بعد visaLead يوماً · أو أجير ≈ ×ajeerX», then choose `rest` = hire («N تأشيرات متاحة»), xfer «نقل خدمات» (~30 days, counts in our headcount/Nitaqat), ajeer (disabled unless `POL.ajeer`; ≈ trade wage ×1.35×ajeerX/month; via Procurement), or none «لا نغطي الباقي — نقولها صراحةً». «التالي» is disabled until `rest` is chosen when short. | `HrManpowerPanel` dialog: «Covered X of Y» + `CoverageLines` (hire AND ajeer both listed for the shortfall) + note | 🟡 There is no choice of how to cover the shortfall: no `xfer` option, no explicit «leave uncovered», no Ajeer policy switch, no cost figure and no wizard. Ours always writes both hire and ajeer lines. | AS-02 P0 R1 · WF-12 step 2 |
| Answer, step 2 «الردّ» | Summary + «ملاحظة لمدير المشروع» + «عند الإرسال: يُسند من هم بلا إسناد الآن، ويُجدول الباقون بتاريخهم، وتُبلَّغ إدارة المشاريع» | Note + «Send the plan» | 🟡 | WF-12 step 2 |
| Answer **executes** the plan | `submit mr`: bench rows are **assigned now** (`e.site=mr.site`, `hist`, log «أُسند إلى … — ط.ع-…», mod pm). Site-ending rows get a **scheduled transfer** `e.planned={to,at}` + log. Visa rows: `v.used++`, `v.to=site`. Writes `mr.plan`, `mr.short` (if rest none), `mr.rest`. | `answerManpowerRequest` stores `answer` only; notifies the requester | ❌ Nothing is assigned, scheduled or reserved. The HR manager must then move each person by hand from the employee file. No visas are consumed. | AS-02 P0 R1 · WF-12 step 2 «أسند الآن · جدول النقل · خصّص التأشيرات» |
| Hire shortfall → vacancy | PRD WF-12: «للعجز: توظيف (يولد شاغراً)» | — | ❌ (needs Hiring, R2) | WF-12 · HI-01 R2 · optional: hire |
| Ajeer → Procurement | «أجير مؤقت — عقد توريد عبر المشتريات · لا يدخل عددنا» | Shown as a line only | ❌ No Procurement handoff. | §Other modules (Procurement) |
| Plan accepted by Projects | `X5S.ack`: PM marks «قُبلت الخطة» (`m.ack=1`); pill «قُبلت الخطة» | `ProjectManpowerPanel` shows the answer; no accept; rules allow only answered/withdrawn | ❌ No accept/object step. Withdraw is allowed by the rules but has no UI. | WF-12 step 3 |
| HR Today item | `decisions()` hr: «طلب عمالة … — التغطية: on time · late · uncovered · N مستبعد» → «اقرأ وردّ» | `today.ts` `mp:` item (group other, source project-management, action answer) | ✅ (no coverage summary in the row) | TD |

### Transfers & assignment corrections

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Move / assign form (`assign`) | Title «أسند»/«انقل»; `to` options = other places (a project shows «ينتهي» + count of the same trade there) + bench «يبقى على الأجر بلا إنتاج». `eff` date (defaults to a pending fix's `since`). `src` «قرار الموارد البشرية» or a manpower request of that place (`MREQ`). Blocks: expired iqama → only bench; **expired licence** → not to fleet/prj/wh («لا يُسند لعمل قيادة»). Note: «تُبلَّغ إدارة المشاريع… مركز التكلفة يتبع الإسناد من تاريخه». Submit: `e.site`, `e.hist.push({from,to,at,by})`, `benchSince`, plan update on the MR, resolves pending fixes (ok if to = fix site, else no). | `EmployeeActionDialogs.tsx` «move» + `employee-writes.ts:assignEmployee`/`employee.ts:assignBlocks` (to, effective date; blocks left/no_date/same_place/iqama_expired; log «moved») | 🟡 Missing: the driving-licence block (`mayDrive` exists in `documents.ts` but is not used by `assignBlocks`), the link to a manpower request (`src`), the hints, the Projects notification, `benchSince`, and auto-resolving pending corrections. «Move» is only in the employee file, not on site rows or the bench. | AS-01 P0 R1 · AS-03 P1 R1 · WF-13 |
| Effective date semantics | `hist.at = eff`; site changes at once | `siteId` changes at once; log carries `on` | 🟡 Same as the prototype. However, a back-dated or future move does not re-home attendance days (`onSheet` reads the current `siteId`), and payroll's cost centre follows the current site, not the date. | AS-01 · WF-13 «cost follows from the date» |
| «عامل يعمل عندي وليس في قائمتي» (`xreq`) | Supervisor picks by **name** from active people elsewhere (bench first) · «يعمل عندي منذ» (default 3 days ago) · note. Creates `REQ{k:'fix', site, since, by, why, state:'pend'}` and notifies HR with a deep link `form:assign:e:site`. | `HrAssignFixPanel.tsx` + `site-writes.ts:raiseAssignFix` (`hrAssignFixes`); the supervisor names the worker by **ID number + name** (RL-01); notice `hr_assign_fix_raised` | ✅ Ours is stricter on privacy, by design. | AS-03 P1 R1 |
| HR decides the correction | `xferPanel`: «صحّح» opens the assign form prefilled; states «بانتظار الموارد البشرية» / «صُحّح» / «رُفض» | `decideAssignFix` approve (moves, log) / decline (reason required); notice `hr_assign_fix_decided`; Today `assignfix:` item | ✅ | AS-03 P1 R1 |
| Corrections across all places | `xferPanel()` without a site on the «الكل» segment | Only per place (`HrAssignFixPanel` on `/sites/[id]`) + Today items | 🟡 There is no all-places list of corrections and their history. | §5 Sites «طلبات تصحيح الإسناد» |
| Sheet's own «unlisted» rows | — (the prototype has one path: `xreq`) | `HrSiteAttendance` «A worker here but not listed» → `DaySheet.unlisted[]` (name + note) | 🟡 Nobody reads it (no notice, no Today item, no HR list). It is a dead end beside `HrAssignFixPanel`. Remove it, or turn each entry into an `hrAssignFixes` doc. | AT-01 P0 R1 |
| Other-site punch → fix assignment | `punchEx` `xsite` / `readPunches.other` → «صحّح الإسناد» (`form:assign`) | — | ❌ (punch) | PT-04 P1 R2 · optional: punch |

### Supervisor sheet (daily)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who and which day | `CAN('att')` = hr / pay / sup; sup only on `CU().site` (`setAtt` guard). **Today only** (`TD`); past days only via the «missing days» declaration. | `attendance.record` manager/payroll/supervisor (site-scoped); day picker `max=today`; any past day of an open month | 🟡 Ours lets any past open-month day be recorded or re-recorded as a normal sheet, so «save changes» edits a recorded day. The PRD says «اليوم يُقفل بتسجيله» (the day closes when recorded) and has back-days filled by a named declaration. Owner decision: lock a recorded day (and past days) or keep it editable until month close. | AT-01 P0 R1 · WF-04 step 1 |
| «الكل حاضر (N بلا تسجيل)» | `data-allp`: every unrecorded active person → `today='p'`; `A.thru=TD`, `A.days[TD]=1`; toast «عدّل الاستثناءات» | Implicit: everyone listed is present unless an exception says otherwise; one «Save the sheet» writes `days[day]={listed, ex}` (`recordDay`) | ✅ The same outcome, but there is no «N unrecorded» counter and the header shows no «present x/y». | AT-01 P0 R1 |
| Per-row status | `ST3` P / A / S / Perm buttons (toggle; clicking again clears) | Present / Absent / Sick / Permission buttons (`DAY_EXCEPTIONS`) | ✅ | AT-01 |
| Overtime hours | `data-ot` number 0–6, enabled only when `today==='p'` | `ot` 0–12 step 0.5 (`MAX_DAILY_OT=12`), disabled for absent/sick (allowed with permission); `compactExceptions` rounds to ¼ h; OT over cap highlighted in the month table (`overtimeOverCap`) | 🟡 The limits differ: 6 vs 12 per day, and OT is allowed on a «permission» day. | AT-01 · PY-01 (60 h cap) |
| Violation from the sheet | Flag button per row → `form:viol:id` (code and ladder in the penalties slice) | Violation select per row (`VIOLATIONS`), only for `violation.record`; `recordDay` creates `hrViolations` once + notices | ✅ | AT-01 · PN-01 P0 R1 |
| Second shift button | `dblBtn` «وردية ثانية» / «×2» on shift places | — | ❌ (see Shifts) | SH-04 P1 R2 · optional: punch |
| Sort by shift, shift headers | `attSheet` sorts by `e.shift`; `shiftHdr` chips | — | ❌ | SH-06 P2 R3 |
| Expired iqama pill per row | `legalOnSite(e)` false → «إقامة منتهية» | — | 🟡 Missing on the sheet. | DC-02 |
| Office: presence assumed | `office` (hq/dept): no «all present» bar; «مكتب: الحضور افتراضي — يُسجَّل الغياب والمرضي والاستئذان فقط، ولا إقفال شهري بعمالة» | `assumesPresence` (department/hq **and** unassigned) + callout «att.assumed»; missing days never counted | ✅ | AT-02 P1 R1 |
| Holiday today / within 7 days | `holOn(0)` → «اليوم … — إجازة رسمية بأجر، لا تسجيل»; else holidays in the next 7 days banner | `holidays.ts:holidayOn` → callout for the chosen day; Ramadan callout (`isRamadan`) | 🟡 There is no «upcoming holidays in 7 days» banner. Ours adds the Ramadan note. | AT-06 P1 R1 |
| On approved leave | (employee `st='leave'` is outside the active list) | `onLeaveOn` → «On approved leave» pill, nothing recorded | ✅ | LV · WF-07 |
| Not back from leave | `X5A.back` / Today item (`backL`) | `notBackOn` + `leaveReturn`: row starts absent, «not back N days» + stage + `ReturnFromLeave` | ✅ | AT-05 P1 R1 |
| «عامل يعمل عندي وليس في القائمة؟» | `data-form="xreq:"` button in the sheet footer | `HrAssignFixPanel` under the sheet (+ the dead `unlisted` box, see Transfers) | ✅ | AT-01 · AS-03 |
| Footer: close hint + close button | «كل يوم يُقفل بتسجيله · إقفال الشهر في {1st of next month} — ولا مسير قبله». «أقفل حضور {PREVM}» if the previous month is open, else a disabled «أقفل حضور {CURM}» (month not over). | Month segment (see below); sheet shows «This month is closed» callout | ✅ (in another segment) | AT-03 |
| Recorded by | — | «Recorded by {name} · {at}» | ✅ ours only | §data «attendance day … by» |
| Supervisor's Today | `todaySup`: KPIs «عمالي اليوم» p/my (absent · sick · unrecorded · on leave outside), «بلا تسجيل», «وثائق تنتهي لعمالي»; sheet + decisions + «عمالي بحسب المهنة» | `today.ts` `sheet:` item (blue, supervisor only) + `dutyToday` duty panel and KPIs | 🟡 The by-trade panel is missing (detail in the Today slice). | TD |

### Monthly closing, declarations, missing days

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Month record | `ATT[m][site] {closed, at, by, thru, days{d:1}, office, fill{n,by,at,note}}` | `hrAttendance/{org}__{site}__{yyyy-mm}` `WorkplaceMonth {days{date: DaySheet}, declarations[], closed{by,byName,at,asIs,missing}}` | ✅ Richer: who was listed per day, exceptions only. | AT-03 P0 R1 · §data |
| Missing days | `missDays`: from `max(month start, min(join/since of people there))` to yesterday (current month) or month end; skips Friday and holidays; none if closed/office | `attendance.ts:dueDays`/`missingDays`: from the **1st of the month** to yesterday / end; skips Friday + `OFFICIAL_HOLIDAYS`; none if assumed | 🟡 Ours ignores when people arrived. A place whose first worker joined (or was moved in) on the 20th shows the 1st–19th as missing. Start at the earliest `join`/move-in of anyone on the place, as the prototype does. | AT-04 P0 R1 |
| Fill the missing days (`fill`) | `x5CloseBtn`: «N يوماً بلا تسجيل» + «سجّل الأيام الناقصة» (hr/sup). The form lists the days as chips, «أيام-عامل ستُسجَّل حضوراً» = Σ per person of days ≥ max(join, since), and with `moneyOk` «ما يقابلها من الأجور تقريباً» ﷼. The note «لماذا لم تُسجَّل في وقتها؟» is **optional**. Requires the **ack checkbox** «أقرّ أن هؤلاء كانوا على رأس العمل في هذه الأيام». «سجّلها باسمي» fills ALL missing days; `A.fill={n,by,at,note}`; adds present days per person from his join/since. | Month segment «Unrecorded days»: pick days (default all) · note **required** · warning «N days will be recorded as present for P people, in your name» · `declareMissing` (manager/supervisor) appends `declarations[{days, employees, by, at, note}]` | 🟡 There is no explicit «I state…» acknowledgement and no man-days or wage figure. Note: required in ours, optional in the prototype. **Bug-level:** `employeeMonth` adds `d.days.length` to **every** employee in `d.employees` (roster at month end), so someone who joined or moved in mid-month is credited declared days before he was there. Count only days ≥ his join / move-in, as the prototype does. | AT-04 P0 R1 |
| Declarations shown | `fl` mini «N يوماً سُجّلت باسم X» with note tooltip, next to the close button | «Declarations» panel: N days · by · at · note | ✅ | AT-04 |
| Close (`data-close-month`) | `x5CloseBtn`: `can = CAN('att') \|\| CAN('payroll')`; «أقفل» when no missing days. With missing days: «أقفل كما هو» only if `!STRICT('closeMiss')`. The click handler re-checks STRICT + `missDays` and sets `A.closed=1, at, by`. | `closeBlocks` (not_over / closed / missing under `policies.closeMissing` block\|warn) + `closeMonth` transaction (manager/payroll/supervisor) storing `asIs` + `missing`; confirm dialog «never reopens»; rules refuse any change after `closed` | ✅ | AT-03 P0 R1 · AT-04 · ST-03 P1 R1 |
| Closing overview across places | `attClosePanel`: «إقفال حضور {PREVM} — الشهر انتهى · لا مسير قبل إقفال كل مكان عمل», one row per unclosed place with «مسجَّل حتى يوم N» + its close/fill buttons. Then «الحضور — {CURM}» bars per place: closed / through yesterday / stopped since X, with headcount. | `today.ts` `close:` blocking item per unclosed place (only while last month's payroll is missing/prepared); `payroll.ts` blocks on open places | 🟡 There is no single overview of all places' closing status with «recorded through day N» / «stopped since». It appears only as Today items. | AT-03 P0 R1 · §5 Attendance «إقفال الشهر» |
| Each person's month | (employee card `e.att[m]` p/a/ot/s) | Month segment table: present · absent · sick · permission · declared · OT h (over-cap highlighted) | ✅ | AT-03 · PY-01 |
| Payroll reads closed months only | `payBlocks`: «حضور X غير مقفل» for non-office places | `payroll.ts` / `preparePayroll` (re-read inside) | ✅ (payroll slice) | AT-03 P0 R1 |
| Close-missing policy | `POL.strict.closeMiss` (block default) | `HrPolicies.closeMissing` block\|warn (Settings) | ✅ | ST-03 P1 R1 |

### Attendance tab (optional: punch)

The whole tab is missing: `HR_BUILT_TABS` excludes `attendance`, and `access.ts` already gates it on `punch` for the manager, payroll and management roles.

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Tab + feature gate | `VIEWS.att`; hidden when `!FEAT('punch')` (`featOfGo` /tab:att\|impdev\|attok\|attno/ → punch) | `access.ts:TAB_FEATURE.attendance`; `ROLE_TABS` manager/payroll/management; not in `HR_BUILT_TABS`; `HrSettingsView` LATER | ❌ The tab is wired in access but no screen exists. | §5 Attendance · ST-02 · optional: punch |
| KPI «حاضرون اليوم» | Present of active non-bench + «كشف المشرف N · جهاز N · تطبيق N» (`amOf`) | — | ❌ | PT-01 P1 R2 · optional: punch |
| KPI «استثناءات تنتظر قراراً» | `punchEx` count + pending `attfix`, split «تأخير · بلا بصمة · إضافي · طلب تصحيح» | — | ❌ | PT-04 P1 R2 · optional: punch |
| KPI «أيام بلا تسجيل» | `missAll` = Σ `missDays` of CURM + PREVM over places: «تمنع إقفال الشهر — اليوم غير المسجَّل كان يُدفع كأنه عمل» | `missingDays` exists per place; no cross-place total | ❌ (logic per place only) | AT-04 P0 R1 |
| «استثناءات البصمة» panel | Header «النظام يقترح والإنسان يقرّر — لا خصم ولا غياب آلياً». Groups in order nop, late, noout, ot, xsite (`EXK`), 4 per group then «more» (`exRow`). | — | ❌ | PT-04 P1 R2 · optional: punch |
| Correction requests group | `REQ k:'attfix' state pend`: «{name} — نسيت البصمة / حضور خارج النطاق لمهمة عمل / اعتراض على غياب مسجَّل · {day}» + why · age; «ارفض» (`attno`) / «اقبل» (`attok`) for hr **or the line manager** (`isMgrOf`). `attok`: type abs → `a-1, p+1`; a same-day miss/out → `today='p'`, `pn={in: shift start, src:'fix', geo: type==='out'?0:1}`; log «قُبل تصحيح حضور …» | — (no `attfix` kind in `requests.ts:HR_REQUEST_KINDS` = leave/advance/data) | ❌ | PT-07 P1 R2 (type «abs» works without punch, see below) |
| «مصدر الحضور لكل مكان عمل» panel | Per place: name + headcount · `AMK[am]` · schedule `in–out` (`schOf`) · shift names · `mob` «نطاق R م» · `dev` `devTx` (connected/serial/synced N min ago / «انقطع منذ» / unknown numbers, or file import + last import). Buttons: «استورد ملف الجهاز» (dev, `CAN('att')`), «الورديات» + «غيّر» (hr). | — | ❌ | PT-01/02/03 P1 R2 · SH-01 · optional: punch |
| Closing panel on the tab | `attClosePanel()` (see Monthly closing) | — | ❌ | AT-03 |
| Attendance correction request (form `attreq`) | From My file (`x5Me` / `X5F.attreq`; offered when `FEAT('punch') \|\| amOf==='sup'`, i.e. **also with punch off**). Types: `miss` «نسيت البصمة» and `out` «كنت خارج النطاق في مهمة عمل» (only when the source ≠ sup), and `abs` «سُجّلت غائباً وكنت حاضراً». Fields: day (default yesterday) and reason (required). Blocks: `miss` over `POL.fixMax` (3)/month, day older than 7 days, future day. Sent to the line manager `mgrOf(e)` (fallback HR) with notice → `tab:att`. Number `nextNo('tr')`. | — | ❌ The «marked absent but was present» type is core-relevant (a supervisor's sheet can be wrong) and needs no punch. | PT-07 P1 R2 · AT-01 · RL-04 |
| Line manager decides attfix on Today | `decisions` (2189): `attfix` pending where `isMgrOf` → row on Today | — | ❌ | PT-07 · RL-04 |
| Policies table rows | `x5SetPanel`: grace `POL.grace` 15 min (per place); corrections `POL.fixMax`/month within 7 days by the line manager; Ramadan hours `RAM` (6 h for everyone, «لا نسجّل ديانة أحد»); month closing blocking | `statutory.ts` `ramadanHours: 6`, `HrPolicies.closeMissing`; no `grace`, no `fixMax` | 🟡 Grace and correction cap are missing from `HrPolicies`. | PT-08 P2 R3 · PT-07 · AT-06 |

### Punches, devices, geofence

None of this exists in our code: no data, no logic, no screen, no API route.

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Attendance source per place (form `am`) | `amOf(s)`: `x.am` or a default (punch off → `sup`; new company → sup; ws/wh → `dev`; prj/bench → `sup`; else `mob`). The form offers 3 options (sup «الكل حاضر ثم الاستثناءات — لعمال المواقع بلا جوالات»; dev «متصل يرسل بنفسه، أو ملف يُستورد ويُراجع — وقوالب البصمات تبقى في الجهاز»; mob «جوال واحد لكل موظف · لا بصمة خارج النطاق إلا بطلب يُعتمد»). Fields: `dvm` push\|file + `sn` serial (dev), `tin`/`tout` schedule, `grace` 0–60, `r` geofence radius (min 30, step 10, «+30 م هامش دقة»). Note: Ramadan 6 h · punch OT never unapproved · location read at punch only · consent at linking · no face capture. Save → `s.am, s.dv, s.sch, s.grace, s.geo={r}`; «يسري من اليوم». HR only. | — | ❌ | PT-01 P1 R2 · PT-02 · PT-06 · PT-08 P2 R3 · optional: punch |
| Default schedule per kind | `SCHD` prj 06:30–15:30, ws/wh 07:00–16:00, fleet 06:00–15:00; else 08:00–17:00; `stdH` 6 h in Ramadan (`RAM` from/to) | — | ❌ | AT-06 · SH-01 |
| Device: connected push | `dv.mode='push'`, `sn` ZK-…, `lastM` minutes since sync, `X5S.devpush` («أرسل الجهاز N بصمة»), buffers offline; one device per place; device user no. = employee no. | — | ❌ Needs a server endpoint (device ADMS/iclock push), Admin SDK writes. | PT-02 P1 R2 · optional: punch |
| Device file import (`impdev`) | Upload a CSV/TXT (`data-devfile` → `parseCSV` → `{no:r[0], t:hm(r[2]\|\|r[1])}`) or «جرّب بملف عرض» (`demoPunches`). Columns: employee no · date · time. May cover several days; uploaded by the place's supervisor or the payroll officer, at the latest before closing. First in / last out per shift. Review (`readPunches`): matched (saved), duplicates dropped, **dawn punches** (night worker, `t < shift in − 6 h` → yesterday's out), unknown numbers (never create employees; Ajeer belongs to Procurement), late beyond grace, «بصم وهو في إجازة معتمدة» (not saved), «بصم هنا وإسناده في مكان آخر» (→ `e.xs` exception). Save → `e.pn={in,src:'dev',geo:1}`, `today='p'`, `s.lastImp=0`, `A.days[TD]=1`. | — | ❌ | PT-02 P1 R2 · SH-05 P1 R2 · optional: punch |
| Silent device = decision | `devLateTx`: push «لم يرسل منذ N — تحقّق من الكهرباء والإنترنت، أو استورد ملفه», file «لم يُستورد منذ N»; Today item for hr/pay when `lastImp < −1` («بلا ملف لا حضور ولا إضافي ولا إقفال للشهر») | — | ❌ | PT-03 P1 R2 · optional: punch |
| Exception: late | `pn.in − sched.in > grace` and not `pn.done` → «دخل X · الدوام Y · N دقيقة → {lateCode}» (late ≤15, late30, late60, late60p). «استئذان» (`latex`: `pn.done`, log, no violation) / «سجّل مخالفة» (`form:viol:id:code`) | — (the violation ladder exists: `penalties.ts`) | ❌ | PT-04 P1 R2 · PN · optional: punch |
| Exception: no punch | `today==null` and now > shift in + 2 h, not a holiday; for a device place only after today's file arrived (`lastImp===0`). «لا يُعدّ غائباً قبل أن يقرّر إنسان». «استئذان» / «غائب» (`npa` → `setAtt`) | — | ❌ | PT-04 · optional: punch |
| Exception: missing out | `py.in` and no `py.out` (night shift after out + 2 h): «لا إضافي يُحتسب ليوم ناقص» → «اعتمد خروج {shift end}» (`fixout`, `py.fixed=by`, log) | — | ❌ | PT-04 · optional: punch |
| Exception: punch overtime | `otp {h, at}` (out after shift end) → «≈ ﷼» (moneyOk) → «اعتمد» (`otok`: adds to month OT, log «اعتُمد إضافي … من البصمة») / «ليس إضافياً» form `otno`: reason nowork / wait / err (required), log + **notify the employee** «لك الاعتراض بطلب تصحيح» | — | ❌ | PT-05 **P0** R2 · optional: punch |
| Exception: other-site punch | `xs` → «إسناده X وبصم في Y — التكلفة تتبع الإسناد» → «صحّح الإسناد» (`form:assign`) | — | ❌ | PT-04 · AS-03 · optional: punch |
| Employee app punch (geofence) | My file «حضوري» panel (`x5Me`, `am==='mob'`): place, shift, today in/out, «داخل/خارج النطاق (r م)». Punch in/out only inside the fence; outside → «لا بصمة من خارج النطاق — اطلب اعتماد حضورك من مديرك» + correction request. «يُقرأ موقعك لحظة البصمة فقط — لا تتبّع». Non-mob: «من يسجّل حضورك» (device or supervisor), today's status, month absent/OT, «سُجّلت غائباً وكنت حاضراً؟» | — | ❌ The punch belongs in the mobile app (PRD R3 «mobile app»); the web My file shows only status. | PT-06 P1 R2 · R3 mobile · optional: punch |
| Geofence rules | Radius per place (`geo.r`, seeded 120 m office/shop, 300 m fleet, default 150, min 30) + 30 m accuracy margin; one phone per employee; explicit consent at linking; no face capture; no tracking | — | ❌ Consent capture and one-device binding have no UI in the prototype either (stated in the `am` note only). | PT-06 P1 R2 · optional: punch |
| Employee file punch section | `x5Emp` «البصمة»: source, shift + times, today in/out, yesterday in/out («ناقص») | — | ❌ | EM-01 · optional: punch |
| Punch never edits pay without a person | Status is the record; punch is evidence | — | n/a | PT-04/05 |

### Shifts

None of this exists in our code: no `shift` on employees, no shift definitions on `hrSites`, no roster report.

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Shift definitions | `SHDEF` m «صباحية» 07:00–15:00 · e «مسائية» 15:00–23:00 · n «ليلية» 23:00–07:00 (night). `shiftsOf(site)`: `s.shifts` flag, `s.sh` list (ws default m/e/n, else m/e), `s.shd` overrides. Seeded: workshop m/e/n (workers rotated), sup's warehouses `shifts:1`. | — | ❌ | SH-01 P1 R2 · optional: punch |
| Form «الورديات» (`shifts`, HR only, from the Attendance tab) | Checkbox «هذا المكان يعمل بورديات» (otherwise one schedule); for each of m/e/n a use checkbox + in/out time. Night note «تمتد بين يومين — بصمة الفجر تُحسب خروجاً لوردية أمس». Law note: 8 h/day (art. 98); a second shift is overtime at wage + 50 % (art. 107) capped at `OTCAP=60` h/month; an 8 h rest between shifts is a check; swaps by request not in v1. Save: `night` = out ≤ in; workers on a removed shift move to the first one; switching off deletes `e.shift`. Blocked if on with no shift ticked. | — | ❌ | SH-01 · SH-02 · optional: punch |
| Shifts flag at place creation | Form `site`: «يعمل بورديات» for wh/ws/fleet | — | ❌ | SH-01 |
| Worker's shift with an effective date (`shiftset`) | From the employee: options = place's shifts with worker count; «من تاريخ» (default tomorrow; «the first day it is read in attendance and punches»). Submit: `e.shift`, `e.shHist.push({from,to,eff,by})`, log «نُقل من وردية X إلى Y من …». HR manager or the place's supervisor. | — (employee has no `shift`) | ❌ | SH-03 P1 R2 · optional: punch |
| Shift day = start day; night ends next morning | `schOf`: out ≤ in → out + 1440; `night` flag; `mh2` «+1»; `shTx` «تمتد إلى صباح اليوم التالي» | — | ❌ | SH-02 P1 R2 |
| Dawn punch of a night worker | `readPunches`: night shift and `t < in − 360` → `py.out = t + 1440` (yesterday's out), counted as «بصمات فجر» | — | ❌ | SH-05 P1 R2 |
| Second shift in a day | `dblToggle` / `dblBtn` «وردية ثانية» on the sheet: sets present, `dbl=1`, `otToday += shLen` (shift length); warns «تجاوز سقف 60 ساعة هذا الشهر — يحتاج موافقة العامل الكتابية»; toggle off removes it; name shows «×2» | — | ❌ | SH-04 P1 R2 |
| Sheet by shift | `shiftHdr`: chips per shift «{name} {in–out} · present/total» + «N وردية ثانية اليوم»; rows sorted by shift | — | ❌ | SH-06 P2 R3 |
| Roster report | `REPORTS` `roster` (feat punch): no · name · trade · place · shift · from · to (+1) · 2nd shift today | — (`reports.ts:7` "joins when built") | ❌ | RP-02 · optional: punch |
| Ramadan 6 h | `stdH(off)` 6 in `RAM`; `schOf` shortens out = in + 6 h | `statutory.ts ramadanHours: 6`, `holidays.ts:isRamadan` → sheet callout only | 🟡 Information only. There is no schedule engine to read it, which is fine until punch exists. | AT-06 P1 R1 |

#### Build notes: Sites & attendance

**Status counts per section** (✅ / 🟡 / ❌):
- Sites list: 5 / 5 / 0
- Site page: 1 / 7 / 5
- Manpower: 2 / 5 / 4
- Transfers: 2 / 4 / 1
- Supervisor sheet: 9 / 5 / 2
- Closing: 6 / 3 / 0
- Attendance tab: 0 / 1 / 10
- Punches: 0 / 0 / 13 (+1 n/a)
- Shifts: 0 / 1 / 9

**R1 (core) gaps: data, files, rules**

1. **Declared days per person (bug, AT-04).**
   - `attendance.ts:employeeMonth` counts `d.days.length` for everyone in `d.employees`. Count only `d.days.filter(day => day >= max(join, movedInOn))`. The move-in date comes from the `employees/{id}/log` «moved» entry; the alternative is to store a per-employee `from` on the declaration: `employees: Array<{id, from}>`.
   - `missingDays` should start at the earliest `join`/move-in of anyone on the place (prototype `missDays`). It needs the roster passed in, so the signature changes and `today.ts`/`payroll.ts`/`closeMonth` callers must change too.
   - Add the ack checkbox «أقرّ أن هؤلاء كانوا على رأس العمل» to the declare panel. The note stays required (stricter than the prototype, keep it).
   - Show man-days, and wages for pay roles.
   - Files: `attendance.ts`, `attendance-writes.ts`, `HrSiteAttendance.tsx`, tests. No rules change.
2. **Recorded day locks (WF-04 «اليوم يُقفل بتسجيله») — owner decision.**
   - Either refuse re-recording a day already in `days` (`sheetBlocks` + rules: `days[day]` create-only), or keep it editable until the month closes.
   - Should past days without a sheet go only through the declaration? The prototype's model is yes.
   - Rules: `hrAttendance` update would need a check that `days.diff().affectedKeys()` hold only new keys. That is a few expressions, so fold something to pay for it.
3. **Manpower answer executes (AS-02/WF-12 P0).**
   - On answer, in the same transaction:
     - move the `unassigned` rows now (employee `siteId`, `log` «moved» with `source: "manpower"` and the request id);
     - write a scheduled transfer for `site_ending` rows: a new field `employees.planned {to, on, by, request}` or a `kind: "planned"` log entry, applied when the date comes (a write by HR on the day);
     - decrement `hrSettings.establishment.visas` by the visa count (until Hiring brings visa batches `{trade, q, nat, arr, no}` — R2).
   - Add the shortfall choice `rest: "hire" | "xfer" | "ajeer" | "none"` + `short` on `answer`, with an Ajeer policy switch (`HrPolicies.ajeer`) and xfer at +30 days.
   - Add a document number `MR-yyyy/NNN` (shown ط.ع) via `mfgCounters`.
   - Add a Projects acceptance `ack {by, at}` (or `objected {by, at, note}`) and a withdraw button on `ProjectManpowerPanel`.
   - Rules: `manpowerRequests` update needs a third branch, `state == 'answered'` → `changedKeys().hasOnly(['ack','updatedAt'])` by the requester, plus `rest`/`short` inside `answer` (no rule change: `answer` is opaque). The bench moves write `hrEmployees.siteId`, which `hrManager()` may already do. The visa decrement is on `hrSettings` (HR manager, already allowed).
   - Files: `manpower.ts`, `HrManpowerPanel.tsx`, `ProjectManpowerPanel.tsx`, `today.ts` (a Projects-side «plan to accept» item is the PM module's).
4. **Move dialog (AS-01/WF-13).**
   - Add `mayDrive` to `assignBlocks` when the target is fleet/project/warehouse and the trade `drives`.
   - Add an optional `source` (manpower request id).
   - Auto-close pending `hrAssignFixes` for that employee (done if `to == fix.siteId`, else declined «superseded»). This needs `decideAssignFix`-like writes, and the rule already allows the HR manager.
   - Send a Projects notice (`emitHrNotice` to the project's PM when `from` or `to` is a project site).
   - Offer «Move/Assign» on site-page rows and on the unassigned list.
   - Files: `employee.ts`, `employee-writes.ts`, `EmployeeActionDialogs.tsx`, `HrSiteWorkers.tsx`.
5. **Site page content (§5 Sites).**
   - Header: project number + PM (read `projects/{projectId}`), end date **derived** from the project (`pm.startOn + durationDays`, or the project's end field) instead of typed. Keep the manual date only for non-PM projects.
   - KPIs: assigned (on leave/exit split) · present today (`dutyToday` for one site) · month status (`recorded through`/`stopped since` from the last `days` key).
   - Panels: ending warning ≤ 45 d; people table with today's status, documents summary (`docState`), expired-iqama pill, Move; by-trade bars; unassigned list with since-date (from the log) and Assign; `HrManpowerPanel` filtered to the place.
   - Sites list: present/assigned, «unrecorded today», expired count; bench monthly cost for pay roles (sum of `employeePay` — readable only by pay roles, so compute only when `seesPay`).
   - Files: `HrSitesView.tsx`, `HrSiteWorkers.tsx` (or a new `HrSiteHeader.tsx`), `today.ts` (reuse `dutyToday`). No rules.
6. **Sheet `unlisted[]` is a dead end.** Drop it in favour of `HrAssignFixPanel` (simplest), or create an `hrAssignFixes` doc per entry inside `recordDay`. The latter needs an ID number, so drop is better.
7. **All-places corrections list + closing overview.**
   - Add an «All» view on Sites listing `hrAssignFixes` across places (HR manager; rules allow `hrOffice()` list).
   - Add a closing panel listing every place's previous-month state.
   - Pure UI.
8. **English name of a place** (`HrSite.nameEn`). `hrSites` update rule has no `hasOnly`, so no rules change.
9. **Projects' daily headcount by trade** (§Other modules). An outbound read: Projects can read `hrAttendance` only if the rule allows it, and today it does not (only `hrOffice`/supervisor). Option: a derived per-day counter doc `hrSiteHeadcount/{org}__{site}__{day}` written by `recordDay` (new collection = new rules block), or let PM read a site's month by `get` when it is their project (one more `||` in the `hrAttendance` get rule). Owner decision.
10. **Workshop attendance «reported, not owned» (Manufacturing).** Does the workshop's sheet come from Manufacturing (station leads) instead of HR? Owner decision. If yes, `hrSites.attendanceFrom: "manufacturing"`, and Manufacturing writes `hrAttendance` for that site. That needs a rules branch for `manufacturing.manage`/`.work`, which is costly in rule size. Alternatively, HR's sheet stays and the Manufacturing badge is only informational.

**R2: punch / devices / geofence / shifts / attendance tab (optional: punch)**

- **Workplace config** rides `hrSites`, whose update rule is `hrManager()` with no `hasOnly`, so no rules change. Add `source: "supervisor" | "device" | "app"` (prototype `am`), `device {mode: "push"|"file", serial, lastAt, unknown[]}`, `schedule {in, out}` (`sch`), `graceMin` (`grace`), `geofence {lat, lng, r}` (`geo.r`; the prototype has no coordinates, but we need them), and `shifts {on, list: [{id: "m"|"e"|"n", in, out, night}]}` (`shifts/sh/shd`). The default source comes from the type (ws/wh → device, project → supervisor, others → app), and is supervisor when `punch` is off.
- **Punches.**
  - New collection `hrPunches/{org}__{site}__{yyyy-mm-dd}`: `{byEmployee: {[id]: {in, out, src: "dev"|"app"|"fix", geo, outFixed?, late?, excused?}}, other: [{employeeId, at}], unknown: [no], imports: [{by, at, rows}]}`.
  - The read rule can reuse the `hrAttendance` get/list expressions; extract a helper `hrAttReadable(siteId)` and use it for both, which saves size.
  - Device push and app punches are written by **API routes with the Admin SDK**: device push via an iclock/ADMS-style endpoint keyed by serial; the app via `/api/hr/punch` validating the fence server-side (location at punch only, 30 m margin, one bound device per employee — `employees.punchDevice {id, consentAt}` written at linking, with explicit consent). So client write rules are needed only for the file import (supervisor/payroll on that place → `create/update` with `hrSupervises || hrRole('hr.payroll')`), plus HR decisions.
  - The rule size cost is a single small block. Ride `hrAttendance` instead? Not recommended: `recordDay` overwrites `days.{day}` wholesale.
- **Daily status from punches.** First in → present on `hrAttendance.days[day]` (listed + no exception). The exception decisions (late excused / violation, no-punch → absent / permission, missing out → set to shift end, OT approve / refuse with reason `nowork|wait|err` + notify the employee) write `hrAttendance.days[day].ex[id]` (`ot` only on approval: PT-05) and `hrViolations` (the existing `violationRecord`). The pure exception engine `punchExceptions(...)` belongs in a new `lib/hr/punch.ts`: late codes ≤15 / 30 / 60 / 60+, no-punch only after shift in + 2 h and after today's file, dawn punch = yesterday's out for night shifts, other-site → assignment fix.
- **Attendance corrections (PT-07).**
  - Add a `HR_REQUEST_KINDS` entry `"attendance"` (`TR-yyyy/NNN`) with `{type: "miss"|"out"|"abs", day, why}`.
  - Policies `HrPolicies.correctionsPerMonth = 3` and `graceMin = 15`.
  - Within 7 days, decided by the **line manager** (RL-04: derived from the workplace — supervisor → top staff → management) or HR.
  - The `abs` type is useful in R1 without punch. Owner decision: ship it in R1.
  - The `hrRequests` rules need the new kind and a line-manager decider branch. Check `mayEndorse`'s existing line-manager plumbing (leave endorsement) and reuse its rule helper.
- **Shifts.**
  - `employees.shift` + `employees.shiftLog` (or the `employees/{id}/log` kind `shift`, which carries no pay and so is safe for roles without pay).
  - Set by the HR manager or the place's supervisor (SH-03). The `hrEmployees` update rule allows only `hrManager()` or gov-docs, so add `|| (hrSupervises(resource.data.siteId) && changedKeys().hasOnly(['shift','updatedAt']))`, a small cost.
  - Second shift: `hrAttendance.days[day].ex[id].double = true` + `ot += shift length`, with a warning above 60 h/month (`overtimeOverCap` exists).
  - Night shift: the day = start day (SH-02), so payroll is unchanged.
  - Shift headers on the sheet; roster report in `reports.ts`.
- **Attendance tab screen.** Add `attendance` to `HR_BUILT_TABS`; route `contractor|supplier/hr/attendance/page.tsx`; component `HrAttendanceView.tsx`:
  - KPIs: present by source, exceptions, unrecorded days across places;
  - exception groups + correction requests;
  - source per place with «Shifts» / «Change» / «Import device file» dialogs;
  - the closing overview.
  - Also: Today items for silent devices (PT-03) for HR / payroll; the employee file's «Punches» section; My file «My attendance» panel (status only on web; the punch button lives in the mobile app, R3).

**Ambiguities for the owner**
- Should the HR manager record a sheet when the place has a supervisor? The prototype says no, ours says yes.
- Should OT on a «permission» day be allowed, and what is the daily OT ceiling: 6 (prototype) or 12 (ours)?
- Should Ajeer be a company policy switch, and should «transfer of services» be a coverage option in R1?
- Should «attendance correction — marked absent» ship in R1, ahead of punch?
- Is the workshop's attendance owned by HR or reported from Manufacturing?
- Should a site's end date be read from the PM project (and become read-only), or stay typed?

<!-- slice 4-pay-pf -->
# Slice 4 — Payroll · Advances · Government platforms · Nitaqat

Prototype = `proto.html` (Prototype-HR-v11). Ours = `/home/shady/studio-monaqasati` at `7dd80e9` (main, 5 Oct 2026).
Short paths: `lib/hr/…` = `src/lib/hr/…`, `components/hr/…` = `src/components/hr/…`, `FinanceHrDesk` =
`src/components/accounting/FinanceHrDesk.tsx`. Accounts: the prototype's 5102/5107/6101/6108 · 2106/2107/1209/2112 ·
2108/2113 are ours 510201/510701/520101/520202 · 210202/210204/110506/210205 · 220201/210206 (posting-rules
`postHrPay`/`postHrEos`) — that renumbering is deliberate and not counted as a gap.

### Payroll — segments & creation

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Segment rail | `PSEGS`/`PAYSEGS` 1148–1149: «سبتمبر — الحضور جارٍ» (current month, `collecting`) · «أغسطس» (main) · «التكميلي» (supplementary) · «السلف» (Advances); a new company builds segments from `PAY` (one per payroll, `-D` suffix) + Advances; a ● dot on a segment whose payroll is `draft` | `components/hr/HrPayrollView.tsx`: three month buttons (last 3 months) + `<Input type="month">` + one state pill; supplementaries sit inside the month's page; no Advances segment | 🟡 | PY-04/05 P0 R1 · §5 Payroll screen ("الشهر الجاري · المسير الرئيسي · التكميلي · السلف") — no current-month segment, no Advances segment, no ● marker for a payroll awaiting approval |
| «أنشئ مسير <شهر>» | `data-newpay` 1694: only `CO==='new'`, no main payroll for `PREVM` yet and someone joined by month end → pushes `{kind:'main',state:'draft',by}`; toast «محسوب من الحضور المقفل» | `HrPayrollView` «Compute and prepare» → `lib/hr/payroll-writes.ts:preparePayroll` (any month, `payroll.prepare` = manager/payroll), re-reads every closing in the transaction; «Recompute» replaces a prepared one | ✅ | PY-01 P0 R1, PY-05 P0 R1 |
| Empty state | «لا مسير بعد — المسير الأول يُنشأ بعد انتهاء الشهر وإقفال حضور كل مكان عمل» | state pill «Not prepared» + blocking reasons | ✅ | PY-02 P0 R1 |
| Current month «الحضور جارٍ» view (`state:'collecting'`) | `payView` 1157: 3 KPIs — «تقدير من العقود» (Σ `wage(e)` of active non-exit), «حضور مقفل حتى» (yesterday), «يُفتح المسير» (date); callout «لا سطور قبل نهاية الشهر … المسير يُحسب لا يُكتب»; `attClosePanel()` (each workplace's closing); disabled «افتح مسير سبتمبر» with the blocks | Picking the current month shows `not_over` + the unclosed list with links — but the table shows LIVE computed lines (offices/unassigned count as present before month end); the contract estimate exists only as the payroll officer's Today KPI (`lib/hr/today.ts` `estimate`) | 🟡 | PY-02 P0 R1 — build: no lines before month end; contract-estimate KPI, "attendance closed through", "payroll opens on" on the payroll screen; reuse the sites' closing list |

### Payroll — per-payroll panels

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Header: name, state pill, reason, line count | `pyName` «مسير أغسطس — تكميلي», `payPill` (draft «مسودة — لم يُعتمد» warn · sent «عند المالية — بانتظار الصرف» info · paid «صُرف» ok · collecting «الحضور جارٍ» mute); `py.reason` sub; «N سطراً · N معلّق» | State pill (none/prepared/approved/posted/paid) + «prepared by … · approved by …»; KPI «People» and «Held (n)» | ✅ | PY-05 P0 R1 |
| Totals | `m3`: «الإجمالي» · «الاستقطاعات» (red) · «الصافي» (green) — held lines excluded (`tot`) | 7 KPIs: people, gross, deductions, GOSI (both), advances, net, held (n, amount) — held lines INCLUDED in gross/net, shown apart in "Held" | ✅ | PY-01 P0 R1 |
| Blocking facts «لا يُعتمد:» | `payBlocks` 868: main — month end not passed «الشهر لم ينتهِ بعد»; each `ATT[m][s]` not `closed` and not bench/hq/dept «حضور X غير مقفل»; diff — «لا سطور». Approve button disabled | `lib/hr/payroll.ts:payrollBlocks` — `not_over`, `unclosed` (named list + a link button per site), `no_pay` (named people without a wage), `approved`; `<BlockingReasons>`; re-checked in `preparePayroll` | ✅ | PY-02 P0 R1 |
| Held-line callout | `blk w` «N سطور معلّقة بآيبان مرتجع — يُعتمد الباقي وتلحق بعد التصحيح» | KPI «Held (n)» + per-line pill «Held — IBAN» + filter «Held» | ✅ | PY-03 P0 R1 |
| Approve & send | «اعتمد وأرسل للمالية» (`CAN('payroll')` = HR manager) → `paysend` 1584: state `sent`, `sentAt`, `by`; note «بعد الاعتماد تُولَّد للمالية: ملف حماية الأجور وكشف التأمينات»; payroll officer sees «الاعتماد لمدير الموارد البشرية» | «Approve» + confirm dialog → `payroll-writes.ts:approvePayroll`: HR manager, never the preparer (owner flagged `ownFlagged`), refuses a stale prepared copy, writes `hrEvents` hr:PAY + hr:EOS once, takes instalments off `employeePay.advance`, notifies Finance; preparer sees «You prepared it — another HR manager approves» | ✅ | PY-05 P0 R1 · RL-02 |
| Flow line after sending | `sent`: «أُرسل للمالية <منذ> — بانتظار القيد والصرف. لا نصرف نحن.»; `paid`: «اعتُمد <date> (<by>) ← قُيّد وصُرف <date>» + `xmod('fin')` badge + «بعد يوم الصرف بيومين» when paid late; bounced list «N حوالات أعادها البنك · <date> · names — بانتظار التصحيح / صُحّحت — بانتظار إعادة الصرف» | Only «prepared by · approved by»; the state pill says Posted/Paid; `posted.at`, `paid.date`, `returned{}`, `paidHeld{}` exist on the doc but are not shown on HR's screen (Finance's desk shows them) | 🟡 | PY-03 P0 R1, PY-09 P1 R2 — show posted date + entry no., paid date (and "N days after pay day" from `policies.payDay`), the bounced transfers (`returned` map: names, date, reason) and each one's IBAN state (returned → fixed → approved → re-paid) |
| Cost by cost centre bar «التكلفة بحسب مركز التكلفة (الإجمالي + تأمينات الشركة)» | `ccSplit` 864: by `l.site`, Σ(gross + gosiC) of non-held lines; stacked bar + legend per site with amount (masked `•••` without money) | — on the payroll screen. Logic: `payroll.ts:byCostCentre` (amount = `cost` = gross − sick − unpaid + employer GOSI) used for events; Reports «Labour cost by cost centre» (`lib/hr/reports.ts` `cost`) reads the last payroll | 🟡 | PY-06 P1 R1 · §5 "cost centres" — build the per-site bar on the payroll page from `lines` (decide basis: prototype gross+gosiC vs our `cost`) |
| «ما يصل المالية — حدثان بمفتاحيهما» | `x7JE`/`finEvents` 2322–2335 (details, closed): E1 `hr:PAY:<m>[-D]` — Dr per cost centre (`accN` + «مركز تكلفة»), Cr 2106 (net + held, «منه معلّق»), 2107, 1209, 2112; E2 `hr:EOS:<m>` — Dr 5102/6101 = eos+leave, Cr 2108, 2113; «نعرض القيد ولا نكتبه»; EOS reconciliation sentence (Σ `eos(e,'term')` vs account balance); «المعدَّل يصل بقيد فرق (-D)» | Logic only: `payroll.ts:payEvent`/`eosEvent` build exactly this (balanced, `eventBalances`); not previewed on HR's screen; Finance's desk shows the key + one amount | 🟡 | §7.2, AC-03 P0 R1 — logic only, no UI: a read-only "What reaches Finance" panel from `payEvent(p)`/`eosEvent(p)` with account names (`accountName`) and cost-centre names |
| Pre-Mudad check panel | `x6PayPanels` (FEAT mudad) — see "Pre-Mudad check" | — | ❌ | PY-08 P1 R2 · optional: mudad |
| Reconciliation with Finance panel | `x6PayPanels` — see "Reconciliation with Finance" | — | ❌ | PY-09 P1 R2 |
| WPS file / GOSI statement buttons | `sent`/`paid` and `CAN('money')`: «ملف حماية الأجور» (+ «كشف التأمينات» for main) open preview forms; «مخرجات محسوبة من المسير — ترفعها المالية، ولا نتصل بمُدد ولا بالتأمينات» | `frozen` (approved+): «Mudad wage file» / «GOSI statement» download CSV directly (main payroll only); also on Reports for the last sent payroll | 🟡 | PY-07 P0 R1 — see "Files" |

### Payroll — lines & exceptions

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Line computation | `line` 853: wage prorated by join (`wdays`), absence /30, OT `otRate×h`, sick 75%/0 bands, `penMonth`, commission (`e.comm`, PREVM), GOSI on (basic+housing)×wdays/30 by scheme, advance `min(inst,bal)`; net = gross − gosiE − advD − sickD − penD | `lib/hr/payroll.ts:employeeLine` + `lib/hr/pay.ts:payLine`: same terms plus pay steps mid-month (`paySegments`), unpaid leave, sick bands carried via `sickUsed/sickYear`, penalties capped at 5 days (`monthPenalties`), advance from the month after payout (`advanceStartMonth`), leaver's month to the settlement | ✅ | PY-01 P0 R1 |
| Who is on it | `lines` 860: `join<=0`, `since<=month end` (import), not settled-exit | `payroll.ts:onPayroll` (join, `since`, `lastDay`, `left`) | ✅ | PY-10 P0 R1 |
| Held line | `l.held` = state≠paid and `e.iban ∈ {ret, fixedp}` (opacity .55, «معلّق — آيبان مرتجع»; `ret` pill «مرتجعة») — outside `tot`, inside 2106 | `heldOf`: `no_iban` · `iban_returned` · `iban_unapproved` (`fixed`); row tinted, pill «Held — IBAN» | ✅ | PY-03 P0 R1 |
| Default view = exceptions | `isExc`: held · absent · OT hours · OT pay · sick ded. · penalty · advance · commission · extra · `iban!=='ok'`; default shows exceptions only | Filter chips «All lines / Exceptions / Held», default **All**; "Exceptions" = `lineWarnings` (net<0, over half, net<90%, OT>60, held, declared days) — absence, OT, sick, penalty, advance and commission lines are NOT exceptions | 🟡 | PY-06 P1 R1 — default to exceptions; exception = any of the prototype's 10 facts (warnings stay as pills) |
| Grouped «الاستثناءات بحسب مركز التكلفة» | rows grouped by `l.site`, groups sorted by Σgross desc; group header row: site name · count · Σ net (non-held); inside: non-held first, by net desc; `clipped(…,'pay',30)` | Flat table sorted by employee no. with a «Workplace» column; no group rows/subtotals | 🟡 | PY-06 P1 R1 — group by `siteId` (UNASSIGNED last), header row with count + net, held last |
| «كل السطور (N)» toggle | footer link `data-payall` toggles `VS.pay.all`: «كل السطور (N) — المعروض الاستثناءات: غياب أو إضافي أو استقطاع» / «الاستثناءات فقط (N)» | Filter chip «All lines» | ✅ | PY-06 P1 R1 |
| Columns | Employee (name + trade · site · cost-centre code + «عمولة» badge `srcb('sal')`) · «أيام · غياب · إضافي» (absent red; «+60» flag when OT incl. late >60 h with tooltip «يحتاج موافقة العامل الكتابية») · gross · deductions · net | No · name (link to file) · workplace · days · absent · OT h · gross · deductions · net · check pills (`ot_over_cap` = «Over 60 OT h») — no trade, no cost-centre code, no commission badge | 🟡 | PY-06 P1 R1 — add trade and a commission marker (`l.commission>0`, source Sales) |
| Footer totals | `tfoot`: N lines; «N معلّق حتى تصحيح الآيبان — يُرسل بملف إفراج -R»; Σ gross, −Σ ded, Σ net | No table footer (totals are the KPIs) | 🟡 | PY-06 P1 R1 — footer row (minor); the "-R release file" is a gap, see Files |
| Click a line → employee | `data-emp` opens the drawer | Name links to `/hr/people/{id}` | ✅ | — |

### Supplementary payroll

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| What it carries | `line(e,m,'diff')`: late OT `otLate×otRate` + `allowLate` + `retro`; no basic, no GOSI, no deductions; who = anyone with otLate/allowLate/retro | `payroll.ts:computeSupplementary`: retro pay differences (EM-04), commission approved after the main, penalties cancelled after deduction (refund); items carry ids so nothing is paid twice | 🟡 | PY-04 P0 R1 — no "late overtime" or "late allowance" item kind. Ours never reopens a closed sheet, so late OT has no source; owner to confirm whether a late OT/allowance item (entered by HR with a reason) is needed |
| Key and repeat | one `-D` per month (`hr:PAY:m-D`) | `-D`, `-D2` … up to 20 (`supplementaryKey`, `MAX_SUPPLEMENTARIES`) — each new event key | ✅ | PY-04 P0 R1 |
| Reason line | `py.reason` (PROF.diffReason) under the title | — | 🟡 | PY-04 — optional free-text reason on the supplementary doc (`reason`) |
| Lines table | «ما وصل متأخراً»: «N س إضافي · بدل/فرق <amount>»; always all lines | `SupLines`: name · «Retro …» · «Commission …» · «Penalty refunded …» · net; held marked | ✅ | PY-04 |
| Blocks / approval | «لا سطور»; approve same as main | `prepareSupplementary` (only after the main is approved; `no_lines`, `too_many`, `stale`), approve by non-preparer; «Next supplementary» draft shown | ✅ | PY-04/05 P0 R1 |
| WPS file for -D | `wpsRows` diff: basic 0, housing 0, other = OT+extra; filename `WPS-m-D.csv`; no GOSI statement | — (no Mudad file for a supplementary) | ❌ | PY-07 P0 R1 — `mudadCsv` variant for `SupplementaryLine` (basic/housing 0, other = retro+commission+refund, net) |
| Event | `hr:PAY:<m>-D` variable items only | `payEvent` supplementary branch (Dr cost per centre for retro+commission; refund debits the fines fund); posted on the day Finance posts it (`eventPostingDate`) | ✅ | §7.2 P0 R1 |

### Payslips

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| «قسائم رواتبي» list | `x7Payslips` 2346: every MAIN payroll `paid` or `sent` the employee was on; summary: month · net · «صُرف <date>» or «عند المالية» · «معلّق — آيبان مرتجع» | `components/hr/HrMyFile.tsx` «Payslips» from `hrPayslips` (written by Finance at payment, held line when paid — `finance-writes.ts:writePayslips`); key · paid on · net; supplementaries too | 🟡 | ES-04 P0 R1 — no slip while «with Finance» (deliberate: PRD fin:PAID opens slips); a returned transfer's slip shows no "returned/held" state (PRD «والمرتجع بحالته») — read `hrPayrolls.returned[empId]`/`paidHeld` or stamp the slip |
| Slip body | `payslip` 1199: basic · housing · transport · OT «h × (hourly + 50% basic)» (+ «فوق 60 س — بموافقة كتابية») · absence N d · commission (Sales badge) · sick 75%/unpaid · penalties · GOSI «x% of basic+housing (new scheme)» (base) · advance instalment · net | `PayslipBody`: month wage (days) · absence (days) · OT (hours) · commission · gross · GOSI · sick (q/zero days) · unpaid (days) · each penalty by code + date · advance · net | 🟡 | ES-04 P0 R1 — missing basic/housing/transport breakdown (line has `basic`/`housing`), GOSI rate % and base, OT formula, >60 h note |
| Who reads | the employee (My file) | rules `hrPayslips`: pay roles, Finance, `employeeUserId` | ✅ | ES-05 P0 R1 |
| Notice | — | `hr_payslip_ready` (no amount) | ✅ | TD-05 |

### Files: Mudad/WPS & GOSI

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| WPS preview form | form `wps` 1517: title «ملف حماية الأجور — <payroll>»; note «رقم المنشأة في مُدد `FIRM.mudad` · الفترة · ملف فرق بلا أساسي · مفتاح السطر الهوية · الاستقطاعات تشمل…»; table (first 8): employee · ID · bank · IBAN · basic · housing · other (transport+OT+commission+extra) · deductions · net; bounced rows red «مرتجعة»; footer rows count, «N معلّق خارج الملف», Σ net | — (direct download, no preview) | 🟡 | PY-07 P0 R1 — a preview dialog (first rows, Σ net = payroll net − held, held count) |
| WPS CSV columns | `id,name,bank,iban,basic,housing,other,deductions,net,establishment,period` (`WPS-<m>[-D].csv`) | `payroll.ts:mudadCsv`: `id_no,name,iban,basic,housing,other_earnings,deductions,net` (`mudad-<m>.csv`); held lines out; basic/housing frozen on the line | 🟡 | PY-07 P0 R1 — missing `bank` (code from IBAN), `establishment` (Mudad no. — not in our `Establishment`), `period`; supplementary file missing |
| "-R" release file for held lines | footer text «يُرسل بملف إفراج -R» (no builder in the prototype) | Finance pays a held line singly (`payHeldLine`); no file | ❌ | PY-03 P0 R1 — owner decision: is a Mudad "-R" file needed for lines paid after the month? |
| GOSI preview | form `gosi`: subtitle «سعودي 9.75% + 11.75% … غير سعودي 2%»; Saudi rows (employee · nat · base · employee · employer) + one aggregated row «غير السعوديين — أخطار مهنية 2%»; footer «الإجمالي = رصيد 2107»; note «رقم الاشتراك `FIRM.gosiReg` · النسب … تُقرأ من ملف المنشأة» | — (direct download) | 🟡 | PY-07 P0 R1 — preview with the 2107 total |
| GOSI CSV | `no,name,nat,base,employee,employer` (`GOSI-<m>.csv`), held lines excluded | `payroll.ts:gosiCsv`: `id_no,name,nationality,scheme,base,employee,employer,total`; held lines INCLUDED (contributions still owed — they are in our credit) | ✅ | PY-07 (deliberate difference, keep) |
| Where | payroll page after sent/paid, `CAN('money')` | payroll page when approved+; Reports page (last sent payroll) for pay roles | ✅ | RP-02 P1 R1 |

### Pre-Mudad check (optional: mudad)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Panel «فحص الالتزام قبل مُدد» | `x6PayPanels` 2300 (only `FEAT('mudad')`, main, moneyOk): details open when draft with unjustified findings; count + «N بلا مبرّر» / «كلها مبرَّرة»; «تنبيه لا مانع» | — (feature `mudad` exists in `lib/hr/settings.ts:HR_FEATURES` and can be switched on in Settings — not in `LATER` — but nothing reads it) | ❌ | PY-08 P1 R2 · optional: mudad · ST-02 |
| Finding: late payment | `mudadFindings` 2296: paid and `paidAt > month end + POL.payDay` → «صُرف <date> بعد موعد الصرف — تأخر يظهر في مُدد» (whole month) | — (`policies.payDay` stored, unused) | ❌ | PY-08 |
| Finding: held | «حوالته معلّقة — سيظهر في مُدد بلا أجر هذا الشهر» | pill `held` | 🟡 | PY-08 — as pill only, no justification |
| Finding: basic ≠ Qiwa | `e.qiwaBasic != e.basic` → «الأساسي في المسير X والموثَّق في قوى Y» | — (no documented-basic field) | ❌ | PY-08 — needs `qiwaBasic` (see Platforms) |
| Finding: over half deducted | `gosiE+advD+penD+sickD > gross×0.5` «(م.93)» | `lineWarnings` `over_half` (gross − net > gross/2 — includes unpaid days) | ✅ | PY-08 |
| Finding: zero/negative net | `net<=0` | `net_negative` (`net<0` only — zero not flagged) | 🟡 | PY-08 — flag `net<=0` |
| Finding: net below 90% | `net < (wage − gosiE)×0.9` and no absence and no leave → «مُدد تطلب سبباً» | `net_below_90`: `net < monthWage×0.9`, regardless of absence/leave, GOSI not taken out — fires for every Saudi (GOSI ≈10%) and every absence | 🟡 | PY-08 — use the prototype's rule |
| Finding: no IBAN (new co) | `CO==='new' && !e.ibanNo` | `heldReason: no_iban` → held | ✅ | PY-08 |
| Justify «برّر» | form `mj`: 3 presets (approved raise not yet on Qiwa · advance/penalty with written consent · returned transfer paid after the fix) or free text; saved `py.just[empId+kind]`; shown «المبرّر: …»; by `prep`/`payroll` | — | ❌ | PY-08 — "justified once" |
| Mudad month status | inside the panel when paid: «حالة الشهر في مُدد» — «رُفع وسُجّل <date> · pct% · note» or «لم تُسجَّل بعد» + «سجّل الحالة» → form `mudad` (compliance % 0–100 optional, notes optional) → `py.mudad={pct,note,by,at}` | — | ❌ | GV-05 P2 R3 · optional: mudad |

### Reconciliation with Finance

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Panel «المطابقة مع المالية» (`srcb('fin')`) | `x6PayPanels` 2325: main, sent/paid, moneyOk; KV: «صافٍ أُرسل (2106)» t.net · «صُرف فعلاً» (net if paid) · «معلّق لم يُصرف» Σ held net + N lines (red) · «التأمينات: كشفنا (2107)» Σ gosiRows + status «سُدّدت <date>» / «لم تُسدَّد — الموعد <month end+15> — غرامة تأخير» / «قبل <date>» · «استحقاق نهاية الخدمة للشهر (2108)» · «استحقاق الإجازات للشهر»; note «الصرف والسداد عند المالية — نحن نقرأ ونطابق» | — on HR's side. Pieces exist: `transferAmount`, `payrollTotals.heldNet/eos/leave`, `owedLines` (Finance desk) | ❌ | PY-09 P1 R2 — logic largely present, no panel |
| GOSI paid (fin:GOSIPAID) | sim `gosipaid` sets `py.gosiPaid` | — no field, no Finance action, no posting of the GOSI payment | ❌ | PY-09 P1 R2 · §7 fin:GOSIPAID — Finance desk action "GOSI paid" on a payroll (date, bank) → `hrPayrolls.gosiPaid` (+ Dr 210204 Cr bank when Accounting is on) |
| EOS reconciliation (hr:RECON) | sentence: Σ `eos(e,'term')` today vs 2108 balance, difference = adjustment | Reports «End-of-service provision» lists each gratuity; no comparison with the ledger balance | 🟡 | PY-09, pipeline `hr:RECON:YYYY-MM` — compare report total with `accounting_journal` balance of 220201 |
| Bounced transfers loop | sim `reissue`; flow line on the paid payroll | `finance-writes.ts:markReturned` (reason, entry, `ibanState: returned`, notices) → `employee-writes.ts:fixIban` (payroll, `SA` + 22 digits) → `approveIban` (HR manager, different hand) → `payHeldLine` (Finance, payslip written) | ✅ | PY-03 P0 R1, WF-06 step 7 |

### Finance events & journal

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Outbox hr:PAY / hr:EOS | "two keyed events" (shown, not written) | `hrEvents/{orgId}__hr:PAY:<key>` and `__hr:EOS:<m>` written at approval, never twice (rules: create once, Finance only moves state) | ✅ | §7.2 P0 R1, AC-03 |
| Finance posts (fin:POSTED) | sim `paid` = posted & paid in one | `FinanceHrDesk` «Payroll events to post» → `postHrEvent` (dated month end; supplementary on posting day), entry id on the event + payroll `posted.entry` | ✅ | WF-06 step 5 |
| Finance pays (fin:PAID) | sim `paid` → `paidAt`, `paidBy` | «Payrolls to pay» → `recordPayrollPaid` (date, bank; transfer = net − held), payslips + notices; with Accounting off recorded without entries | ✅ | WF-06 step 5–6 |
| Held/returned lines on Finance desk | sim «الحوالات المصحَّحة … أُعيد صرفها» | «Held and returned lines» (every paid payroll), IBAN ready/waiting, «Pay» | ✅ | PY-03 |
| Event content preview for Finance | `x7JE` lines | Finance desk shows key + «Salaries · {amount}» only | 🟡 | §7.2 — show Dr/Cr rows before «Post» (same panel as HR's "What reaches Finance") |
| Mudad window task after fin:PAID | `govTasks` «ارفع ملف أجور <شهر> وسجّل حالته» due paid+3 | — | ❌ | WF-06 step 6 · GV-02 P1 R2 · optional: gov/mudad |

### Advances

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| «السلف» segment — «سلف قائمة» panel | `advView` 1184: employees with `adv.bal>0`: employee · «المتبقي» · «القسط» · «يكتمل بعد N أشهر»; sub «تُستقطع أقساطها من المسير — لا سلفة ثانية قبل سداد الأولى»; row opens employee | No screen list. Reports «advances» (`lib/hr/reports.ts`: no · name · principal · balance left · instalment · months left, pay roles); payroll officer's Today KPI «advances» (Σ balance, count) → report; balance on the employee file / My file | 🟡 | AD-01 P0 R1 · §5 Payroll "السلف" — add an Advances segment on Payroll (outstanding from `employeePay.advance`) |
| «طلبات السلف» panel | all advance requests not `ok`: «<name> — amount · القسط i × n»; «reason · when · الأجر wage»; status: `fin` → waiting badge «اعتماد المدير المالي» · `no` → «رُفض» · Decide button (`CAN('approve')`) · «بانتظار القرار» | Advances appear in the generic request lists (`components/hr/HrRequestList.tsx` on Today / employee file / My file) with number, state, holder; no advance-specific list | 🟡 | AD-03 P0 R1 — list pending / with Finance / declined advances on the Advances segment |
| Request form | `reqadv` 1422: amount (min 100, step 100), reason; outstanding block «لديك سلفة قائمة — الباقي X بقسط Y … لا سلفة ثانية» (button disabled); instalment preview | `components/hr/NewRequestDialog.tsx` + `lib/hr/requests.ts:advanceQuote`: amount, reason, instalment, months; blocks `bad_amount`/`no_reason`/`no_wage`/`outstanding` (incl. a pending one); warnings `over_limit`, `past_contract` | ✅ | AD-01/02/04 P0/P1 R1 |
| Decision form | `adv` 1403: KV wage · «حدّك» (wage×`advMax`) · outstanding pill · «القسط — 10% (م.92)» `i × (n−1) + r = amount`; warnings: repayment past contract end «الباقي يُستقطع من المخالصة أو يُطلب مبلغ أقل»; outstanding block (approve disabled); over limit «فوق حدّك — يذهب للمدير المالي»; options «اعتمد» / «أوصِ وأرسل للمالية» / «ارفض» | `HrRequestList` decision dialog: number · name · «Advance · amount»; only `req.over_limit_note` for over-limit; note field; no wage/limit/outstanding/instalment breakdown, no past-contract warning to the decider | 🟡 | AD-01/03/04 — show `advanceQuote` on the decision (wage, limit, outstanding, i × n, past-contract) |
| Approve ≤ limit | → `e.adv={amt,bal,inst}`, log «طلب صرف للمالية» | `request-writes.ts` decide: `employeePay.advance {amount,balance,instalment}`, state approved | ✅ | AD-01 P0 R1 |
| Over limit → Finance | state `fin`, HR's recommendation kept; Finance `finadv` ok/no | state `finance` + `financeHold`, `hr_advance_to_finance`; `FinanceHrDesk` «Advances» → `financeDecideAdvance` (decline needs a note; HR's view shown) | ✅ | AD-03 P0 R1 |
| HR manager's own advance → management | Today mgmt 909 | `deciderLevel: management` | ✅ | LV-05/RL-02 |
| Payout & instalments | approve = «طلب صرف للمالية»; instalment from payroll | `finance-writes.ts:payAdvance` (Dr 110506 Cr bank, entry names the request) → instalment from the month after payout; approval deducts balance | ✅ | AD-01, WF-08 step 4 (PRD names it `hr:PR` on 1209 — ours pays from the request; equivalent) |
| «قسّط» (schedule) | Today item for an approved, unscheduled advance (`q.sched`) | automatic | ✅ | — |

### Government platforms (optional: gov)

The Platforms tab is not built (`components/hr/HrShell.tsx:HR_BUILT_TABS` excludes `platforms`; `access.ts` already has the
tab, gated by feature `gov`, roles manager/gov/management, and duty `platform.tasks`; Settings lists `gov` in `LATER`).

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Tab «المنصات» | 1016: `FEAT('gov')` and (gov role, or HR manager when no gov user); badge = overdue tasks | — | ❌ | GV-02 P1 R2 · optional: gov |
| KPI «أعمال مفتوحة على المنصات» | count; red if any late «N تجاوزت موعدها» | — | ❌ | GV-02 |
| KPI «فروقات من آخر مطابقة» | Σ `PFL[pf].diff` | — | ❌ | GV-04 P1 R2 |
| KPI «أقدم مطابقة» | min `PFL[pf].at` over importable platforms on; «لم تُطابَق» | — | ❌ | GV-04 |
| Panel «ما يجب فعله على المنصات» | `govTasks` grouped by platform (`dhdr2`), 4 per group (`clipped`): «<employee> — task», «قبل <due>» or «تجاوز موعده <due>» · trade · site; action button by `go` | — (pieces elsewhere: exit tasks gosi/insurance/finalExit in `HrExitPanel` + `exit-writes.ts:setExitTask`; injury GOSI report in `HrInjuryPanel`; iqama issue/renewal queue on gov Today; exit re-entry only a notification `hr_exit_reentry`) | ❌ | GV-02 P1 R2 |
| Task catalogue — Qiwa | contract `ct` (joined <30 d, `!onb.qiwa`, due join+7, action ticks onboarding) · `xfer` transfer of services (src xfer, join+3) · `abs` absence report art. 80 (leave ended ≥15 d ago, due leave.to+15) · `pay<i>` «حدّث الأساسي في العقد: from → to» (pay change in last 60 d, due eff+7; done sets `qiwaBasic`) | — (art. 80 day-15 stage exists in `requests.ts` as a fact, no task) | ❌ | GV-02 |
| Task catalogue — GOSI | `reg` register new joiner (join+7) · `excl` exclude leaver (last+7) · `inj` report injury (at+deadline, form inj) · reconciliation `wage` fix | `excl` = exit task `gosi` ✅; `inj` = injury report ✅; reg/wage ❌ | 🟡 | GV-02, DC-07 |
| Task catalogue — Muqeem | `iq` issue iqama (arrival, due arrived+90) · `ren` renew (iqama ≤ renew window; «مع رسوم رخصة العمل ورسوم العمالة الوافدة») · `erv` exit re-entry (approved leave within 21 d, due from−2, `do:exitvisa` records `q.exitVisa`) · `fexit` final exit/transfer (settled non-Saudi, last+14) | iqama issue/renew via documents + gov Today queue (DC-04/05) ✅; final exit = exit task `finalExit` ✅; exit re-entry: notice only, no "done" record | 🟡 | GV-02, DC-04/05, LV-04 |
| Task catalogue — CHI / Traffic / HRDF / Mudad | CHI `ins` add/renew (missing or ≤30 d), `rem` remove leaver · Traffic `dl` licence ≤60 d · HRDF `sup` new Saudi (join+30) · Mudad `up` upload wage file (paid+3, form `mudad`) | CHI remove = exit task `insurance` ✅; others ❌ (licence state exists in `documents.ts`, DC-06) | 🟡 | GV-02 |
| «سجّل أنه تمّ» | form `gt`: note «الفعل يُنفَّذ على المنصة نفسها — هنا نسجّل أنه تمّ»; optional reference no.; saves `GT[key]={ref,by,at}`; side effects: pay change → `c.qiwa=1`, `qiwaBasic=basic`; `fexit` → `exit.finalExit`; employee log «<platform>: <task> — مرجع» | exit tasks only (stamp, no reference no.) | 🟡 | GV-02 |
| Panel «الجهات» | per platform (`PFS`): name · «نُخرج» · «نستورد» · «آخر مطابقة <rel> — N فرقاً» / «لم تُطابَق بعد»; «طابق بملف» (importable, on, not mudad, hr/gov); «أطفئ/فعّل» (HR manager); off = dimmed | — | ❌ | GV-03/04 P1 R2 |
| Platform switches `POL.pf` | qiwa, mudad, gosi, muqeem, chi, traffic on; hrdf off; toggles also in Settings under the gov feature (`do:pfx`) | — (`HrSettings` has no `platforms`) | ❌ | GV-03 P1 R2 |
| Reconciliation by import «مطابقة — <جهة>» | form `recon`: 2-column CSV (employee no · value) or demo; `RCV`: Muqeem = iqama expiry (non-Saudi), GOSI = registered wage basic+housing, Qiwa = documented basic (`qiwaBasic`); differences only: `diff` «عندنا X · عند الجهة Y» · `miss` «ناقص عندهم» · `gone` «زائد عندهم» (left here) · `unk` «مجهول» (never creates an employee); tick «اعتمد قيمة الجهة» (Muqeem → `docs.iq`, Qiwa → `qiwaBasic`) or for GOSI «أنشئ عملاً صحّح الأجر المسجَّل»; miss/gone become tasks (due 3); saves `PFL[pf]={at,n,diff,by}` | — | ❌ | GV-04 P1 R2 |
| No platform connection | everything is files / lists / imports | Files are CSV; no integration anywhere | ✅ | GV-01 P0 R1 |

### Nitaqat / establishment

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Establishment form | form `firm` 1458/1563: name ar/en, CR, MOL no., GOSI reg., **Mudad no.**, **band** (g/y/r), **min %** (green threshold), visas, as-of = today, company type (sets features once) | `components/hr/HrSettingsView.tsx` + `lib/hr/settings.ts:Establishment`: name, cr, mol, gosi, visas, visasAsOf, business type (defaults once) | 🟡 | ST-04 P1 R1, ST-06 — missing `mudad` (needed in the WPS file), `band`, `minPct`; prototype's name has an English form |
| Panel «ملف المنشأة» (`nitaqatPanel` 998) | on gov Today and Settings: «نطاق التوطين» band pill · «نسبة السعوديين — محسوبة من السجل» pct (sa of active) · «حدّ النطاق الأخضر» minPct · «هامش الأمان» «ينقص N سعوديين للبقاء في النطاق» (red) / «يمكن أن تفقد N سعوديين قبل الخروج من الأخضر» · CR · MOL · GOSI · «تأشيرات متاحة» + «آخر تحديث» | Settings shows the editable fields only; Saudi % appears as a note on management's labour-cost KPI (`today.ts`) and in Reports «saudization» (by trade) | 🟡 | ST-04 P1 R1 — read-only panel with computed ratio and margin needs `band` + `minPct` |
| Visas used by arrivals | `FIRM.visas` | `establishment.visas` decremented by a visa arrival (rules allow gov exactly −1) | ✅ | EM-02 |
| Saudi under 4,000 warning | new-employee form «سعودي بأقل من 4,000 لا يُحتسب في نطاقات» | (out of this slice — check New employee) | — | — |

#### Build notes — Payroll · Advances · Platforms · Nitaqat

**Payroll screen (🟡 PY-06, PY-02 collecting, flow line, cost bar, events preview).** No new data: everything is on
`hrPayrolls` (`lines`, `posted`, `paid`, `returned`, `paidHeld`) and `payEvent`/`eosEvent`. Touches
`components/hr/HrPayrollView.tsx` (split it: `PayrollSegments`, `PayrollLinesTable` grouped by `siteId`,
`PayrollCostBar`, `PayrollEventsPreview` — the last reused by `FinanceHrDesk`), `lib/hr/payroll.ts` (an
`isException(l)` with the prototype's 10 facts; `lineWarnings` fixes: `net<=0`, net<90% rule =
`net < (monthWage − gosiEmployee)×0.9 && !absent && !leave`). Decide the cost-bar basis (prototype gross+employer
GOSI vs our `cost`, which also nets sick/unpaid — ours matches the posted debit; recommend ours). Current month:
hide lines before month end. No rules impact.

**Advances segment (🟡).** Reads `employeePay.advance` (pay roles already read it) and `hrRequests` kind `advance`
(already queried by `useHrRequests`). Decision dialog: call `advanceQuote` with the employee's pay and contract
end. No rules impact.

**Files (🟡/❌ PY-07).** `Establishment.mudad` (new string field on `hrSettings.establishment` — the existing HR-manager
write rule covers it). `mudadCsv` gains `bank` (derive SAMA bank code from IBAN digits 5–6), `establishment`, `period`;
a `mudadSupplementaryCsv(lines)`; preview dialogs (first rows + totals). Owner decision: is a "-R" release file for
held lines paid later wanted (prototype names it, never builds it)? No rules impact.

**Pre-Mudad check (❌ PY-08, optional: mudad; R2) and Mudad status (GV-05, P2).** Data on the payroll doc:
`just: { [employeeId+kind]: { why, by, byName, at } }` and `mudad: { pct|null, note, by, byName, at }`. Needs
`EmployeePay.qiwaBasic` (documented basic, a PAY figure → `employeePay`, not `employees`) and uses
`policies.payDay`. Rules: `hrPayrolls` update today allows HR only while `prepared` and only the preparer;
add ONE branch `changedKeys().hasOnly(['just','mudad','updatedAt']) && (hrManager() || hrRole('hr.payroll'))`
(any state) — small, reuses existing helpers. Gate the panel on `featureSet(settings).has('mudad')` and move
`mudad` into `LATER` until built (today the switch can be turned on and does nothing). Who justifies: prototype
`prep` or `payroll` (payroll officer, HR manager).

**Reconciliation with Finance (❌ PY-09, R2).** Panel computed from the payroll + `payrollTotals`; GOSI due =
month end + 15. New: Finance action "GOSI paid" → `hrPayrolls.gosiPaid {date, by, byName, at, entryId}` (+
`postHrGosiPayment` Dr 210204 Cr bank in `accounting/posting-rules.ts`, mirrored to mobile). Rules: add `'gosiPaid'`
to the Finance `hasOnly` list of `hrPayrolls` (one token). EOS line: compare the EOS report total with the ledger
balance of 220201 (read `accounting_journal`, Finance/HR manager only). The pipeline's `hr:RECON:YYYY-MM` event
(no entry) is optional — owner to decide whether to write it or compute on screen.

**Platforms tab (❌ GV-02…04, optional: gov; R2).** New lib `lib/hr/platforms.ts` (pure `platformTasks(world)` =
the 14-task catalogue above, due dates from `statutory`/policies; reconciliation diff `reconcile(rows, kind)`
returning diff/miss/gone/unk), `platform-writes.ts`, screen `components/hr/HrPlatformsView.tsx`, routes
`/contractor|supplier/hr/platforms`, add `platforms` to `HR_BUILT_TABS`. Data: ONE new collection
`hrPlatform/{orgId}__{key}` with `kind: 'done' | 'task' | 'recon'` — `done` = a completed task (`ref`, by, at;
key = `pf:task:employeeId`), `task` = a reconciliation-made task (`pf`, `employeeId`, text code, due), `recon` =
last reconciliation per platform (`at`, `n`, `diff`, by). Platform switches in `hrSettings.platforms`
(`{qiwa,mudad,gosi,muqeem,chi,traffic,hrdf}` booleans; HR manager — existing rule). Onboarding flags
(`onb.qiwa/gosi/xfer`) can be the `done` docs themselves. Side effects that touch other docs: Qiwa pay update →
`employeePay.qiwaBasic` (pay doc — gov role cannot write pay today); Muqeem "take their value" →
`employees.docs.iqama` (gov already writes documents); final exit → existing `hrExits.tasks.finalExit` (reuse
`setExitTask` rather than duplicating). Rules: one new block for `hrPlatform` (~read `hrStaff()`-org,
create/update `hrRole('hr.gov') || hrManager()`, `createsInOrg()`/`keepsOrg()`, no delete) — about 300–400
stripped chars; the ruleset is at ~142,950 of ~145,500, so it fits, but fold something if PY-08/09 branches go in
the same release. **Owner decisions:** (1) GOSI and Qiwa reconciliation compare WAGES — government relations is
"no pay" (RL-03); either the recon for gosi/qiwa is payroll's/HR manager's, or the comparison shows only
"differs / matches" to gov without amounts; (2) whether exit re-entry needs a recorded "done" (prototype `q.exitVisa`)
— today it is only a notification; (3) HRDF default off (prototype) — confirm.

**Nitaqat (🟡 ST-04).** Add `band: 'green'|'yellow'|'red'|null` (prototype also has platinum/high/medium green in seed
data — ask whether the band list is the 3 colours or Nitaqat's 6 bands), `minPct`, `mudad` to `Establishment`
(+ `normalizeHrSettings`); a read-only `EstablishmentPanel` (ratio from active employees, margin =
`ceil(active×minPct/100) − saudis`) on gov Today and Settings. Existing `hrSettings` rules cover it (HR manager
writes; gov's visa-only branch unchanged). No new collection.

<!-- slice 5-hire-grow -->
# Slice 5 — Hiring · Training · Performance (optional: hire / train / perf)

Scope read: proto.html 1715–1729 (FEATS/STRICTS/FDEF/POL.strict), 1737–2048 (X5F/X5A hiring, cycle, reviews,
raises, training), 1306 `applyRaise`, 1013–1018 (tabs), 2170–2235 (`x5Decisions`, `x5EmpSecs`, `x5Me`, reports,
`x5SetPanel`, `x5Init`), 2389/2395 (new employee file cards), 2504/2520 (new My file cards), 2584 `x5PrefillCand`.
Not in this slice (checked, they belong elsewhere): `X5F.open` 2144 = opening **balance** (IM-04), `X5F.mj` 2307 =
Mudad justification, `X5F.fill` 2100 = attendance missing days, `X5F.gt` 2267 = platform task done.

Ours, verified by grep + read: **nothing of hiring, training or performance is built** — no collection, no lib
file, no screen, no rule. What exists: the tab ids `hiring` and `perf` in `lib/hr/access.ts:HR_TABS/ROLE_TABS/
TAB_FEATURE` (filtered out by `components/hr/HrShell.tsx:HR_BUILT_TABS`), the switches in
`lib/hr/settings.ts:HR_FEATURES/defaultFeatures` (match the prototype's FDEF: contractor/supplier = all but perf,
developer = all but train), the strings `Portal.HR.tab.hiring|perf`, `feature.*`, `feature_desc.*`, and these
logic overlaps: trade reference wage + `saudiOnly` (`lib/hr/trades.ts`), visa arrivals spending
`establishment.visas` (`lib/hr/employee-writes.ts:createEmployee`), coverage's `visa`/`hire`/`ajeer` lines
(`lib/hr/manpower.ts:coverage`), single-employee pay change with effective date and retro
(`employee-writes.ts:changePay`/`payWithStep`), probation decision (`employee-writes.ts:decideProbation`), the
iqama clock (`lib/hr/documents.ts:iqamaDueBy/iqamaOverdue`, Today `iqama_clock`), Nitaqat 4,000 warning
(`trades.ts:NITAQAT_MIN_BASIC`), the `saudization` and `turnover` reports (`lib/hr/reports.ts`).

Release: hiring HI-01…08 = P1 **R2**, HI-09 = P2 **R3**; training TR-01…05 = P1 **R2**, TR-06 = P2 **R3**;
performance PF-01…06 = P1 **R3** (build order puts performance & raises in R3), PF-07 = P2 **R3**.

---

### Hiring — openings

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Tab «التوظيف» | `TABS` 1015: shown when `FEAT('hire')` for roles hr · gov · mgmt; badge = openings in `open`/`wait` | `lib/hr/access.ts:ROLE_TABS` has `hiring` for manager · gov · management, gated by `TAB_FEATURE.hiring = f.has("hire")`; `HrShell.tsx:HR_BUILT_TABS` drops it; no route `contractor/hr/hiring` | 🟡 tab id + role map + switch only; no route, no screen, no badge | ST-02 P0 R1 · HI-01 P1 R2 · optional: hire |
| Feature switch default | `FDEF` con/sup `hire:1`, dev `hire:1`; `new` all off | `settings.ts:defaultFeatures` — contractor/supplier: all but perf; developer: all but train; none for no type | ✅ | ST-06 P1 R1 |
| KPI «شواغر مفتوحة» | `VIEWS.hire` 1832: count of `open`+`wait`; sub = Σ`jobLeft` people needed; red «N لن يُسدّ في موعد الحاجة» when any `jobLate`, else «كلها في موعدها» | — | ❌ | HI-01/HI-03 P1 R2 · optional: hire |
| KPI «مرشحون ينتظرون خطوة منّا» | `candMine` = stage new, int (with or without scorecard), acc; sub «N للفرز · N مقابلة · N عرض قائم» | — | ❌ | HI-02 P1 R2 |
| KPI «يلتحقون خلال 30 يوماً» | accepted candidates with `offer.start ≤ 30` + Σ`jobLeft` of batches at stage `visa` with `jobEta ≤ 30`; sub «السعودة الآن X% — الحدّ `FIRM.minPct`%» | — (no Nitaqat floor field in `Establishment`) | ❌ | HI-05 P1 R2 · ST-04 P1 |
| Segments «الشواغر · المرشحون · الالتحاق» | `data-seg="hire:open|cand|join"` with counts (open+wait openings · active candidates · `onbList()`) | — | ❌ | HI-02/HI-06 P1 R2 |
| Action «شاغر جديد» | HR only (`ROLE()==='hr'`) → `X5F.job` | — | ❌ | HI-01 P1 R2 |
| Openings list (row) | `jobRow`: `jname` = trade ×q — workplace, number `ش-2026/NN` / `JOB-2026/NN` (`JNO` sequence), `jobSrc` (manpower request + its no. · replaces <name> · new position [approved by management]), needed date, «بانتظار اعتماد الإدارة» or expected date + `jobEtaWhy`; pills: «لم يُعتمد» (wait) / «متأخر N» (`jobLate`) / «في الموعد»; batch → stage pill, individuals → «N مرشح»; sorted by `need` ascending; filled/closed in a collapsed «اكتملت أو أُغلقت» | — | ❌ | HI-01/HI-03 P1 R2 |
| Opening states | `state`: `wait` → `open` → `filled` (when `filled ≥ q`) · `closed` (declined or closed by HR); flag late = `open && jobEta > need` | — | ❌ | HI-01 P1 R2 (PRD state table) |
| Opening born from a manpower request | `x5SyncJobs` (on every render): each MREQ `answered` with `rest==='hire'` and no `job` → `addJob({trade, q: plan 'hire' count, site, need: m.from, src:'mr', ref:m.id})`, `m.job=j.id`; no approval needed | `lib/hr/manpower.ts:answerManpowerRequest` stores `answer.plan` (CoverageLine[]); `coverage` always appends BOTH a `hire` (+90 d) and an `ajeer` (+45 d) line for the shortfall — HR does not choose the rest (prototype `d.rest` ajeer/hire/xfer/none, 1367/1550) | 🟡 logic only — no "rest" choice, nothing creates an opening from a `hire` remainder | HI-01 P1 R2 · AS-02 P0 R1 |
| Opening born from an exit (suggestion) | `jobSugg` = active employees with `st==='exit'` and no `rep` opening; panel «خروج بلا بديل» (HR) — «اقتراح — لا يُفتح شاغر وحده» — row: name — trade · site · last day · «افتح شاغراً بديلاً» → `X5F.job` with `rep` | — (exits exist: `hrExits`, employee `status: "leaving"`, `lastDay`) | ❌ | HI-01 P1 R2 |
| New position needs management approval | `POL.strict.jobApprove` (default 1 = block): a new (not rep/mr) opening is created `state:'wait'`, management notified «وظيفة جديدة للاعتماد — …»; off (warn) → opens directly | — (`HrPolicies` has only `closeMissing` as block/warn) | ❌ | HI-01 P1 R2 · ST-03 P1 |
| Opening detail header | `jobDetail`: «← كل الشواغر», source · opened by · when; KV: needed·joined (`q · filled`), needed by, «المتوقع — بحسب الواقع» + why, money roles: «نطاق الأساسي للمهنة» `bandOf` 90–120% (rounded to 50); `why` note | — | ❌ | HI-03/HI-05 P1 R2 |
| «وظيفة جديدة = تكلفة جديدة» callout | on `wait`: management approves before sourcing; money roles see est. cost `round(tradeWage × 1.35 × 1.12) × q` SAR/month; replacements and request-born openings need none | — | ❌ | HI-01 P1 R2 |
| Late callout «لن يُسدّ في موعده — متأخر N» | batch: recruitment ≈ `POL.visaLead` (90) days — bridge with a transfer or Ajeer through Procurement, tell the requester the honest date; mr-born: tell the requester / Ajeer; else «computed from the furthest candidate» | — | ❌ | HI-03 P1 R2 |
| Management approves/declines position | mgmt on `wait`: «اعتمد الوظيفة» `jobok` → `open`, `okBy`, HR notified «اعتُمدت وظيفة … ابدأ البحث»; «ارفض» `jobno` → `closed` | — | ❌ | HI-01 P1 R2 (permissions: MG approves position) |
| Close opening | HR, individuals track, `open`: «أغلق الشاغر» `jclose` → `closed` | — | ❌ | HI-01 P1 R2 |
| Honest date `jobEta` | batch: `arr`→0, `visa`→`b.eta` (or 30), `test`→75, `auth`→`visaLead` (90). Individuals: max accepted `offer.start`; else offer out → 21, interview → 30, nothing past interview → 45 (`jobEtaWhy` gives the reason) | `manpower.ts:COVERAGE` holds `visaLeadDays 90`, `hireLeadDays 90`, `ajeerLeadDays 45` (coverage only; hire lead is 90, prototype's individual estimate is 45) | 🟡 constants only, no per-opening computation | HI-03 P1 R2 |
| Panel «من أين يأتي المرشحون» | static text: one apply link per opening + file import for agency lists; no job-board integration | — | ❌ | HI-09 P2 R3 |
| Panel «أثر التوظيف على السعودة» | now `pctNow()` (Saudis/active) vs «لو التحق كل من قَبِل ووصلت كل دفعة» (adds accepted candidates and open batches' `jobLeft` as non-Saudi); «حدّ النطاق `FIRM.minPct`% — يُحسب قبل تقديم العرض لا بعده» | `reports.ts` `saudization` report (by trade: headcount · Saudis · others · ratio · localized); no floor, no projection | 🟡 ratio exists in a report; no hiring projection, no establishment band/floor | HI-05 P1 R2 · ST-04 P1 |
| Today rows (HR) | `x5Decisions` r=hr: per late opening (amber, due) «شاغر … لن يُسدّ في موعده — متأخر N» → open; «مرشحون ينتظرون خطوة منك: N» (blue, req) with «N للفرز · N بعد المقابلة · N قَبِل ولم يُحوَّل» → candidates segment | `lib/hr/today.ts:todayItems` has no hiring kinds | ❌ | TD-01 · HI-03 P1 R2 · optional: hire |
| Today rows (management) | «وظيفة جديدة للاعتماد — …» (amber) with `why` and ≈ monthly cost; «عرض فوق النطاق — name» (amber) trade · offer vs ceiling | — | ❌ | HI-01/HI-05 P1 R2 |
| Report «الشواغر والمرشحون» | `REPORTS.hire` (hr, mgmt, gov; feat hire): No · opening · qty · joined · needed · expected · late (d) · candidates (or batch stage) | `reports.ts:REPORT_IDS` — not present (header comment: "join when those features are built") | ❌ | RP-02 P1 · optional: hire |
| Report «دوران العمالة وسدّ الشواغر» — opening columns | `turn` report adds «مطلوبون في شواغر» (Σ`jobLeft` of open/wait at the site) and «أقدم شاغر (يوم)» | `reports.ts` `turnover`: site · headcount · joined90 · leaving · turnover% — no opening columns | 🟡 missing the two opening columns | RP-02 P1 · optional: hire |

### Hiring — individuals track

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Track choice | `addJob`: `track = isLab(trade) ? 'batch' : 'ind'` by default; overridable in the job form | `trades.ts` `category` labour/staff exists | 🟡 data to derive it only | HI-02 P1 R2 |
| Candidate stages | `STG`: new «جديد» → int «مقابلة» → offer «عرض» → acc «قَبِل العرض» → hired «التحق» · rej «مستبعد» (also declined) | — | ❌ | HI-02 P1 R2 |
| Candidate sources | `CSRC`: link «رابط التقديم» · ref «ترشيح موظف» · agency «مكتب توظيف» · walk «حضر بنفسه» · file «استيراد من ملف» (`link` only via the apply link) | — | ❌ | HI-02 · HI-09 |
| Opening detail — candidates by stage | `jobDetail` individuals: groups by `SORD` (new, int, offer, acc) with counts; collapsed «التحقوا أو استُبعدوا»; empty «لا مرشحين بعد — أضف مرشحاً، أو انسخ رابط التقديم» | — | ❌ | HI-02 P1 R2 |
| Candidate row | `candRow`: name · nationality · source; (all-candidates list adds trade — site); age; scorecard avg `(t+x+b)/3`/5 or interview date; money roles & not `new`: «يطلب» ask; offer basic + «صالح حتى»; acc: «يباشر» start; `why` (rejection reason) | — | ❌ | HI-02/HI-04 · HI-09 (ask hidden at first screening) |
| Segment «المرشحون» (all) | active candidates of all openings grouped by stage, furthest first | — | ❌ | HI-02 P1 R2 |
| Action «قابِل» / «استبعد» (new) | HR manager (`CAN('approve') && ROLE()==='hr'`): `cint` → `int`, `intAt = +2` days; `crej` → `rej` | — | ❌ | HI-02 P1 R2 |
| Action «سجّل تقييم المقابلة» (int, no scorecard) | HR → `X5F.score` | — | ❌ | HI-04 P1 R2 |
| Action «قدّم عرضاً» / «استبعد» (int, with scorecard) | HR → `X5F.offer` | — | ❌ | HI-05 P1 R2 |
| Not recommended = rejected | `X5F.score.submit`: `rec=0` → stage `rej`, `why` «لم يوصِ به المقابِل» | — | ❌ | HI-04 P1 R2 |
| Saudi-only trade blocks non-Saudi candidates | `LOCALIZED.includes(trade) && nat!=='sa'` → red block in the candidate form, submit disabled; job form shows «مهنة مقصورة على السعوديين»; seeding forces `nat:'sa'` | `trades.ts:saudiOnly` + `employee.ts:newEmployeeBlocks/assignBlocks/payChangeBlocks` → `saudi_only` (employees only) | 🟡 rule exists for employees; no candidate pipeline to apply it to | HI-08 P1 R2 |
| Add candidate | HR on an open individuals opening: «أضف مرشحاً» → `X5F.cand` | — | ❌ | HI-02 P1 R2 |
| Apply link | «انسخ رابط التقديم» `copylink` → `https://jobs…/{cr}/{no}`; an application arrives as a `new` candidate with `src:'link'` and HR is notified «مرشح جديد عبر الرابط» (`X5S.apply`, simulator) | — (needs a public route like `/offer/[token]`) | ❌ | HI-09 P2 R3 |
| Import candidates from a file | text only («استيراد من ملف» for agency lists); `src:'file'` exists, no import form in the prototype | — | ❌ (prototype too: text only) | HI-09 P2 R3 |
| Expected pay hidden at screening | `candRow`: `ask` shown only when `moneyOk()` and stage ≠ new | — | ❌ | HI-09 P2 R3 |

### Hiring — recruitment batch

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Batch stages | `BST`/`BORD`: auth «تفويض مكتب الاستقدام» → test «الاختيار والاختبار المهني» → visa «صدرت التأشيرات» → arr «الوصول»; stepper in `jobDetail` | — | ❌ | HI-02/HI-07 P1 R2 |
| Batch data | `j.b = {stage, agency, nat, sel (passed trade test), eta, visa}` | — | ❌ | HI-07 P1 R2 (data model: batch) |
| Batch KV panel | agency (or «غير محدد») · nationality · «اجتازوا الاختبار المهني» sel / q · «رصيد التأشيرات في ملف المنشأة» `FIRM.visas` (+ «حُدّث» `FIRM.asOf`), red when `visas < jobLeft` before visas are issued | `settings.ts:Establishment.visas/visasAsOf`, edited in `HrSettingsView.tsx` | 🟡 the balance and its as-of day exist; no batch panel | HI-07 P1 R2 · ST-04 P1 |
| Coverage note | «عند صدور التأشيرات تدخل الدفعة «التغطية» بموعد وصولها … لا نتصل بمساند ولا قوى؛ نسجّل ما صدر» | — | ❌ | HI-07 P1 R2 |
| Action «سجّل: <next stage>» / «سجّل الواصلين موظفين» | HR or gov, opening `open` → `X5F.bstage` | — | ❌ | HI-07 P1 R2 (WF-18: HR / GR) |
| Visas issued spend the balance (whole batch) | `bstage` stage test→visa: `FIRM.visas -= jobLeft(j)` at once; **blocked** if `FIRM.visas < jobLeft`; creates a `VISA` record `{trade, q, nat, arr: eta, no, job}` that coverage reads (`cover()` 876 takes `VISA` by trade with its arrival date) | `employee-writes.ts:createEmployee`: each `source:'visa'` employee spends ONE `establishment.visas` inside the create transaction (`no_visas` block); `manpower.ts:coverage` offers `min(left, establishment.visas)` of ANY trade at today+90 | 🟡 logic differs: we deduct per arrival, the prototype deducts at issue and tracks issued-visa lots by trade with an ETA; coverage reads the raw unused balance instead of issued lots. Building batches without changing `createEmployee` would spend visas twice | HI-07 P1 R2 · AS-02 P0 R1 |
| Arrivals by name become employees | stage visa→arr: names (one per line, as in passport, ≤ `jobLeft`) → one employee each: `nat = b.nat`, trade, site = opening's, `join: today`, wage = trade wage, docs pp/iq/ins null, `prob: 90`, `src:'visa'`, `arrived: today`, `onb:{}`, `certs:{}`, log «وصل ضمن دفعة … — agency»; `filled += n`, VISA lot reduced, stage `arr`, opening `filled` when full; message «وثائقهم تظهر ناقصة عند العلاقات الحكومية» | `NewEmployeeDialog.tsx` + `createEmployee` one at a time with `source:'visa'` (iqama clock notice DC-05, probation 90) | 🟡 single-employee path only (no bulk-by-names, no link to a batch; would also spend a visa each — see above) | HI-07 P1 R2 · DC-05 P0 R1 |
| Iqama clock for arrivals | `POL.iqamaGrace` 90 from `arrived`; onboarding shows «المهلة حتى …» | `documents.ts:iqamaDueBy/iqamaOverdue`, `legalOnSite`, Today `iqama_clock` | ✅ | DC-05 P0 R1 |
| Today rows (gov) | per open batch past `auth`: «دفعة … — <stage>» (blue, due) agency · expected → «سجّل التالي» `form:bstage` | — | ❌ | HI-07 P1 R2 |

### Hiring — offers

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Offer band | `bandOf(t)` = [round(ref×0.9/50)×50, round(ref×1.2/50)×50] of the trade's reference wage (`TR(t)[4]`) | `trades.ts:Trade.ref` "reference monthly basic for the band" — no band function | 🟡 reference wage only | HI-05 P1 R2 · policy «نطاق العرض 90–120%» |
| Above band → management | `POL.strict.offerBand` (default block): basic > ceiling → offer saved `state:'mg'`, management notified «عرض فوق النطاق»; candidate row shows «بانتظار الإدارة — فوق النطاق»; off = warn only | — (`HrPolicies` lacks it) | ❌ | HI-05 P1 R2 · ST-03 P1 |
| Management approves/returns an offer | mgmt: «اعتمد العرض» `offok` → `state:'sent'`, `okBy`, HR notified «اعتُمد عرض … — أرسله»; «أعده» `offno` → back to `int`, offer cleared | — | ❌ | HI-05 P1 R2 |
| Offer states | `offer.state`: mg → sent → acc \| dec | — | ❌ | HI-05 P1 R2 |
| Loaded cost shown | wage = basic + 25% + 10%; company cost = `wage × (Saudi 1.1175 : non-Saudi 1.02) + wage/24` | `statutory.ts` GOSI rates + `eos.ts` accrual exist (payroll/EOS) | 🟡 ingredients exist, no offer view | HI-05 P1 R2 |
| Saudization effect before the offer | «السعودة لو التحق» `pctNow()% ← pctAfter(nat)%` in candidate and offer forms | — | ❌ | HI-05 P1 R2 |
| Saudi under 4,000 warning | offer form: Saudi with 0 < basic < 4000 → «لا يُحتسب كاملاً في نطاقات» | `trades.ts:NITAQAT_MIN_BASIC` + `saudi_below_nitaqat` warning on new employee / pay change | 🟡 rule exists, not on an offer | HI-05 P1 R2 |
| Start after need warning | offer start > opening `need` → «المباشرة بعد موعد الحاجة بـN» | — | ❌ | HI-03 P1 R2 |
| Candidate answer | HR on a sent offer: «قَبِل» `cacc` → stage `acc`, offer `acc` («حوّله إلى موظف عند توقيع العقد»); «اعتذر» `cdec` → `rej`, offer `dec`, why «اعتذر عن العرض» | — | ❌ | HI-05 P1 R2 (WF-17 step 5) |
| Offer letter «الخطاب» | `X5F.offerl` (anyone seeing the row while offer sent/acc): company name, date; Arabic or English body: trade, workplace, basic, housing 25%, transport 10%, total, start, contract (open / 1 y / 2 y), probation 90 days, annual leave `POL.leave`, valid until, «يُوثَّق العقد في منصة قوى عند القبول»; signed by `offer.by` — HR | `components/hr/LetterDocument.tsx` / `lib/hr/letters.ts` (5 letter types: salary, embassy, experience, …) print in the letter's language | 🟡 letter rendering infrastructure exists; no offer-letter type | HI-09 P2 R3 (bilingual offer letter) |

### Hiring — onboarding & convert to employee

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| «حوّله إلى موظف» | candidate `acc`: HR or gov → `form:newemp:cand:<id>` | `NewEmployeeDialog.tsx` (HR manager / gov; gov without pay) — no candidate entry point | 🟡 the form exists; no conversion | HI-06 P1 R2 |
| Prefill from the offer | `x5PrefillCand`: source = `sa` if Saudi else `xfer` (transfer), nat, gender, names ar/en, trade, site, basic = offer basic, join = offer start (≥ today), contract `open` or `fixed` with end = start + 365/730 | `NewEmployeeDialog` fields: source (local/transfer/visa), names, nationality, trade, site, join, contract, basic … | 🟡 every target field exists; no prefill | HI-06 P1 R2 |
| `x5Hired` after save | candidate → `hired`, `c.e = employee id`; opening `filled += 1`, `filled` state when full; employee `onb = {}`; basic/housing/transport from the offer; log «التحق من الشاغر … — مرشح عبر <source>» | `createEmployee` writes the employee + `employeePay` + log | ❌ link candidate/opening ↔ employee | HI-06 P1 R2 |
| Onboarding segment «الالتحاق» | `onbList`: active, not visa, joined in the last 30 days, not exiting; row: name · trade · site · started; chips; `ok/total`; «ما يُقرأ من السجل يُقرأ — وما يُنجز خارج النظام يؤشَّر، ولا يمنع شيئاً» | — | ❌ | HI-06 P1 R2 |
| Onboarding items (`onbItems`) | manual ticks (HR/gov) `qiwa` «العقد موثّق في قوى», `gosi` «مسجَّل في التأمينات»; read from the record: iqama recorded (non-Saudi; «المهلة حتى» arrival+90), medical insurance (non-Saudi), IBAN, each required certificate valid (with train; next session date), line manager (`mgrOf`) | record facts exist: `docs.iqama/insurance`, `employeePay.iban`, `lineManagerOf`; no `onb` ticks | 🟡 facts readable; no checklist, no Qiwa/GOSI ticks | HI-06 P1 R2 · GV (platform tasks, other slice) |
| Tick action | `onb` (`do:onb:<emp>:<k>`) sets `e.onb[k]=1`, log «وُثّق العقد في قوى» / «سُجّل في التأمينات» | — | ❌ | HI-06 P1 R2 |
| Today rows (gov) | «<name> قَبِل العرض — يباشر …» (amber) → «حوّله»; «ملتحقون جدد بلا توثيق قوى أو تسجيل تأمينات: N» (blue) → onboarding segment | — | ❌ | HI-06 P1 R2 |

### Hiring forms

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| `X5F.job` — fields | `trade` (select, required) · `q` count (number ≥ 1) · `site` workplace (select) · `need` needed-by (date, default today+30, or replacement: max(7, exit last day)) · `track` ind/batch (shown once a trade is picked; default by labour/staff) · `why` «لماذا الآن؟» (optional, not for replacements) | — | ❌ | Form 26 · HI-01 P1 R2 |
| `X5F.job` — rules | disabled unless trade, site, q > 0, need; warning «لن يُسدّ في موعده من الآن — متأخر نحو N» when days to need < lead (batch `visaLead` 90 / ind 45); Saudi-only note; money roles: band + est. monthly cost `ref×1.35×1.12×q`; button «افتح الشاغر» (replacement or jobApprove off) / «أرسل للإدارة» (wait + mgmt notified) | — | ❌ | HI-01/HI-03 P1 R2 |
| `X5F.cand` — fields | `n` name Arabic · `en` name English (either one enough) · `nat` (select) · `src` (ref/agency/walk/file — not link) · `phone` (optional) · `ask` expected pay (money roles, optional, «بلا رقم أفضل من رقم مخترع») | — | ❌ | Form 26 · HI-02 P1 R2 |
| `X5F.cand` — rules | blocked: Saudi-only trade with non-Saudi nat; needs a name; shows «السعودة لو التحق» now ← after; created at stage `new` | — | ❌ | HI-08 P1 R2 |
| `X5F.score` — fields | three 1–5 ratings: `t` technical ability (labour: «الاختبار المهني العملي») · `x` experience in similar work · `b` discipline & conduct; `rec` recommend / do not recommend; `note` optional | — | ❌ | Form 26 · HI-04 P1 R2 |
| `X5F.score` — rules | all three + rec required; stores `sc {by, at, t, x, b, rec, note}`; rec = 0 → rejected | — | ❌ | HI-04 P1 R2 |
| `X5F.offer` — fields | `basic` (number, step 50; default min(ask, ceiling) or trade wage; «سكن 25% · نقل 10% تلقائياً») · `start` (date, default today + max(7, notice or 14)) · `until` valid until (date, default +7) · `ct` contract open / 1 year / 2 years | — | ❌ | Form 26 · HI-05 P1 R2 |
| `X5F.offer` — rules | needs basic > 0, start and until; shows monthly wage, company cost, band, Saudization effect; above band (strict) → «احفظ وأرسل للإدارة» + `mg`; Saudi < 4,000 warning; start after need warning | — | ❌ | HI-05 P1 R2 |
| `X5F.offerl` | read-only letter (see offers); no submit | — | ❌ | HI-09 P2 R3 |
| `X5F.bstage` — stage auth→test | `agency` (text, required) · `nat` (non-Saudi select, default bd) · `sel` passed the trade test (number ≥ 0, of q — «الاختبار قبل التأشيرة لا بعد الوصول») | — | ❌ | Form 26 · HI-07 P1 R2 |
| `X5F.bstage` — stage test→visa | shows needed (`jobLeft`) vs visa balance; **blocked** «رصيد التأشيرات لا يكفي — حدّث رصيد التأشيرات في ملف المنشأة بعد إصدارها في قوى» when balance < needed; `eta` expected arrival (date, required, default +45) | — | ❌ | HI-07 P1 R2 |
| `X5F.bstage` — stage visa→arr | `names` textarea, one passport name per line; disabled if none or more than `jobLeft`; note: one employee per name on the workplace at trade wage, iqama clock (90) and probation start; missing iqama/insurance/IBAN stay missing | — | ❌ | HI-07 P1 R2 |
| `newemp:cand` | the new-employee form prefilled by `x5PrefillCand`; `x5Hired` on save | `NewEmployeeDialog.tsx` (no candidate mode) | 🟡 | HI-06 P1 R2 |

### Training

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Tab «الأداء والتدريب» / «التدريب» | `TABS` 1017: when `FEAT('perf')||FEAT('train')` for hr · sup · mgmt; label by which is on; segments `growHead` perf / train (only enabled ones); `VIEWS.grow` opens training when perf is off | `access.ts` `perf` tab for manager · supervisor · management, `TAB_FEATURE.perf = perf ∨ train`; label `tab.perf` = "Performance & training" fixed; not in `HR_BUILT_TABS`, no route | 🟡 tab id + gate only; label not adaptive | ST-02 P0 · TR-01 P1 R2 · optional: train |
| Certificate catalogue | `CERTS`: `ind` site safety induction 12 months · `hgt` work at height 24 · `fa` first aid 24 | — (`documents.ts:DOC_TYPES` = iqama, passport, insurance, contract, licence, forklift) | ❌ | TR-01 P1 R2 |
| Requirement by trade & workplace | `reqCerts(e)`: none for visa-pending; `ind` for anyone on a site kind in prj/ws/wh/fleet; `hgt` on a project for car, stl, pnt, plr, ele, frm; `fa` for saf, frm, whm | `sites.ts` workplace types (project, workshop, warehouse/distribution, fleet …) and `trades.ts` keys exist | 🟡 inputs exist; no requirement function | TR-01 P1 R2 |
| Certificate state = from its date | `certSt` = `miss` or `dState(expiry)` (ok / d60 / d30 / exp) — «الشهادة وثيقة — تُحسب حالتها من تاريخها» | `documents.ts:docState` (missing · valid · d60 · d30 · expired, renewal window from policy) | 🟡 reusable state function; no certificate data | TR-01 P1 R2 |
| Gaps & red fact | `certGaps` over active/leave people: every required cert not `ok`; `gapBad` = missing/expired AND active AND (not induction OR joined > 3 days ago) — 3-day induction grace; does NOT block assignment | — | ❌ | TR-02 P1 R2 |
| KPI «على رأس العمل بلا شهادة سارية» | count `gapBad`; sub «N منهم في جلسة مجدولة» | — | ❌ | TR-02 P1 R2 |
| KPI «شهادات تنتهي خلال 60 يوماً» | gaps in d30/d60 | — | ❌ | TR-01 P1 R2 |
| KPI «جلسات مجدولة» | planned sessions, seats taken; sub «N ساعة تدريب منجزة هذا العام — تدخل إفصاح التدريب» (`trainHours` = Σ attended × course hours) | — | ❌ | TR-03 · TR-06 P2 R3 |
| Panel «الفجوات — بالشهادة ومكان العمل» | grouped by cert × workplace, worst first: «N بلا شهادة سارية» (red) · «N تنتهي قريباً أو في المهلة» (amber) · «N في جلسة مجدولة»; HR: «جدول جلسة» → `X5F.sess` (cert, site) unless all already in a session | — | ❌ | TR-02/TR-03 P1 R2 |
| Supervisor view «شهادات عمالي — بالاسم» | role sup, scope = his workplaces: each gap by name, worst first, cert chip (name · expiry or «لا شهادة»), «في جلسة <date>»; «الجدولة عند الموارد البشرية» (clipped 8) | — | ❌ | TR-05 P1 R2 |
| Panel «احتياج تدريبي من التقييم» | non-certificate courses with `courseNeeds` (reviews whose `rv.need` = course and not in a session): names (4 + more); HR «جدول جلسة» | — | ❌ | TR-06 P2 R3 · optional: perf + train |
| Course catalogue «الدورات» | `COURSES`: ind (internal, company safety officer, 0 SAR, 3 h, cert) · hgt (external, Occupational Safety Institute, 350, 8 h) · fa (external, Red Crescent, 280, 12 h) · sup field supervision (external, 1,200, 16 h) · xl Excel (external, 600, 12 h); row: internal/external · provider · hours · cert validity; cost shown to money roles, «بلا تكلفة» | — | ❌ | TR-03 P1 R2 (data model: course) |
| Panel «الجلسات» | planned first then by date: course · site or location · date · seats used/seats · provider; done: «N اجتازوا» + cost (money); planned & date ≤ today & HR → «سجّل الحضور والنتيجة» `X5F.sessdone`; else relative date; cost requested → waiting on Finance «صرف التكلفة»; else «أُنجزت» | — | ❌ | TR-03/TR-04 P1 R2 |
| Session states | `state` plan → done; `pr` (payment) req → paid | — | ❌ | TR-04 P1 R2 (PRD state table) |
| Scheduling notifies the supervisor | `sess.submit`: per workplace of the participants, the site's supervisor user gets «جلسة … <date> — N من عمالك»; «يوم التدريب يوم عمل بأجر» | `lib/hr/notify.ts:emitHrNotice` infrastructure | ❌ | TR-03 P1 R2 (WF-20 step 3) |
| Result issues certificates | `sessdone.submit`: attendees (all minus unticked) get `certs[cert] = session date + months×30`, log «اجتاز … — الشهادة حتى …»; absentees in `abs` | — | ❌ | TR-04 P1 R2 |
| External cost = payment request to Finance | done external session: `cost = attended × course cost`, `pr:'req'` (Finance answers «صُرفت» `trainpaid` → `paid`); charged to the cost centres of the attendees' workplaces (`ccOf`) | `finance-writes.ts`/`hrEvents` outbox pattern (`hr:PAY`, `hr:EOS`, `hr:FS`); no training event | ❌ | TR-04 P1 R2 (WF-20: 6109 account) |
| Today rows (HR) | «N على رأس العمل بلا شهادة سلامة سارية» (red, now) «N منهم في جلسة مجدولة» → training; per planned session dated ≤ today «جلسة … اليوم — N مشاركاً» (amber) → «سجّل» | — | ❌ | TR-02/TR-04 P1 R2 |
| Today row (supervisor) | «N من عمالك بلا شهادة سلامة سارية» (red) with next induction session date or «اطلب جلسة من الموارد البشرية» | — | ❌ | TR-05 P1 R2 |
| Employee file — «الشهادات والتدريب» card | `openEmp` 2395 (train on): table certificate · «لماذا مطلوبة» (induction: anyone on site/workshop/warehouse; height: <trade> on a project; first aid: the trade) · expires · state chip; session log (date · passed/absent/scheduled); old drawer `x5EmpSecs` same with a red count | `HrEmployeeFile.tsx` segments ov/docs/att/pay/log — no certificates | ❌ | TR-05 P1 R2 · ES-06 P1 |
| My file — «شهاداتي وتدريبي» | `VIEWS.me` 2520 / `x5Me`: certificate · expires · state; red «شهادة منتهية أو ناقصة — أبلغ <manager>; أنت مسجَّل في جلسة <date> / لم تُجدول لك جلسة بعد»; planned sessions with location and «يوم عمل بأجر» | `HrMyFile.tsx` — no certificates | ❌ | TR-05 P1 R2 · ES-06 P1 |
| Onboarding reads certificates | `onbItems`: each required cert valid + next session | — | ❌ | HI-06 · TR-01 |
| Report «الشهادات وانتهاؤها» | `REPORTS.cert` (feat train): No · name · trade · workplace · certificate · expires · status (missing/expired/valid/expiring) | not in `REPORT_IDS` | ❌ | RP-02 P1 · optional: train |
| Report «بيانات الإفصاح عن التدريب» | `REPORTS.train`: done sessions — course · date · provider · trainees · Saudis · hours · cost (money roles) — «تُدخل في قوى يدوياً» | not in `REPORT_IDS` | ❌ | TR-06 P2 R3 |

### Performance — cycle & sheets

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Review cycle | `CYC = {n, open, close, raise}` (seeded «التقييم السنوي 2026»); `cycOpen` = open ≤ today ≤ close; no cycle → empty state «لا دورة تقييم مفتوحة … من لم يُكمل ستة أشهر يُقيَّم في التجربة», HR «افتح دورة تقييم» | — | ❌ | PF-01 P1 R3 · optional: perf |
| Eligibility | `rvElig`: not visa-pending, not exiting, joined ≥ 180 days ago | `employee.ts` `join`, `status` | ❌ (data only) | PF-01 P1 R3 |
| Rater = line manager | `mgrOf(e)`: set manager → site's labour supervisor (labour) / senior staff by basic → management → HR; never self, never visa-pending | `access.ts:lineManagerOf` = `managerId` else the site's `supervisorEmployeeId`; `managerId` is always null on create and no UI sets it | 🟡 shorter chain (no senior-staff / management fallback), no way to set it on the card | RL-04 P1 · PF-01 P1 R3 |
| KPIs (HR / management) | «اكتمل من التقييم» done / eligible, «الدورة تُقفل …، N دون ستة أشهر خارجها»; «بانتظار اعتمادك» (HR) / «بانتظار اعتماد الموارد البشرية» count `done`, with rater-skew warning «N مقيِّم أغلب درجاته ممتاز»; «زيادات التقييم» Σ monthly (money roles, else •••) and the raise state | — | ❌ | PF-01/PF-05/PF-06 P1 R3 |
| KPIs (supervisor / line manager) | «أرسلتُ من تقييم فريقي» sent / team · «مسودات لم تُرسل» («الدرجة لا تُحتسب قبل الإرسال») · «بانتظار اعتماد الموارد البشرية» | — | ❌ | PF-02 P1 R3 |
| Worker sheet «عمالي — درجة لكل عامل» | `rvSheet` (labour in my team, eligible, not done): row = worker · trade · absences · penalties; three toggles `RV3` 3 «يُعتمد عليه» (4.7) · 2 «عادي» (3.6) · 1 «ضعيف» (2.0); `rvq` toggles a draft (only if `isMgrOf` and cycle open; clicking the same grade clears it); «لا زر الكل ممتاز»; «أرسل N للاعتماد» `rvsend` → all drafts `done`, HR notified | — | ❌ | PF-02 P1 R3 |
| Staff list «فريقي من الكادر» | staff in my team: name · trade · «أرسل تقييمه الذاتي» · state; band pill; «قيّم» → `X5F.rv` while not done and cycle open | — | ❌ | PF-03 P1 R3 |
| Staff review: four criteria | `RVC`: g goals achieved · q work quality · i initiative & problem solving · t collaboration & communication — 1–5 each | — | ❌ | PF-03 P1 R3 |
| Self-review | `X5F.self` from My file (staff only, cycle open, not reviewed, not yet sent): four criteria + highlights; stored `rv.self`; manager sees it in the review form («تقييمه الذاتي: …»); «يقرؤه مديرك … وليس جزءاً من النتيجة» | — | ❌ | PF-03 P1 R3 |
| Facts box «من السجل — لا يُقيَّم بل يُقرأ (20%)» | `factsBox`/`attFacts`: absences last two months · applied penalties in 180 days (not cancelled, with amount) · OT hours · recorded injury → `attScore = max(1, 5 − absences − penalties)` | attendance months (`hrAttendance`), violations (`hrViolations` applied), injuries (`hrInjuries`) all exist | 🟡 facts readable; no score | PF-04 P1 R3 |
| Score with record weight | `rvScore` = base × (1 − rvW%) + attScore × rvW%, rvW default 20; base = worker grade value (4.7/3.6/2) or staff average of four; one decimal | — | ❌ | PF-04 P1 R3 · policy «وزن السجل 20%» |
| Bands | `BANDS` A ≥ 4.3 «ممتاز» · B ≥ 3.5 «جيد جداً» · C ≥ 2.5 «جيد» · D «يحتاج تحسيناً» | — | ❌ | PF-04 P1 R3 |
| Review states | `rvStTx` draft «مسودة عند المقيِّم» → done «بانتظار اعتماد الموارد البشرية» → ok «معتمد — لم يطّلع الموظف» → ack «اطّلع الموظف»; returned → draft | — | ❌ | PF-02…07 (PRD state table) |
| Probation assessment panel «تقييم فترة التجربة» | employees with `prob ≤ 30` days left, active, visible to HR or their line manager: trade · ends · manager; the view pill (confirm/extend/end) or «قيّم» → `X5F.pe` or «لا تقييم بعد» | `decideProbation` (HR manager: confirm · extend with consent ≤ 180 · end → exit); Today `probation_end` (HR, ≤ due-soon days) | 🟡 the HR decision exists; the line manager's attached view (`pe`) does not | EM-05 P0 R1 · PF-01 P1 R3 |
| Probation view on the HR decision | `x5ProbBox` in the HR probation form: «رأي المدير المباشر (name · date): grade — recommends …» or «لا تقييم من المدير المباشر بعد — غير مانع» | `EmployeeActionDialogs.tsx` probation dialog — no manager view | ❌ | EM-05 P0 R1 |
| Today rows (supervisor / line manager) | «قيّم عمالك — N بلا تقييم» (amber) one grade each · closes …; «رأيك في تجربة <name> — تنتهي …» (amber) → `form:pe` | — | ❌ | PF-02 P1 R3 · EM-05 |
| Employee file — performance | `openEmp` 2389 card «الأداء» (perf on or a review exists): cycle state (band pill to HR/mgmt/manager, state text), «من السجل» attScore with absences · penalties, «رأي المدير في التجربة», «زيادة معتمدة» from → to from <date> (money); old drawer `x5EmpSecs` adds line manager (set / derived), «خطة تحسين حتى …», review note | `HrEmployeeFile.tsx` shows the line manager (`lineManagerOf`) in overview; no performance | 🟡 line manager only | ES-06 P1 · PF-07 P2 R3 |
| My file «تقييمي» | `VIEWS.me` 2504 / `x5Me` (perf, cycle, eligible): after approval — result band, reviewed by, «من سجلّي» attScore, approved raise (+amount on basic from …), note; «اطّلعت» `rvack` → `ack` with date, «لك مناقشته مع مديرك أو الموارد البشرية»; before — «قُيّمت — بانتظار اعتماد الموارد البشرية» or «لم يقيّمك مديرك (<name>) بعد — الدورة تُقفل …» + «أرسل تقييمي الذاتي» (staff) | `HrMyFile.tsx` — none | ❌ | PF-07 P2 R3 · ES-06 P1 |
| Report «نتائج التقييم» | `REPORTS.perf` (hr, mgmt; feat perf): No · name · workplace · rater · score · band · attendance score · status | not in `REPORT_IDS` | ❌ | RP-02 P1 · optional: perf |

### Performance — calibration & raises

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Raters panel «المقيِّمون — المعايرة قبل الاعتماد» | HR & management: `raters()` per line manager: sent/all · average · % outstanding (A) · approved count; flags «أغلبها ممتاز» (`flag`: ≥ 5 done and > 60% A), «درجة واحدة لأغلبهم» (`flat`: ≥ 10 done and one grade ≥ 90%), «N لم يُقيَّم»; sorted by pending | — | ❌ | PF-05 P1 R3 |
| Approve per rater | HR: «اعتمد N» `rvok` (outline button when flagged) → each `done` of that rater → `ok`, `okBy`; band D → `pip = {until: +60 days, by}`; log «اعتُمد تقييم …: <band>» | — | ❌ | PF-05 P1 R3 · PF-07 |
| Return per rater | HR: «أعده للمراجعة» `rvback` → back to draft, rater notified «أُعيدت تقييماتك للمراجعة» | — | ❌ | PF-05 P1 R3 |
| Distribution «توزيع النتائج» | bars per band (count of done reviews), money roles see «+X%» per band | — | ❌ | PF-05 P1 R3 |
| Improvement plan | band D on approval → `e.pip {until 60, by}`, shown on the file «خطة تحسين حتى …» | — | ❌ | PF-07 P2 R3 |
| Acknowledgement | employee «اطّلعت» → `ack`, `ackAt` | — | ❌ | PF-07 P2 R3 |
| Raise percentages | `POL.raise` A 7 · B 4 · C 2 · D 0 (policy; editable in the proposal form 0–25 step 0.5) | `HrPolicies` — none | ❌ | PF-06 P1 R3 · policy «نِسب زيادات التقييم» |
| `raisePlan` | over APPROVED reviews (ok/ack) by band: cost per band = Σ round(wage × %); total; loaded = Σ raise × (1 + employer GOSI) + raise × (1/24 if < 5 years else 1/12); «لو اعتُمد الباقي» = still-pending (`done`) reviews at the same % | `statutory.ts` GOSI rates; `eos.ts:monthlyEosAccrual` | 🟡 cost ingredients only | PF-06 P1 R3 |
| Prepare proposal | HR, approved reviews exist, no proposal, money: «زيادات مقترحة على N تقييماً معتمداً: X ﷼ شهرياً — تعتمدها الإدارة دفعة واحدة» → `X5F.raiseplan` | — | ❌ | PF-06 P1 R3 |
| Management decides | mgmt panel «زيادات التقييم السنوي — X ﷼ شهرياً على N موظفاً — من <eff> · A +7 · … · أعدّها …» → «اعتمد الزيادات» `raiseok` / «أعدها» `raiseno` (proposal cleared) | — | ❌ | PF-06 P1 R3 |
| Apply raises | `raiseok`: per approved review with % > 0: `pendRaise = {basic: round(basic×(1+p)/10)×10, eff: first of next month, why}`, log; `x5Init` applies when eff ≤ today via `applyRaise` (pushes `changes`, basic, housing 25%, transport 10%; retro to last month if eff more than 14 days back); message «تدخل مسير <month>» | `employee-writes.ts:changePay` (HR manager, one employee: basic, effective date, reason, kind raise/promotion/correction; `payWithStep` keeps future steps; retro on a closed month → supplementary) — the single-employee `applyRaise` | 🟡 per-employee mechanism exists; no batch from a decision, no `pendRaise`, management cannot write it (`pay.change` = manager only), HR manager's own raise must not be applied by him | PF-06 P1 R3 · EM-04 P0 R1 |
| Today rows | HR: «N تقييماً بانتظار اعتمادك» (blue) + flagged raters by name; management: «زيادات التقييم السنوي — X ﷼ شهرياً» (amber) | — | ❌ | PF-05/PF-06 P1 R3 |
| Settings panel (policies v5) | `x5SetPanel`: offer band 90–120% (policy) · new position needs management (policy) · raise % per band · score = (100−w)% manager + w% record · required certificates text | `HrSettingsView.tsx` policies: housing/transport %, pay day, renewal window, advance limit, closeMissing | ❌ for these five | ST-01/ST-03 · HI-05 · PF-04/06 · TR-01 |

### Performance & training forms

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| `X5F.cycle` | `open` (date, default today) · `close` (date, default +30); disabled unless both and close > open; note «يدخل الدورة من أكمل ستة أشهر: N من M. المقيِّم هو المدير المباشر»; creates `CYC {n: «التقييم <year>», open, close, raise: null}` | — | ❌ | Form 27 · PF-01 P1 R3 |
| `X5F.rv` (staff review) | facts box; self-review line if any; four 1–5 ratings g · q · i · t (all required); `need` training need (select: none or a non-certificate course, optional — feeds training needs); `note` to the employee (optional); «أرسل للاعتماد» → `rv {st:'done', sc, by, at, need, note}`, HR notified | — | ❌ | Form 27 · PF-03/PF-04 P1 R3 · TR-06 |
| `X5F.self` | info «يقرؤه مديرك … ليس جزءاً من النتيجة»; four 1–5 ratings (all required); `note` highlights (optional) → `rv.self {sc, note, at}` | — | ❌ | Form 27 · PF-03 P1 R3 |
| Worker grade (`rvq`/`rvsend`) | in-sheet toggles (no form): grade 3/2/1 → draft; send N | — | ❌ | PF-02 P1 R3 |
| `X5F.pe` (probation view) | facts box; `o` grade 3/2/1 (required); `rec` confirm / extend / end (required); `note` reason (optional — «القرار لمدير الموارد البشرية»); → `e.pe {by, at, o, rec, note}`, log, HR notified (opens the probation form) | — | ❌ | EM-05 P0 R1 · PF-01 |
| `X5F.raiseplan` | table per band: count · % input (0–25, step 0.5) · SAR/month; footer: monthly wage impact · company cost incl. GOSI & EOS · «لو اعتُمدت الباقية (N) — تكلفة إضافية»; note «النِّسب سياسة شركة. الزيادة على الأساسي فتتبعها البدلات. … ولا يُعدّل مدير الموارد البشرية أجر نفسه»; disabled if total = 0; → `CYC.raise {state:'mg', eff: 1st of next month, total, n, by, at}`, management notified. NB: editing the % writes `POL.raise` live | — | ❌ | Form 27 · PF-06 P1 R3 |
| `X5F.sess` | `at` date (required, not past; public-holiday warning) · `seats` (≥ 1; default 15 for a certificate course, 8 otherwise) · `site` «من أي مكان عمل؟» (certificate courses: all or one site/workshop/warehouse/fleet) · participants pool = gaps for that cert not already in a session, worst first (missing/expired first, then earliest expiry) or review needs; untick to exclude; first `seats` taken; external & money: estimated cost N × course cost, «طلب صرف للمالية بعد الانعقاد»; disabled if no participant | — | ❌ | Form 28 · TR-03 P1 R2 |
| `X5F.sess` submit | `SESSIONS.push {course, at, site (internal: chosen or first participant's), loc (external: provider), seats, ppl, state:'plan', by}`; each workplace's supervisor notified | — | ❌ | TR-03 P1 R2 |
| `X5F.sessdone` | «الكل حضر واجتاز — ثم أزل من تغيّب»; checkbox per participant (default ticked); certificate validity shown; external & money: actual cost and charged-to cost centres; disabled if nobody attended → certificates issued, `abs`, `state:'done'`, `cost`, `pr:'req'` | — | ❌ | Form 28 · TR-04 P1 R2 |

---

#### Build notes — hiring · training · performance

**Common.** All three are new; none rides an existing screen except the tab ids already reserved in
`access.ts`. Add routes `contractor/hr/hiring` and `contractor/hr/perf` (+ supplier mirrors), append `hiring` and
`perf` to `HrShell.tsx:HR_BUILT_TABS`, make the `perf` tab label follow the switches (perf+train / perf / train),
add HR_GUARD actions (`hire.manage` manager; `hire.convert` manager+gov; `hire.batch` manager+gov;
`hire.approve` management; `perf.cycle` manager; `perf.rate` = line manager relation, not a role; `perf.approve`
manager; `perf.raise.approve` management; `train.manage` manager), Today kinds per the rows above (each must pass
`leakage()` = 0, TD-03), and the six feature reports in `reports.ts` (`hire`, `perf`, `cert`, `train` + the two
`turnover` columns). Every new decision must disappear when its switch is off (`featOfGo` in the prototype).

**Policies (ST-03 / ST-04).** Extend `statutory.ts:HrPolicies` + `resolveHrPolicies` + `HrSettingsView`:
`offerBandLow 0.9`, `offerBandHigh 1.2`, `jobApprove: BlockOrWarn = "block"`, `offerBand: BlockOrWarn = "block"`,
`raisePct {A:7,B:4,C:2,D:0}` (0–25), `recordWeight 0.2`. Add `Establishment.minPct` (Nitaqat floor) for the
Saudization panels. `hrSettings` is already written by the HR manager — no new rule block.

**Hiring data model.** `hrOpenings/{id}` `{organizationId, no (JOB-yyyy/NN from mfgCounters/hrCounters), trade,
q, siteId, need, src: 'mr'|'rep'|'new', ref (manpower request id or employee id), track: 'ind'|'batch', state:
'wait'|'open'|'filled'|'closed', filled, why, by, at, okBy, batch?: {stage: 'auth'|'test'|'visa'|'arr', agency,
nat, sel, eta, visas}}` and `hrCandidates/{id}` `{organizationId, openingId, names {ar,en}, nat, gender, src,
phone, ask, notice, stage, intAt, sc {by,at,t,x,b,rec,note}, offer {basic,start,until,ct,state:'mg'|'sent'|'acc'|
'dec', by, at, okBy}, why, employeeId}`. Money (`ask`, `offer.basic`) is pay — RL-03 says gov must not see it,
but gov converts candidates: either split the offer figures into `hrCandidatePay/{id}` (like `employeePay`) or
let gov read only non-money fields (needs a split doc — rules cannot hide fields). The candidate log/onboarding
ticks can ride the employee: `employees.onb {qiwa, gosi}` (manager/gov — widen gov's `hasOnly(['docs'…])` to
include `onb`). Files: new `lib/hr/hiring.ts` (pure: `bandOf`, `jobEta`, `jobLate`, `candMine`, `pctAfter`,
offer blocks), `lib/hr/hiring-writes.ts` (open/approve/close, candidate stages, scorecard, offer + management
approval, batch stages, convert via `createEmployee` in the same transaction), `components/hr/HrHiringView.tsx`,
`HrOpeningDetail.tsx`, dialogs; `NewEmployeeDialog` gains a `candidate` prefill prop; `LetterDocument` gains an
offer-letter type (or a print view; the offer is not a `hrLetters` doc).
*Rules:* two new collections = two blocks; the ceiling is tight — fold them into ONE collection
`hrHiring/{id}` with `kind: 'opening'|'candidate'` (same reader set hrOffice + management; writes hrManager /
hr.gov for batch & convert / hr.management for `state` wait→open and offer mg→sent) using existing helpers
`hrRole`, `hrManager`, `hrOffice`, `createsInOrg`. The apply link (HI-09, R3) needs a server route with a token
(like `api/guest-offer`), never a client write.
*Owner decisions:* (1) **Visas are spent twice** if batches are built as-is: the prototype deducts the whole
batch at «صدرت التأشيرات» and keeps an issued-visa lot by trade with an ETA that coverage reads; ours deducts one
per visa arrival in `createEmployee` and coverage reads the raw balance of any trade. Pick one: deduct at issue
and make `createEmployee` skip the deduction when the employee comes from a batch (field `openingId`), and make
`coverage()` read issued lots (by trade, with `eta`) — matching AS-02's "issued visas". (2) Manpower answers have
no "rest" choice — `coverage` writes both `hire` and `ajeer`; HI-01 needs HR to choose `hire|ajeer|xfer|none` so a
`hire` remainder opens an opening (server-side in `answerManpowerRequest`, not on render as the prototype does).
(3) Est. position cost factor 1.35 × 1.12 and the individual-track 45-day estimate are prototype constants —
confirm. (4) Line manager chain (`lineManagerOf`) lacks the senior-staff → management fallback and has no UI to
set `managerId` (RL-04) — reviews and probation views depend on it.

**Training data model.** Certificates are dated documents → ride the employee: `employees.certs {ind?: date,
hgt?: date, fa?: date}` (state from `docState`, like `docs`) — no new collection; rule: HR manager writes
(already), and add `certs` to nothing else (a session result is written by the HR manager). Requirements: pure
`lib/hr/training.ts` (`CERTS`, `reqCerts` by site type + trade keys mapped to ours: carpenter, steelFixer,
painter, plasterer, electrician, foreman; first aid: safety, foreman, warehouseSupervisor (prototype `whm` — confirm whether storekeeper too); `certGaps`, `gapBad`
with the 3-day induction grace, `nextSession`). Courses: a constant catalogue to start (prototype has no course
editor) or `hrSettings.courses`. Sessions: `hrSessions/{id}` `{organizationId, course, at, siteId|loc, seats, ppl
[employeeIds], state: 'plan'|'done', abs[], cost, pay: 'req'|'paid', by}` — new collection unless it rides
`hrHiring` (different readers: supervisors read sessions of their sites → it needs `hrSupervises`; keep it
separate but small, or store participants' sites in `siteIds[]` for an `hasAny` check). The cost request to
Finance: an `hrEvents` doc `hr:TRN:<sessionId>` (outbox already exists, Finance desk posts it — account 6109 per
WF-20) rather than a new collection. Files: `lib/hr/training*.ts`, `components/hr/HrTrainingView.tsx`, a
certificates card in `HrEmployeeFile.tsx` (docs segment) and `HrMyFile.tsx`, supervisor view on the site page or
the perf tab. *Decision:* is the training cost charged to the attendees' workplaces' cost centres (prototype) —
needs Finance's agreement.

**Performance data model.** `hrReviews/{orgId}__{cycleId}__{employeeId}` `{organizationId, cycleId,
employeeId, employeeUserId, raterEmployeeId, raterUserId, st: 'draft'|'done'|'ok'|'ack', sc ({o} worker | {g,q,i,t}
staff), self {sc, note, at}, need, note, by, at, okBy, ackAt, pip {until, by}}` — the employee reads his own only
from `ok` (rules: `employeeUserId == auth.uid && st in ['ok','ack']`), the rater reads/writes his team's while
`draft`/`done` and the cycle is open, HR manager everything; management reads. Cycle + raise proposal on
`hrSettings` or `hrCycles/{orgId}__{year}` `{n, open, close, raise {state:'mg'|'ok', eff, total, n, pct, by,
okBy}}` (pct frozen in the proposal — the prototype's live `POL.raise` mutation should not be copied). The
probation view: `employees.probation.view {by, at, o, rec, note}` written by the line manager (rule: a narrow
`hasOnly(['probation'])` path for `lineManagerOf`) or on the review doc with `kind: 'probation'` — the latter
avoids widening the employees rule. Raises: management approval writes a future `employeePay.steps` entry per
employee — `pay.change` is manager-only and RL-02 forbids the HR manager raising himself, so either the approval
transaction runs as management with a dedicated rule (`hr.management` may append a step whose `from` = the
cycle's `eff` and whose basic = the frozen %) or management's approval leaves `ok` and the HR manager applies
the batch through `changePay` (his own line excluded, owner flagged). The first keeps "one decision". Score/
band/plan pure in `lib/hr/performance.ts` (`rvScore`, `attScore` from closed `hrAttendance` + applied
`hrViolations` + `hrInjuries`, `raters`, `raisePlan` with `monthlyEosAccrual`/GOSI). Rules: one new block
(`hrReviews`, cycle on `hrSettings`) — fold the rater check into a helper; cost ~1 block.

<!-- slice 6-set-rep-sim -->
# Slice 6 — Tab bar · Settings · Build path · Reports · Simulator · Demo shell

Sources read: proto.html `TABS` 1008, `ROLES` 509, `USERS` 794, `PROF`/`NEWPROF` 582–610, `FEATS/STRICTS/CTYPES/FDEF/FWHY` 1719–1727,
`VIEWS.set` 1241–1261, `nitaqatPanel` 997, `x5SetPanel` 2222, `x6FeatPanel`/`PFS` 2236–2246, forms `firm/site/pol/user` 1374–1377 · 1461–1467 · 1563–1566,
`buildSteps/buildPanel/gapsPanel/clipped` 955–990, `todayNew` 1105, `persist/restoreNew/jumpMonth` 943–953, `REPORTS` 1204 + 2214–2221 + 2366, `VIEWS.rep` 1237,
report/wps/gosi forms 1514–1519 + `d.dl` 1706, `simItems/simDo/renderSim` 1598–1629, `x5Sim/X5S` 2224–2228, `x6Sim` 2315, `renderIntro` 1631, `shell` 1648,
`renderUsers` 1664, `selfTest` 2585, `x5SelfTest` 2233.
Ours: `lib/hr/access.ts`, `components/hr/HrShell.tsx`, `hooks/useHrAccess.ts`, `lib/hr/settings.ts`, `settings-writes.ts`, `statutory.ts`, `sites.ts`, `site-writes.ts`,
`components/hr/HrSettingsView.tsx`, `HrSitesView.tsx`, `lib/hr/build-path.ts` + `components/hr/HrTodayView.tsx` (build/gaps panels), `lib/hr/reports.ts`,
`components/hr/HrReportsView.tsx`, `lib/hr/payroll.ts:mudadCsv/gosiCsv`, `lib/hr/manpower.ts`, `lib/hr/finance-writes.ts`, `lib/hr/exit-writes.ts`,
`components/accounting/FinanceHrDesk.tsx`, `components/inventory/HrCustodyDesk.tsx`, `components/projects/ProjectManpowerPanel.tsx`, `lib/permissions.ts`,
`firestore.rules` `hrSettings`, tests in `src/__tests__/hr-*.test.ts` + `render-hr-roles.test.tsx`, `messages/{en,ar}.json` `Portal.HR`.

---

### Tab bar — prototype matrix

Prototype rules (`TABS()` 1008, one role per user):
- `emp` → only `me` «ملفي» (return early).
- `today` «اليوم» for every other role · count = `decisions().length` (shown even when 0).
- `people` «الموظفون» for hr/gov/pay/mgmt · count = `active().length`.
- `sites` (label = `PROF.siteWord`) for hr/sup/mgmt/pay · count = `MREQ.state==='new'` (hidden when 0).
- `att` «الحضور» if `FEAT('punch')` for hr/pay/mgmt · count = punch exceptions (non-bench) + pending `attfix` requests.
- `pay` «الرواتب» for hr/pay/mgmt · count = payrolls in `draft`.
- `hire` «التوظيف» if `FEAT('hire')` for hr/gov/mgmt · count = JOBS open|wait.
- `pf` «المنصات» if `FEAT('gov')` AND (role gov, OR role hr when NO user holds gov) · count = `govTasks()` late.
- `grow` if `FEAT('perf')||FEAT('train')` for hr/sup/mgmt · label «الأداء والتدريب» (both on) / «الأداء» (perf only) / «التدريب» (train only) · count only for hr = reviews in `done` (awaiting approval).
- `rep` «التقارير» for hr/pay/mgmt/gov (no count).
- `set` «الإعدادات» for hr only.
- `me` «ملفي» for every non-emp user whose `CU().e` resolves to an employee · count = own `REQ` pending.
- Shell: `if(!T.some(t=>t[0]===TAB))TAB=T[0][0]`; switching user resets `TAB='today'` (TD-01).

Default features (`FDEF`, `POL.feat`): con & sup = hire·train·punch·gov·mudad on, perf off; dev = hire·perf·punch·gov·mudad on, train off; new = all six off.
`siteWord`: con «المواقع»/Sites · sup «الفروع والمستودعات»/Branches & warehouses · dev «الإدارات والمشاريع»/Departments & projects · new «أماكن العمل»/Workplaces.
Users: con/sup/dev = u1 hr(e1) · u2 gov(e2) · u3 pay(e3) · u4 sup(e4, site = SITES[0]) · u5 emp(e5) · u6 mgmt(e6) (+ `x5Init` inserts u7 = a second `emp` on an app-punch workplace).
new = u1 hr (no employee record) · u6 mgmt (no record) only; gov/pay/sup/hr are added later through the `user` form (no `emp` option).

| Role \ company | con «المواقع» | sup «الفروع والمستودعات» | dev «الإدارات والمشاريع» | new (all features off, until a business type is chosen) |
|---|---|---|---|---|
| hr | today(n) · people(n) · sites(new MR) · att(ex) · pay(draft) · hire(open) · grow «التدريب» · rep · set · me(pending) — no `pf` (a gov user exists) | same as con | today · people · sites · att · pay · hire · grow «الأداء»(done reviews) · rep · set · me | today · people · sites «أماكن العمل» · pay · rep · set — no `me` (u1 has no record until the `user` form adds an hr member, which links u1). After choosing a type: + att, hire, grow, **pf (no gov user yet)** per FDEF |
| gov | today · people · hire · pf(late) · rep · me | same | same | (only once added) today · people · rep · me (+hire/pf when on) |
| pay | today · people · sites · att · pay · rep · me | same | same | (only once added) today · people · sites · pay · rep · me (+att) |
| sup | today · sites · grow «التدريب» · me | same | today · sites · grow «الأداء» · me | (only once added) today · sites · me (+grow) |
| mgmt | today · people · sites · att · pay · hire · grow «التدريب» · rep · me | same | … grow «الأداء» … | today · people · sites · pay · rep (no `me`: u6 has no record) |
| emp (u5, u7) | me | me | me | — (no emp user possible) |
| staff user's «ملفي» | every non-emp user above with a record gets `me` + own pending count | same | same | only users added via `user` form (each becomes an employee) |

### Tab bar — ours vs prototype

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Role model | One role per demo user (`USERS[].role`) | `access.ts:hrRolesOf` — roles from the DEFAULT group's permissions (`employees.manage`→manager, `hr.gov`, `hr.payroll`, `hr.supervisor`, `hr.management`); owner or `'*'` = manager + management; tabs = union of held roles (`hrTabs`) | ✅ (multi-role union is a superset) | RL-01 P0 R1 |
| Employee role | `emp` → `['me']` only | No HR role + linked `employees.userId` → `['me']`; no record and no role → `EmptyState no_record_desc` | ✅ | ES-00 P0 R1 |
| Today first / land on first tab | `TAB=T[0][0]` if current tab not held; user switch → today | `HrShell` redirects `today` → first tab when Today not held | ✅ | TD-01 P0 R1 |
| `people` roles | hr/gov/pay/mgmt | `ROLE_TABS`: manager/gov/payroll/management | ✅ | RL-01 P0 R1 |
| `sites` roles | hr/sup/mgmt/pay | manager/payroll/supervisor/management | ✅ | RL-01 P0 R1 |
| `att` tab | punch on; hr/pay/mgmt | `attendance` in manager/payroll/management, `TAB_FEATURE` punch — but **not in `HR_BUILT_TABS`**, never shown | ❌ (not built) | AT-* · optional: punch · R2 |
| `pay` roles | hr/pay/mgmt | manager/payroll/management | ✅ | RL-01 P0 R1 |
| `hire` tab | hire on; hr/gov/mgmt | `hiring` manager/gov/management + `TAB_FEATURE` hire; not built | ❌ (not built) | HI-* P1 · optional: hire · R2 |
| `pf` «المنصات» rule | gov on AND (role gov OR (role hr AND no user holds gov)); **mgmt never** | `platforms` in manager, gov AND **management** unconditionally (feature gov); not built | 🟡 rule differs: (1) management gets platforms in ours, not in the prototype; (2) the HR manager gets it always, the prototype only when nobody holds gov. Latent until the tab is built | GV-02 P1 · optional: gov · R2 |
| `grow` tab | perf‖train; hr/sup/mgmt | `perf` manager/supervisor/management, perf‖train; not built | ❌ (not built) | PF-*/TR-* · optional: perf/train · R2/R3 |
| `grow` label variants | «الأداء والتدريب» / «الأداء» / «التدريب» by which feature is on | `Portal.HR.tab.perf` fixed "Performance & training" / «الأداء والتدريب» | 🟡 no variant label (add `tab.perf_only`, `tab.train_only`) | ST-02 P0 |
| `rep` roles | hr/pay/mgmt/gov | manager/gov/payroll/management | ✅ | RP-01 P1 R1 |
| `set` roles | hr only | manager only (`settings.manage`) | ✅ | ST-01 P0 R1 |
| `me` for staff | every non-emp user with `CU().e` | `if (ctx.employeeId) set.add("me")` — any role with a linked record | ✅ | ES-00 P0 R1 |
| Sites tab label per company | `P2(PROF.siteWord)` — 4 wordings (con/sup/dev/new); also `TT.sites` title, Today sitesPanel title, People segment «sites» | `tab.sites` fixed «مواقع العمل» / "Workplaces" whatever `settings.businessType` | 🟡 no per-business-type wording (contractor «المواقع», supplier «الفروع والمستودعات», developer «الإدارات والمشاريع», none «أماكن العمل»). Note ours' Arabic «مواقع العمل» matches none of the four | ST-06 P1 |
| Supervisor role label per company | `PROF.supWord`: مشرف عمالة / مشرف مستودع / منسّق إدارة / مشرف مكان العمل | one label for `hr.supervisor` | 🟡 (cosmetic; same treatment as siteWord) | RL-01 |
| Tab counts | today = decisions (always), people = active, sites = new manpower requests, att = exceptions+attfix, pay = drafts, hire = open jobs, pf = late tasks, grow = reviews awaiting (hr), me = own pending | `HrShell` builds `ModuleTab` without `count` (ModuleHeader supports `count`/`urgent`) | ❌ no counts on any tab | TD-04 P1 R1 (numbers = screens) |
| Feature off hides tab | `FEAT(k)` in TABS | `TAB_FEATURE` in `hrTabs` | ✅ | ST-02 P0 R1 |
| All features off = core | `x5SelfTest.featuresOffRestoreCore`: today,people,sites,pay,rep,set | `hr-access.test.ts` "all features off leaves the core" | ✅ | ST-02 P0 |
| Built-tab filter | n/a (all built) | `HR_BUILT_TABS` = today, people, sites, payroll, reports, settings, me — a con company (defaults on) shows the same 7 as a new one | 🟡 by design until R2; Settings says "screens arrive in a later release" for hire/perf/train/punch/gov | — |
| Features with no settings doc | non-new companies start with `FDEF[CO]`; new = all off | no `hrSettings` doc → `features: []` for every company until the business type is picked | 🟡 every company behaves as `new` until settings are saved (acceptable; owner decision whether existing tenants get defaults by business type) | ST-05/06 P1 |
| Per-role Today subtitle | `TODAYSUB[role]` (5 texts) | `tab_desc.today` single text | 🟡 (minor; see Today slice) | TD-01 |

### Settings

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Settings visible to | hr only (`set` tab); non-hr would see pills instead of buttons | manager only; inputs `disabled` when `!settings.manage` | ✅ | ST-01 P0 R1 |
| Policies panel — statutory read-only | `pol` rows not marked «سياسة شركة»: annual leave 21/30 · OT hourly+50% basic (240 h) · hours 8/48, Ramadan 6, Friday rest · OT ceiling 720 h/yr (60/mo) · GOSI Saudi 9.75%+11.75% · non-Saudi 2% · EOS ½×5 then 1, resignation ⅓/⅔/full · iqama after arrival `POL.iqamaGrace` 90 d · advance instalment 10% · sick 30/60/30 · probation 90→180 · fines cap 5 days · public holidays 2026 | `HrSettingsView` "Statutory — read-only": overtime (share, divisor, 60 h cap) · GOSI old/new/non-Saudi · leave · sick · probation · EOS · advance · penalty (cap + 15-day objection) · hours (8 / Ramadan 6) · holidays of the year | 🟡 missing rows: 48-hour week + Friday rest, iqama-issue 90 days (`STATUTORY.iqamaIssueDays` exists, not shown), OT yearly 720 wording | ST-01 P0 R1 |
| Company policy: HR advance limit | `POL.advMax` months (form step 0.5, min 0; «فوقه المدير المالي») | `policies.advanceMaxMonths` (0 < x ≤ 12; input step 1) | 🟡 input `step="1"` while the resolver accepts fractions — 0.5 month cannot be typed | ST-01 · LV/AV P0 R1 |
| Company policy: pay day | `POL.payDay` 1–10 «حماية الأجور تراقب التأخير» | `payDay` 1–28 | ✅ (range wider) | ST-01 P0 |
| Company policy: renewal window | `POL.renewWin` min 15 | `renewWindowDays` 1–365 | ✅ | ST-01 / DC P0 |
| Company policy: temporary labour (Ajeer) | `POL.ajeer` allowed/not + `POL.ajeerX` cost multiplier (×1.4) — read by coverage | none in settings; `manpower.ts:COVERAGE.ajeerLeadDays 45, ajeerCostFactor 1.4` hard-coded, Ajeer always offered | ❌ policy not editable; "not allowed" impossible | AS-02 P0 R1 (policy table: Policy) |
| Company policy: housing/transport allowance | not a policy (fixed 25%/10% in `mk`) | `housingShare` 25%, `transportShare` 10% editable | ✅ (ours adds) | — |
| Lateness grace | `POL.grace` 15 min, per workplace (`X5F.am` `grace`) | — | ❌ | AT/PT P1 · optional: punch · R2 |
| Attendance corrections | `POL.fixMax` 3/month · within 7 days · line manager approves | — | ❌ | PT P1 · optional: punch · R2 |
| Offer band | 90–120% of trade wage (display) | — | ❌ | HI-05 P1 · optional: hire · R2 |
| New position approval | text row (`x5SetPanel`) + strict `jobApprove` | — | ❌ | HI-01 · optional: hire · R2 |
| Review raises A/B/C/D % | `POL.raise` {A:7,B:4,C:2,D:0} (edited in `X5F.raiseplan`) | — | ❌ | PF-06 P1 · optional: perf · R3 |
| Review record weight | `POL.rvW` 20% | — | ❌ | PF-04 P1 · optional: perf · R3 |
| Required certificates | induction (3-day grace) / height / first-aid by trade & place (text) | — | ❌ | TR-01 P1 · optional: train · R2 |
| Ramadan hours dates | `RAM.from–to`, six hours for everyone (no religion recorded) | `STATUTORY.ramadanHours 6` + calendar (`hr-calendar.test.ts`); dates not shown in settings | 🟡 dates not displayed | AT-06 |
| Block or warning — closeMiss | `STRICTS.closeMiss` toggle «مانع / تنبيه فقط» | `policies.closeMissing` select block/warn | ✅ | ST-03 P1 R1 · AT-04 P0 |
| Block or warning — jobApprove, offerBand | toggles | — | ❌ | ST-03 P1 · optional: hire · R2 |
| Policy change is logged | PRD: "policy is editable and logged" (proto: toast only) | `settings-writes.ts` stamps `updatedAt/updatedBy`; no previous value kept | 🟡 no change log (who, when, from → to) | ST-01 · §Policies note |
| Policies "confirmed" | `pol` form «اعتمد السياسات» sets `FLAGS.polOk` (build step) | build step done = `settingsDocExists` (any save) | 🟡 see Build path | ST-05 |
| Features panel «ما تستعمله من الوحدة» | 6 rows (`FEATS` name + `FEATS[k][2]` explanation), toggle «✓ مفعّلة / مطفأة» for hr, pill for others; sub "off hides tab & decisions; data kept" | `HrSettingsView` features panel: 6 switches with `feature_desc`, "screens arrive in a later release" on hire/perf/train/punch/gov | ✅ | ST-02 P0 R1 |
| Per-feature default label | «افتراضي: مفعّلة / مطفأة» from `FDEF[ct]` | — | ❌ | ST-06 P1 R1 |
| Default-at-sale explanation | `FWHY[ct]` one line per business type (con: site labour → safety, punches, platforms first; sup: shift warehouses & fleet; dev: office staff → performance & hiring) | `settings.type_note` generic | ❌ | ST-06 P1 |
| «أعد إلى الافتراضي» reset | shown when any feature ≠ `FDEF[ct]`; `X5A.featdef` assigns defaults | — (`defaultFeatures(type)` exists, unused by UI after first choice) | ❌ | ST-06 P1 R1 |
| Business type sets defaults once | `firm` submit: `if(CO==='new'&&d.ctype&&!FIRM.ctype){FIRM.ctype=…;POL.feat=FDEF}`; later changes only the type | `settings.ts:withBusinessType` (`defaultsAppliedFor`) | ✅ | ST-06 P1 R1 |
| Business types | `CTYPES` con «مقاول» · sup «مورّد مواد» · dev «مطوّر عقاري» | `BUSINESS_TYPES` contractor · supplier («Supplier / factory») · developer; null = not chosen | ✅ | ST-06 |
| Platforms you follow «الجهات التي تتابعها» | only when gov on; `PFS` qiwa · mudad · gosi · muqeem · chi · traffic · hrdf with their outputs; `POL.pf` default all on, hrdf off; `X5A.pfx` toggles | — | ❌ | GV-03 P1 · optional: gov · R2 |
| Establishment file form (`firm`) | name ar + en · CR · Qiwa establishment no. (`mol`) · GOSI no. · **Mudad no.** · **Nitaqat band** g/y/r · **green threshold %** (`minPct`) · visas («صفر يمنع تسجيل وافد جديد») · business type (new only); save needs name+CR+mol | name (one language) · CR · MOL · GOSI · visas + `visasAsOf` · business type | 🟡 missing English name, Mudad number (the prototype prints it in the WPS file), band, green threshold, band as-of | ST-04 P1 R1 |
| «ملف المنشأة» panel (`nitaqatPanel`) | band pill · Saudi ratio computed from the record (`sa of active`) · green threshold · safety margin («ينقص N سعوديين» / «يمكن أن تفقد N») · CR·MOL·GOSI · visas «آخر تحديث» | none (only the Saudization report; `saudi_below_nitaqat` warning on a new employee) | ❌ | ST-04 P1 R1 |
| Visa use on arrival | `FIRM.visas` decremented by a visa arrival | rules: gov may decrement `establishment.visas` by exactly 1; done in the employee create transaction | ✅ | HI-07 / EM P0 |
| Workplace creation (`site` form) | name ar/en · kind prj/ws/wh/fleet/shop/dept/hq with cost account 5102/5107/6108/6108/6108/6101/6101 · project end date REQUIRED for prj («يُقرأ من إدارة المشاريع في المنتج») · «يعمل بورديات» for wh/ws/fleet | `HrSitesView` + `site-writes.ts:saveSite`: name (one) · `SITE_TYPES` (same 7) · `costKindOf` (direct/workshop/distribution/admin) · project REQUIRES a linked `projectId` · `endDate` optional, typed · supervisor user picker · `setSiteActive` | 🟡 end date typed by HR and optional instead of read from the project; no English name; no shifts flag (punch R2) | AS-01 P0 R1 · AS-02 |
| Shifts per workplace (`X5F.shifts`, `shiftset`) | m/e/n shifts with times, night spans midnight | — | ❌ | optional: punch · R2 (attendance slice) |
| Attendance source per workplace (`X5F.am`) | sup sheet / device / app + geofence radius + grace | — | ❌ | optional: punch · R2 (attendance slice) |
| Team member (`user` form) | role gov/pay/sup/hr · name ar/en · nationality · supervised site (sup) · basic → creates the EMPLOYEE and the USER with that role in one step; hr member links u1; Saudi-only trade guard | Build-path "team" → `/{portal}/team` (invite + default group; seeded HR groups `lib/permissions.ts`, `scripts/migrate-hr-seed-groups.js`); employee created separately and linked (`employee.edit` link) ; supervisor chosen on the workplace | 🟡 two places instead of one form; no Saudi-only check on the role's trade | RL-01 P0 R1 · ST-05 |
| Roles panel «الأدوار» | the six roles with description and «يرى الأجور / بلا أجور» | none in HR settings (team page shows permissions by section) | ❌ (read-only reflection; cheap) | RL-01/03 |
| Design notes (boundaries own/read/never, events we send, conflicts, not in this version) | collapsible `details` panel — prototype documentation | — | ❌ prototype-only (owner decision: keep out of product) | — |
| Line manager on the card (`X5F.mgr`) | sets `e.mgr` | employee slice (`managerId`) | n/a here | RL-04 P1 |

### Build path (new company)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Where it shows | `todayHr` → `todayNew()` replaces the HR manager's Today when `CO==='new'` and not every step done | `HrTodayView` side column when `settings.manage` and `done < 10` — any company, beside the decision groups | 🟡 not limited to a new company (fine for migrating tenants); does not replace Today | ST-05 P1 R1 |
| New-company KPIs | Employees (n, present today, unassigned) · `siteWord` count + names · Payroll last net + state, "current month · today" | `useHrTodayKpis` (role KPIs) | 🟡 no build-time KPI set | TD-04 / ST-05 |
| Panel header | «بناء العملية من الصفر» · «N من 10 — الحالة من السجل لا من مربّع» | `today.build_title` "Moving in — the build path" · `build_note` {done}/{total}, count badge = remaining | ✅ | ST-05 |
| Step 1 firm | done `!!FIRM.name` (form requires name+CR+MOL) · go `form:firm` | `establishment` done = name + CR + businessType → Settings | 🟡 requires business type, not MOL | ST-05 · ST-04 |
| Step 2 site | done `SITES.length>0`, count | `sites` done active site > 0, count → Sites | ✅ | ST-05 |
| Step 3 pol | done `FLAGS.polOk` (explicit «اعتمد السياسات») | `policies` done = `settingsDocExists` | 🟡 any save (e.g. picking the type) ticks it; no explicit confirmation | ST-05 |
| Step 4 team | done `USERS.length>2 || FLAGS.teamOk`, count users → `form:user` | `team` done = members (owner aside) holding an HR role > 0, count → `/team` | ✅ (different target, same meaning) | ST-05 |
| Step 5 emp | done active > 0, lock no site → `form:newemp` | `employees` done, locked without a site → People (`step_go` "New employee or import") | ✅ | ST-05 · IM-01 |
| Step 6 att | done someone recorded today / att p>0, lock no employee → sites | `attendance` done = any sheet day/declaration, or everyone in an office (assumed presence) | ✅ | ST-05 · AT-02 |
| Step 7 docs | non-Saudis all have iqama or `arrived` → People «docs» segment | iqama or `source==='visa'` → People | ✅ | ST-05 |
| Step 8 close | all sites closed for last month & someone employed then; else button «انتقل إلى أول الشهر القادم (عرض)» (`do:jump`) | `close` via `sitesToClose`; locked when nobody was employed last month | ✅ (demo jump not applicable) | ST-05 · AT-04 |
| Step 9 pay | done main payroll `sent|paid`; lock until closed → Payroll | done main payroll `state !== prepared`; locked until close done | ✅ | ST-05 · PY-01 |
| Step 10 files | done a paid payroll; lock until sent → Reports | `files` done paid; locked until approved → Reports | ✅ | ST-05 · PY-07 |
| Step row UI | done → «تمّت» + «أضف» on site/team/emp; locked → «بعد ما قبلها»; next step highlighted `btn-c` | done pill; locked text; next step `variant=default`; no «أضف» on done rows | 🟡 no "Add another" on done site/team/employee steps | ST-05 |
| Demo tools in panel | «انتقل إلى أول الشهر القادم — أداة عرض» (`jumpMonth`) · «ابدأ من جديد» (`data-reset`) · «محفوظ في هذا المتصفح فقط» | — | n/a (prototype-only) | — |
| Gaps «ما تبيّن ناقصاً» | header + "updated with every step" | `today.gaps` panel, shown while moving, `shown(…,6)` + more | ✅ | ST-05 P1 |
| Gap: workplace without supervisor | non-hq/dept site with no `sup` user | `site_no_supervisor` (non-office, no `supervisorUserId`) | ✅ | ST-05 |
| Gap: non-Saudi without iqama/arrival | yes | `no_iqama` | ✅ | ST-05 |
| Gap: no IBAN | every employee without `ibanNo` | `no_iban` (pay roles only — the builder has pay) | ✅ | ST-05 |
| Gap: no payroll officer / no gov officer | yes / yes (only if a non-Saudi exists) | `no_payroll_officer` / `no_gov_officer` (same condition) | ✅ | ST-05 |
| Gap: HR manager not on the record | u1 has no `e` | `manager_not_on_record` (viewer is manager, no `employeeId`) | ✅ | ES-00 |
| Gap: shifts to define | a site with `shifts` | — | ❌ optional: punch R2 | — |
| Gap: unrecorded days paid as worked | per employee: last month's recorded days < expected after a payroll exists → «دُفعت كأيام عمل لأن غير المسجَّل ليس غياباً» | — | ❌ | ST-05 · AT-04 (warn mode) |
| Fixed "model notes" in gaps | 6 notes (import added, close block added, users belong to Governance, chart of accounts from Finance, projects from Projects, line manager) | — | n/a (prototype documentation) | — |
| Prev-month close panel | `attClosePanel()` when last month open | close items in Today decisions (`close_month`) | ✅ (Today slice) | AT-04 |
| `clipped` «عرض N أخرى / أقلّ» | generic show-more toggle | `shown()` + `moreButton()` in `HrTodayView` | ✅ | TD-02 |
| Tests | — | `hr-build-path.test.ts` (10 steps, locks, order, gaps) | ✅ | — |

### Reports

Prototype gating (`VIEWS.rep`): `(!r.money||moneyOk()) && (!r.roles||r.roles.includes(ROLE())) && (!r.feat||FEAT(r.feat))`; card = title, description, `N سطراً`, «بالريال» if money.
Ours (`reports.ts:visibleReports`): `reports.view` (manager/gov/payroll/management), money → `pay.view`, `roles` narrower; no `feat` (optional reports not built).

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| `emp` كشف الموظفين | No·Name·Trade·Nat·Workplace·Joined·Status (active/leave/leaving); money 0 | `register` same 7 columns | ✅ | RP-02 P1 R1 |
| `att` الحضور الشهري | No·Name·Workplace·Present·Absent·Leave·OT(h) — closed last month | `attendance` + Sick column; office = assumed presence less exceptions | ✅ (matches PRD incl. sick) | RP-02 |
| `cost` تكلفة العمالة بمركز التكلفة (money) | Cost centre·Account·Employees·Gross·Employer GOSI·**EOS accrual**·Cost·Per head (last main payroll) | `cost`: Site·Account·Headcount·Gross·Employer GOSI·Cost·Per head (cost = gross + GOSI) | 🟡 no EOS-accrual column (ours follows the PRD's columns; the prototype adds it) — owner decision | RP-02 · AS-04 |
| `docs` الوثائق المنتهية والقادمة | No·Name·Document·Expires·State·Workplace — ≤ 90 days | `documents` + Days left; Saudi iqama excluded | ✅ | RP-02 |
| `leave` أرصدة الإجازات (money) | No·Name·Service·Accrued·Taken·Balance·Liability (wage/30) sorted by balance | `leave` same (+ opening balance) | ✅ | RP-02 |
| `eos` مخصص نهاية الخدمة (money) | No·Name·Service·Wage·Termination·Resignation·Monthly accrual | `eos` same | ✅ | RP-02 |
| `adv` السلف القائمة (money) | No·Name·Principal·Balance·Instalment·Months left | `advances` same | ✅ | RP-02 |
| `pen` سجل الجزاءات (money) | No·Name·Violation·Incident·Hearing·**Penalty text** (`penTx`)·Amount·State (in force/objected/cancelled) | `penalties`: … ·**Step (number)**·Amount·State (applied/objected/upheld/cancelled) | 🟡 shows the ladder step number, not the penalty («إنذار كتابي», «خصم يوم», …) | RP-02 · PN P0 |
| `nit` التوطين بالمهنة | Trade·Saudis·Non-Saudis·Ratio·Localized | `saudization` + Headcount | ✅ | RP-02 |
| `turn` الالتحاق والخروج | No·Name·Event (joined/resigned/terminated)·Date·Trade·Workplace — 90 days | `movement` + Reason (exit reasons) | ✅ | RP-02 |
| `hire` الشواغر والمرشحون | roles hr/mgmt/gov, feat hire: No·Opening·Qty·Joined·Needed·Expected·Late(d)·Candidates | — | ❌ | RP-02 · optional: hire · R2 |
| `perf` نتائج التقييم | roles hr/mgmt, feat perf: No·Name·Workplace·Rater·Score·Band·Attendance·Status | — | ❌ | RP-02 · optional: perf · R3 |
| `cert` الشهادات وانتهاؤها | feat train: No·Name·Trade·Workplace·Certificate·Expires·Status (missing/expired/valid/expiring) | — | ❌ | RP-02 · optional: train · R2 |
| `train` بيانات الإفصاح عن التدريب | feat train: Course·Date·Provider·Trainees·Saudis·Hours·Cost (cost `•••` without pay) | — | ❌ | RP-02 · TR-06 P2 · optional: train · R2 |
| `late` التأخير واستثناءات البصمة | feat punch: No·Name·Workplace·Source·In today·Late today (min)·Late count this month | — | ❌ | RP-02 · optional: punch · R2 |
| `turn` (2nd) دوران العمالة وسدّ الشواغر | roles hr/mgmt: Workplace·Headcount·Joined 90d·Leaving·Est. annual turnover %·**Open positions**·**Oldest opening (d)**. NB prototype bug: duplicate id `turn` — this card opens «الالتحاق والخروج» (`RP` finds the first) | `turnover` (roles manager/management): first five columns | 🟡 open positions + oldest opening missing (need hiring) | RP-02 · optional: hire (last two columns) |
| `org` الهيكل | No·Name·Trade·Workplace·Line manager·Source (set/derived) | `structure` + source "management" when none | ✅ | RP-02 · RL-04 |
| `roster` جدول الورديات | feat punch: No·Name·Trade·Workplace·Shift·From·To(+1)·2nd shift today | — | ❌ | RP-02 · optional: punch · R2 |
| Report preview | modal table, first 15 rows + «يُعرض 15 من N — الباقي في الملف», numbers right-aligned | full table in a Panel, back button, `?report=` deep link | ✅ | RP-01 P1 |
| CSV download | `csvOf` BOM + all cells quoted; file `${id}-${date}.csv`; raw numbers | `reportCsv` BOM, quoted when needed, CRLF; `hr-${id}-${today}.csv`; money `toFixed(2)`, enums translated | ✅ | RP-01 · NF import/export |
| Money hidden | `money` reports filtered by `moneyOk()` | `visibleReports` + `pay.view` | ✅ | RL-03 P0 |
| Footer note | «التقارير تُقرأ من السجل الحيّ…» | `rep.note` / `rep.note_no_pay` Callout | ✅ | RP-01 |
| Mudad/WPS card | «ملف حماية الأجور — أغسطس» for **every** report reader (no `moneyOk` check — gov sees nets: prototype leak) → preview: Mudad no. + period note, first 8 rows (employee·ID · bank·IBAN · basic · housing · other · deductions · net), bounced rows red, held count, total net; CSV `id,name,bank,iban,basic,housing,other,deductions,net,establishment,period`; `WPS-m(-D).csv` | money roles only; last main payroll not `prepared`; direct download `mudadCsv`: `id_no,name,iban,basic,housing,other_earnings,deductions,net`; no preview; supplementary file only from the Payroll screen | 🟡 no preview/totals; CSV lacks **bank**, **establishment (Mudad no.)**, **period** columns (PRD lists bank) | PY-07 P0 R1 · RP-02 |
| GOSI statement card | money only; preview: Saudis rows (base, employee, employer) + non-Saudi 2% line, total = 2107, rate note; CSV `no,name,nat,base,employee,employer`; held lines and non-main excluded | money only; `gosiCsv`: `id_no,name,nationality,scheme,base,employee,employer,total`; all lines (held included); no preview | 🟡 no preview / "= GOSI payable" total; held-line treatment differs (owner decision) | PY-07 P0 R1 |
| Tests | `selfTest` none for reports | `hr-reports.test.ts` (role gating, columns, each report), `render-hr-roles.test.tsx` reports | ✅ | — |

### Simulator / other modules

The prototype's «محاكاة الوحدات الأخرى» (`simItems` → `renderSim`, panel shows groups pm/inv/sal/fin/mfg ONLY — `web` and `dvc` items are counted in `simN` but never rendered: prototype bug). In the product each event must come from its module's own screen.

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| `nmr` new manpower request (from `PROF.mrMod`: Projects for con/dev/new, **Inventory** for sup) | `MREQ.unshift({no ط.ع-2026/0NN, site, trade, q, from, by, state:'new'})` + notify hr → `form:mr` | Projects: `ProjectManpowerPanel` → `manpower.ts:raiseManpowerRequest` (`manpowerRequests`), HR answers in `HrManpowerPanel` (`manpower.answer`), Today row `kind: manpower` source project-management | 🟡 no Inventory/warehouse origin for a supplier company (warehouse/branch staffing) | AS-02 P0 R1 · WF-12 |
| `ack` Projects accepts the plan | `MR.ack=1`; until then HR's «عند وحدة أخرى» lists «ردّنا على … — قبول الخطة» | `state: open → answered | withdrawn`; no acceptance, no wait row | ❌ | AS-02 · TD-03 |
| `ext` Projects extends a site end (+40 d) | `ST.end += 40` — coverage sources change | `hrSites.endDate` typed by HR in `HrSitesView`; not read from the project, no event | 🟡 (end date not read from Projects) | AS-02 P0 · "projects are read from Projects" |
| `paid` Finance posts & pays the payroll | `py.state='paid'`, `paidBy` | `FinanceHrDesk` → `postHrEvent` (hr:PAY/hr:EOS, state `posted`) → `recordPayrollPaid` (payslips + `hr_payslip_ready`) | ✅ | PY / Finance contract P0 R1 |
| `reissue` Finance re-issues fixed transfers | `iban 'fixed' → 'ok'` + log | `markReturned` → payroll `fixIban` → `approveIban` → `payHeldLine` (FinanceHrDesk) | ✅ | PY-03 P0 · RL-02 |
| `finadv` Finance decides an above-limit advance | ok → `e.adv` scheduled / no → declined | `request-writes.ts:financeDecideAdvance` (state `finance`, `financeHold`) + `payAdvance` in FinanceHrDesk | ✅ | AV P0 R1 |
| `fspaid` Finance pays the settlement | `exit.paid=1` + notify gov «الخروج النهائي» | `finance-writes.ts:paySettlement` + `hr_settlement_paid` to gov | ✅ | EX-04 P0 · WF-16 |
| `cust` Inventory clears custody | `exit.custody=0` + notify hr «أعدّ المخالصة» | `/x/warehouses/custody` `HrCustodyDesk` → `exit-writes.ts:clearCustody`; Today wait row `wait_custody` (no button) | ✅ | EX-03 P0 R1 |
| `xatt` workshop attendance arrives from Manufacturing (`site.ext:'mfg'`) | `ATT[CURM][ws].thru = yesterday` | — (workshop is an ordinary HR workplace; its supervisor records the sheet) | ❌ (design conflict #5 in the prototype says attendance is ONE record here — owner decision) | AT · boundary |
| `wsabs` Manufacturing reports a workshop absence | `e29.today='a'`, absence counted | — (`mfgStops` are capacity hours, not attendance) | ❌ owner decision | AT · boundary |
| `comm` Sales approves commissions → payroll | `commOk=1` for all `e.comm` (sup company) | `employee-writes.ts:commissionBlocks/record commission` — the HR manager records it with Sales' reference; no Sales-side approval/event | 🟡 no event from Sales | PY-01 · Sales boundary |
| `apply` candidate via apply link (`web`) | `CANDS.push(stage new, src link)` + notify hr | — | ❌ | HI-09 P2 · optional: hire · R2/R3 |
| `trainpaid` Finance pays a training cost | `session.pr='paid'` | — (the `hr:PR` fee path `payFeeRequest` exists for document fees) | ❌ | TR-04 P1 · optional: train · R2 |
| `devpush` a device pushes punches (`dvc`) | device workplaces receive punches | — | ❌ | optional: punch · R2 |
| `gosipaid` Finance pays the GOSI bill | `PY.gosiPaid=0` (prototype bug: sets falsy, item never clears) | — (no GOSI payment record in Finance's HR desk) | ❌ | PY-09 P1 R1 |
| Rule: HR has no button for another module's act | `selfTest.leakage` counts HR decisions whose `go` starts paid/reissue/cust/ack/finadv (must be 0) | `today.ts:leakage()` (waiting rows with action/href) — `hr-today.test.ts`, `hr-manpower.test.ts`, `hr-write-leftovers.test.ts` | ✅ | TD-03 P0 R1 |

### Demo shell (users, intro, persistence, self-test)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Users switcher (`renderUsers`) | list of `USERS` with role description (`ROLES[r].d`); «تدخل باسم — أدوار الموارد البشرية وحدها»; note: other modules do not sign in here | real sign-in; role from the default group; UAT demo accounts (`scripts/seed-hr-demo.ts`, `lib/hr/demo-seed.ts`) | ✅ n/a (product) | RL-01 |
| Company switcher (`coSw` con/sup/dev/new, `?co=`) | reloads with another `PROF` dataset | `hrSettings.businessType` (one per org) | n/a | ST-06 |
| Intro «نموذج قابل للتجربة» (`renderIntro`/`openIntro`, `INTRO_K`) | first-visit dialog with tours (manpower request, difference payroll, expired iqama, full EOS; others for sup/dev; hiring, reviews/training/punch/import); new-company variant | — | n/a (demo; a UAT walkthrough doc could replace it) | — |
| Notifications bell (`renderBell`, `myNtf`) | per role/user, opens `go` | `users/{uid}/notifications` via `lib/hr/notify.ts:emitHrNotice` | ✅ (notification slice) | NT |
| Persistence (`persist`) | new company only → `localStorage mdmak_hr_new_v1` {t0, FIRM, POL, SITES, EMP, REQ, MREQ, PAY, ATT, USERS, CNTR, LNO, VISA, FLAGS, X5} | Firestore collections | n/a | — |
| `restoreNew` | shifts every DATEKEY by days elapsed since `t0`; re-creates `ATT[CURM]` per site (office flag for hq/dept) | n/a (dates are stored absolute `YYYY-MM-DD`) | n/a | NF time & calendar |
| `jumpMonth` | adds today's marks into the month, saves, sets `mdmak_hr_t0` to next 1st, reloads | n/a | n/a | — |
| «ابدأ من جديد» reset | confirm → remove `mdmak_hr_new_v1` + `mdmak_hr_t0` | none in app; demo seed refuses a second run without `--force-update` (`DEMO_SEED_TAG`) | n/a | — |
| Self-test `onePlaceEach` | every employee on a known site or bench | `siteId` null = unassigned by type; no explicit test | 🟡 no test asserting a stale `siteId` (deleted/inactive site) falls to unassigned | AS-01 P0 |
| `payrollLinesEqualTotal` | Σ line net = payroll total | `hr-payroll.test.ts` (Mudad file = net; events balance) | ✅ | PY-01/07 |
| `costCentresEqualGross` | Σ cost-centre split = gross + employer GOSI | `hr-payroll.test.ts` "hr:PAY and hr:EOS balance", `hr-finance.test.ts` "by centre" | ✅ | Finance contract |
| `noExpiredIqamaAssignable` | expired-iqama people never in coverage rows | `hr-manpower.test.ts` "expired excluded by name" | ✅ | AS-02 · DC |
| `leakage` = 0 | see above | `leakage()` tests | ✅ | TD-03 |
| `featuresOffRestoreCore` | all off → today,people,sites,pay,rep,set and no feature decision | `hr-access.test.ts` | ✅ | ST-02 |
| `noSelfManager` | `mgrOf(e)!==e` | `hr-access.test.ts` "the line manager … never oneself" | ✅ | RL-04 |
| `ramadanSixHours` | `stdH(RAM.from)===6 && stdH(0)===8` | `hr-calendar.test.ts` | ✅ | AT-06 |
| `hiredLinked`, `jobsNotOverfilled`, `reviewsHaveRater`, `certsOnlyWhenRequired` | hiring / review / training invariants | — | ❌ (features not built) | optional: hire/perf/train |
| Counters (`employees`, `sites`, `saudiPct`, `augustNet`, `diffNet`, `openings`, `sessions`, `platformTasks`, `punchOtPending`) | logged figures, not assertions | — | n/a | — |

---

#### Build notes — tab bar, settings, build path, reports, simulator

**Tab bar (🟡/❌)**
- *Counts:* no data change. Add `count`/`urgent` to the rail in `components/hr/HrShell.tsx`. Today = the viewer's `todayItems` decision count (not waits); people = live employees in scope; sites = `manpowerRequests` `open` (manager only); payroll = payrolls `prepared` (manager) / months to prepare (payroll); me = own `hrRequests` pending. Keep TD-04 (count = the screen's number) by reusing the same pure functions. Cost: Today's world on every HR page — an owner decision whether to load it in the shell (one hook `useHrTabCounts`) or count only cheap ones.
- *Platforms rule:* `hrTabs(ctx, features, { govHeld })` — drop `platforms` from `ROLE_TABS.management`; give it to `manager` only when no member holds `hr.gov` (computed like `heldRoles` in `HrTodayView` from `useOrgMembers` + groups; move to `useHrAccess`). Update `hr-access.test.ts`. No rules impact (tabs are not guards). Owner decision: does management really not see platform tasks? (prototype + PRD §3 say gov / HR manager.)
- *Labels:* add `Portal.HR.tab.sites_contractor|sites_supplier|sites_developer` (= «المواقع» / «الفروع والمستودعات» / «الإدارات والمشاريع», default «أماكن العمل» — the current «مواقع العمل» matches none), `tab.perf_only`/`tab.train_only`, and matching supervisor wording; `HrShell` picks by `access.settings.businessType` / features. Both message files; run `check-i18n-links`.
- *Defaults for existing tenants:* a company with no `hrSettings` doc runs with every feature off. Owner decision: seed defaults from the business type when the doc is first created vs. keep "core until chosen".

**Settings (🟡/❌)** — all fields ride the existing `hrSettings/{orgId}` doc (readable by every member, written by `hrManager()`); no new rules block, the existing `create/update` rule covers new fields (no field-level rule exists beyond the gov visa decrement — keep that rule's `affectedKeys().hasOnly(['visas'])`).
- `establishment`: add `nameEn`, `mudad` (Mudad establishment no.), `band: 'platinum'|'high_green'|'mid_green'|'low_green'|'yellow'|'red'` (prototype uses g/y/r + label), `minPct` (green threshold %), `bandAsOf`. Extend `normalizeHrSettings`. Use `mudad` in `mudadCsv` (`establishment`, `period` columns).
- Establishment panel (`nitaqatPanel`): pure — Saudi ratio from `useHrPeople` (live employees), `need = ceil(n×minPct/100) − saudis`, margin = `floor(saudis − n×minPct/100)`; show in `HrSettingsView` (and later Today for management).
- `policies`: add `ajeerAllowed: boolean` (default true), `ajeerFactor` (default 1.4) → `manpower.ts:coverage()` must read them instead of `COVERAGE.ajeerCostFactor` and skip the Ajeer line when not allowed (touches `HrManpowerPanel`, `hr-manpower.test.ts`). Fix `advanceMaxMonths` input `step="0.5"`. R2 policies when their features are built: `lateGraceMin` 15 (per workplace override on `hrSites.grace`), `fixMax` 3 / `fixWindowDays` 7, `offerBand {min:0.9,max:1.2}`, `raise {A:7,B:4,C:2,D:0}`, `recordWeight` 0.2, `strict.jobApprove`, `strict.offerBand` (keep `closeMissing` where it is), `platforms {qiwa, mudad, gosi, muqeem, chi, traffic, hrdf}` (hrdf off) visible only when `gov` is on.
- Policy change log (PRD: "policy is editable and logged"): cheapest = a `log[]` array on the same doc `{at, by, field, from, to}` appended by `saveHrSettings` (no money values in policies, so org-readable is fine). Append-only cannot be enforced cheaply in rules (ruleset at its ceiling) — owner decision: array (unenforced) vs `hrSettings/{orgId}/log` subcollection with a `create`-only rule (one small block).
- Feature defaults UI (ST-06): per-row «افتراضي: مفعّلة/مطفأة» from `defaultFeatures(businessType)`, the `FWHY` one-liner per type (new messages `settings.why.contractor|supplier|developer`), and a «أعد إلى الافتراضي» button shown when `features ≠ defaultFeatures(type)`. Pure UI in `HrSettingsView.tsx`.
- Statutory rows to add: 48-hour week + Friday rest, iqama issue 90 days (`STATUTORY.iqamaIssueDays`), Ramadan dates of the year.
- Roles reflection panel: static list of the six roles from `HR_ROLES` + employee, with sees-pay flag (`HR_GUARD['pay.view']`); messages only.
- Workplace form: owner decision whether a project workplace's `endDate` is READ from the linked project (projects have an end/handover date in PM 1.0 terms — `pm.startOn + durationDays (+ granted days)`) instead of typed; if read, compute in `useHrPeople`/coverage and keep `endDate` only for non-PM projects. English name `nameEn` optional. Shifts are punch (R2).
- Team form: product keeps `/team` for users (correct per the prototype's own note "user creation belongs to Settings & Governance"); add a Saudi-only-trade guard when a team member is linked to an employee record (employee slice).

**Build path (🟡/❌)**
- `policies` step: add `policiesConfirmedAt/By` to `hrSettings` written by an explicit «اعتمد السياسات» action; step done = that field (ride the same doc/rule).
- `establishment` step: decide whether MOL is required (prototype: name+CR+MOL; ours: name+CR+type).
- Add «أضف» buttons on done site/team/employee rows (`HrTodayView`).
- Gap "unrecorded days paid as worked": after a payroll exists for last month, list employees whose recorded days < expected (from `employeeMonth` vs `dueDays`) — only meaningful when `closeMissing = warn`; pure, in `build-path.ts:setupGaps` (needs `lastMonth` + payroll in `GapInput`).
- Optional: a build-time KPI set (Employees / Workplaces / Payroll) in `useHrTodayKpis` while moving in.

**Reports (🟡/❌)**
- Six reports wait for their features (hire, perf, cert, train, late, roster) — add to `REPORT_IDS` with a `feature` key and filter in `visibleReports(ctx, features)`; the `train` report masks cost for non-pay roles.
- `turnover`: add `open`/`oldest` when hiring exists (feature-gated columns).
- `penalties`: add the penalty text column (from `penalties.ts` ladder: step → action key) beside or instead of the step number.
- `cost`: owner decision — add the EOS accrual column (prototype) or keep the PRD's six columns.
- Mudad/GOSI cards: preview tables (8 rows + totals; GOSI total = GOSI payable), bank name column (derive from the SA IBAN bank code — no new field), `establishment.mudad` + `period` columns; offer the supplementary (`-D`) file; owner decision on held lines in the GOSI statement (prototype excludes them, ours includes).

**Simulator counterparts (❌ that are real gaps, not demo)**
- Manpower plan acceptance: add `accepted` (+ `acceptedBy/At`) to `manpowerRequests` (`state: open → answered → accepted`), written from `ProjectManpowerPanel` by the requester; HR Today "waiting on Projects" row (no button) while `answered`. Rules: the existing `manpowerRequests` block needs an update path for the project side limited to `state/acceptedBy/acceptedAt` (small; try to fold into the existing requester-update condition).
- Supplier companies: a manpower request origin outside Projects (Inventory/branch) — owner decision (the prototype's `mrMod:'inv'`); would ride `manpowerRequests` with `source: 'inventory'` + `siteId` instead of `projectId`.
- GOSI payment (PY-09): record on the payroll doc (`gosiPaid {by, at, amount}`) from `FinanceHrDesk`, posting Dr GOSI payable / Cr bank — rides `hrPayrolls` (Finance already updates `state/posted/paid` there; extend the affected-keys list in that rule).
- Workshop attendance from Manufacturing / workshop absence report: owner decision — the prototype's own conflict note says attendance is one record in HR and the workshop reports, not owns; if kept, a Manufacturing → HR notice (`emitMfgEvent` → HR supervisor) rather than a write into `hrAttendance`.
- Sales commission approval: owner decision — today HR records it with Sales' reference; a Sales-side approval would be a `salesCommissions` event read by HR (new collection = new rules block; avoid unless asked).

<!-- slice 7-me -->
# Slice 7 — My file «ملفي»

Prototype source: the LATER `VIEWS.me` (proto.html ~2522–2534) with `meHome` 2499, `meToday` 2495, `meActs` 2476,
`meAttn` 2484, `meReqs` 2506, `mePay` 2509, `meDocs` 2517, `efAtt` 2398 (the "attendance & leave" segment reuses the
employee-file attendance view), forms `reqleave`/`reqadv` (1413/1422), `X5F.reqletter` 2556, `X5F.attreq` 2109,
`X5F.data` 2335 (+ `dataok` 2338), `X5F.self` 2000, actions `cancelleave` 1587, `object` 1586, `rvack`, `punch`.
The earlier `meView` (1190) with `x7MeCard` (2341) / `x5Me` (2201) / `x7Payslips` (2346) is SUPERSEDED: its "My card"
content moved into `meDocs` «بطاقتي», its payslips into `mePay`, its punch box into `meToday`. They are listed
once below where their content now lives. PRD screen spec: prd.txt line 124 (§5 "ملفي").

Ours: `components/hr/HrMyFile.tsx:HrMyFile` (route `contractor|supplier/hr/me/page.tsx`, inside `HrShell` tab `me`),
`NewRequestDialog.tsx`, `HrRequestList.tsx:CancelOwnRequest`, `HrLetters.tsx:HrLettersPanel`,
`HrLetterDialogs.tsx:NewLetterDialog`, `HrViolationList.tsx`, `lib/hr/requests.ts` (kinds `leave|advance|data`
ONLY — no `attfix`), `lib/hr/access.ts:hrTabs/lineManagerOf`, payslips `hrPayslips` written by Finance at payment
(`lib/hr/finance-writes.ts`).

### Access, tab and roles

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Tab «ملفي» for the employee role | `TABS()`: `emp` gets only `['me']`; `VIEWS.today` for emp = My file | `lib/hr/access.ts:hrTabs` adds `me` when `ctx.employeeId`; `HrShell` redirects a role-less employee from Today to his first tab | ✅ | ES-00 P0 R1 |
| Tab for staff users (hr/gov/pay/sup/mgmt) | `TABS()` line 1020: `me` appended when `CU().e` links to an employee, with a badge = his pending requests count | `hrTabs` same rule (employeeId); the rail passes NO count | 🟡 no pending-count badge on the tab | ES-00 P0 R1 |
| Not on the record | `VIEWS.me`: empty panel «لست على سجل الموظفين» + "add yourself as a team member to have a file and payroll" | `HrMyFile` → `Callout me.no_record` ("ask the HR manager to link your account"); `HrShell` no_record_desc | ✅ (wording differs) | ES-00 P0 R1 |
| Sees only himself | `openEmp` refuses another id for emp; `SELFV=1` lets him see his own money (`mOk`) | rules: `employees` by `userId`, `employeePay` by user link, `hrRequests` by `employeeUserId`, `hrPayslips` by `employeeUserId`; `HrMyFile` filters `employeeId === id` | ✅ | ES-05 P0 R1 |
| Own pay visible even when the role does not see pay | `SELFV`/`mOk()` during render | `useEmployeePay(id)` readable via the employee link (RL-03) | ✅ | ES-00 P0 R1 |
| His requests go to his approver, never himself | `reqleave` submit: HR's own → `role:mgmt`; supervisor never endorses his own (`mgrOf` skips self) | `request-writes.ts:fileRequest` `deciderLevel` management for the HR manager; `lineManagerUserId !== emp.userId` | ✅ | ES-00 P0 R1 · LV-05 |
| Company variants | `CO=new` → `amOf`='sup', all features off → no punch/perf/train items; `PROF.supWord` per company («مشرف عمالة» con · «مشرف مستودع» sup · «منسّق إدارة» dev) names who records attendance | no company-specific wording in My file; features not consulted (none of the optional items exist) | 🟡 nothing to vary yet — when "who records me" is built it needs the per-company supervisor word | ES-00 P0 R1 |

### Header «mhero» (replaces `x7MeCard` as the head)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Avatar + greeting «مرحباً <first name>» | `av(e)`; first name with title prefix (م./أ./د.) stripped | number chip + full name + status pill | 🟡 no greeting/avatar; we show status pill instead | ES-00 P0 R1 |
| Meta line: `#no · trade · workplace` | `e.no`, `TN(e.trade)`, `SN(e.site)` | `empNo(emp.no)` chip, `trade · siteName` | ✅ | ES-01 P0 R1 |
| Meta: «مديرك: <name>» | `mgrOf(e)` (explicit `e.mgr` → site head (labour) → senior staff → mgmt → hr) | — (line manager only on the card, see below) | ❌ | RL-04 P1 R1 |
| Meta: shift name chip | `shN(e)` when the workplace has shifts | — (no shift model) | ❌ | PT-01 P1 R2 · optional: punch |
| Staff chip «ملفك كموظف — ودورك <role> في التبويبات الأخرى» | shown when `ROLE()!=='emp'`, names the role | — | ❌ | ES-00 P0 R1 |

### Four tiles «etiles»

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| «رصيد إجازتي» | `leaveBal(e)` days (red if < 0) + sub "`⌊accrued(e,0)⌋` مستحق − `taken` مأخوذ" | balance only, as a row on the home card / leave segment; no tile, no formula | 🟡 no tile; formula (accrued − taken = balance) missing | ES-06 P1 R1 |
| «آخر راتب» | last main payroll in state `paid`/`sent` the employee belongs to: net ﷼ + "`month` · صُرف `date`" or «عند المالية» | — (payslips only in Pay segment) | ❌ | ES-04 P0 R1 |
| «أقرب وثيقة تنتهي» | min `off` over `docs(e)`: doc name + date + `efLeft` (days left) | — | ❌ | ES-06 P1 R1 · DC-01 |
| «حضوري — <current month>» | `e.att[CURM].p` present days; sub "`a` غياب · `ot` س إضافي" | — (employee cannot read `hrAttendance`) | ❌ | ES-06 P1 R1 |
| Header KPIs | the tiles ARE the KPIs | `HrShell` for `me` passes no `kpis` | ❌ | ES-00 P0 R1 |

### Quick actions «meActs»

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Shown only while `e.st` is `active` or `leave` | `meActs` returns '' otherwise (leaving/left/visa see none) | buttons always shown; letters gated by `requestableKinds(status)`, leave/advance only blocked in the write | 🟡 no status gating of the bar | ES-00 P0 R1 |
| «اطلب إجازة» | `reqleave` form: types filtered by `leaveAllowed(e,x)`; from/to; days excl. holidays; "effect" (+ deduction ﷼); sick-this-year x/120; blocks: overlap, beyond 120 sick; warn above balance (HR decides balance-only or excess unpaid); red: iqama/passport expires before return; non-Saudi annual → «تذكرة سفر مستحقة» checklist | `NewRequestDialog` kind `leave` + `lib/hr/requests.ts:leaveQuote` (days, balance at start, from balance, unpaid, sick bands, overlap, eligibility, travel_docs, above_balance) | 🟡 all types listed (ineligible ones block after choosing, not filtered); no money "effect" line; no ticket-due line | LV-01…06 P0 R1 |
| «اطلب سلفة» | disabled with tooltip «لديك سلفة قائمة» when `e.adv`; form: amount, reason, instalment 10% (art. 92), months, «من يقرّر» HR manager or Finance above `POL.advMax`×wage | `NewRequestDialog` kind `advance` + `advanceQuote` (outstanding/pending block, instalment, months, over_limit + past_contract warnings) | 🟡 button not disabled up front (block shows inside the dialog); "who decides" not shown as a row (only the over-limit warning) | AD-01…04 P0 R1 |
| «اطلب خطاباً» | `X5F.reqletter`: type (sal/emb/noc/oth/exp on exit), title for oth, purpose required for noc/oth, addressee, language, signer named | `NewLetterDialog` (`HrLetterDialogs.tsx`) via header button | ✅ (detail in the letters slice) | EM-08 P1 R1 |
| «تصحيح حضور» | shown when `FEAT('punch')` OR the workplace is supervisor-sheet (`amOf==='sup'`, i.e. always when punch is off) — `X5F.attreq`: type `miss` (forgot punch) / `out` (outside fence on duty) only on punch workplaces, `abs` (marked absent but present) always; day (≤ 7 days back, not future), reason required; `miss` capped `POL.fixMax`=3 a month; creates `REQ{k:'attfix', no, type, day, why, state:'pend'}` → notifies the line manager (`mgrOf`) else HR | — (no `attfix` kind, no form, no approval) | ❌ | PT-07 P1 R2 (the `abs` variant applies to supervisor sheets — R1-reading core P1) |
| «حدّث بياناتي» | `X5F.data`: field `phone`/`iban`/`addr`/`emg`/`edu`; IBAN regex `^SA\d{2}[A-Z0-9]{18,22}$`, bank document FILE attached; HR approves (`dataok`), IBAN on a returned transfer → `iban='fixed'` | `NewRequestDialog` kind `data` + `dataBlocks` (iban `SA\d{22}`, document reference text), approve applies to `employeePay.iban` (`ibanState:'ok'`) or `employees.contact.*` | 🟡 no `qualification` (`edu`) field; document is a typed reference, not an attachment; an approved IBAN sets `ok`, not a "fixed → back to Finance" handoff for a returned line | ES-03 P0 R1 |
| «تقييمي الذاتي» | when `FEAT('perf')`, cycle open, eligible, staff (not labour), not reviewed, no self yet → `X5F.self` (4 criteria + note) | — | ❌ | PF-03 P1 R3 · optional: perf |

### Segments bar

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Five segments الرئيسية · طلباتي · حضوري وإجازاتي · راتبي · وثائقي وبياناتي | `SEG` with counts: home = `meAttn(e).length`, requests = pending count | `SegmentedNav` home/requests/leave/pay/docs; count on requests only (pending+endorsed+finance) | 🟡 no attention count on Home | ES-00 P0 R1 |

### Home «meHome»

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Home content | attention list + «يومي» + «طلباتي الجارية» + «آخر راتب» + «تقييمي» (perf) | Home shows only «بطاقتي» (number, join, service years, contract, probation, line manager, leave balance, EOS info) | 🟡 home is the card; prototype puts the card in Documents & details | ES-00 P0 R1 |
| «يحتاج انتباهك» panel (count pill red if any `r`) | `meAttn` rows {colour, icon, title, sub, button} — see the next table | — | ❌ | ES-00 P0 R1 (PRD §5 line 124) |
| «يومي» — today's state | pill from `e.today`: p حاضر · a غائب · s مرضي · l/on leave في إجازة · x استئذان · else «لم يُسجَّل بعد» | — | ❌ | ES-06 P1 R1 |
| «يومي» — الدوام | `schOf(e,0)` in–out (+ shift name) — site schedule `x.sch`/`SCHD[type]` (prj 06:30–15:30, ws/wh 07:00–16:00, fleet 06:00–15:00) | — (no schedule on `hrSites`) | ❌ | AT-06 P1 R1 · PT-01 R2 |
| «يومي» — من يسجّل حضوري | `amOf`: `mob` «أنا — من التطبيق» · `dev` «جهاز البصمة في مكان العمل» · `sup` the line manager's name else `PROF.supWord` | — (derivable today from site type: office = assumed, else the site supervisor) | ❌ | PT-01 P1 R2 (sheet case R1) |
| «يومي» — بصمتي اليوم | `e.pn.in`–`e.pn.out` when the source is not the sheet | — | ❌ | PT-04 P1 R2 · optional: punch |
| «يومي» — مكان عملي · مديري المباشر | `SN(e.site)`, `mgrOf(e)` | — on Home (line manager on the card) | 🟡 | RL-04 P1 R1 |
| «يومي» — punch button | `am==='mob'` & active: «سجّل حضوري/انصرافي» enabled only inside the geofence (`VS.geoIn`), «اكتمل يومك» when both; note "location read at punch only"; demo toggle is not product | — | ❌ | PT-06 P1 R2 · optional: punch |
| «طلباتي الجارية» | pending requests: `reqTx` + number, `rel(at)` · «عند: `reqHolder`»; empty «لا طلبات جارية — ارفع طلباً من الأزرار أعلاه» | only in the Requests segment | ❌ on Home | ES-02 P0 R1 |
| «آخر راتب» card | month, net ﷼, «صُرف `date`» or «عند المالية — لم يُصرف بعد», held-IBAN chip, gross · deductions, button «القسيمة والتفاصيل» → pay segment | — | ❌ | ES-04 P0 R1 |
| «تقييمي» card | perf on & cycle & eligible: band, reviewed by, record score `attScore`/5 (absences, penalties), approved raise `+basic` from date, manager note, «اطّلعت» ack; else "not reviewed yet — cycle closes `date`" | — | ❌ | PF-07 P2 R3 · optional: perf |

### «يحتاج انتباهك» rows (`meAttn`)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Penalty with objection window | each `e.pen` with `at > −15` and not cancelled: «جزاء: code — penalty (amount ﷼)»; sub «لك الاعتراض حتى `at+15` (م.72)» + «اعترض» button, or «اعتراضك قائم — موقوف حتى البتّ» | objection exists in `HrViolationList` (Documents segment) but no attention row | 🟡 no Home row; object action lives in Docs | PN-04 P0 R1 |
| Review ready | perf, `e.rv.st==='ok'` → band + «اطّلعت» | — | ❌ | PF-07 P2 R3 · optional: perf |
| Certificate missing/expired | train: `reqCerts(e)` missing/expired; booked session date or "tell your manager" | — | ❌ | TR-* R2 · optional: train |
| Document within renewal window / expired | `docs(e)` with `off <= POL.renewWin`, except contract: "X expires/expired `date`" — "renewal is with government relations" | state pills in Documents only | 🟡 no attention row | DC-01 P0 R1 · ES-06 |
| Fixed contract ending ≤ 60 days | «عقدك محدد المدة حتى `date`» — "renews unless notified in writing" | — | ❌ | ES-01 P0 R1 |
| Transfer returned | `e.iban==='ret'` red «حوالتك مرتجعة» + «حدّث الآيبان» (opens data form on iban) | — (`employeePay.ibanState:'returned'` exists) | ❌ | ES-03 P0 R1 · PY returned-transfer |
| No IBAN | no IBAN recorded: «لا آيبان مسجّل — بدونه لا يُصرف راتبك» + «أضفه» | — | ❌ | ES-03 P0 R1 |
| No mobile | `!info.phone`: «جوالك غير مسجّل — لتصلك رسائل صرف الراتب وقرارات طلباتك» + «أضفه» | — (`contact.mobile` exists) | ❌ | ES-03 P0 R1 |
| This week's decisions | own requests decided in the last 7 days: «<request> — اعتُمد/رُفض», sub = reason or who decided | — | ❌ | ES-02 P0 R1 |

### Requests segment «meReqs»

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| «كل طلباتي» table | columns الطلب · الرقم · التاريخ · الحالة · «عند من / من قرّر» (+ «السبب:» on decline) · action; excludes `viol` | `HrMyFile` list: number (ط.إ/ط.سل/ط.ص), kind label, state pill, «عند: …», «السبب: …» | 🟡 no date; no "decided by" (we hold `decision.byName`); kind label generic | ES-02 P0 R1 |
| Request description `reqTx` | leave: type · N days from `date`; advance: amount ﷼; data: «تحديث <field>»; letter: type — addressee · serial; attfix: «تصحيح حضور — …» | `t('req.kind.<kind>')` only — no dates/days, amount or field | 🟡 | ES-02 P0 R1 |
| Holder by name `reqHolder` | leave: endorsed → HR manager; else line manager's NAME «(توصية) ثم الموارد البشرية»; advance: HR manager or «المدير المالي» above limit; attfix: line manager; data: «الموارد البشرية — بعد التحقق من المستند»; letter: «شؤون الموظفين»; `fin` → payment wait | `holder()`: pending leave → line manager by name; pending/endorsed → «مدير الموارد البشرية» / «الإدارة»; `finance` → «المالية» | 🟡 HR/management/Finance by role word, not by name (PRD: "current holder by name") | ES-02 P0 R1 |
| Kinds covered | leave · adv · letter · attfix · data · raise (+ objection, self-review per PRD) | leave · advance · data (`hrRequests`) + letters in a separate panel (`HrLettersPanel`) + objections in `HrViolationList` | 🟡 one list in the prototype; ours three places; attfix/self missing | ES-02 P0 R1 |
| Cancel | «ألغِ» on an APPROVED leave not yet started (`from>0`) by the employee → state no, `cancelled`, balance restored | `CancelOwnRequest` + `requests.ts:mayCancel`: own pending/endorsed; an approved leave before day 1 only by HR | 🟡 employee cannot cancel his own approved future leave (prototype lets him) — owner decision | LV-07 P1 R1 |
| «اعرض» an issued letter | on an approved letter row | `HrLetterList` view/print in `HrLettersPanel` (Requests segment) | ✅ | EM-08 P1 R1 |
| «جزاءات عليّ» table | violation · date · penalty (· amount) · objection: «أُلغي» / «أُبقي — لك اللجنة العمالية» / «قائم» / «اعترض حتى `date`» / «انتهت المهلة» | `HrViolationList` (own, `mayObject`) — placed in the Documents segment | 🟡 present but in Docs, not Requests | PN-04 P0 R1 · ES-02 |

### Attendance & leave segment «efAtt»

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Two month cards | previous month (+ «مقفل» if closed) and current «حتى أمس»: present · absent · sick · leave · OT h | «شهراً بشهر» from PAID payslips: absent · sick · OT | 🟡 paid months only, no present/leave counts, no current month, no closed flag | ES-06 P1 R1 |
| Today / schedule / source / punch today / yesterday / late count / shift history | `efRow`s: today state (+ «وردية ثانية»), schedule + shift, source `AMK[am]` (sheet/device/app), punches today & yesterday (missing out), `lateN`, `e.shHist` | — | ❌ (today/source R1-able; punches/late/shifts R2 optional: punch) | ES-06 P1 R1 · PT-01/04 R2 |
| Balance formula | `accrued − taken = balance` boxes | balance, taken rows | 🟡 no accrued figure / formula | LV-01 P0 R1 · ES-06 |
| Yearly entitlement | 21 d, «يصير 30 من `join+5y`» | — | ❌ | LV-01 P0 R1 |
| Sick this year | `sick/120` + bands «30 كاملة · 60 بثلاثة أرباع · 30 بلا أجر» | `emp.sick.days` (no /120, no bands) | 🟡 | LV-06 P0 R1 |
| Balance in cash | `wage/30 × max(0,bal)` (own money visible) | — | ❌ | ES-06 P1 R1 |
| Opening balance | `e.open.leave` + who entered it | — (`emp.opening` exists) | ❌ | IM-04 P1 R1 |
| «الإجازات» table | type + number · from · to · days · state | — (leaves only as rows in Requests) | ❌ | ES-06 P1 R1 |
| «الإسناد» history | `e.hist` from → to, date, by; current assignment (+ bench since) | — (`employees/{id}/log` holds assignments; no UI here) | ❌ | ES-06 P1 R1 |

### Pay segment «mePay» (+ `x7Payslips`, `payslip`)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| «راتبي الشهري» basic · housing · transport · total | `e.basic/hous/trans`, `wage(e)` | `pay.basic/housing/transport`, `wageOf` | ✅ | ES-04 P0 R1 |
| OT hour rate | `otRate(e)` (art. 107) | — | ❌ | ES-04 P0 R1 |
| GOSI share | `gosiR(e).emp` % «من الأساسي والسكن» / «لا شيء» (non-Saudi) | — | ❌ | ES-04 P0 R1 |
| Pay day | `POL.payDay` «من الشهر التالي» | — (policy exists in `HrPolicies`) | ❌ | ES-04 P0 R1 |
| Bank + IBAN MASKED | bank name; IBAN `first6…last4` | `pay.iban` shown IN FULL; no bank name | 🟡 must be masked (ES-01 «الآيبان مقنّعاً») | ES-01 P0 R1 |
| «قسائم رواتبي» list | every main payroll `paid` OR `sent` the employee belongs to; summary month · net · «صُرف `date`» / «عند المالية» · held chip «معلّق — آيبان مرتجع»; first one open | `hrPayslips` (written by Finance at payment; main + supplementary), key · paid date · net, toggle | 🟡 nothing before payment (no «عند المالية»), no held/returned state; key shown raw (`YYYY-MM`) not a month name | ES-04 P0 R1 |
| Payslip body with reasons | basic/housing/transport lines; OT h × (hourly + 50% basic), ">60h written consent" flag; absence days; commission (Sales badge); sick 75%/unpaid; penalties; GOSI % of (basic+housing); advance instalment; net | `PayslipBody`: wage for N days, absence, OT h, commission, gross, GOSI, sick bands, unpaid days, each penalty by code & date, advance, net; supplementary (retro/commission/refund) | ✅ (ours names each penalty; lacks the component split and the >60h flag) | ES-04 P0 R1 |
| «سلفتي» card | amount · remaining · monthly instalment · months left; none: «لا سلفة قائمة — القسط إن طلبت 10% من راتبك (م.92)» | single row "advance balance" when > 0 | 🟡 no amount/instalment/months-left, no empty text | AD-01 P0 R1 · ES-04 |
| «مستحقاتي — للعلم» | EOS accrued (art. 84), if resigned today (art. 85, "nothing before 2 years"), leave balance value, air ticket (non-Saudi) + note "information, not a decision" | EOS (contract_end) + resignation figure on the Home card | 🟡 no leave value, no ticket; placed on Home | ES-01 P0 R1 |
| «تغيّرات راتبي» log | `e.changes`: kind: from ← to, effective date, reason | — (`employeePay.steps` holds the history, readable by him) | 🟡 logic/data only, no UI | EM-04 P1 R1 · ES-04 |

### Documents & details segment «meDocs» (absorbs `x7MeCard`)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| «بطاقتي» card placement | in Documents & details, with the update button | on Home | 🟡 placement | ES-01 P0 R1 |
| Employee no. first «مفتاحك في كل طلب وفي جهاز البصمة» | `e.no` large | `empNo` first, strong | ✅ | ES-01 P0 R1 |
| National ID / Iqama no. | `idOf(e)` labelled by nationality | `emp.idNo` in «بياناتي» as "ID no." | 🟡 not labelled iqama vs national ID; not on the card | ES-01 P0 R1 |
| Trade (per contract) | `TN(e.trade)` | in header only | 🟡 | ES-01 P0 R1 |
| Joined + years | `fdl(join)`, `⌊yrs⌋` | join date + service years (1 decimal) | ✅ | ES-01 P0 R1 |
| Contract | fixed «محدد حتى `date`» + «يتجدد ما لم تُخطَر» / open-ended | fixed until / open — no "renews unless notified" | 🟡 | ES-01 P0 R1 |
| Probation | only while running «حتى `date`» | always shown (decision / lapsed / until) | ✅ | EM-05 P0 R1 |
| Line manager | `mgrOf(e)` — explicit `e.mgr`, site head, senior staff, management, HR | `memberName(site.supervisorUserId)` else «مدير الموارد البشرية» | 🟡 ignores `emp.managerId` (`lib/hr/access.ts:lineManagerOf` exists but unused here); fallback should be management (RL-04), not HR | RL-04 P1 R1 |
| Employee affairs | gov officer's name, else HR manager | — | ❌ | ES-01 P0 R1 |
| Mobile · national address · emergency contact · qualification | `e.info.phone/addr/emg/edu` | `contact.mobile/address/emergency` in «بياناتي» | 🟡 no qualification | ES-01/03 P0 R1 |
| Air ticket | non-Saudi «مستحقة مع الإجازة السنوية — تُحجز بعد الاعتماد» | — | ❌ | ES-01 P0 R1 |
| Update button + note «يعتمدها مدير الموارد البشرية — الآيبان بمستند من البنك» | on the card | header button + `me.details_note` | ✅ | ES-03 P0 R1 |
| «وثائقي» table | doc · expires (missing / open-ended contract) · days left `efLeft` · state chip; note "renewals by gov relations; your passport stays with you" | `DOC_TYPES` (iqama hidden for Saudis) with date + state pill | 🟡 no days-left column, no passport/renewal note | DC-01 P0 R1 · ES-06 |
| «شهاداتي وتدريبي» | train: required certs (expires, state) + sessions (date, place, passed/absent/scheduled — paid work day) | — | ❌ | ES-06 P1 · optional: train (R2) |

#### Build notes — My file

1. **Layout realignment (pure UI, no data)** — `HrMyFile.tsx`: move «بطاقتي» to Documents & details; make Home =
   attention + «يومي» + «طلباتي الجارية» + «آخر راتب»; add the header greeting, «مديرك», the staff chip
   (`access.ctx.roles.size > 0` → name the role(s) from `Portal.HR.role.*`), and the four tiles as `HrShell` `kpis`
   for tab `me` (a `useKpis` for the me page). Line manager: use `lib/hr/access.ts:lineManagerOf(emp, siteSupervisor)`
   resolving `managerId` → employee → user name, null → «الإدارة». Mask the IBAN (`SA12 34…5678`), add bank name
   (IBAN prefix → bank table if one exists, else omit). Owns only `HrMyFile.tsx` + i18n keys.
2. **Attention list (`meAttn`)** — computable client-side from what the employee already reads: own violations
   (15-day window from `HrViolationList`'s `mayObject`), `emp.docs` vs `renewWindowDays`, `contract.end` ≤ 60 d,
   `employeePay.ibanState==='returned'` / no `iban`, no `contact.mobile`, own requests decided in the last 7 days
   (`decision.at`). A pure `lib/hr/me.ts:attentionItems()` + test; the "add/update" buttons open `NewRequestDialog`
   kind `data` preset to the field (needs an `initialField` prop). No rules impact.
3. **Requests list richness** — show date (`createdAt`), a `reqTx`-like description (leave type · days · from;
   advance amount; data field), "decided by" `decision.byName`, and holders by name: resolve the HR manager / gov
   officer from org members whose default group holds `employees.manage`/`hr.gov` (same reading as
   `userIsHrManager`). Optionally merge letters and objections into one table (the prototype's single «كل طلباتي»);
   owner call whether to keep three panels.
4. **Today / attendance for the employee** — the employee may NOT read `hrAttendance` (rules: office roles + the
   site's supervisor) and the doc holds the whole site's exceptions, so opening it would leak colleagues' absences.
   Options for the owner: (a) a per-employee projection written beside the sheet (e.g. `hrAttendance` doc field
   `byEmp.{employeeId}` is still the whole doc — no); (b) a new tiny collection `hrMyDay/{orgId}__{employeeId}__{yyyy-mm}`
   {today, p, a, s, lv, ot, lateN} written by `recordDay`/closing — new rules block (~300 chars, reuse
   `hrEmp(...)`/userId check as in `hrRequests`) — costs ruleset budget; (c) R1 minimum: derive "who records me"
   (site type office → «حضورك مفترض»; else site supervisor's name / per-company word) and the previous closed
   months from payslips (already done), and leave "today" + current month for R2 with punches. Recommend (c) now,
   (b) with the punch release. Schedules (`sch` per site type, 06:30–15:30 etc.) need a `schedule` field on
   `hrSites` (rides the existing doc, no new rules block).
5. **Attendance correction (`attfix`)** — ride `hrRequests` with `kind: 'attfix'` (fields `type` miss|out|abs, `day`,
   `why`), number `HQ-` (ط.ص, as the prototype) — rules: add `'attfix'` to the create `kind in [...]` list (a few
   chars) and let the line manager decide (`lineManagerUserId == auth.uid` on update — new clause). Policy
   `fixMax` (3/month, forgot-punch only) and the 7-day window go into `HrPolicies`/`requests.ts:attfixBlocks`.
   Approval must write the day into `hrAttendance` (the manager/supervisor already may) and is refused once the
   month is closed (closed months never reopen — then it becomes a supplementary item; owner decision). The
   `miss`/`out` variants exist only with `punch` (R2); `abs` is useful in R1 for supervisor-sheet workplaces.
6. **Pay segment** — OT hour (`statutory` art. 107 helper), GOSI employee rate (`statutory` table by nationality /
   new scheme), pay day (`policies.payDay`), advance card (`employeePay.advance` amount/balance/instalment →
   months left), entitlements (leave value `wage/30×balance`, ticket for non-Saudis), pay changes from
   `employeePay.steps` (read-only — the employee already reads the doc). «عند المالية» / held: either Finance writes
   the payslip at `approved` with `paidOn:null` and a `held` flag, updated at payment (rules today only allow
   `create` at `state=='paid'` and no update — needs a rules change), or My file shows "approved — with Finance" from
   a field the employee can read (he cannot read `hrPayrolls`). Owner decision; the cheaper path is a create at
   approval + one `update` clause limited to `paidOn`/`held`.
7. **Data update** — add `qualification` to `DATA_FIELDS` + `contact.qualification`; real attachment waits for EM-07
   (Storage). Clarify with the owner: an employee's approved IBAN on a RETURNED line sets `ibanState:'ok'` today —
   the payroll flow uses `fixed → approveIban (different hand)`; decide whether the employee's own request counts
   as that second hand (prototype: HR approval sets `fixed`, back to Finance).
8. **Cancel an approved future leave by the employee** — prototype allows it (balance restored); ours HR only
   (`mayCancel`). Rules: the employee update on `hrRequests` would need the approved→cancelled transition — owner
   decision.
9. **Optional switches** — self-review (perf, R3), review card/ack (perf, R3), certificates & sessions (train, R2),
   punch button/geofence/shift chip (punch, R2) — no work in R1.

<!-- slice 8-forms-core -->
## Forms (core)

Scope: `openForm` (proto 1359–1388), `renderForm` (1394–1523), `submitForm` (1524–1581), `doAct` (1582–1593).
`X5F[k]` wins over the core branch in both renderForm and submitForm, so **`letter`** (X5F.letter, 2572) and
**`reqletter`** (X5F.reqletter, 2556) are X5F forms. Their core branches (1471–1477 / 1572–1573) are dead code and
are left to the X5F slice. `xq` shares the `mr` renderer ("Cover {by}'s request") but nothing opens it
(`form:xq` appears nowhere), so it is dead code too.
The core kinds that exist: newemp, assign, mr, xreq, leave, reqleave, adv, reqadv, doc, exit, fs, ct, iban, firm, site,
pol, user, inj, viol, pen, prob, raise, wps, gosi, report (25). None of the other kinds named in the task
(miss/ot/nop/noout/late/wsabs/xatt/bench/gone/comm/cust/reissue/paid/fspaid/finadv/fexit/ext/ack/hgt/fleet/nmr/team/type/obj)
is a core form. `data` is X5F. `obj` is a REQ kind decided through `doAct('objdec')` (see the doAct table).
Common to every core form: `autoBy()` shows "Recorded under your name: <name> · <today>". The submit button is disabled with
the blocking fact said above it (PRD §5: "states blocking facts before sending"). Ours uses `BlockingReasons` with the button
disabled for most dialogs, and no auto-signed "recorded under your name" line anywhere (the write stamps the actor).

### Form: newemp — موظف جديد / New employee (2 steps)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | Setup checklist "First employee" (961), People "+ New employee", hiring `cand` prefill (x5PrefillCand) | `components/hr/NewEmployeeDialog.tsx`, guard `employee.create` = manager, gov (`lib/hr/access.ts`) | ✅ | EM-03 P0 R1 |
| Steps | `steps=[العقد, الوثائق والبنك]`. Next is disabled until `ok0` | `WizardSteps` Contract → Documents & bank. Next is disabled on `stepOneBlocks` | ✅ | EM-03 P0 R1 |
| `src` source | optBtn sa «سعودي — توظيف محلي» / xfer «نقل خدمات» / visa «وافد بتأشيرة جديدة» (shows `FIRM.visas` available). Default sa | `HIRE_SOURCES` local/transfer/visa. The visa button shows "N visas left" | ✅ | EM-03 P0 R1 |
| Block: no visas | `src==='visa'&&FIRM.visas<=0` → red «لا تأشيرات متاحة في ملف المنشأة» | `newEmployeeBlocks` `no_visas`, re-read inside the transaction (`createEmployee`) | ✅ | EM-03 P0 R1 |
| `n` Arabic name | required (ok0) | `nameAr` required (`no_name`) | ✅ | EM-03 |
| `en` English name «كما في الجواز» | **required** (ok0 `(d.en||'').trim()`) | `nameEn` optional | 🟡 prototype requires the passport-English name. Ours does not, and Mudad/WPS rows need it | EM-03 P0 R1 |
| `nat` nationality | select NATS, default sa | `NATIONALITIES` select, default sa | ✅ | EM-03 |
| `idno` | label switches: «رقم الهوية» (Saudi) / «رقم الجواز» (non-Saudi) | label switches national ID / **iqama no.**. Optional, no format check | 🟡 the label differs (passport vs iqama no.), and ours does not format-check the ID (Mudad/GOSI key on it) | EM-03, PY-07 |
| `g` gender | select m/f, default m | select m/f | ✅ | EM-03 |
| `trade` | select TRADES with «مقصورة على السعوديين» suffix on localized trades | `SearchableSelect` grouped by category. No Saudi-only marker in the option label | 🟡 the option does not mark Saudi-only trades (the block still fires) | EM-03 |
| Block: Saudi-only trade | `LOCALIZED.includes(trade)&&!sa` → red, Next disabled | `saudi_only` | ✅ | EM-03 P0 R1 |
| `site` | select SITES + bench. **required** (`d.site`) | `siteId` defaults to Unassigned | ✅ ours defaults to unassigned, which is valid | AS-01 P0 R1 |
| `join` | date, default today. Required | `join` required (`no_join`). A future join → status `expected` (extra) | ✅ | EM-03 |
| `basic` | only if `moneyOk()`. Required then (`basic>0`). Placeholder = trade ref wage `TR[4]`. Without money the record takes `TR(trade)[4]` silently | only with `pay.view`. `bad_basic` if ≤0. Without pay: no pay doc + warning `no_basic` (HR completes it) | ✅ ours does not invent a wage (stricter). No trade-reference placeholder | EM-03, RL-03 P0 R1 |
| Allowances preview | kv «الأجر الشهري» = basic + 25% + 10% | `payFromBasic` breakdown (basic, housing, transport, wage) from policy shares | ✅ | EM-03 |
| `ct` contract open/fixed + `ctEnd` | select. A fixed contract needs a valid `ctEnd` | `contractType` + `contractEnd` (`fixed_needs_end`) | ✅ | EM-03 |
| Warn: Saudi < 4,000 | amber «سعودي بأقل من 4,000 لا يُحتسب في نطاقات» | warning `saudi_below_nitaqat` | ✅ | EM-03 |
| Probation preview | kv «فترة التجربة 90 يوماً حتى <join+90>» (computed date) | static note `new.probation_note` with no computed end date | 🟡 the probation end date is not shown | EM-05 P0 R1 |
| Step 2 note | «نسجّل ما صدر… الفارغ يبقى فارغاً» | `new.blanks_note` | ✅ | EM-03 |
| `iq` iqama expiry (non-Saudi) | date. A visa arrival gets the hint «تُترك فارغة حتى الإصدار — مهلة 90 يوماً» | `iqama` date; for a visa arrival the label is "Iqama (once issued)" | ✅ | DC-05 P0 R1 |
| `ins` insurance expiry | non-Saudi only | shown for everyone | ✅ (broader) | DC-01 |
| `pp` passport/ID expiry | label «انتهاء الهوية» (Saudi) / «انتهاء الجواز» | `passport` date, always labelled passport | 🟡 a Saudi's national-ID expiry is not captured (the label says passport) | DC-01 P0 R1 |
| Licence / forklift expiry | — | `licence`/`forklift` when the trade drives (extra) | ✅ extra | DC-06 P1 R1 |
| `bank` bank select | select BANKS, default RJHI | — | ❌ no bank field. Prototype WPS rows show the bank name | PY-07 P0 R1 |
| `iban` | text, placeholder SA… (no check at this step) | `iban` (pay roles only), uppercased, **no format validation**. Stored with `ibanState: ok` | 🟡 a malformed IBAN is saved as "ok". Should reuse `/^SA\d{22}$/` from `fixIban` | PY-03 P0 R1 |
| Onboarding checklist | «عقد موثّق في قوى · تسجيل في التأمينات · تأمين طبي · تدريب السلامة» (non-blocking checklist) | — | ❌ | GV-02 P1 R2 · optional: gov |
| Block: expired iqama on a site | — | `iqama_expired_site` (extra) | ✅ extra | DC-02 P0 R1 |
| Submit: number | `mk(o)` | `hrCounters/{orgId}.lastEmployeeNo` +1, permanent | ✅ | EM-02 P0 R1 |
| Submit: visa spent | `FIRM.visas-1` | `establishment.visas -1` in the same transaction | ✅ | EM-03 |
| Submit: probation | `prob=join+90` | `probationEnd(join)` | ✅ | EM-05 |
| Submit: iqama clock notice | non-Saudi with no iqama → notify gov «إصدار الإقامة خلال 90 يوماً» | visa arrival only → `hr_iqama_clock` to gov | 🟡 a transfer or local non-Saudi with no iqama date gets no notice | DC-05 P0 R1 |
| Submit: log + open file | log «سُجّل موظفاً جديداً — <src> · فترة التجربة حتى …», then opens the drawer | log `created`, then routes to `/hr/people/{id}` | ✅ | EM-06 P0 R1 |

### Form: assign — أسند / انقل / Assign or move

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | `CAN('assign')` (hr) on an active employee; Today row «تصحيح إسناد» opens `assign:<e>:<site>` | `EmployeeActionDialog` action `move`, guard `employee.assign` = manager | ✅ | AS-01 P0 R1 |
| `to` destination | optBtn per site except the current one. A project shows «ينتهي <end> · N <trade>» (same-trade headcount). Bench shown when not on bench, with «يبقى على الأجر بلا إنتاج». Prefilled from `b` | `SearchableSelect` Unassigned + active sites. No end date or same-trade headcount on options | 🟡 options lack the project end date and the same-trade count | AS-01 P0, AS-04 P1 R1 |
| `eff` effective | date. Default = the pending fix's `since`, else today | `effectiveOn` default today (`no_date`) | ✅ | AS-03 P1 R1 |
| `src` trigger | select «قرار الموارد البشرية» or a manpower request `MREQ` for that site. Submit pushes the plan into `mm.plan` | — | ❌ a move cannot name the manpower request it answers | AS-02 P0 R1 |
| Block: expired iqama | `!legalOnSite(e)` → red; only bench allowed | `assignBlocks` `iqama_expired` | ✅ | DC-02 P0 R1 |
| Block: expired driving licence | `!canDrive(e)` → red; Confirm disabled when the target kind is fleet/prj/wh | — (`mayDrive` exists in `lib/hr/documents.ts` but is only used in manpower coverage) | ❌ | DC-06 P1 R1 |
| Same place / left | (current site is excluded from the options) | `same_place`, `left` | ✅ | AS-01 |
| Info | «تُبلَّغ إدارة المشاريع بالإسناد؛ ومركز التكلفة يتبع الإسناد من تاريخه» | `move.cost_note` (cost only) | 🟡 Projects is not notified | AS-01 |
| Submit: site + history | `e.site=to`, `e.hist.push({from,to,at,by})`, `benchSince` | `assignEmployee`: `siteId` + log `moved {from,to,on}` | ✅ | AS-03 P1 R1 |
| Submit: effective date | `hist.at = eff` | the site changes **now**. `effectiveOn` is only written to the log | 🟡 a future-dated move takes effect at once. Payroll cost follows `siteId` now, not "from this date" | AS-03 P1 R1 |
| Submit: close pending corrections | pending `fix` REQs for the employee → `ok` if the target equals their site, else `no` | — (an `hrAssignFixes` correction stays pending after a manual move) | ❌ | AS-03 P1 R1 |
| Submit: notify Projects | log `mod:'pm'`; toast «أُبلغت إدارة المشاريع» | — | ❌ | AS-01 P0 R1 |

### Form: mr — الردّ على طلب العمالة / Answer a manpower request (2 steps)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | HR (`answer`) from Today «اقرأ وردّ» / notification `form:mr:<id>` | `components/hr/HrManpowerPanel.tsx` "Answer with the plan", guard `manpower.answer` = manager | ✅ | AS-02 P0 R1 |
| Request number | `NX(mr.no)` in the title | `manpowerRequests` has no number | 🟡 no request number | AS-02 |
| Steps | Coverage → Answer | one dialog | 🟡 single step (PRD form 5 says 2 steps) | AS-02 P0 R1 |
| KPIs step 1 | «في الموعد» on time · «بعد الموعد» late · «بلا تغطية» uncovered · «مستبعدون» excluded (count) | "Covered X of N" only | 🟡 no on-time/late split and no uncovered or excluded counts | AS-02 P0 R1 |
| Coverage rows | `cover(mr)`: one row per person (name, trade, now at) or per visa batch (nationality, «تأشيرة صدرت»), source `covSrc` + date; amber when the date is after the need date | `coverage()` lines: source × count × date + names; same order unassigned → site_ending (7 days) → visa (+90) → hire (+90) / ajeer (+45) | 🟡 grouped by source, not per person; lateness against the need date is not flagged | AS-02 P0 R1 |
| Excluded by name | rows «مستبعد — إقامة منتهية / رخصة منتهية» | `excluded` names + reason (iqama_expired / licence_expired) | ✅ | AS-02 P0 R1 |
| `rest` remainder choice | when short: optBtn hire «توظيف خارجي» (FIRM.visas, arrival POL.visaLead) · xfer «نقل خدمات» (~30 days, counts in headcount and Nitaqat) · ajeer «أجير مؤقت» (cost ≈ TR×1.35×POL.ajeerX/month; disabled when `POL.ajeer` is off) · none «لا نغطي الباقي». Default ajeer if allowed, else hire. Next disabled until chosen | — both `hire` AND `ajeer` lines are listed for the same remainder; no choice, no transfer-of-services option, no "leave uncovered" | ❌ | AS-02 P0 R1 |
| Ajeer cost estimate | ≈ riyals/month per worker | label "×1.4 cost" only | 🟡 | AS-02 |
| Ajeer allowed policy | `POL.ajeer`, `POL.ajeerX` | — (fixed `COVERAGE.ajeerCostFactor` 1.4) | ❌ see `pol` | ST-01 P0 R1 |
| Step 2 summary | green «الردّ: X في الموعد · Y بعده · Z <rest>» | — | ❌ | AS-02 |
| `note` to the PM | textarea | `note` | ✅ | AS-02 |
| Info | «عند الإرسال: يُسند من هم بلا إسناد الآن، ويُجدول الباقون…» | `mp.plan_note` (the order only) | 🟡 | AS-02 |
| Submit: bench assigned now | every `src==='bench'` row: `e.site=mr.site`, hist, log mod pm | — the answer is stored only; nobody is moved | ❌ | AS-02 P0 R1 |
| Submit: site-ending scheduled | `e.planned={to:mr.site,at:when}` + log «مجدول للنقل» | — | ❌ | AS-02 P0 R1 |
| Submit: visas reserved | `r.v.used++`, `r.v.to=site` | — | ❌ | AS-02 |
| Submit: plan + state | `mr.state='answered'`, `ansAt`, `plan=[[src,n,when]…]`, `short` (if rest none), `rest` | `answerManpowerRequest`: state answered, `answer {plan, excluded, note, by, at}` | 🟡 no `rest`/`short` fields | AS-02 P0 R1 |
| Submit: notify Projects | toast «أُرسل الردّ لإدارة المشاريع» (the PM acks the plan in the sim, `ack`) | `hr_manpower_answered` to the requester; the plan is shown on the project's Team tab | ✅ (no "plan accepted/objected" step) | AS-02 P0 R1 |

### Form: xreq — عامل يعمل عندي وليس في قائمتي / Assignment correction

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | supervisor's sheet button `xreq:` (1082) | `components/hr/HrAssignFixPanel.tsx` "raise", guard `assignment.correct` (manager, supervisor on his site) | ✅ | AS-03 P1 R1 |
| `e` who | select of active employees not on this site, bench first, «<name> — <trade> · <site>» | manager: `SearchableSelect` of non-left employees elsewhere. Supervisor: **ID number + name** (he cannot read other records, RL-01) | ✅ (adapted to RL-01) | AS-03, RL-01 P0 R1 |
| `since` | date, default today−3 | `since` default today, max today. Blocks `future`, `no_date` | ✅ | AS-03 |
| `why` note | textarea (optional) | `note` optional | ✅ | AS-03 |
| Info | «تصحيح إسناد لا طلب عمالة — طلب العمالة الجديد يُرفع من <module>» | `fix.not_manpower` | ✅ | AS-03 |
| Blocks | Send disabled without `e` | `same_place`, `left`, `pending` (one open per person), `future` | ✅ (stricter) | AS-03 |
| Submit | REQ `{k:'fix', no:nextNo('tr'), e, site, since, state:'pend', why}`; notify HR `form:assign:<e>:<site>` | `raiseAssignFix` → `hrAssignFixes` pending + `hr_assign_fix_raised` | 🟡 no number (`nextNo('tr')`) | AS-03 P1 R1 |
| HR decision | via the `assign` form prefilled (to = the site, eff = since); a move elsewhere declines it | Correct (moves from `since`) / Decline with a mandatory reason; `hr_assign_fix_decided` notice | ✅ | AS-03 P1 R1 |

### Form: leave — قرار الإجازة / Leave decision

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | HR (`approve`) from Today «قرّر» (888); the HR manager's own → management (909) | `components/hr/HrRequestList.tsx` approve/decline dialog via `requestActions`; `deciderLevel` management for the HR manager's own | ✅ | LV-05 P0, RL-02 P0 R1 |
| Title | «إجازة <type> ط.إ<no> — <name>» | the dialog shows the action; the description shows the number · name · type · dates · days | ✅ | LV |
| Sub | trade · site · from–to · days · effect `leaveEffect().tx` (−deduction ﷼) · note | the `what()` line: type · dates · days | 🟡 no trade/site, no pay effect or deduction amount | LV-02 P0 R1 |
| KV balance as of start | «الرصيد المستحق حتى بداية الإجازة (<date>)» + «N عطلة رسمية لا تُحتسب» | — (computed when filed, stored as `leave.balance`, not shown at decision) | ❌ not displayed | LV-02 P0 R1 |
| KV sick used | «المرضية هذه السنة قبل الطلب N من 120» | — | ❌ | LV-06 P0 R1 |
| KV supervisor endorsement | «توصية المشرف: <by> — يوصي / لا توصية بعد» | state pill "endorsed" only; the endorser and note are not shown | 🟡 | LV-05 P0 R1 |
| KV workplace during | «مكان عمله خلالها: <site> · N <trade> غيره» (same-trade cover) | — | ❌ | LV-05 |
| KV ticket | «مستحقة — قائمة تحقق لا مانع» (non-Saudi) | — | ❌ | LV-08 P1 R1 |
| Block: travel docs | non-Saudi with iqama/passport ≤ `q.to` → red «لا سفر قبل التجديد… جدّد أولاً أو قصّر الإجازة»; Approve disabled | `leaveQuote(...,{deciding:true})` blocks `travel_docs` **only when written** (error toast); the dialog does not pre-check | 🟡 the blocking fact is not shown before clicking | LV-04 P0 R1 |
| Over balance | red «تتجاوز الرصيد بـN»; options `ok` = «N يوماً فقط — حتى <from+bal−1>» / `unpaid` = «N يوماً تُخصم ≈ <wage/30×over> ﷼» | `req.mode` balance_only (with the end date) / excess_unpaid (days, no riyal estimate) | 🟡 no riyal estimate of the unpaid deduction | LV-03 P0 R1 |
| `dec` options | ok / unpaid / no | approve (mode when over) / decline | ✅ | LV-05 |
| `why` | required when `dec==='no'` | decline note required | ✅ | LV-05 |
| Submit: approve | `state ok`; annual: `taken += min(days,bal)`, `to` cut or `unpaid=days−bal`; sick: `sick+=days`, attendance s75/s0; unpaid/hajj flags; log | `decideRequest`: `leaveTaken += fromBalance`, `sick {year,days}`, `hajjTaken`, `leave.to/unpaidDays/mode`; log | ✅ | LV-01..06 P0 R1 |
| Submit: notify gov | «إجازة معتمدة — خروج وعودة قبل <from>» | `hr_exit_reentry` to gov for a non-Saudi leave abroad (not sick or Hajj) | ✅ | LV-08 P1 R1 |
| Submit: decline | `state no`, `why`, log | declined + decision note + log + `hr_request_decided` to the employee | ✅ | LV-05 |

### Form: reqleave — طلب إجازة / Leave request

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | HR (`approve`) or the employee, on an active record (drawer, My file) | `components/hr/NewRequestDialog.tsx` kind leave: the HR manager from the file, the employee from My file (`fileRequest`: own or manager) | ✅ | LV-05, ES-02 P0 R1 |
| `type` options | `Object.keys(LT).filter(leaveAllowed)`: hides female-only for men, Hajj under 2 years or already taken. Sub-label from LT | all `LEAVE_TYPES` in a select (with the statutory days); ineligible types are **blocked** (`female_only`, `min_years`, `once_taken`) | 🟡 ineligible types are listed then refused, instead of hidden | LV-01 P0 R1 |
| `from` / `to` | dates, default today+14 / today+18 | empty by default; `bad_dates` | ✅ | LV |
| Sub: balance as of start | «الرصيد حتى بداية الإجازة N · العطل الرسمية داخلها لا تُحتسب» | KV `balance_at_start`, `from_balance`, `unpaid_days` | ✅ | LV-02 P0 R1 |
| KV days / effect | days (holidays excluded) · effect `lef.tx` −deduction ﷼ | days · from balance · unpaid days · sick split (full / ¾ / unpaid) | 🟡 no riyal deduction estimate | LV-02/LV-06 |
| KV sick this year | «المرضية هذه السنة N من 120» | sick split line only | 🟡 no "N of 120 used" | LV-06 P0 R1 |
| Warn: over balance | amber «تتجاوز الرصيد بـN — يقرّر مدير الموارد البشرية» | warning `above_balance` | ✅ | LV-03 P0 R1 |
| Block: overlap | an existing leave REQ (not `no`) or a current leave → red; Submit disabled | `overlap` against pending/endorsed/approved requests | ✅ | LV |
| Block: beyond 120 sick days | `sickSplit().over>0` → **red block** «ما بعدها خارج النظام: قرار إداري… لا طلب إجازة» | warning `sick_beyond` ("HR decides"); it is filed | 🟡 prototype blocks; ours warns | LV-06 P0 R1 |
| Too long for the type | (days fixed by LT; not checked) | `too_long` (extra) | ✅ extra | LV-01 |
| Travel docs | non-Saudi, iqama/passport ≤ to → red «لن تُعتمد للسفر قبل التجديد؛ يبقى الطلب مسجّلاً وتُبلَّغ العلاقات الحكومية» (not disabling) | warning `travel_docs` in red (filed) | 🟡 government relations is not notified when filed | LV-04 P0 R1 |
| Ticket checklist | non-Saudi + annual: «تذكرة سفر مستحقة — تُحجز بعد الاعتماد» | — | ❌ | LV-08 P1 R1 |
| `note` | — | free note (extra) | ✅ | — |
| Submit: number | `nextNo('lv')`, REQ k leave, `ticket` flag | `drawYearlyDocNumber` `LV-yyyy/NNN` (ط.إ) | 🟡 no `ticket` flag | LV-08 |
| Submit: HR files for another | **recorded and approved at once** (`state ok`, balance/sick applied) — «سُجّلت واعتُمدت» | filed `pending` with `onBehalf: true`; it waits in the HR manager's own queue | 🟡 an extra approval step for what HR records itself | LV-05 P0 R1 |
| Submit: HR manager's own | notify `role:mgmt` «طلبك أنت — يعتمده المدير العام» | `deciderLevel: management`, `hr_request_filed` to management | ✅ | RL-02 P0 R1 |
| Submit: routing | notify HR; «يمرّ بمشرفك ثم بمدير الموارد البشرية» | `hr_request_filed` to the decider + `hr_leave_to_endorse` to the line manager/supervisor | ✅ | LV-05 P0 R1 |

### Form: adv — قرار السلفة / Advance decision

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | HR (`approve`) from Today / Requests; the HR manager's own → management | `HrRequestList` approve/decline; `deciderLevel` | ✅ | AD-03, RL-02 P0 R1 |
| Title | «سلفة ط.س<no> — <name>»; sub amount · reason | description: number · name · "Advance · amount" (pay roles) | 🟡 the reason is not shown in the dialog | AD |
| KV wage / limit | «الأجر الشهري» · «حدّك = wage×POL.advMax (راتب شهر)» | — | ❌ | AD-03 P0 R1 |
| KV outstanding | pill with the outstanding balance or «لا» | — (refused at write: `outstanding`) | 🟡 not shown before deciding | AD-02 P0 R1 |
| KV instalment schedule | «القسط — 10% من الأجر (م.92)»: `i × (n−1) + r = amt` | — (stored `instalment`/`months`, not shown) | ❌ | AD-01 P0 R1 |
| Warn: past contract | `ceil(amt/inst)*30 > docs.ct` → amber «السداد يتجاوز نهاية العقد… الباقي من المخالصة» | `past_contract` only on the request form, not at decision | 🟡 | AD-04 P1 R1 |
| Block: outstanding | red «سلفة قائمة لم تُسدَّد»; the Approve option is disabled | `advanceQuote` `outstanding` blocks the write (toast) | 🟡 not pre-checked in the dialog | AD-02 P0 R1 |
| Over limit | amber «فوق حدّك — يُحفظ برأيك ويذهب للمدير المالي»; the button reads «أوصِ وأرسل للمالية» | `req.over_limit_note`; approve → state `finance` + `financeHold` + `hr_advance_to_finance` | ✅ | AD-03 P0 R1 |
| `dec` | ok / no (no reason needed to decline) | approve / decline (a reason is **required** to decline) | ✅ (stricter) | AD |
| Submit: approve | `state ok`; `ee.adv={amt,bal,inst}`; `sched=1`; log mod fin «طلب صرف للمالية» | `employeePay.advance {amount,balance,instalment}`; state approved; log; employee notified | ✅ | AD-01 P0 R1 |

### Form: reqadv — طلب سلفة / Advance request

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | HR or the employee (button disabled when `e.adv`) | `NewRequestDialog` kind advance: the HR manager (with pay view) or the employee | ✅ | ES-02 P0 R1 |
| Sub | «الأجر الشهري N ﷼» | — | 🟡 wage not shown | AD |
| Block: outstanding | red «لديك سلفة قائمة — الباقي N بقسط M شهرياً. لا سلفة ثانية» | `outstanding` (also a pending advance request) with no balance figures | 🟡 the balance and instalment are not quoted | AD-02 P0 R1 |
| `amt` | number min 100 step 100 | `amount` > 0 (`bad_amount`) | ✅ | AD |
| `why` | required | `reason` required (`no_reason`) | ✅ | AD |
| KV instalment / months | «القسط الشهري — 10% (م.92)» · «يكتمل السداد خلال N شهراً» | `instalment`, `months` | ✅ | AD-01 P0 R1 |
| KV who decides | «مدير الموارد البشرية» / «المدير المالي — فوق حدّ الموارد البشرية» | warning `over_limit` (decided in Finance) | ✅ | AD-03 P0 R1 |
| Past contract | — | warning `past_contract` (extra) | ✅ extra | AD-04 P1 R1 |
| Submit | REQ `{k:'adv', no:nextNo('ad'), amt, inst:months, why}`; notify HR | `AV-yyyy/NNN` (ط.سل), `hr_request_filed` | ✅ | AD |

### Form: doc — تسجيل تجديد / تسجيل إصدار / Record a renewal or issue

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | `ROLE()==='gov'` and non-Saudi (drawer); Today renewal rows; the iqama clock | `EmployeeActionDialog` action `renew`, guard `documents.manage` = manager, gov | ✅ | DC-03 P0 R1 |
| Title | «تسجيل إصدار» when the iqama is still pending (`docs.iq===null`), else «تسجيل تجديد» | always "Record a renewal" | 🟡 no "record issue" wording for a pending iqama | DC-05 P0 R1 |
| `k` document | optBtn over the employee's own `docs(e)` minus `ct`, each with «لم تصدر» / «منتهية <date>» / «تنتهي <date>» | select of all `DOC_TYPES` (iqama, passport, insurance, **contract**, licence, forklift) with no current state shown | 🟡 lists documents the person does not hold (licence for a non-driver, iqama for a Saudi) and shows no current expiry. "contract" is renewable here while `contract.end` lives elsewhere | DC-01/DC-03 P0 R1 |
| Block: passport first | iqama + `ppBeforeIq(e)` → red «لا تُجدَّد الإقامة على جواز ينتهي <date>» | `renewalBlocks` `passport_first` | ✅ | DC-03 P0 R1 |
| `exp` new expiry | date, required | `expiry`; `bad_date` (future required), `not_later` (extra) | ✅ | DC-03 |
| `fee` | optional number «تُطلب من المالية إن كُتبت» | `fee` → `hrEvents` `hr:PR:DOC:<no>:<doc>:<expiry>` payment request; `bad_fee` | ✅ | DC-03 P0 R1 |
| `ins` checkbox (iqama only) | «التأمين الطبي جُدّد بنفس المدة (شرط التجديد)»; sets `docs.ins` to the same date | — | ❌ | DC-04 P1 R1 |
| Submit: arrival clock | iqama: clears `e.arrived` | the iqama clock reads `docs.iqama` (`iqamaOverdue`) | ✅ | DC-05 |
| Submit: log | «صدرت/جُدّدت <doc> حتى <date> — رسوم N طُلبت من المالية» (mod fin) | log `renewed {doc, from, to, fee}` | ✅ | EM-06 |
| Submit: notify HR | iqama renewed and not on bench → «جُدّدت إقامة <n> — يمكن نقله وإسناده» | — | ❌ | DC-02 P0 R1 |

### Form: exit — إنهاء خدمة / End service

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | `CAN('exit')` (hr) on an active employee | `StartExitDialog` (`components/hr/HrExitPanel.tsx`), guard `exit.manage` = manager, not own | ✅ | EX-01 P0 R1 |
| `k` reason | resign «استقالة» / term «إنهاء من الشركة» / end «انتهاء العقد». Each option shows `EOS <amount>` when money is visible. Default resign | `EXIT_REASONS` resignation / termination_notice / termination_pay / contract_end / probation; no amount per option | 🟡 no gratuity shown per reason | EX-01/EX-02 P0 R1 |
| `last` last day | date, default today+30, required | `lastDay` required; `last_before_join` | ✅ | EX-01 |
| `notice` (term) | served «بإشعار 60 يوماً (م.75)» / pay «بدل إشعار — شهران = <2×wage> ﷼ يُضاف للمخالصة» | split into two reasons + `noticeOn` date | 🟡 the pay-in-lieu amount is not quoted | EX-01 P0 R1 |
| Art. 77 | amber always for term: «إنهاء بلا سبب مشروع يُعوَّض (م.77)…»; comp computed automatically at settlement | `art77` checkbox (termination only), used by the settlement | ✅ (explicit flag) | EX-01 P0 R1 |
| Info | «يبدأ مسار الخروج: إخلاء العهدة · المخالصة · الصرف · الخروج النهائي» | `exit.custody_note` | ✅ | EX-03 |
| Blocks | Start disabled without `last` | `no_reason`, `no_last_day`, `left`, `probation_over`, `contract_open` | ✅ (stricter) | EX-01 |
| `note` | — | free note (extra) | ✅ | — |
| Submit | `e.st='exit'`, `exit {k,last,custody:2,notice}`; log mod inv «طُلب إخلاء العهدة» | `startExit`: `hrExits` leaving + `custody.requested`; `hr_custody_requested` to Inventory, `hr_exit_started` to gov | ✅ | EX-03 P0 R1 |

### Form: fs — مخالصة / Settlement (2 steps)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | `CAN('exit')`, once `custody===0` (otherwise a wait badge on Inventory); notification after clearance | the `HrExitPanel` "Approve the settlement" button, disabled until `custody.state==='cleared'` (callout `exit.block.custody`) | ✅ | EX-03 P0 R1 |
| Steps | الحساب → الإرسال | one panel with a live preview and an approve button | 🟡 single step | EX-04 P0 R1 |
| Gratuity line | `eos(e,resign/prob/term)` with the explanation «نصف شهر × N سنة + شهر × M = … · الاستقالة بين 2 و5: الثلث (م.84–85)» | `gratuity` with service y/m/d; resignation share in `lib/hr/eos.ts`. The explanation (bands / share) is not spelled out | 🟡 no "how computed" text | EX-02 P0 R1 |
| Leave balance in cash | `leaveBal × wage/30` | `leaveCash` (days) | ✅ | EX-04 |
| Last month days | `wage/30 × days` | `lastPay` from `settlementLastMonth` (absences, sick, penalties, GOSI); "already paid" variant | ✅ (richer) | EX-05 P0 R1 |
| Notice pay | `term && notice==='pay'` → 2×wage | `noticePay` | ✅ | EX-01 |
| Art. 77 compensation | term: open contract 15 days×years; fixed: remaining contract wage | `art77` / `art77_fixed` (remaining days) | ✅ | EX-01 |
| `ticket` | checkbox «تذكرة العودة», default ON for a non-Saudi, fixed 1,200 ﷼ | `ticket` free amount input (pay roles), default empty | 🟡 no default for non-Saudis; amount typed | EX-04 P0 R1 |
| Advance deduction | − outstanding advance | `advance` | ✅ | EX-04 |
| Custody shortfall | — | `custody` deduction (extra) | ✅ extra | EX-03 |
| Net | «صافي المخالصة» | `net` | ✅ | EX-04 |
| Step 2: posting preview | «كيف ستقيّده المالية»: 2108 from provision = gratuity · <cc> leave/days/ticket/comp · 1205 advance settled · 2106 payable = net | — | ❌ no posting preview (Finance posts via `postHrSettlement`) | EX-04 P0 R1 |
| Info | «تُرسل للمالية طلب صرف · تصدر شهادة الخدمة تلقائياً (م.64) · يخرج من مسير الشهر بعد آخر يوم» | — (the effects happen; nothing says so before) | 🟡 | EX-04/EX-05 |
| Submit | `exit.settled=1`, `net`; REQ letter `exp` issued with serial `خ-2026/n`; log mod fin; toast «أُرسلت المخالصة للمالية» | `approveSettlement`: `hrSettlements` + `hrEvents` `hr:FS:<no>` + experience letter (`hrLetters`, issued) + `hr_settlement_approved` | ✅ | EX-04/EX-05 P0 R1 |

### Form: ct — عقد <name> ينتهي <date> / Contract renewal decision

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | Today rows (898–899) «قرّر» / «قرّر واحداً واحداً» for fixed contracts nearing their end; sub «بلا قرار يتجدّد لمدة مماثلة» | Today `contract_end` row (`lib/hr/today.ts`, 60 days) → opens the person page only | ❌ no decision form | EX-01 P0 R1 (contract end); TD-02 P0 R1 |
| `dec` | renew «جدّد سنتين — حتى <ct+730>» / end «لا تجدّد — يبدأ الإنهاء بانتهاء العقد — EOS <amount>» | — (the only path is `StartExitDialog` with `contract_end`; there is no way to extend `contract.end`) | ❌ | EX-01 P0 R1 |
| Submit renew | `docs.ct += 730`; log «جُدّد العقد حتى…»; «يوثَّق في قوى يدوياً» | — (`recordRenewal` with type `contract` writes `docs.contract`, not `contract.end`) | ❌ | EM-01 |
| Submit end | `st='exit'`, `exit {k:'end', last:ct, custody:0}`; log | `startExit` reason `contract_end` (manual) | 🟡 | EX-01 |

### Form: iban — تصحيح الآيبان / Fix IBAN

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | Today «حوالة مرتجعة» row (924) for payroll | `IbanActions` in `components/hr/HrEmployeeFile.tsx` when `ibanState==='returned'`, guard `iban.fix` = payroll (+owner) | ✅ | PY-03 P0 R1 |
| Sub | «أعاد البنك حوالة <month> <net> ﷼» | callout `iban.returned` (no amount or month) | 🟡 the bounced amount and month are not shown | PY-03 |
| `iban` | text; hint «من كشف حساب الموظف — لا يُكتب من الذاكرة»; button enabled only on `/^SA\d{2}[A-Z0-9]{18,22}$/` | inline input; enabled on non-empty; `fixIban` refuses unless `/^SA\d{22}$/` (`bad_iban`) | 🟡 validated at the write, not before the click; no source hint | PY-03 P0 R1 |
| Info | «بعد التصحيح تعود الحوالة للمالية لإعادة الصرف» | the `iban.fixed` callout | ✅ | PY-03 |
| Submit | `iban='fixedp'`, `ibanNew`; log; notify HR `do:ibanok` | `ibanState: fixed`, `ibanFixedBy`; `hr_iban_to_approve` to the manager | ✅ | PY-03, RL-02 P0 R1 |

### Form: firm — ملف المنشأة / Establishment file

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | setup checklist (957) for HR | `components/hr/HrSettingsView.tsx` panel Establishment, guard `settings.manage` = manager | ✅ (a panel, not a modal) | ST-04 P1 R1 |
| `n` / `en` names | Arabic + English, `n` required | one `name` field, not required | 🟡 no English name; no required check | ST-04 |
| `cr` CR number | required | `cr` optional | 🟡 not required (prototype: «بلا سجل تجاري ورقم منشأة لا خطاب ولا ملف أجور») | ST-04 P1 R1 |
| `mol` Qiwa number | required | `mol` optional | 🟡 | ST-04 |
| `gosi` | text | `gosi` | ✅ | ST-04 |
| `mudad` Mudad establishment no. | text; printed on the WPS file | — | ❌ | PY-07 P0 R1, ST-04 |
| `band` Nitaqat band | select green/yellow/red | — | ❌ (ST-04: "numbers, band and visas") | ST-04 P1 R1 |
| `minPct` green threshold % | number 0–100 «من جدول نطاقات لنشاطك وحجمك» | — | ❌ | ST-04 |
| `visas` | number ≥0 «صفر يمنع تسجيل وافد جديد» | `visas` + `visasAsOf` (extra) | ✅ | ST-04 |
| `city` | in the init only (not rendered) | — | ✅ n/a | — |
| `ctype` business type | `CO==='new'` only: optBtn CTYPES; applies `FDEF` once | `businessType` select + `withBusinessType` (once) | ✅ | ST-06 P1 R1 |
| `asOf` | `FIRM.asOf=0` on save | only `visasAsOf` | 🟡 no as-of date for the band | ST-04 |
| Submit | `Object.assign(FIRM, …)` | `saveHrSettings` (whole doc) | ✅ | ST-04 |

### Form: site — مكان عمل جديد / New workplace

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | setup checklist (958) | `components/hr/HrSitesView.tsx` add/edit dialog | ✅ | AS-01 P0 R1 |
| `n` / `en` | Arabic + English; `n` required | `name` required (`no_name`) | 🟡 no English name | AS-01 |
| `k` kind + cost account | optBtn prj 5102 · ws 5107 · wh/fleet/shop 6108 · dept/hq 6101, each showing «<cc> <CCN>» | `SITE_TYPES` select; cost kind via `costKindOf` (direct/workshop/distribution/admin) | 🟡 the option does not show the account it posts to | AS-01, PY-01 P0 R1 |
| `end` project end | **required** for prj (`offFromDate(end)`) «يُقرأ من إدارة المشاريع في المنتج» | `endDate` optional; `projectId` **required** for project (`project_needed`) | 🟡 end date optional. Coverage (AS-02) needs it for "site ending" | AS-02 P0 R1 |
| Project link | — | `projectId` (extra; the product reads from Projects) | ✅ extra | AS-01 |
| Supervisor | via the `user` form (role sup + site) | `supervisorUserId` on the workplace (extra) | ✅ | RL-01 |
| `shifts` | wh/ws/fleet: «يعمل بورديات» | — | ❌ | PT P1 R2 · optional: punch |
| Submit | `addSite({…cc})`; «أُضيف <site> — حسابه <cc>» | `saveSite` | ✅ | AS-01 |

### Form: pol — سياسات الشركة / Company policies

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | setup checklist (959) | `HrSettingsView` Policies panel, guard `settings.manage` | ✅ | ST-01 P0 R1 |
| `advMax` | number ≥0 step 0.5 «فوقه المدير المالي» | `advanceMaxMonths` input min 1 step 1 (stored 0 < x ≤ 12) | 🟡 the UI step prevents half-month limits | AD-03, ST-01 |
| `payDay` | 1–10 «حماية الأجور تراقب التأخير» | `payDay` (stored 1–28) | ✅ | ST-01 |
| `renewWin` | ≥15 | `renewWindowDays` (1–365) | ✅ | ST-01 |
| `ajeer` allowed | select allowed / not | — | ❌ | AS-02 P0 R1, ST-01 |
| `ajeerX` multiplier | number ≥1 step 0.1 | — (hard-coded `COVERAGE.ajeerCostFactor = 1.4`) | ❌ | AS-02 |
| Housing / transport shares | — (fixed 25/10) | `housingShare`, `transportShare` (extra) | ✅ extra | ST-01 |
| closeMissing | — (in `POL.strict`, settings) | `closeMissing` block/warn | ✅ | ST-03 P1 R1 |
| Statutory note | «ثابت من النظام: الإجازة 21/30 · المرضية 30/60/30 · … التأمينات 9.75%+11.75% و2%» | Statutory panel (read-only, richer) | ✅ | ST-01 P0 R1 |
| Validation | Confirm disabled unless `advMax>0 && payDay>0 && renewWin>0` | none shown; `resolveHrPolicies` silently resets bad values to defaults | 🟡 an invalid value is replaced without being said | ST-01 |
| Submit | `Object.assign(POL,…)`, `FLAGS.polOk` | `saveHrSettings` | ✅ | ST-01 |

### Form: user — عضو في الفريق / Team member

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | setup checklist (960) for HR | — the platform team / invitations page + seeded HR groups (`employees.manage`, `hr.gov`, `hr.payroll`, `hr.supervisor`, `hr.management`); the record is linked with `EmployeeActionDialog` `link` | 🟡 done differently: two places, not one form | RL-01 P0 R1, form 31 |
| `role` | optBtn gov / pay / sup / hr with role descriptions | the group on the team page | 🟡 | RL-01 |
| `n` / `en` / `nat` | name, English, nationality | — an employee record is made separately (`newemp`) | 🟡 | RL-01 |
| `site` (sup) | the workplace he supervises | `supervisorUserId` on the workplace | ✅ (elsewhere) | RL-01 |
| `basic` | number, placeholder = trade ref | via `newemp` | 🟡 | — |
| Block: Saudi-only trade | role trade (pro/acc/frm/hrs) localized and non-Saudi → red | — | ❌ (no role↔trade link) | EM-03 |
| Submit | `mk()` employee with the role trade + `USERS.push({e, role, site})` | — | 🟡 | RL-01 |

### Form: inj — بلاغ إصابة عمل / Work-injury report

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | hr / gov on an active employee; Today row (918) | `components/hr/HrInjuryPanel.tsx` "report" on an unreported injury, guard `injury.report` = gov, manager | ✅ | DC-07 P0 R1 |
| Recording the injury itself | (exists before: `e.injury {d, at}` in the data) | "Record injury" (`injury.record`: manager, the site's supervisor): `on` + description; due = 3 working days | ✅ extra | DC-07 P0 R1 |
| `rep` reported on | date, default today, required | `on` date (max today), required | ✅ | DC-07 |
| `ref` reference | text, required «من منصة التأمينات — يُسجَّل يدوياً» | `no` text, required | ✅ | DC-07 |
| Info | «العلاج والأجر خلاله على التأمينات — لا تُخصم أيامها مرضيةً من المسير» | — | 🟡 the note is missing (the payroll effect is outside forms) | DC-07 |
| Submit | `injury.rep/ref`; log | `recordInjuryReport` | ✅ | DC-07 |

### Form: viol — تسجيل مخالفة / Record a violation

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | `CAN('att')` (hr, pay, sup) from the drawer or the sheet row (1081) | `RecordViolationDialog` (`components/hr/HrViolationList.tsx`) from the file and `HrSiteWorkers`; guard `violation.record` = manager, supervisor (site) | 🟡 payroll cannot record (prototype `att` includes pay) | PN-01 P0 R1 |
| `e` employee | select: `scope()` active; a supervisor sees labour category only | fixed to the file or row the dialog was opened from | ✅ (entry differs) | PN-01 |
| `code` | optBtn per `VIOL` code, each with «التكرار N ⇐ <penalty>» for the chosen employee | `VIOLATION_CODES` select; no occurrence or penalty preview | 🟡 the step and penalty preview per code is missing | PN-01 P0 R1 |
| `when` | date ≤ today | `on` max today (`future`) | ✅ | PN-01 |
| Recorded by | auto «من سجّلها: <name>» | stamped by the write | ✅ | — |
| `note` «ما حدث» | **required** | optional | 🟡 the prototype requires what happened | PN-02 P0 R1 |
| Info | «الغياب يُسجَّل في الحضور… المخالفة هنا للجزاء التأديبي فقط… بعد استجواب العامل (م.71)» | `vio.record_desc` | ✅ | PN-02 |
| Duplicate | — | `exists` (one per employee/day/code) | ✅ extra | PN |
| Submit | REQ `{k:'viol', no:nextNo('tr'), code, note, by}`; notify HR `form:pen` | `hrViolations/{org}__{emp}__{day}__{code}` state recorded; `violationRecordedNotice` | ✅ | PN-01 |

### Form: pen — مخالفة — قرار الجزاء / Penalty decision

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | HR from Today «قرّر» (904) | `HrViolationList` "decide" (`violationWaits`: `penalty.apply` = manager, not own) | ✅ | PN-02 P0 R1 |
| KV occurrences in 180 days | «N سابقة» + the dates of prior same-code ones | the step number only | 🟡 no prior dates | PN-01 P0 R1 |
| KV penalty per regulation | `penTx(pc.x)` = amount ﷼ | step, kind, amount (pay roles) | ✅ | PN-01 |
| KV fines this month + cap | «غرامات هذا الشهر N — السقف M (أجر 5 أيام)» | — (`vio.cap_note` text; the payroll applies the cap) | ❌ not quoted | PN-03 P0 R1 |
| Over cap | red «يتجاوز سقف الشهر… يُخفَّض إلى N ﷼ ولا يُرحَّل» | — | ❌ (the reduction is applied silently at payroll) | PN-03 P0 R1 |
| `inv` hearing date | date, required to apply «واقعة لا مربّع — بلا استجواب لا جزاء» | `hearingOn` required, ≥ violation day, ≤ today; plus `hearingNote` | ✅ | PN-02 P0 R1 |
| `dec` | ok «طبّق — يُبلَّغ كتابةً · الاعتراض 15 يوماً» (disabled without `inv`) / no «احفظه بلا جزاء» | Apply / Dismiss (dismiss **requires a note**) | ✅ | PN-02/PN-04 |
| Submit apply | `ee.pen.push({m:CURM, amt=min(pc.amt, cap−sofar), step, inv, objectBy:15})`, viol applied; log | `decidePenalty` apply: `amount` (before cap), `deductMonth`, `notifiedOn`; objection window | ✅ (the cap moves to payroll) | PN-03/PN-04 |
| Submit dismiss | `viol.applied=0`, «لا تُعدّ تكراراً» | dismissed; not counted as a step | ✅ | PN-01 |

### Form: prob — فترة تجربة / Probation

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | `CAN('approve')` when probation ends within 30 days and the employee is active; Today (905) «بلا قرار يصبح مثبَّتاً» | `EmployeeActionDialog` `probation`, guard `request.decide`, `probationState==='on'`, not own | ✅ | EM-05 P0 R1 |
| Line manager's view | `x5ProbBox(e)`: the `pe` assessment (rec ok/ext/end) or «لا تقييم… غير مانع» | — | ❌ | EM-05 P0 R1 (view part: PF · optional: perf R3) |
| `dec` | ok «ثبّت — دائم من تاريخ التحاقه» / ext «مدّد — متاح <maxExt> يوماً» (disabled at 0) / end «أنهِ — بلا مكافأة ولا إشعار» | confirm / extend / end (select) | ✅ | EM-05 |
| `ext` days | number 1..maxExt (= 180 − elapsed) | `extTo` date (max `probationMaxEnd`); blocks `extend_too_long`, `extend_not_later` | ✅ (date instead of days) | EM-05 |
| `consent` | date, required for ext «بلا موافقة موثّقة لا تمديد (م.53)» | `consentOn` required (`extend_needs_consent`) | ✅ | EM-05 P0 R1 |
| End: last day | `last = max(0, e.prob)` (the probation end) | `lastDay` input (≥ join, ≤ probation end) | ✅ (explicit) | EM-05/EX-01 |
| Info | «م.53: لا تُحتسب العيدان والمرضية في التجربة · الإنهاء يبدأ مسار الخروج» | `probation.end_note` (exit path); no Eid/sick exclusion note | 🟡 the probation end is not pushed out by Eid and sick days | EM-05 P0 R1 |
| Lapsed | (no decision → confirmed) | `over` block once it has lapsed | ✅ | EM-05 |
| Submit | ok: `prob=null`; ext: `prob += ext`, log with the consent date; end: exit `{k:'prob'}` | `decideProbation`: confirmed / extended (`end`, `consentOn`) / `startExit` reason probation | ✅ | EM-05 |

### Form: raise — تعديل الأجر / Pay change

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | `CAN('approve')` on an active employee; Today raise request (906, from perf) | `EmployeeActionDialog` `pay`, guard `pay.change` = manager, with pay view, not own | ✅ | EM-04 P0 R1 |
| Own pay | red «أجرك أنت — لا يعدّله صاحبه؛ يعتمده المدير العام»; Apply disabled | the button is hidden; `changePay` refuses `own_request` (owner excepted) | 🟡 nobody but the owner can change the HR manager's pay (prototype: management) | RL-02 P0 R1 |
| `kind` | raise / promo / title (title allows the same basic) | raise / promotion (+ new `trade`, `saudi_only` block) / correction | 🟡 no "title change only" kind (ours blocks `no_change` when the basic is unchanged) | EM-04 |
| `nb` new basic | number step 100 | `basic` (`bad_basic`, `no_change`) | ✅ | EM-04 |
| `eff` | date default today (or the request's) | `effectiveOn`; `too_old` beyond the last closed month; a future date is scheduled (info) | ✅ | EM-04 P0 R1 |
| `why` | required | `reason` required | ✅ | EM-04 |
| KV new wage | basic + 25% + 10% | wage now → wage after | ✅ | EM-04 |
| KV company delta incl. GOSI | `(nw−wage) + (nb−basic)×1.25×GOSI employer` | — | ❌ | EM-04 |
| Saudi < 4,000 | red «لا يُحتسب في نطاقات — والتخفيض يحتاج موافقة كتابية» | warning `saudi_below_nitaqat` | ✅ | EM-04 |
| Pay cut | amber «تخفيض أجر — بموافقة كتابية أو بعقوبة (م.67)» | warning `pay_cut` | ✅ | EM-04 |
| Retro in a closed month | info «فرق N ﷼ عن D يوماً… يذهب بمسير فرق… شهر مقفل واحد» | `retro_preview` amount + month; `retro_note` | ✅ | EM-04 P0, PY-04 P0 R1 |
| From a raise request | prefilled from REQ (`q.newBasic`, `q.kind`, `q.eff`, `q.why`); marks it ok | — | ❌ | EM-04 (request from manager); PF P2 R3 · optional: perf |
| Submit | `applyRaise(e, nb, kind, eff, why)`; log «<kind>: الأساسي X ← Y من <date>» | `changePay`: pay steps, supplementary retro, log `pay_changed`/`promoted` | ✅ | EM-04 |

### Form: wps / gosi — ملف حماية الأجور · كشف التأمينات / WPS file · GOSI statement

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Who opens | `CAN('money')` on a payroll in sent/paid (1181); GOSI for the main payroll only | `HrPayrollView` buttons on a frozen payroll, plus `HrReportsView` (last sent month) | ✅ | PY-07 P0 R1 |
| Preview modal | table of the first 8 rows + totals before download | none — direct CSV download | 🟡 no preview (PRD form 24) | PY-07 |
| WPS header note | «رقم المنشأة في مُدد <mudad> · الفترة · ملف فرق: بنود متغيرة بلا أساسي · مفتاح السطر رقم الهوية» | — (no Mudad establishment number exists to print) | ❌ | PY-07 P0 R1 |
| WPS columns | employee · ID · **bank** · IBAN · basic · housing · other (transport/OT/commission) · deductions · net; bounced rows marked | `mudadCsv`: id_no, name, iban, basic, housing, other_earnings, deductions, net; held lines excluded | 🟡 no bank column | PY-07 |
| Held count | footer «N معلّق خارج الملف» | held lines skipped, not counted | 🟡 | PY-03 |
| GOSI table | Saudis per row (base, employee, employer) + one aggregated non-Saudi 2% row; total = 2107 | `gosiCsv` one row per person with scheme (old/new), base, shares, total | ✅ | PY-07 |
| GOSI note | «رقم الاشتراك <gosiReg> · النسب للمشتركين قبل يوليو 2024…» | — (the scheme is per line) | ✅ | PY-07 |
| Supplementary (diff) WPS | `py.kind==='diff'` file | supplementary payrolls exist (`-D`); export per frozen payroll | ✅ | PY-04 |

### Form: report — تقرير (معاينة) / Report preview

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Open | report card → modal: first 15 rows + «يُعرض 15 من N — الباقي في الملف»; Download CSV | `components/hr/HrReportsView.tsx` opens the report in the page (all rows) + CSV (UTF-8 BOM) | ✅ | RP-01 P1 R1, form 32 |

### doAct — core actions (proto 1582–1593)

`X5A[a]` takes precedence. None of the X5A keys (jsel…copylink, rvq…raiseno, latex…devdemo, hseg/gseg, featdef/feat/strict/pfx,
dbl/dblfold/efseg/mseg/recondemo) overrides a core doAct action.

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| `paysend` approve and send the payroll | `payBlocks(py)` empty → `state sent`, `by`; toast with the net | `HrPayrollView` approve (a different hand from the preparer; `hrEvents` outbox) | ✅ | PY-05 P0 R1 |
| `object` employee objects | `pen.obj=1`; REQ `{k:'obj', no:nextNo('tr'), pi}`; notify HR | `objectPenalty` from My file / list (`mayObject` within 15 days, text required) | ✅ | PN-04 P0 R1 |
| `objdec` cancel / keep | cancel: `amt=0`, `cancelled`, viol not counted, «أُعيد المبلغ في المسير»; keep: `upheld`, «للموظف الرفع للجنة العمالية» | `decideObjection` cancel / uphold (note required) | ✅ | PN-04 P0 R1 |
| `cancelleave` cancel an approved leave before it starts | by the approver **or the employee**; restores `taken` | `cancelRequest` (approved leave before its start: **HR only**; the employee only while pending); restores leaveTaken / sick / Hajj | 🟡 the employee cannot cancel his approved, not-yet-started leave | LV-07 P1 R1 |
| `ibanok` approve a new IBAN | HR; `iban='fixed'`; log mod fin | `approveIban` (manager, never the fixer, not own; owner flagged); `hr_iban_approved` to Finance | ✅ | PY-03, RL-02 P0 R1 |
| `remind` remind the supervisor | Today rows (907, 926) when attendance is unrecorded since a date: «ذكّر المشرف» | — (Today shows unrecorded counts, no reminder action) | ❌ | AT-04 P0 R1 |
| `sched` schedule an approved advance | Today row «سلفة اعتُمدت — قسّطها على N أشهر» → `e.adv` set | the instalment is set on approval (HR, or Finance via `financeDecideAdvance`) | ✅ (folded into approval) | AD-01 P0 R1 |
| `rec` supervisor endorses a leave | `q.rec={by,at,ok}` «توصيتك تُرفق للقرار» | `endorseRequest` (line manager or site supervisor; not own) | ✅ | LV-05 P0 R1 |
| `exitvisa` exit re-entry recorded | gov Today/Muqeem task «خروج وعودة قبل سفره» → `q.exitVisa=1`, log | `hr_exit_reentry` notification only; nothing to tick as done | 🟡 no "recorded" state | LV-08 P1 R1; GV-02 P1 R2 · optional: gov |
| `jump` | demo month jump | — | ✅ n/a | — |

#### Build notes — Forms (core)

1. **Manpower answer (mr), the largest gap (AS-02 P0).**
   - Data: on `manpowerRequests` add `answer.rest` (`hire|xfer|ajeer|none`), `answer.short`, a per-person `answer.rows[]` `{employeeId, source, when}`, and `no` (MR-yyyy/NNN via `mfgCounters`, like requests).
   - Coverage: `coverage()` should return per-person rows with `late = when > from`, and the remainder as ONE line chosen by `rest` (add `xfer` at +30 days).
   - Answering must perform the moves: unassigned rows get `siteId` = the request's site (log `moved`, as `assignEmployee` does); site-ending rows get `employees.planned {siteId, on}` (new field, plus a Today row on that day to apply it, since there are no scheduled writes); visa rows are optionally reserved.
   - Files: `lib/hr/manpower.ts`, `components/hr/HrManpowerPanel.tsx` (two steps: coverage → answer), `ProjectManpowerPanel`.
   - Rules: the `manpowerRequests` update rule must allow the new answer fields. The moves touch `employees` under the manager's existing update path; do it in one transaction, with no new collection.
   - Policy `ajeer` / `ajeerX` goes into `HrPolicies` (`lib/hr/statutory.ts` resolve + Settings UI) and replaces `COVERAGE.ajeerCostFactor`.
2. **Assign (move).**
   - Add the `mayDrive` block for driving trades to fleet/project/warehouse targets: `assignBlocks` gains `licence_expired`, and `decideAssignFix` re-uses it.
   - An effective date in the future should not move the person now: write `employees.planned {siteId, on}` and apply it on the day, or block future dates. Owner decision: the prototype only back-dates (the default is the pending fix's `since`).
   - On move, close any pending `hrAssignFixes` for the person (done if the target equals its site, otherwise declined "moved elsewhere"), read beside the transaction as `decideAssignFix` already does.
   - Notify Projects: a new `hr_assigned` notice kind in `lib/hr/notify.ts`, to the project's editors or PM.
   - Add the optional "trigger" select linking an open manpower request.
   - Rules: none new (`employees` / `hrAssignFixes` blocks exist).
3. **Contract renewal (ct).**
   - New `EmployeeAction` `contract`: renew (new end, default +2 years, logged `contract_renewed`) or do not renew (`startExit` reason `contract_end`, last day = `contract.end`). Wire the Today `contract_end` row's action to it.
   - Decide whether `DOC_TYPES` "contract" (docs.contract) should go. It duplicates `contract.end`, and the renewal form writes the wrong field for it.
   - Rules: the `employees` update for `contract` is the manager's (check that the block allows `contract` in `changedKeys`).
4. **Decision dialogs should pre-check and quote** (the PRD's "blocking facts before sending"). `HrRequestList` must run `leaveQuote(..., {deciding:true, mode})` and `advanceQuote` in the dialog, show the blocks, and disable Approve. Show:
   - leave: balance as of start (+ holidays not counted), sick N/120, the endorser, the ticket line, and the riyal estimate of unpaid days (`wage/30 × days`);
   - advance: wage, HR limit, outstanding balance, the instalment schedule `i × (n−1) + r`, and the past-contract warning.
   Pure UI, with `useHrPeople` / pay reads only for pay roles (RL-03). No rules impact.
5. **Leave request.**
   - Hide ineligible types (`leaveEligibility`) instead of refusing them.
   - Make sick beyond 120 a BLOCK (prototype and LV-06: "a management decision, not a leave request"). Owner decision: ours deliberately warns.
   - Add the non-Saudi annual ticket checklist line plus a `leave.ticket` flag.
   - On a `travel_docs` warning at filing, notify gov (`hr_travel_docs`).
   - HR filing for someone else: the prototype records it as approved at once. Ours queues it to the same HR manager. Owner decision: auto-approve when the filer holds `request.decide` and it is not his own (the write would call the decide path in the same transaction).
6. **Penalty decision.** Quote "fines this month" and the cap (`monthPenalties` over the employee's applied violations for the decision month, `cappedPenalty`), the reduced amount when over, and the prior same-code dates in 180 days. Make the violation `note` ("what happened") required at recording, and add the per-code "occurrence N → penalty" preview in `RecordViolationDialog` (`penaltyStep` + `VIOLATIONS`). Needs the employee's violations (already read by `useHrViolations` for pay roles). For a supervisor, the step preview must come without amounts.
7. **Establishment file (ST-04).**
   - Add `establishment.nameEn`, `mudad`, `band` (`g|y|r`), `bandMinPct`, `bandAsOf` to `Establishment` / `normalizeHrSettings` and the Settings panel. Require name, CR and Qiwa number before letters or WPS (or say so).
   - Print `mudad` in the Mudad CSV header or file name, and add a `bank` column (needs `employeePay.bank`, a code from a BANKS list, captured in `newemp` and the `data` request).
   - Rules: `hrSettings` is written whole by the manager. The gov visa-decrement rule checks `changedKeys().hasOnly(['establishment'])`; verify it still compares only `visas` inside `establishment`, or new keys could ride along.
8. **New employee.**
   - Require `nameEn` (Mudad/WPS) — owner decision.
   - Validate the IBAN with the `fixIban` regex.
   - Show the computed probation end.
   - Saudi: label the expiry "ID expiry" (`docs.nationalId` or re-use `passport`; owner decision).
   - Mark Saudi-only trades in the select.
   - Send the iqama-clock notice to any non-Saudi with no iqama date (not only visa arrivals).
   - Onboarding checklist: R2 with `gov`.
9. **Settlement.**
   - Default the ticket for non-Saudis (amount from a policy, e.g. `HrPolicies.ticketDefault`, or the contract).
   - Add the posting preview (Dr 220201 gratuity provision / 210206 leave / wages by cost centre; Cr 110506 advance / 420101 custody / bank), read-only from `postHrSettlement`'s mapping in `lib/hr/finance-writes.ts`.
   - Spell out the gratuity explanation (art. 84/85 bands) and quote the per-reason gratuity in `StartExitDialog` (`gratuity(wage, join, lastDay, reason)`, pay roles only).
10. **Document renewal.**
    - List only the person's documents (iqama/insurance for non-Saudis, licence/forklift by trade), each with its state and current expiry. Title it "record issue" when the iqama is still pending.
    - Add the "insurance renewed for the same period" checkbox (also writes `docs.insurance`).
    - Notify the HR manager when an iqama is renewed for someone on unassigned (`hr_iqama_renewed`).
    - Rules: the gov path on `employees` allows docs only, and `docs.insurance` is in docs.
11. **Small items.**
    - Show the bounced month and amount in the IBAN callout; pre-validate the IBAN before enabling Fix.
    - Make the policy advance limit step 0.5 and report invalid values instead of silently resetting them.
    - Let the employee cancel his own approved, not-started leave (LV-07; `mayCancel` + the `hrRequests` rule for the employee's update).
    - Add a supervisor "remind" action (a notice `hr_sheet_reminder` to `hrSites.supervisorUserId`, `once` per site per day).
    - Add an exit re-entry "recorded" tick for gov: `hrRequests.leave.exitVisa {by, at}` — the rules must let `hr.gov` set only that key — or ride the GV task list in R2.
    - Payroll may record violations in the prototype; ours does not (owner decision; the PRD permissions matrix gives it to supervisor and HR).
12. **Team member (user).** Ours deliberately splits it: the platform team page, the HR groups, then the employee link. Owner decision whether a single "add team member" form (create record + invitation + group) is wanted. It would ride `invitations` + `employees`, with no new collection.

<!-- slice 9-forms-ext -->
## Forms (extensions)

Source: `proto.html` `const X5F={},X5A={}` (1737). `openForm` runs `X5F[kind].init` (1387); `renderForm` uses `X5F[k].render` **before** any core branch (1396), and `submitForm` uses `X5F[k].submit` (1525). So `X5F.letter` / `X5F.reqletter` (2556/2572) **replace** the core `letter`/`reqletter` forms (1373/1379/1472/1475/1569/1570). Every X5F form follows the same frame: title + sub, body, `x5Primary` submit button **disabled while a blocking fact holds**, `autoBy()` ("recorded under your name · date") on every recording form.

Hiring / performance / training forms are covered by another slice. One line each:
- `job` (1847) — new opening (trade, site, qty, need date, track individual/batch, band) · `cand` (1860) — add candidate (source link/ref/agency/walk/file) · `score` (1868) — interview scorecard · `offer` (1873) — offer terms (basic in band, start, contract) · `offerl` (1883) — offer letter · `bstage` (1887) — batch recruitment stage (auth → test → visa → arrival).
- `cycle` (2008) — open a review cycle with two dates · `rv` (1994) — manager review of one employee · `pe` (2003) — worker grade sheet · `self` (2000) — staff self-review · `raiseplan` (2010) — raise proposal by band.
- `sess` (2015) — schedule a training session · `sessdone` (2025) — record session result (attended/absent, certificates).

---

### Form: data — «تحديث بياناتي» / Update my data (PRD form 10, WF-25)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Opened from | `x7MeCard` «حدّث بياناتي» (2345), My file prompt cards: «حوالتك مرتجعة → حدّث الآيبان» (e.iban==='ret'), «لا آيبان مسجّل → أضفه», «جوالك غير مسجّل → أضفه» (2490–2492), file Details segment (2518). Employee on his own record | `components/hr/HrMyFile.tsx` header button `req.new_data` → `NewRequestDialog kind="data"`; also `HrEmployeeFile.tsx` (HR files on his behalf) | 🟡 the button exists; the three prompt cards that push the employee to fix a returned / missing IBAN or a missing mobile are not on My file | ES-03 P0 R1 |
| Field `k` «ماذا تُحدّث؟» | select of `DATAK`: iban · phone · addr (national address) · emg (emergency contact) · edu (qualification); default `phone` | `lib/hr/requests.ts:DATA_FIELDS` = iban · mobile · address · emergency; default `iban` | 🟡 **`edu` (qualification) is missing** — add `education` to DATA_FIELDS, `contact.education`, translations, rules `contact` already covers it | ES-03 P0 R1 |
| Field `v` new value | text; IBAN placeholder `SA..`, hint "as on your bank statement — a transfer bounces if one digit is wrong" | `NewRequestDialog` `du-value` input (ltr for iban/mobile) | ✅ | ES-03 |
| IBAN format rule | `/^SA\d{2}[A-Z0-9]{18,22}$/i` after stripping spaces; submit disabled when wrong | `dataBlocks` → `bad_iban` with `/^SA\d{22}$/` (Saudi IBAN is exactly SA+22 digits) | ✅ stricter, correct for KSA | ES-03 |
| IBAN document | amber callout "an IBAN change needs a bank document (statement or bank letter); the HR manager approves it, not payroll (separation of duties)" + **file picker** «أرفق المستند» (`data-reqdoc`, stores file name in `d.doc`); submit disabled without it | `du-doc` **text input** = the bank letter's reference (`req.bank_document`), `no_document` block | 🟡 a typed reference, not an attached file. `lib/hr/attachments.ts` (EM-07, kind `bank`) now exists — the request should upload the bank document into `employees/{id}/files` and carry its file id | ES-03 P0 · EM-07 P1 R1 |
| Other fields: non-empty | `!!v.trim()` | `no_value` block | ✅ | |
| Submit effect | `REQ` `{k:'data', no: nextNo('tr') (shown ط.ص), dk, v (spaces stripped), doc, state:'pend'}`; log "data update requested"; notify `role:hr` → `form:dataok` | `lib/hr/request-writes.ts:fileRequest` — `hrRequests` kind `data`, number `HQ-yyyy/NNN` (ط.ص), log `data_filed`, `tellFiled` → HR manager (management when it is the HR manager's own) | ✅ | ES-02/03 P0 R1 |
| «عند» holder | `reqHolder`: "HR — after checking the document" | `HrMyFile.tsx:holder` → HR / management | ✅ | ES-02 |

### Form: dataok — «تحديث … — اعتماد» / Approve data update (PRD form 10)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Opened from | HR notification `form:dataok:<id>` | `components/hr/HrRequestList.tsx` (HR request list / Today) approve·decline | ✅ | ES-03 P0 R1 |
| Shows | new value, document name; Approve / Decline options; submit disabled until one is chosen | row text `req.kind.data · field: value · document ref` — IBAN masked `•••` for roles without pay | ✅ (ours masks the IBAN — RL-03) | RL-03 |
| Decline | no reason, no notification to the employee | reason required (`needsNote`), `hr_request_decided` notice to employee + filer | ✅ better (PRD: any decision → requester) | Notifications table |
| Approve effect | IBAN → `e.ibanNo=v`, a returned transfer (`iban==='ret'`) becomes `fixed` (payable again); others → `e.info[dk]=v`; log | `decideRequest` kind `data`: IBAN → `employeePay.iban`, `ibanState:'ok'` (returned line payable again); others → `employees.contact.<field>`; log `data_updated` | ✅ | WF-25 step 3 |
| Who decides | `role:hr` (the HR manager — never payroll) | `mayDecideRequest` → HR manager; HR manager's own → management | ✅ | RL-02 P0 |

### Form: reqletter — «طلب خطاب» / Letter request (PRD form 9; X5F overrides core 1379/1475/1570)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Opened from | My file «طلب خطاب» (1197), employee card (1333) for `ROLE()==='emp'` | `HrMyFile.tsx` `letter.request` → `components/hr/HrLetterDialogs.tsx:NewLetterDialog`; HR on his behalf from the file | ✅ | EM-08 P1 R1 |
| Field `lt` type | option cards: sal (salary certificate, signed by HR) · emb (embassy, signed by **gov**) · exp (experience — **only when e.st==='exit'**) · noc (no-objection) · oth (other — describe it); each with a `LTR_HINT` line + "signed by <role>" | `lib/hr/letters.ts:LETTER_KINDS`, `requestableKinds` (exp only leaving/left; nothing else after left), `LETTER_SIGNER` | ✅ | EM-08 |
| Field `title` (oth only) | "Which letter do you need?" placeholder examples; required for oth | `title` + `no_title` block | ✅ | |
| Field `why` purpose | textarea; **required for noc and oth**, optional note otherwise | `purpose` + `no_purpose` (free letters) | ✅ | |
| Field `to` addressee | required (e.g. Al Rajhi Bank / To whom it may concern) | `addressee` + `no_addressee` | ✅ | |
| Field `lang` | select ar / en, default UI language | `lang` (LETTER_LANGS), default locale | ✅ | |
| (`copies:'1'` in init) | initialised but never rendered — dead field | — | ✅ n/a | |
| Submit effect | REQ `{k:'letter', no: nextNo('lv') …, state:'pend'}`; log; notify the signer role → `form:letter:<id>` | `lib/hr/letter-writes.ts:fileLetter` — `hrLetters` doc, log `letter_filed`, `hr_letter_filed` to the signer level; HR manager's own → management, gov officer's own embassy letter → HR manager | 🟡 ours has **no request number until issued** (serial `LT-yyyy/NNN` drawn at signing); ES-02 wants each request with its number. Prototype draws one at filing (from the leave sequence — a prototype slip). Decide: show a filing number or accept "no number until issued" | ES-02 P0 R1 |
| Extra in ours | — | `no_wage` block on salary/embassy letter when no pay record | ✅ | |

### Form: letter — «خطاب …» issue or decline (PRD form 9; X5F overrides core 1373/1472/1569)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Opened from | Today decision rows (902 for HR, 919 for gov), My file, file requests (1196/1347/2418/2507), notification | `HrLetterDialogs.tsx` signer sheet; Today `letters.ts:letterTodayRows` | ✅ | EM-08 |
| Who may act | `CAN('approve')` (HR) **or** `ROLE()==='gov'` — any type | `maySignLetter`: by signer level; HR manager stands in for gov; nobody signs his own (owner flagged) | ✅ stricter | RL-02 |
| Decision `dec` | ok «أصدر ووقّع» (from record as is / after writing the text) · no «ارفض» (reason sent to employee) | `dec` issue / decline | ✅ | |
| Free text (noc/oth) | textarea `text`, starts from the employee's words; required to issue | `initialLetterText`, `issueBlocks` → `no_text` | ✅ | |
| Decline reason | required | `declineBlocks` → `no_reason` | ✅ | |
| Live preview | `letterAny` renders in the letter's language (dir rtl/ltr) | `LetterDocument`/`LetterInLanguage` | ✅ | |
| Warning | employee leaving and type ≠ exp → "an experience certificate is usual" | `leaving_warn` callout | ✅ | |
| Issue effect | `state ok`, `serial 'خ-2026/'+LNO`, okBy/okRole; log; notify employee | `issueLetter`: yearly `LT` serial (shown خ-), card + letterhead snapshot, pay copied into `hrLetterPay` (RL-03), optional travel leave on embassy letter; `hr_letter_issued` | ✅ | |
| Decline effect | `state no`, `why2`; log; notify employee | `declineLetter`, `hr_letter_declined` | ✅ | |
| Issued/declined view | Print button | `printLetter` | ✅ | |

### Form: imp — «استيراد الموظفين بأرصدتهم» / Import employees with balances (PRD form 2, WF-02)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Opened from | People tab header «استورد من ملف» when `CAN('admin')` (HR manager) — `x5Acts` 2213 | `components/hr/HrPeopleView.tsx` import button, `access.allowed("employee.import")` | ✅ | IM-01 P0 R1 |
| Step 1 intro | "Entered once: actual join date (EOS computed from it, never typed), today's leave balance, outstanding advance. Blanks stay blank. Imported people enter payroll from the import month." + template column list | `imp.desc` + `imp.since_note` | ✅ | IM-02 |
| Template | `IMPC` 14 columns; «نزّل القالب» (`do:imptpl`) | `lib/hr/import.ts:IMPORT_COLUMNS` 15 (adds `id_no`) + label row, `templateCsv` | ✅ | IM-01 |
| Demo file | «جرّب بملف عرض (8 أسطر)» `do:impdemo` → `demoCSV` | — | ✅ n/a (prototype tool) | |
| Parser | `parseCSV`: BOM, `,` or `;`, quotes | `parseCsv` (also `""` escapes, CRLF) | ✅ | |
| No name | reject «بلا اسم» (en-only name accepted) | `no_name` (en-only accepted) | ✅ | IM-01 |
| Trade | exact (key/ar/en) else `nearT` substring match → note "read as X — review"; else reject | `findTrade` exact, else nearest within two letters + `trade_interpreted` note; else `bad_trade` | ✅ | IM-03 P1 R1 |
| Nationality | unknown → reject | `bad_nationality` | ✅ | |
| Saudi-only trade (LOCALIZED) for non-Saudi | reject | `saudi_only` | ✅ | |
| Join date | not a real yyyy-mm-dd or future → reject | `bad_join` / `future_join` | ✅ | IM-02 |
| Workplace | unknown → `bench` + note | `site_unknown` note → unassigned; extra: expired iqama → unassigned + note (DC-02) | ✅ | IM-03 |
| Basic missing | **filled with the trade's default wage `TR(trade)[4]` + note "review it"** | `no_basic` note, basic stays **null** ("HR enters it before payroll") | 🟡 deliberate difference (blanks stay blank, PRD IM-02/EM-03) — owner to confirm; prototype IM-03 text says "no basic → trade default" | IM-03 P1 R1 |
| Gender | anything not f/أنثى/female → `m` | unknown → **reject** `bad_gender` | ✅ stricter | |
| Document dates | unreadable → note, left missing | `bad_date_ignored` note | ✅ | |
| Non-Saudi without iqama date | note "no iqama date — shows as missing" | — (no note) | 🟡 add note `no_iqama` when nat ≠ sa and iqama blank | IM-03 |
| IBAN | invalid/blank → note "no valid IBAN — transfer will bounce" | `bad_iban` / `no_iban` notes | ✅ | |
| Leave balance cap | `> floor(service/365×30)+30` → capped + note | `leave_capped` same formula; `bad_leave_ignored` | ✅ | IM-02 |
| Advance | `advance_balance` → `e.adv {amt,bal,inst}` | `advanceBalance` → `employeePay.advance` (not without a basic: `advance_without_wage`) | ✅ | IM-02 |
| Duplicate | same English name + join date → reject | same + **duplicate ID number** (in file or on record) | ✅ | IM-03 |
| Review table | header "N to import · M rejected · K with notes"; columns **# · Employee (name, trade · nationality · site) · Joined · Leave balance · Advance (••• without pay) · Status + notes**; rejected rows red | status pills clean/notes/rejected; columns Row · Name · Trade · Site · Review | 🟡 **missing columns: nationality, join date, leave balance, advance (masked for non-pay roles)** — the opening balances are what the reviewer must check | IM-01/02 P0 R1 |
| Submit | «استورد N», disabled when 0 importable; rejected never saved | `imp.create {n}`, disabled when 0 | ✅ | IM-01 |
| Effect | `mk()` employee, `since=0` (payroll from import month), `taken` from balance, `open={leave,adv,at,by}`, IBAN, log "imported from file — actual join … opening leave … advance" | `createEmployee` per row with `since: month`, `openingLeave`, `advanceBalance`; per-row failures listed | 🟡 ours writes one transaction per row (partial import possible — failures are listed); prototype is all-or-nothing in memory. Check that the log entry names "imported" and the opening balances (prototype log text) | IM-02 |

### Form: open — «رصيد افتتاحي» / Opening balance (PRD form 3)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Shown when | HR only; `e.join<-30 && !e.open && (e.since!=null || CO==='new')` (x5EmpActs 2194) | `HrEmployeeFile.tsx` action `opening`: `employee.edit`, not left, no opening yet, `leaveTaken==0`, > 30 days | ✅ | IM-04 P1 R1 |
| Field `lb` leave balance | number ≥ 0, hint "at most N could have accrued" (`accrued(e,0)`); required; disabled above max | `op-lv`, `openingBlocks` → `bad_leave` / `above_accrued` | ✅ | IM-02 |
| Field `ab` advance | only for money roles, optional | `op-adv` only when `seesPay`; `advance_exists`, `bad_advance` | ✅ | |
| Note | "Entered once under your name. EOS never typed — computed from join date; its opening provision is Finance's entry." | `opening.note` | ✅ | |
| Effect | `taken = accrued − lb`, `e.open={leave,adv,at,by}`, advance created; log | `recordOpeningBalance`: `openingLeave`, `opening{leave,at,by,byName}`, `employeePay.advance`; log without the amount | ✅ | |

### Form: mgr — «المدير المباشر» / Line manager (PRD form 30)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Opened from | employee card action «المدير المباشر», **HR only**, active employees (x5EmpActs 2193) | — (`HrEmployeeFile.tsx` only *shows* `lineManagerOf`) | ❌ no editor | RL-04 P1 R1 |
| Field `mgr` | select of active, non-labour, non-visa staff except himself, same workplace first; default = current `mgrOf(e)`; disabled when empty | — | ❌ | RL-04 |
| Derivation shown | sub "derived from the workplace unless you set it — he reviews and approves attendance corrections"; card shows "· derived" when not set | `access.ts:lineManagerOf` = `managerId` else site supervisor | 🟡 derivation chain is shorter: prototype `mgrOf` = explicit `e.mgr` → site head (labour: the site supervisor user's employee or a foreman `frm`; staff: highest-basic non-labour person at the site) → management → HR manager; HR manager's own manager = management; never himself, never a visa-stage person | RL-04 |
| Effect | `e.mgr=id`, cache reset, log "line manager: X" | field `employees.managerId` exists (`employee.ts:43`, created null) but nothing writes it | ❌ | RL-04 |
| Use of the line manager | endorses leave, approves attendance corrections, reviews (perf) | `fileRequest` takes the **site supervisor** as `lineManagerId`, not `lineManagerOf(emp)` — an explicit manager would be ignored even once settable | 🟡 | RL-04, LV (endorse) |

### Form: fill — «أيام بلا تسجيل» / Missing days declaration (PRD form 19)

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Opened from | `x5CloseBtn` on the attendance closing row: «سجّل الأيام الناقصة» for `ROLE() in [hr, sup]` when missing days exist; also «أقفل كما هو» when policy = warn | `components/hr/HrSiteAttendance.tsx` Month segment panel `att.missing_title` (inline, not a dialog); `attendance.declare` (HR manager / the site's supervisor) | ✅ | AT-04 P0 R1 |
| Days | all `missDays(site, month)` shown as chips, all declared together | each missing day a tick (`pick`), default all | ✅ (ours allows a subset) | |
| Computed preview | **man-days to be recorded present** = Σ per person of missing days on/after his join/`since`; **≈ wages** (money roles only) = Σ wage/30 × his days | callout "N days will be recorded present for P people" (P = current roster) | 🟡 no man-days figure that respects join/since, no wage estimate for pay roles | AT-04 |
| Field `note` | "Why were they not recorded at the time?" — **optional**, kept with the record | `att.declare_note`, **required** (`no_note`) | ✅ (stricter) | |
| Field `ack` | checkbox «أقرّ أن هؤلاء كانوا على رأس العمل في هذه الأيام» — submit disabled until ticked | — (button names the count; the callout is the statement) | 🟡 no explicit statement tick — the PRD wants a "named declaration"; add the checkbox | AT-04 P0 R1 |
| Submit disabled | `!ack || !miss.length` | `declareBlocks`: closed · no_days · no_note · not_missing | ✅ | |
| Effect | `X5A.fillatt`: days marked recorded, `A.fill={n,by,at,note}`, each person's `att.p += days since join`; toast "absences are edited afterwards from the card" | `declareMissing`: `declarations[]` {days, employees, by, byName, at, note}; payroll counts `declared` (line warning `declared`) | ✅ | AT-04 |
| Shown after | pill "N days recorded by X on D" (title = note) beside close button | `att.declarations` panel with each declaration | ✅ | |

### Form: am — «مصدر الحضور» / Attendance source per workplace (PRD form 21) — optional: punch

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Opened from | Attendance tab → «مصدر الحضور لكل مكان عمل» panel → «غيّر», **HR manager only** | — (Attendance tab not built; `access.ts` gates it on `punch`) | ❌ | PT-01 P1 R2 · optional: punch |
| Field `am` source | options: `sup` supervisor sheet ("all present, then exceptions — site labour without phones") · `dev` device ("connected and pushing, or a reviewed file import — templates stay on the device") · `mob` employee app ("one phone per employee · no punch outside the fence without an approved request") | — | ❌ | PT-01 |
| Field `dvm` (dev only) | `push` connected (device pointed at our server, buffers offline) · `file` import (old devices / no internet, always fallback) | — | ❌ | PT-02 P1 R2 |
| Field `sn` (push only) | device serial, optional; "one device per workplace; device user number = employee number; templates never leave the device" | — | ❌ | PT-02 |
| Fields `tin`/`tout` | shift start / end (time), default from `schOf` (site `sch` or `SCHD[type]` or 08:00–17:00) | — | ❌ | PT-01 |
| Field `grace` | lateness grace minutes, 0–60, default `POL.grace` 15 | — | ❌ | PT-08 P2 R3 |
| Field `r` (mob only) | geofence radius m, min 30 step 10, default 150; hint "+30 m accuracy margin" | — | ❌ | PT-06 P1 R2 |
| Info block | grace · Ramadan six hours for everyone (art. 98) · punch overtime never reaches payroll unapproved · location read only at the punch, no tracking, explicit consent when linking the phone · no face capture | — | ❌ | PT-06, AT-06 |
| Submit | never disabled; `s.am`, `s.dv={mode,sn,lastM}`, `s.sch`, `s.grace`, `s.geo={r}`; this month's sheet `office=false`; "applies from today" | — | ❌ | |

### Form: impdev — «ملف جهاز البصمة» / Device file import (PRD form 22) — optional: punch

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Opened from | source panel «استورد ملف الجهاز» when source = dev and `CAN('att')` (HR, payroll, supervisor); Today decision «ملف بصمة X لم يُستورد منذ N» / «جهاز X لم يرسل منذ N» for hr (2180) and pay (2185) when `lastImp < -1` ("no file means no attendance, overtime or closing") | — | ❌ | PT-02/PT-03 P1 R2 · optional: punch |
| Step 1 | info: export from device software (ZKTeco etc.), columns employee no · date · time; a file may cover several days; uploaded by the site supervisor or payroll, at latest before closing; first in / last out per shift; CSV picker; demo file | — | ❌ | PT-02 |
| Review KPIs | matched (saved) · duplicates dropped · dawn punches (night shift: punch < shift-in − 6 h → yesterday's out) · unknown numbers (listed) · late beyond grace | — | ❌ | SH-05 P1 R2, PT-04 |
| Warnings | punched while on approved leave → not saved ("record his return first"); punched here but assigned elsewhere → exception for assignment fix (cost follows assignment); unknown numbers never create employees (temporary labour = Procurement supply contract) | — | ❌ | PT-04 |
| Submit | «احفظ N بصمة», disabled when 0 matched; `e.pn={in,src:'dev'}`, today present; others flagged `xs`; `s.lastImp=0`; sheet day recorded | — | ❌ | |
| Prototype gap | the file reader keeps only `no` and `time` (date column ignored) — the product must key punches by date | — | note | |

### Form: otno — «ليس إضافياً» / Not overtime (PRD form 20) — optional: punch

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Opened from | Attendance tab punch exceptions, row kind `ot` ("out yesterday HH:MM · N h after shift ≈ amount" for money roles): «ليس إضافياً» / «اعتمد» (`do:otok`); `CAN('att')`, supervisor only for his site | — | ❌ | PT-05 P0 R2 · optional: punch |
| Field `why` | one of: `nowork` stayed without assigned work · `wait` waiting for transport · `err` punch error — left on time; submit disabled until chosen | — | ❌ | PT-05 |
| Info | "a punch is evidence; refusing overtime is a decision recorded with its reason and your name; the employee is told and may object" | — | ❌ | |
| Effect | log on employee (hours, day, reason); notify the employee's user "overtime not counted — you may object by a correction request" (→ My file); `e.otp=null` | — | ❌ | PT-05; Notifications «ليس إضافياً» بسببه |
| Approve alternative | `X5A.otok`: `att.ot += h`, log "punch overtime approved" | — | ❌ | PT-05 |

### Form: attreq — «طلب تصحيح حضور» / Attendance correction request (PRD form 11) — optional: punch

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Opened from | My file «حضوري» panel (FEAT punch, active): app source → «طلب تصحيح»; other sources → «سُجّلت غائباً وكنت حاضراً؟» | — (`HR_REQUEST_KINDS` = leave · advance · data) | ❌ | PT-07 P1 R2 · optional: punch |
| Sub | "approved by your line manager: <name>" (`mgrOf`) | — | ❌ | RL-04 |
| Field `type` | `miss` forgot to punch · `out` outside the fence on duty — **only when the site's source is not the supervisor sheet** · `abs` marked absent but present (always); default `abs` on a sheet site, else `miss` | — | ❌ | PT-07 |
| Field `day` | date, default yesterday | — | ❌ | |
| Field `why` | reason text, required | — | ❌ | |
| Block: monthly cap | `type==='miss'` and this month's `miss` requests ≥ `POL.fixMax` (3, policy) → red "you reached 3 requests this month — company policy; see your manager"; otherwise a line "the cap counts forgotten punches only: used X of 3" | — | ❌ | PT-07 (policy fixMax) |
| Block: age | day more than 7 days ago → red "more than 7 days ago" | — | ❌ | PT-07 |
| Submit disabled | over cap · old · no day · future day · empty reason | — | ❌ | |
| Effect | REQ `{k:'attfix', no: nextNo('tr') (ط.ص), type, day, why, state:'pend'}`; notify the line manager's user, else `role:hr` → Attendance tab | — | ❌ | Notifications «طلب تصحيح حضور» → LM |
| Decision | Attendance tab «طلبات تصحيح من الموظفين» list, HR or the line manager: `attok` (abs → absent −1 / present +1; same-day miss/out → today present with punch `src:'fix'`, `geo:0` for out; log) · `attno` (declined, no reason, no notice) | — | ❌ | PT-07 |
| Holder | `reqHolder` → line manager's name | — | ❌ | ES-02 |

### Form: shifts — «ورديات <مكان>» / Workplace shifts (PRD form 23) — optional: punch

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Opened from | Attendance source panel «الورديات», HR manager only | — (`hrSites` has no shift fields) | ❌ | SH-01 P1 R2 · optional: punch |
| Field `on` | checkbox "this workplace runs shifts" (else one daily schedule) | — | ❌ | SH-01 |
| Per shift m/e/n | `u_k` use checkbox, `i_k` in time, `o_k` out time; defaults `SHDEF` (morning/evening/night); default set: workshop (non-new company) m·e·n, else m·e; night hint "spans midnight — a dawn punch counts as yesterday's out" | — | ❌ | SH-01/02/05 |
| Info | 8 h a day (art. 98); a second shift for the same worker = overtime at hourly + 50 % (art. 107), cap **60 h/month** (`OTCAP`); 8 h rest between shifts is a checklist; shift swaps by request not in this version | — | ❌ | SH-04 |
| Submit disabled | `on` and no shift chosen | — | ❌ | |
| Effect | `s.shifts`, `s.sh`, `s.shd[k]={in,out,night: out<=in}`; workers on a removed shift moved to the first; turning off clears `e.shift` | — | ❌ | SH-01/02 |

### Form: shiftset — «وردية <موظف>» / Worker's shift with effective date (PRD form 23) — optional: punch

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Opened from | employee card «الوردية» when the site has shifts and the employee is active; **HR manager, or the site's supervisor for his own site** | — | ❌ | SH-03 P1 R2 · optional: punch |
| Field `sh` | option per site shift (`shTx`: name in–out, "ends next morning"), each with the count of workers on it; default current shift | — | ❌ | SH-03 |
| Field `eff` | date, default tomorrow; "the new shift applies to attendance and punches from that day" | — | ❌ | SH-03 |
| Submit disabled | no shift / unreadable date | — | ❌ | |
| Effect | `e.shift`, `e.shHist.push({from,to,eff,by})`, log "moved from shift X to Y from D" (prototype switches at once — the product must apply from `eff`) | — | ❌ | SH-03 |

### Form: gt — «عمل منصة — تمّ» / Platform task done (PRD form 29) — optional: gov

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Opened from | Platforms tab task list and gov Today rows (`gtGo(key)` → `form:gt:<key ~>`); HR or government relations | — (`gov` feature listed "later" in `HrSettingsView.tsx:LATER`) | ❌ | GV-02 P1 R2 · optional: gov |
| Title / sub | "<platform> — <task>", employee name · trade | — | ❌ | |
| Info | "the act happens on the platform itself — here we record that it was done so it is neither forgotten nor repeated" | — | ❌ | GV-01 P0 |
| Field `ref` | reference number, optional | — | ❌ | |
| Submit disabled | the task no longer exists (computed list changed) | — | ❌ | |
| Effect | `GT[key]={ref,by,at}` (task disappears); pay-change task → `changes[i].qiwa=1`, `e.qiwaBasic=e.basic`; `fexit` → `exit.finalExit=1`; employee log "<platform>: <task> — ref" | — | ❌ | GV-02 |

### Form: recon — «مطابقة — <منصة>» / Reconciliation by file (PRD form 29) — optional: gov

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Opened from | Platforms tab «الجهات» panel «طابق بملف» per platform with an import (`muqeem`, `gosi`, `qiwa`; not `mudad`), platform on, HR or gov | — | ❌ | GV-04 P1 R2 · optional: gov |
| Step 1 | two-column CSV: employee no · value (`RCV`: Muqeem iqama expiry · GOSI registered wage = basic+housing · Qiwa documented basic); "we do not connect; we compare and show differences only — you decide which is right"; demo file | — | ❌ | GV-01/04 |
| Population compared | muqeem: non-Saudis not at visa stage; gosi/qiwa: everyone joined, not visa stage | — | ❌ | |
| Review | sub "N rows · M matched · K differences"; rows: `diff` (ours vs theirs, amber) · `miss` on our record, not theirs · `gone` left here, still there · `unk` number in their report, not ours | — | ❌ | GV-04 |
| Field `take` (when any diff) | Muqeem/Qiwa: "take the platform value into our record" (iqama date / `qiwaBasic`); GOSI: "create a 'fix registered wage' task per difference"; unticked = kept for information | — | ❌ | GV-04 |
| Effect | `miss`/`gone` → platform tasks (due 3 days; GOSI `miss` skipped for joiners < 30 days); unknown never creates an employee; `PFL[pf]={at,n,diff,by}` feeds the Platforms KPIs (differences at last reconciliation, oldest reconciliation) | — | ❌ | GV-02/04 |

### Form: mudad — «حالة <الشهر> في مُدد» / Mudad month status (PRD form 25) — optional: mudad

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Opened from | gov task "upload <month> wage file and record its status" (paid main payroll, due paidAt+3, Mudad platform on); payroll's Mudad section «سجّل الحالة» when not recorded, `CAN('prep')||CAN('payroll')` (payroll officer, HR manager) | — (Mudad CSV download exists: `HrPayrollView.tsx`, `HrReportsView.tsx`, `payroll.ts:mudadCsv`) | ❌ | GV-05 P2 R3 · optional: mudad |
| Fields | `pct` compliance % 0–100 optional · `note` optional; "recorded after upload — we do not read Mudad" | — | ❌ | GV-05 |
| Effect | `py.mudad={pct,note,by,at}`; shown "uploaded and recorded D · pct% · note" | — | ❌ | |

### Form: mj — «مبرّر لمُدد» / Mudad justification (PRD form 25) — optional: mudad

| Element | Prototype | Ours | Status | PRD |
|---|---|---|---|---|
| Opened from | pre-Mudad check rows (`mudadFindings`, main payroll): paid after pay day · held transfer · basic ≠ Qiwa documented basic · deductions > half the wage (art. 93) · net ≤ 0 · net < 90 % of (wage − GOSI) without absence/leave; «برّر» for `CAN('prep')||CAN('payroll')` | findings partly as line warnings: `payroll.ts:lineWarnings` (net_negative, over_half, net_below_90, ot_over_cap, held, declared) | 🟡 logic only: no **basic vs Qiwa** (no `qiwaBasic` field), no **late payment** finding, no justification | PY-08 P1 R2 · optional: mudad |
| Field `why` | three presets ("approved raise not yet updated on Qiwa" · "advance or penalty with written consent" · "returned transfer — paid after the IBAN fix") or free text; disabled when empty | — | ❌ | PY-08 |
| Effect | `py.just[empId+findingKey]=why`; row shows "justified" pill; "written once, attached to the file" | — | ❌ | PY-08 |

---

### X5A — the extension actions table (`doAct` checks `X5A[a]` first, 1583)

| Action | Prototype (button · where · for whom · effect) | Ours | Status | PRD |
|---|---|---|---|---|
| `latex` | punch exceptions `late` row «استئذان» — `CAN('att')`, supervisor own site: lateness excused, log, no violation | — (sheet has `permission` exception, no punches) | ❌ | PT-04 P1 R2 · optional: punch |
| `npa` | `nop` row (no punch, no leave — "not absent until a person decides"): «استئذان» / «غائب» → `setAtt` | — | ❌ | PT-04 · optional: punch |
| `fixout` | `noout` row: «اعتمد خروج HH:MM» = shift end, no overtime on an incomplete day; log | — | ❌ | PT-04 · optional: punch |
| `otok` / `otno` | `ot` row «اعتمد» adds punch OT hours to the month; «ليس إضافياً» opens `X5F.otno` (`X5A.otno` is a bare clear) | — | ❌ | PT-05 P0 R2 · optional: punch |
| `attok` / `attno` | correction requests list (Attendance tab): HR or line manager accept (fixes the record) / decline | — | ❌ | PT-07 P1 R2 · optional: punch |
| `fillatt` | called by `X5F.fill` submit | `attendance-writes.ts:declareMissing` | ✅ | AT-04 P0 R1 |
| `back` | Today row "leave ended D, no return recorded" «باشر اليوم»: active, present; days after the leave end = absence (art. 80: warning at 10 consecutive days, termination after 15) | `request-writes.ts:recordReturn`, `today.ts` (`leaveReturn`) | ✅ (another slice details it) | AT-05 P1 R1 |
| `punch` / `geo` | My file app panel «سجّل حضوري / انصرافي» (disabled outside the fence, "location read only at the punch"); `geo` = demo toggle | — | ❌ | PT-06 P1 R2 · optional: punch |
| `imptpl` / `impdemo` / `devdemo` / `recondemo` | template download (imp) / demo files (prototype tools) | `templateCsv` for imp; demos n/a | ✅ / n/a | IM-01 |
| `dbl` / `dblfold` | supervisor sheet «وردية ثانية» toggle (`CAN('att')`, site with shifts): `e.dbl`, `otToday += shift length`; toast warns above 60 h this month ("needs the worker's written consent") | — | ❌ | SH-04 P1 R2 · optional: punch |
| `hseg` / `gseg` | Hiring / Growth segment navigation | — (tabs not built) | ❌ (hiring/perf slices) | R2/R3 |
| `efseg` / `mseg` | employee file / My file segment navigation | `SegmentedNav` in `HrEmployeeFile.tsx` / `HrMyFile.tsx` | ✅ | EM-01, ES-01 |
| `featdef` | Settings «أعد إلى الافتراضي» (HR, when features differ from the business type's default) | `HrSettingsView.tsx` toggles only | ❌ reset button missing | ST-06 P1 R1 |
| `feat` | Settings feature toggle (HR): off hides tab and decisions, data kept | `HrSettingsView.tsx` features switches (hire/perf/train/punch/gov marked "later release") | ✅ | ST-02 P0 R1 |
| `strict` | Settings block-or-warn for closeMiss · jobApprove · offerBand | `policy.closeMissing` select only | 🟡 jobApprove/offerBand belong to hiring (R2) | ST-03 P1 |
| `pfx` | Platforms panel «أطفئ/شغّل» per authority (HR only) | — | ❌ | GV-03 P1 R2 · optional: gov |
| hiring (1898) `jsel jobok jobno jclose cint crej cacc cdec offok offno onb copylink`; perf (2031) `rvq rvsend rvok rvback rvack raiseok raiseno` | other slices | — | — | R2/R3 |

#### Counts (rows)
- data 8: ✅5 🟡3 · dataok 5: ✅5 · reqletter 9: ✅8 🟡1 · letter 10: ✅10 · imp 22: ✅17 🟡4 (+1 n/a) · open 5: ✅5 · mgr 5: ❌3 🟡2 · fill 8: ✅6 🟡2 · am 9: ❌9 · impdev 6: ❌5 (+note) · otno 5: ❌5 · attreq 11: ❌11 · shifts 6: ❌6 · shiftset 5: ❌5 · gt 6: ❌6 · recon 6: ❌6 · mudad 3: ❌3 · mj 3: 🟡1 ❌2 · X5A 18: ✅5 🟡1 ❌10 (+2 other slices)

#### Build notes — Forms (extensions)

**R1 / core gaps (build first)**
1. **Line manager (`mgr`, RL-04 P1 R1).** Data: `employees.managerId` already exists — only a writer and a dialog are missing. Add `setLineManager(firestore, ctx, id, actor, managerId)` in `lib/hr/employee-writes.ts` (assert `employee.edit`; refuse self, a `left`/`expected` person, a labour-category person unless decided otherwise; log `manager_set` with the name), action `manager` in `EmployeeActionDialogs.tsx` (SearchableSelect of active staff, same site first, "derived" note when unset) and in `HrEmployeeFile.tsx` actions. Extend `access.ts:lineManagerOf` to the prototype chain (explicit → site supervisor / foreman for labour, senior staff for staff → management → HR manager; HR manager → management). Fix `NewRequestDialog`/`fileRequest` to pass `lineManagerOf(emp)` (employee id + its `userId`) instead of the site supervisor. Rules: none — the HR manager may already update `employees` freely. Owner decision: should staff (non-labour) default to the highest-paid staff member at the site (the prototype reads basic — a pay fact — to pick him)?
2. **Data update (`data`, ES-03 P0 R1).** Add `education` to `DATA_FIELDS` (+ `contact.education`, both message files). Replace the typed bank-letter reference by an upload of a `bank` attachment through `lib/hr/attachments.ts` (`employees/{id}/files`), keep the file id on `data.document`; rules: the employee must be able to create a `files` entry of kind `bank` on his own record (check the files block — today read by HR/pay and the employee; creation by the employee may need a clause). Add the My file prompt cards (returned IBAN → "update IBAN", no IBAN → "add it", no mobile → "add it") opening the same dialog with the field preselected (ES-01 slice).
3. **Missing-days declaration (`fill`, AT-04 P0 R1).** In `HrSiteAttendance.tsx`: an explicit statement checkbox ("I state these people were at work on these days") gating the button; a man-days figure computed per person from max(join, since, month start) (move the helper into `lib/hr/attendance.ts`); for pay roles (`seesPay`) the approximate wages (`wage/30 × days`) — needs `employeePay`, so only where the viewer reads pay. No data-model change.
4. **Import review (`imp`, IM-01/02 P0 R1).** Add columns nationality · join date · leave balance · advance (masked `•••` without `seesPay`) to `HrImportDialog.tsx` from `ImportRow.input`; add `no_iqama` note for a non-Saudi without an iqama date in `import.ts`. Owner decision: keep "blank basic stays blank" (ours) or fill the trade's default with a note (prototype IM-03 text).
5. **Letter request number (ES-02).** Either draw an `LQ`-type number at filing or document "number on issue" as the rule.
6. **Settings `featdef` (ST-06 P1 R1).** A reset-to-default button in `HrSettingsView.tsx` when the features differ from `settings.ts` business-type defaults; rides `hrSettings/{orgId}` — no rules change.

**R2 — punches, devices, shifts (optional: punch)** — `am`, `impdev`, `otno`, `attreq`, `shifts`, `shiftset`, X5A `latex npa fixout otok attok attno punch dbl`.
- Data on existing collections where possible: `hrSites/{id}`: `attendance: { source: 'sheet'|'device'|'app', device?: { mode: 'push'|'file', serial }, schedule: { in, out }, grace, geofence?: { lat, lng, r } , shifts?: { on, list: [{ id:'m'|'e'|'n', in, out, night }] }, lastImport }` — the `hrSites` update rule only checks `type`, so no rules change for the HR manager.
- Punches: a new collection `hrPunches/{orgId}__{siteId}__{yyyy-mm-dd}` (one doc per site-day: `{ employeeNo: { in, out, src, geo } }`, `imports[]`, `exceptions decided[]`) — **new rules block**; prefer folding it into `hrAttendance` (`days[date].punches`, `days[date].decided`) to reuse `hrSheetOk` and the closed-month lock — that rides an existing collection and costs only a field allowance in `hrSheetOk`.
- Employee shift: `employees.shift`, `employees.shiftLog[]` (`{from,to,eff,by}`) — HR manager already allowed; the **supervisor** (shiftset for his site) needs a narrow clause `hrSupervises(siteId) && changedKeys().hasOnly(['shift','shiftLog','updatedAt'])`.
- Attendance correction: ride `hrRequests` with `kind: 'attfix'` (`attfix: { type: 'miss'|'out'|'abs', day, reason }`, number type e.g. `AC` shown ط.ص? — owner to pick the prefix; the prototype shares ط.ص with data updates). Rules: add `'attfix'` to the `kind in [...]` list, let the line manager (`lineManagerUserId == auth.uid`) read and decide that kind (`changedKeys().hasOnly(['state','decision','updatedAt'])`). Policy: `HrPolicies.fixMax` (default 3) in `settings.ts`; the 7-day window is statutory-like (PRD) — keep in `statutory.ts` or policy (owner).
- Not overtime: decision stored on the punch day (`decided: { ot: 'ok'|'no', why: 'nowork'|'wait'|'err', by }`), notice `hr_ot_refused` to the employee through `lib/hr/notify.ts`.
- Second shift: `days[date].ot` + a `second: true` flag on the sheet exception; the 60 h cap already exists as `overtimeOverCap` (`ot_over_cap` warning).
- Files owned: new `lib/hr/punches.ts` (+ `punch-writes.ts`), `components/hr/HrAttendanceView.tsx` (tab), `HrSourceDialog.tsx`, `HrDeviceImportDialog.tsx`, `HrShiftsDialog.tsx`, `HrCorrectionDialog.tsx`; `HrShell.tsx` adds the `attendance` tab to HR_BUILT_TABS.
- Owner decisions: device push endpoint (server API + device auth) is out of scope for the web module or not; geofence consent text; whether the device file's date column defines the day (the prototype ignores it).

**R2 — platforms & reconciliation (optional: gov), pre-Mudad (optional: mudad)** — `gt`, `recon`, `mj`, X5A `pfx`; R3 `mudad` (GV-05 P2).
- Platform tasks are COMPUTED (`govTasks`), so only their completion is stored: `hrGovDone/{orgId}__{taskKey}` `{ ref, by, at }` — **new rules block**, or ride `hrSettings/{orgId}` with a `govDone` map (size grows without bound — not advised) or the employee log (cannot be queried per key). Recommend a small new collection with one compact rule using `hrManager() || hrRole('hr.gov')`.
- Reconciliation: `hrRecons/{orgId}__{platform}` `{ at, n, diff, by }` + extra tasks `XT` (`{ platform, employeeId, key, text, due }`) — can share the `hrGovDone` collection with a `kind` field (`done` | `recon` | `task`) to keep one rules block. Employee fields: `qiwaBasic` (documented basic — a pay fact: put it on `employeePay`, not `employees`), iqama date taken into `employees.docs.iqama` (gov may already update `docs`).
- Platform switches `pf`: `hrSettings.platforms` map — rides `hrSettings` rules.
- Pre-Mudad: add findings `basic_vs_qiwa` (needs `employeePay.qiwaBasic`) and `late_pay` (payroll `paidAt` vs pay day) to `payroll.ts:lineWarnings`; justifications `hrPayrolls/{id}.justifications: { [employeeId+finding]: text }` and Mudad status `hrPayrolls/{id}.mudad: { pct, note, by, at }` — ride `hrPayrolls`; its update rule must allow these two keys for the payroll officer / HR manager after approval (check the current state-locked update clause).
