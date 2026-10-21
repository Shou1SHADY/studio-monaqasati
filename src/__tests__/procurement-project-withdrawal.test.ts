/**
 * PUR-01 p.5: a request the project took back.
 *   · before its approval it never reaches Procurement;
 *   · after it reached us and before anything was bought it moves to «انتهت» as «سحبه المشروع», with the day
 *     and who withdrew it (it used to vanish: nothing was left in its `items`);
 *   · after an RFQ or an order exists it stays where it is and is MARKED — the decision is Procurement's.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { todayDay } from "@/lib/pm/format"
import { approveMaterialRequest, createMaterialRequest, stopLine, withdrawMaterialRequest } from "@/lib/pm/supply-writes"
import { buildNeedRows, inSegment, type DeskFacts } from "@/lib/procurement/need-desk"
import { inRequestSegment, requestCards, requestState } from "@/lib/procurement/incoming-requests"
import { linkNeed } from "@/lib/procurement/needs-writes"
import { projectNeed, reachesProcurement, type ProjectRequestDoc } from "@/lib/procurement/needs"
import { projectRequestsOf, requestChanges, wholeWithdrawal } from "@/lib/procurement/project-change"
import { resolvePolicies } from "@/lib/procurement/policies"

const db = fakeFirestore as unknown as Firestore
const ctx: PmContext = { ceiling: pmCeiling({ owner: true, permissions: [] }), seat: null, archived: false }
const asker = { uid: "own", name: "م. فهد" }
const boss = { uid: "own", name: "م. خالد" }
const project = { id: "P1", name: "مجمع الياسمين" }
const R = "projects/P1/purchaseRequests/01"
const facts: DeskFacts = { now: new Date(`${todayDay()}T08:00:00Z`), policies: resolvePolicies(null), agreements: [], history: [], orders: [], rfqs: [], onHand: () => null, makeable: () => false, mfgRequests: {} }

const lines = [
  { itemId: "b1", name: "بلوك أسمنتي مفرغ 20 سم", unit: "قطعة", qty: 2000 },
  { itemId: "b1", name: "أسمنت بورتلاندي عادي", unit: "كيس", qty: 200 },
  { itemId: "b1", name: "رمل أبيض للياسة", unit: "م³", qty: 15 },
]

async function requested(approve = true) {
  resetFakeDb()
  seed("projects/P1", { organizationId: "own", contractorId: "own", name: project.name, status: "in_progress", projectManagerId: "own", enabledSections: ["procure"], pm: { no: "PJ-2026/001", lifecycle: "live", startOn: todayDay(), durationDays: 200 } })
  seed("projects/P1/boqItems/b1", { itemNo: "09-01-01", descriptionAr: "لياسة داخلية", unit: "م²", quantity: 5000, unitPrice: 40, executedQuantity: 0 })
  await createMaterialRequest(db, ctx, "P1", asker, { title: "مواد", needBy: null, notes: null, lines })
  if (approve) await approveMaterialRequest(db, ctx, "P1", boss, "01")
}
const raw = () => ({ id: "01", ...(readDoc<Record<string, unknown>>(R) as Record<string, unknown>) }) as ProjectRequestDoc
const need = () => projectNeed(project, raw(), "MR 01")
const cards = () => requestCards(buildNeedRows([need()], facts), [])

describe("what reaches Procurement", () => {
  it("never a request withdrawn (or still waiting, or rejected) before the project manager approved it", async () => {
    await requested(false)
    expect(reachesProcurement(raw())).toBe(false)
    await withdrawMaterialRequest(db, ctx, "P1", asker, "01")
    expect(raw()).toMatchObject({ status: "rejected", withdrawn: true })
    expect(reachesProcurement(raw())).toBe(false)
    expect(reachesProcurement({ pm: true, status: "rejected" })).toBe(false)
  })
  it("the approved one, and a legacy one in any state", async () => {
    await requested()
    expect(reachesProcurement(raw())).toBe(true)
    expect(reachesProcurement({ pm: undefined, status: "pending" })).toBe(true)
  })
})

describe("withdrawn after it reached Procurement, before anything was bought", () => {
  it("moves to «انتهت» as «سحبه المشروع» with the day and the name of who withdrew it", async () => {
    await requested()
    expect(cards()[0].state).toBe("new")
    for (const i of [0, 1, 2]) await stopLine(db, ctx, "P1", boss, "01", i, "need", null)
    const n = need()
    expect(n).toMatchObject({ state: "done", endKind: "withdrawn", endNote: "م. خالد", withdrawal: { on: todayDay(), byName: "م. خالد" } })
    expect(n.lines.map((l) => [l.name, l.quantity])).toEqual(lines.map((l) => [l.name, l.qty]))
    const [card] = cards()
    expect(card.state).toBe("withdrawn")
    expect(card.withdrawal).toEqual({ on: todayDay(), byName: "م. خالد" })
    expect(inRequestSegment(card, "done")).toBe(true)
    expect(inRequestSegment(card, "new")).toBe(false)
    expect(buildNeedRows([n], facts).every((r) => inSegment(r, "done"))).toBe(true)
  })
  it("a request with only some lines stopped stays new, and says what the project took back", async () => {
    await requested()
    await stopLine(db, ctx, "P1", boss, "01", 2, "need", null)
    const [card] = cards()
    expect(card.state).toBe("new")
    expect(card.rows.map((r) => r.name)).toEqual([lines[0].name, lines[1].name])
    expect(card.changes).toEqual([{ kind: "withdrawn", on: todayDay(), byName: "م. خالد", lines: [{ line: 2, name: lines[2].name, unit: "م³", was: 15, now: 0 }] }])
  })
})

describe("withdrawn or changed after an RFQ or an order exists", () => {
  it("the request stays in its RFQ and is marked, for Procurement to decide", async () => {
    await requested()
    await linkNeed(db, need().source, { rfqId: "r1", rfqNumber: "RFQ-2026/001" }, "Badr")
    for (const i of [0, 1, 2]) await stopLine(db, ctx, "P1", boss, "01", i, "need", null)
    const n = need()
    expect(n).toMatchObject({ state: "rfq", rfqId: "r1" })
    expect(n.withdrawal).toBeNull()
    expect(n.projectChanges).toHaveLength(1)
    const [card] = cards()
    expect(card.state).toBe("rfq")
    expect(card.changes[0]).toMatchObject({ kind: "withdrawn", byName: "م. خالد" })
    expect(card.changes[0].lines).toHaveLength(3)
  })
  it("a line stopped after part of it arrived is «عدّله المشروع» with the new quantity", () => {
    const pr: Pick<ProjectRequestDoc, "pm" | "status" | "lines"> = {
      pm: true,
      status: "approved",
      lines: [{ name: "حديد", unit: "طن", qty: 10, receipts: [{ q: 4 }], cl: { t: "short", on: "2026-10-20", byName: "م. خالد", why: "need" } }],
    }
    expect(requestChanges(pr)).toEqual([{ kind: "changed", on: "2026-10-20", byName: "م. خالد", lines: [{ line: 0, name: "حديد", unit: "طن", was: 10, now: 4 }] }])
    expect(wholeWithdrawal(pr)).toBeNull()
  })
  it("a rejected change is not a withdrawal", () => {
    const pr: Pick<ProjectRequestDoc, "pm" | "status" | "lines"> = { pm: true, status: "approved", lines: [{ name: "x", unit: "u", qty: 1, cl: { t: "cancel", on: "2026-10-20", why: "chg" } }, { name: "y", unit: "u", qty: 1 }] }
    expect(requestChanges(pr)).toEqual([])
  })
  it("an RFQ or an order names its request, and the one line of it that it carries", () => {
    const rfq = {
      products: [
        { needSource: { kind: "project_request", projectId: "P1", purchaseRequestId: "01", line: 0 } },
        { needSource: { kind: "project_request", projectId: "P1", purchaseRequestId: "01", line: 1 } },
        { needSource: { kind: "project_request", projectId: "P1", purchaseRequestId: "01", line: 1 } },
      ],
    }
    expect(projectRequestsOf(rfq)).toEqual([
      { projectId: "P1", purchaseRequestId: "01", line: 0 },
      { projectId: "P1", purchaseRequestId: "01", line: 1 },
    ])
    expect(projectRequestsOf({ purchaseSource: { kind: "project_request", projectId: "P1", purchaseRequestId: "02" } })).toEqual([{ projectId: "P1", purchaseRequestId: "02", line: null }])
    expect(projectRequestsOf({ purchaseSource: { kind: "stock_gap", warehouseId: "w", itemId: "i" } })).toEqual([])
  })
})

describe("a legacy request the requester withdrew", () => {
  it("reads as withdrawn, with the day and the name — not as refused", () => {
    const n = projectNeed(project, { id: "9", status: "rejected", withdrawn: true, decidedByUserName: "م. سعد", decidedAt: "2026-10-05T09:00:00.000Z", items: [{ name: "حديد", quantity: 3, unit: "طن" }] }, "PR-9")
    expect(n).toMatchObject({ state: "done", endKind: "withdrawn", withdrawal: { on: "2026-10-05", byName: "م. سعد" } })
    expect(requestState(buildNeedRows([n], facts), null)).toBe("withdrawn")
  })
})
