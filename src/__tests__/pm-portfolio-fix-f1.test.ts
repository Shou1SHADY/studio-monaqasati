/**
 * PM 1.0 portfolio — fix wave F (V1-pm-portfolio-05/06): a decision raised by
 * ONE document names it, as the prototype's rows do («م-04 بانتظار اعتمادك —
 * قاسه عمر», «طلب مواد 01 — اعتماد فني», «أمر تغيير 02 نُفّذ 30% …», «عيّنة 01
 * مرفوضة», «فحص 02 مرفوض»), and «مستخلص جاهز» carries the days since the last
 * billed measurement. Several documents keep the counted row.
 */

import { projectDecisions, type DecisionFacts } from "@/lib/pm/decisions"
import { defaultTerms } from "@/lib/pm/terms"
import type { PmMaterialRequest } from "@/lib/pm/supply"

const base: DecisionFacts = {
  lifecycle: "live",
  managerless: false,
  startOn: "2026-01-01",
  plannedStart: "2026-01-01",
  durationDays: 300,
  baseValue: 1_000_000,
  terms: defaultTerms(),
  acceptances: {},
  items: [{ quantity: 100, rate: 10_000, executed: 90, billed: 90 }],
  sheets: [],
  addenda: [],
  certificates: [],
  punch: [],
  variations: [],
  claims: [],
  eac: { on: "2026-09-20" },
  today: "2026-09-27",
}
const find = (f: Partial<DecisionFacts>, k: string) => projectDecisions({ ...base, ...f }).find((d) => d.kind === k)

describe("one document, named", () => {
  it("a single waiting sheet names its number, who measured it and its lines", () => {
    const d = find({ sheets: [{ status: "wait", day: "2026-09-25", seq: 4, byName: "عمر", lines: [{}, {}] }] }, "sheets_waiting")
    expect(d).toMatchObject({ count: 1, title: "title_one", detail: "detail_one", vars: { no: "04", name: "عمر", n: 2 } })
    expect(find({ sheets: [{ status: "wait", day: "2026-09-25", seq: 4, lines: [{}] }] }, "sheets_waiting")).toMatchObject({ title: "title_one_plain", vars: { no: "04", n: 1 } })
    const two = find({ sheets: [{ status: "wait", day: "2026-09-25", seq: 4, byName: "عمر" }, { status: "wait", day: "2026-09-26", seq: 5, byName: "عمر" }] }, "sheets_waiting")
    expect(two).toMatchObject({ count: 2 })
    expect(two?.title).toBeUndefined()
    expect(two?.vars).toBeUndefined()
  })

  it("a single material request names its number, title and need date", () => {
    const req: PmMaterialRequest = { id: "01", seq: 1, pm: true, title: "حديد الأسقف", needBy: "2026-10-20", lines: [], status: "pending", requestedByUserId: "se1", day: "2026-09-26" }
    expect(find({ requests: [req] }, "req_waiting")).toMatchObject({ title: "title_one", detail: "detail_one_need", vars: { no: "01", name: "حديد الأسقف", date: "2026-10-20" } })
    expect(find({ requests: [{ ...req, needBy: null }] }, "req_waiting")).toMatchObject({ detail: "detail_one" })
    expect(find({ requests: [req, { ...req, id: "02", seq: 2 }] }, "req_waiting")?.title).toBeUndefined()
  })

  it("a single variation worked before approval names its number, share and title", () => {
    const d = find({ variations: [{ seq: 2, title: "تغيير البلاط", status: "wait", value: 20_000, executedPct: 0.3, day: "2026-09-01" }] }, "vo_work")
    expect(d).toMatchObject({ title: "title_one", detail: "detail_one", age: 26, vars: { no: "02", pct: 30, name: "تغيير البلاط" } })
  })

  it("a single rejected sample names its number, what it is and the consultant's note", () => {
    const d = find({ submittals: [{ itemId: "a", seq: 1, what: "عازل مائي", status: "rej", rev: 1, day: "2026-09-20", reply: { note: "السماكة 3 مم" } }] }, "sample_rejected")
    expect(d).toMatchObject({ title: "title_one", detail: "detail_one_note", vars: { no: "01", name: "عازل مائي", note: "السماكة 3 مم" } })
    expect(find({ submittals: [{ itemId: "a", seq: 1, what: "عازل", status: "rej", rev: 1, day: "2026-09-20" }] }, "sample_rejected")).toMatchObject({ detail: "detail_one" })
  })

  it("a single failed inspection names its number, location and note", () => {
    const d = find(
      {
        items: [{ id: "i06", quantity: 100, rate: 10_000, executed: 90, billed: 90, gate: { pmInspect: true, pmWir: "fail" } }],
        inspections: [
          { seq: 1, itemId: "i06", status: "fail", location: "قديم", attempts: [{ on: "2026-08-01" }] },
          { seq: 2, itemId: "i06", status: "fail", location: "الفيلا 1 — الدور الأرضي", attempts: [{ on: "2026-09-17", rOn: "2026-09-17", note: "سماكة اللياسة أقل" }] },
        ],
      },
      "wir_failed"
    )
    expect(d).toMatchObject({ count: 1, title: "title_one", detail: "detail_one_note", age: 10, vars: { no: "02", name: "الفيلا 1 — الدور الأرضي", note: "سماكة اللياسة أقل" } })
  })
})

describe("an IPC ready says how long the last billed measurement has waited", () => {
  const items = [{ quantity: 100, rate: 10_000, executed: 90, billed: 80 }]
  it("with a last certificate: its age and the sub-line", () => {
    expect(find({ items, lastCertDay: "2026-09-07" }, "ipc_ready")).toMatchObject({ severity: "red", amount: 100_000, age: 20, detail: "detail_since", vars: { days: 20 } })
  })
  it("with none: the plain sub-line", () => {
    const d = find({ items }, "ipc_ready")
    expect(d?.detail).toBeUndefined()
    expect(d?.age).toBeUndefined()
  })
})
