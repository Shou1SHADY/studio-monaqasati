# rules-sim status (firestore.work.rules rework)

Work copy: `scripts/rules-sim/firestore.work.rules`  (never edit the repo's firestore.rules)
Base (frozen copy of firestore.rules at the start): `firestore.base.rules`

## Done (all in the work copy; each verified by suites r7 = proc/pm/mfg/sales, 0 limit hits)
- Helpers: getUserData single read; hasOrgPermission/hasOrgAny/groupGrantsAny/hasProjectAny/hasRfqAny (one group read for several perms);
  pmPerms (+pmCeilingOf/pmCeilingHas/pmCeilingAnd), pmRoleDuties, pmDuty/pmDutyAnd (ceiling checks first, cheap fail), pmProjectOk, pmSeatDuty/pmSeatData.
- Key finding: `changedKeys()` (whole-document diff) is expensive; it is now computed once per rule via a function with `let ck`:
  poUpdateOk(poId), rfqUpdateOk(), projectUpdateOk(projectId), woUpdateOk(); boqUpdateOk, pmCounterDuty (one pm diff).
- purchaseOrders: cheap-first helpers, poPmStops first and takes poId (not resource.id), isAdmin last.
- rfqs/offers: arms cheap-first, actsOnRfq cheaper, offers decision permission asked once, mark-as-read (contractorReadAt/contractorUnread) for buying-company members.
- projects update: counters mapped to duties in pmCounterDuty; pmFinanceKeys excluded from the PM/approve arms (B7); BOQ editors may use the `create` key.
- members (cheap shape first, PM-team create last), pmCertificates/pmVariations/pmClaims/pmPlantRequests/purchaseRequests reordered.
- workOrders: keys first, woStatusOk (unchanged status or open|done, never revive a cancelled order), purchaseRequests arm + buysOrApproves/deliveries.confirm.
- B1 legacy owner (isOrgOwner), B2 mfgStops qc, B3 manufacturingRequests update, B4 create sales.approve, B5 rfq draft rfq.create,
  B6 keepsOrg on crmContacts/crmOpportunities/crmActivities/salesPriceItems/invoices, B7, B8 accessRequests isCompanyOwner.
- HR: hrSheetOk first declaration (`before.size() == 0 ||`), hrExits get/list employee clause first, admin last.

## Tools (scripts/rules-sim)
- Runners honour RULES_FILE (procurement.ts, sales.ts, manufacturing.ts, pm-accounting.ts, hr.ts). `runall.sh <tag> <rulesFile> [proc pm mfg sales hr]` -> out/<suite>.<tag>.txt
- `cmp.js base.txt work.txt` verdict diff; `size.js file` compiled size (comments+whitespace stripped); `compile.js file` compile check;
  `cal.js` expression-cost calibration (flaky); `padrules.js in out K` adds K expressions of ballast to every create/update rule (headroom test);
  `jest-redirect.cjs` + `RULES_FILE_ABS=... jest --setupFiles` runs the rule-text jest tests against a candidate file;
  `tests-for-work-rules.patch` = the 5 jest tests whose text pins changed (git apply -p1).

## Commands
```
cd /c/Users/HP/Downloads/studio-monaqasati
scripts/rules-sim/runall.sh rN scripts/rules-sim/firestore.work.rules proc pm mfg sales        # ~35 min
PAR=40 scripts/rules-sim/runall.sh rN scripts/rules-sim/firestore.work.rules hr              # slow; hr prints only at the end
node scripts/rules-sim/cmp.js out/proc.base.txt out/proc.rN.txt     # same for pm/mfg/sales/hr
```
gcloud must be on PATH (Windows path style); see out/ for earlier runs (base = original rules, r7 = last full run).

## Final (rebased on 5b0c49f, run r9)
- firestore.work.rules = current repo rules + all edits; compiled size 147,698 (<= 147,834). LF endings.
- proc 519 cases 0 limit hits; pm 747: 0; mfg 789: 0; sales 853: 0; hr 1367/1367 as expected (0 limit hits).
- jest: apply tests-for-work-rules.patch (5 rule-text tests) when installing.
- Left: nothing blocking. Known base issues not fixed: see report.
