# HR 1.0 — status against the delivery package

Audit of 1 Oct 2026 against `Delivery-HR-1.0` (PRD-HR-1.0: 128 requirements — 59 P0 · 63 P1 · 6 P2;
`Prototype-HR-v11.html`; `HR-Pipeline-1.0.html`; the four QA packs). The built module is the R1 core
(15 commits of 27 Sep 2026). Method: six area reviews of the code against the PRD and the prototype's own
functions, each finding then re-read in the code before anything was changed; every fix has a test that
failed before it.

**State (1 Oct 2026, 09:38 UTC):** the rules fix is **live on UAT** (ruleset `6d45e52b…`, matches the file) and
**not on prod**, which still runs the rules of 29 Sep. The code fixes below are local and uncommitted — the
UAT app is still the last pushed build, so they are not on UAT yet.

## 1. The blocker: the live rules refuse the module's first-time operations

The Jest suites run the write layers over an in-memory Firestore with no rules, so none of this showed.
Traced from the rule text to the client's exact reads (not executed against an emulator — none on this machine):

| What fails on UAT and prod today | Why |
|---|---|
| New employee, and every imported row | The first log entry is written in the transaction that creates the employee; the log rule `get()`s the parent, which does not exist before that transaction. |
| The first attendance sheet of every site-month; a declaration or a closing on a month with no document | `hrAttendance` `get` reads `resource.data` of a missing document — an evaluation error, which refuses. |
| Preparing a month's payroll | Same, on `hrPayrolls`. |
| **Approving any payroll** | "Never sent twice" reads `hrEvents/…hr:PAY…`, which by design does not exist yet. |
| **Starting any exit; approving any settlement** | Same, on `hrExits` and on the `hr:FS` event. |
| Entering the wage of a joiner recorded without one (government relations' joiners; imports without a basic) | Same, on `employeePay`. |

Fixed in `firestore.rules` (a missing document reads as missing for the roles that may read it; the log's first
entry is judged with `getAfter()`), pinned by `src/__tests__/hr-rules.test.ts` — 10 of its 15 cases fail on the
rules as committed. Google compiled the ruleset at deploy. **Needs a click-through on UAT, then prod.**
The own-record check on `employeePay` is ordered so a payroll approval, which writes many pay documents in
one transaction, never triggers a record lookup per document (a transaction may look up twenty).

Also in that rules change, because each has a path in the UI:

- Government relations could link any employee record to his own user and then read that person's pay
  (RL-03). The link is now the HR manager's, never onto or off himself (owner excepted).
- Government relations could change any field of an employee record; now documents only (the matrix gives
  assigning, status and probation to the HR manager).
- An HR manager could change the wage or bank of his own record; Finance or management could rewrite their
  own outstanding advance (RL-02). Both closed.
- The named manager of an adopted or hand-made PM project could not raise a manpower request (the rule asked
  for a handover file).

The client follows: `employee.edit` (the "Link user" action) is the HR manager's alone, and `linkUser` refuses
linking oneself onto or off a record (`hr-link-user.test.ts`). Until that code is pushed, the build on UAT still
shows "Link" to government relations and the rules refuse it on save. Still open: one user linked to two records.

## 2. Fixed, each with a failing test first

| Area | What was wrong | Test |
|---|---|---|
| Payroll | A settled leaver vanished from every month before the month of his last day (EX-05) | `hr-payroll-audit` |
| Payroll | New GOSI scheme started the day after 3 Jul 2024, not on it | `hr-payroll-audit` |
| Payroll | A month of unpaid leave deducted 31 (or 28) days against a 30-day month — net went negative, or February paid two days not worked | `hr-payroll-audit` |
| Payroll | A day of approved **paid** leave marked absent on the sheet was docked (WF-07) | `hr-payroll-audit` |
| Payroll | Absences and overtime recorded at an office were dropped unless someone closed it — and nothing asked for that (AT-02) | `hr-payroll-audit` |
| Payroll | One date marked absent on two workplaces' sheets was deducted twice | `hr-payroll-audit` |
| Payroll | Sick days counted twice on a person's first payroll (LV-06) | `hr-payroll-audit` |
| Files | The GOSI statement left held lines out while the entry credited them — "statement = GOSI credit" did not hold (PY-07) | `hr-payroll-audit`, `hr-payroll` |
| Files | The Mudad row showed negative "other earnings" on an absence, and read today's pay rather than the pay the month was computed with | `hr-payroll-audit` |
| Payroll | A workplace whose people all joined this month still had to be "closed" for last month before last month's payroll | `hr-today` |
| Attendance | Overtime typed before switching to absent/sick was saved and paid | `hr-attendance` |
| Attendance | Someone serving notice disappeared from the sheet; people were listed on days before they joined | `hr-attendance` |
| Attendance | The sheet did not know about approved leave — now shown "on approved leave", nothing recorded against them | `hr-attendance` |
| Attendance | Another user's save wiped unsaved rows; a failed declaration cleared its note | — (screen) |
| Manpower | Coverage skipped every unassigned worker when the project had no HR workplace; a joiner still marked "expected" was never offered (AS-02) | `hr-manpower` |
| Today | Government relations never saw an expired iqama of someone on a site (DC-02) | `hr-today` |
| Today | A company that started this month was told to close and pay last month | `hr-today` |
| Today | No row when custody is cleared and the settlement is the HR manager's turn; none for a prepared "-D" payroll | `hr-today` |
| Import | The package's own template was rejected row for row (countries by name); a row whose join date was text vanished; line numbers drifted; a future join date was accepted; an English-only name was rejected; the opening leave balance landed one day short on about half the join dates (IM-01…03) | `hr-import` |
| i18n | `req.block.no_value / bad_iban / no_document` and `log.data_filed / data_declined / data_cancelled` did not exist in either language — the data-update form showed raw key paths | checker cannot see dynamic keys |

## 3. Verified and still open

Money and law first.

| # | Requirement | Defect |
|---|---|---|
| 1 | EM-04, PY-04 (P0) | A pay change ignores its effective date: the dialog never passes the last closed month, so no retro is computed, a future-dated raise applies at once, and the supplementary "-D" payroll can never have a line. |
| 2 | EX-04 | The settlement's last-month pay is the day of the month × wage/30: it ignores the join date, the month's attendance and GOSI; a back-dated last day in a month already paid is paid twice. |
| 3 | PN-03/04 | A penalty objected after its payroll: deducted again if upheld (`deductMonth` is rewritten), never refunded if cancelled. |
| 4 | LV-04 (P0) | "No travel before renewal" depends on a travel checkbox that defaults to off; a missing passport date counts as lapsing. |
| 5 | LV-02 (P0), AT-06 | No holiday calendar exists: holidays are counted inside leave and as unrecorded days. |
| 6 | PY-04 | The supplementary is dated into the closed month (refused once that period is locked); only one "-D" per month. |
| 7 | PY-03, AC-04 | Finance's desk records a returned transfer only on the newest paid payroll; held lines older than three payrolls are lost from view; the owner of a company with no payroll officer cannot fix a returned IBAN. |
| 8 | AD-01 | The advance instalment starts on approval, not on payout; two months prepared back to back both take it. |
| 9 | EX-01/02 | Art. 77 on a fixed term is typed and optional (`contract.end` is never read); service years are days ÷ 365, which moves the art. 85 thresholds by a day. |
| 10 | DC-05, EM-03 | An arrival with no iqama after 90 days is still legal on a site; a promotion can put a non-Saudi in a Saudi-only trade. |
| 11 | EM-05 | "End during probation" does not start the exit; imported long-service staff show an open probation forever. |
| 12 | DC-07, PN-01 | A supervisor has no screen to record an injury or a manual violation (the panels sit under People, which he does not have). |
| 13 | PY-01 | Commission never reaches the line; a renewal's fee is not sent to Finance (DC-03, `hr:PR`). |
| 14 | — | Employee writes use the UTC day (00:00–03:00 Riyadh is "yesterday"); nothing ever moves a record from `expected` to `active`. |
| 15 | RL-02 | Who decides is taken from who files, not from who the employee is (HR manager A files for HR manager B and approves it). |
| 16 | LV-03, LV-07 | The decision has no "balance only / excess unpaid" choice; the employee has no way to cancel his own pending request. |
| 17 | RL-01 | The seeded `finance` group holds `employees.manage`: every Finance member is HR manager and Finance at once. No seeded group carries the other four HR roles. |
| 18 | Rules hardening | A month can be closed before it ends by a direct call; declarations are not append-only; the objection's 15 days and "cancel before it starts" are client-only; a supervisor reads every employee in the org; journal entries for returned and held lines carry one person's net and are org-readable. |

To confirm with the authority rather than from code: whether the new-scheme GOSI rate for September 2026 is
10.25 / 12.25 (as the PRD says) or has stepped up in July.

## 4. Not built

Core, in the PRD's R1 or its core tab set: **Reports** (RP-01/02 — the prototype's core tabs are today · people ·
sites · pay · reports · settings); **notifications** (the module writes none — "a penalty on you" starts a 15-day
clock nobody is told about); **letters** (EM-08, WF-24 — new in this release of the package; nothing exists);
Today's three KPIs and role panels (TD-04); the 10-step build path (6 exist) and the gaps panel (ST-05);
return from leave and art. 80 (AT-05); assignment correction by the supervisor (AS-03); the officer's list by
person (DC-04); attachments (EM-07); opening balance from the card (IM-04); pre-Mudad check and reconciliation
(PY-08/09); two of the three block/warn policies (ST-03).

Optional features (R2/R3), none built — their switches in Settings change nothing visible: punches and
geofence (PT), shifts (SH), hiring (HI), performance (PF), training (TR), platforms (GV), the mobile app and a
third language (ES-07).

Tests the package asks for and the product lacks: a per-role render test (AC-12 — PM and Procurement have
one in `render-*-roles.test.tsx`; HR has none) and the end-to-end flows of `qa_flows.js` run over the rules.

## 5. Checks at the end of the audit

`npx jest` 3,145 passed (178 suites; HR 181) · `npx tsc --noEmit` only the known errors · `check-i18n-links`
0 / 0 / 0 · eslint clean on the changed files.
