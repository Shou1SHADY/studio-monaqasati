/**
 * HR 1.0 — moving in (IM-01…03, PY-10): the file is read, each row validated
 * and interpreted with a visible note — never invented — rejected rows are not
 * saved; opening balances land so the leave balance today is the file's
 * (capped) and payroll starts from the import month.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext } from "@/lib/hr/access"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import { createEmployee } from "@/lib/hr/employee-writes"
import { IMPORT_COLUMNS, interpretRows, parseCsv, parseDay } from "@/lib/hr/import"
import { leaveBalance } from "@/lib/hr/leave"
import { onPayroll } from "@/lib/hr/payroll"
import type { HrSite } from "@/lib/hr/sites"

const TODAY = "2026-09-10"
const sites: HrSite[] = [{ id: "s1", organizationId: "org", name: "Tower A", type: "project", projectId: "p1", active: true }]
const ctx = { today: TODAY, sites, existing: [{ idNo: "2000000001", names: { en: "Old Hand", ar: "قديم" }, join: "2020-01-01" }], tradeLabels: { "بنّاء": "mason", mason: "mason", "نجار": "carpenter" }, nationalityLabels: { "مصري": "eg", egyptian: "eg" } }
const head = IMPORT_COLUMNS.join(",")
const row = (o: Partial<Record<(typeof IMPORT_COLUMNS)[number], string>>) => IMPORT_COLUMNS.map((c) => (o[c] ?? "").includes(",") ? `"${o[c]}"` : (o[c] ?? "")).join(",")
const good = { name_ar: "أحمد", name_en: "Ahmed", id_no: "2345678901", nationality: "مصري", gender: "ذكر", trade: "بنّاء", workplace: "tower a", join_date: "01/03/2024", basic: "2,000", iqama_expiry: "2027-05-01", iban: "SA44 2000 0001 2345 6789 1234", leave_balance: "30", advance_balance: "600" }

describe("reading and interpreting", () => {
  it("parses quoted cells, semicolons and a BOM; dates as YYYY-MM-DD or DD/MM/YYYY", () => {
    expect(parseCsv('﻿a,"b, c";d\r\n1,2\n')).toEqual([["a", "b, c", "d"], ["1", "2"]])
    expect(parseDay("01/03/2024")).toBe("2024-03-01")
    expect(parseDay("2024-02-30")).toBeNull()
  })

  it("a clean row: labels interpreted from either language, the site by name, the basic with its thousands", () => {
    const [r] = interpretRows(parseCsv(`${head}\n${row(good)}`), ctx)
    expect(r).toMatchObject({ status: "clean", errors: [] })
    expect(r.input).toMatchObject({ nationality: "eg", gender: "m", trade: "mason", siteId: "s1", join: "2024-03-01", basic: 2_000, iban: "SA4420000001234567891234", since: "2026-09", advanceBalance: 600 })
  })

  it("the nearest trade with a note; an unknown site goes unassigned with a note; an expired iqama never on a site (IM-03, DC-02)", () => {
    const [r] = interpretRows(parseCsv(`${head}\n${row({ ...good, trade: "masson", workplace: "Tower Z" })}`), ctx)
    expect(r.status).toBe("notes")
    expect(r.notes.map((n) => n.key)).toEqual(expect.arrayContaining(["trade_interpreted", "site_unknown"]))
    const [x] = interpretRows(parseCsv(`${head}\n${row({ ...good, iqama_expiry: "2026-01-01" })}`), ctx)
    expect(x.notes.map((n) => n.key)).toContain("iqama_expired_unassigned")
    expect(x.input?.siteId).toBe("__bench__")
  })

  it("rejected rows are named and never saved: no name, bad gender, a duplicate ID, the same name and join already on the record", () => {
    const rows = interpretRows(
      parseCsv([head, row({ ...good, name_ar: "" }), row({ ...good, id_no: "1", gender: "?" }), row({ ...good, id_no: "2000000001" }), row({ ...good, id_no: "9", name_en: "Old Hand", join_date: "2020-01-01" })].join("\n")),
      ctx
    )
    expect(rows.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected", "rejected"])
    expect(rows.map((r) => r.errors[0].key)).toEqual(["no_name", "bad_gender", "duplicate_id", "duplicate"])
    expect(rows.every((r) => r.input === null)).toBe(true)
  })

  it("a leave balance above what could accrue is capped, with a note (IM-02)", () => {
    const [r] = interpretRows(parseCsv(`${head}\n${row({ ...good, join_date: "2026-06-01", leave_balance: "90" })}`), ctx)
    expect(r.notes.find((n) => n.key === "leave_capped")?.params).toMatchObject({ cap: 38 })
  })
})

describe("saving", () => {
  it("the balance today is the file's; the advance is outstanding; payroll starts from the import month (PY-10)", async () => {
    resetFakeDb()
    const db = fakeFirestore as unknown as Firestore
    const [r] = interpretRows(parseCsv(`${head}\n${row(good)}`), ctx)
    const hrm: HrContext = { uid: "hrm", owner: false, roles: new Set(["manager"]), employeeId: null, sites: [] }
    const { id } = await createEmployee(db, hrm, "org", { uid: "hrm", name: "H" }, r.input!, { visas: null })
    const e = readDoc<HrEmployee>(`employees/${id}`)!
    expect(leaveBalance(e.join, TODAY, e.leaveTaken, e.openingLeave)).toBe(30)
    expect(readDoc<EmployeePay>(`employeePay/${id}`)?.advance).toMatchObject({ balance: 600 })
    expect(onPayroll(e, "2026-08")).toBe(false)
    expect(onPayroll(e, "2026-09")).toBe(true)
  })
})
