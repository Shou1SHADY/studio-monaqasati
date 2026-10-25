/**
 * PM 1.1 — Supply › Requests (qa_fixes FX-32…36, clarifications REQ-01/03):
 * a rejection takes a reason from a list (REQ-02); stopping what has not
 * arrived needs a reason (REQ-04); a first request that dies takes back the
 * materials it added (REQ-05); a material a subcontractor supplies is refused
 * (REQ-01); a sample still with the consultant blocks approval (SUB-03); a
 * rejected quantity on a site receipt carries its reason (STK-09).
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { materialKeyOf, ratesWithoutRequest, storeIdOf, type PmStoreLine } from "@/lib/pm/store"
import { approveBlocks, receiveBlocks, rejectBlocks, requestBlocks, requestOf, stopBlocks, subSuppliedItems, type ReqLine } from "@/lib/pm/supply"
import { approveMaterialRequest, createMaterialRequest, receiveOnProject, rejectMaterialRequest, stopLine, withdrawMaterialRequest } from "@/lib/pm/supply-writes"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const siteActor = { uid: "se1", name: "Site" }
const pmActor = { uid: "pm1", name: "PM" }
const P = "projects/p1"
const mesh = materialKeyOf("Mesh", "m2")

beforeEach(() => {
  resetFakeDb()
  seed(P, { organizationId: "org", name: "Villas", projectManagerId: "pm1", pm: { no: "PJ-2026/001", lifecycle: "live" } })
  seed(`${P}/boqItems/i1`, { itemNo: "04-02-01", descriptionAr: "لياسة", unit: "m2", quantity: 10000, executedQuantity: 2000 })
  seed(`${P}/boqItems/i2`, { itemNo: "05-01-01", descriptionAr: "عزل", unit: "m2", quantity: 500, executedQuantity: 0 })
})

const reqDoc = () => requestOf({ id: "01", ...(readDoc<Record<string, unknown>>(`${P}/purchaseRequests/01`) as Record<string, unknown>) })
const meshLine = () => readDoc<PmStoreLine>(`${P}/pmStore/${storeIdOf(mesh)}`)

describe("REQ-02 (FX-33) — a rejection takes a reason from the list", () => {
  it("pure: no reason, or «other» without its text, is refused", () => {
    expect(rejectBlocks({ archived: false, status: "pending", why: null, text: null })).toEqual(["no_reason"])
    expect(rejectBlocks({ archived: false, status: "pending", why: "oth", text: "  " })).toEqual(["why_text"])
    expect(rejectBlocks({ archived: false, status: "pending", why: "dup", text: null })).toEqual([])
    expect(rejectBlocks({ archived: false, status: "approved", why: "dup", text: null })).toEqual(["not_pending"])
  })

  it("the write refuses without a reason and keeps the code for the requester", async () => {
    await createMaterialRequest(db, site, "p1", siteActor, { title: "", needBy: null, notes: null, lines: [{ itemId: "i2", name: "Mesh", unit: "m2", qty: 60 }] })
    await expect(rejectMaterialRequest(db, pm, "p1", pmActor, "01", { why: null, text: null })).rejects.toMatchObject({ blocks: ["no_reason"] })
    await expect(rejectMaterialRequest(db, pm, "p1", pmActor, "01", { why: "oth", text: "" })).rejects.toMatchObject({ blocks: ["why_text"] })
    await rejectMaterialRequest(db, pm, "p1", pmActor, "01", { why: "early", text: null })
    expect(reqDoc()).toMatchObject({ status: "rejected", rejectWhy: "early", rejectReason: null })
  })
})

describe("REQ-04 (FX-34) — stopping what has not arrived needs a reason", () => {
  const line: ReqLine = { itemId: "i1", code: "x", key: "k", name: "Cement", unit: "bag", qty: 10, receipts: [] }
  const request = { status: "approved" as const, withdrawn: false, lines: [line] }
  it("pure: no reason is refused at save", () => {
    expect(stopBlocks({ archived: false, request, line, why: null, whyNote: null })).toEqual(["no_reason"])
    expect(stopBlocks({ archived: false, request, line, why: "oth", whyNote: "" })).toEqual(["why_text"])
    expect(stopBlocks({ archived: false, request, line, why: "need", whyNote: null })).toEqual([])
  })
  it("the write refuses too", async () => {
    await createMaterialRequest(db, site, "p1", siteActor, { title: "", needBy: null, notes: null, lines: [{ itemId: "i2", name: "Mesh", unit: "m2", qty: 60 }] })
    await approveMaterialRequest(db, pm, "p1", pmActor, "01")
    await expect(stopLine(db, pm, "p1", pmActor, "01", 0, null, null)).rejects.toMatchObject({ blocks: ["no_reason"] })
    expect(await stopLine(db, pm, "p1", pmActor, "01", 0, "need", null)).toBe("cancel")
  })
})

describe("REQ-05 (FX-35) — a first request that dies takes back what it added", () => {
  it("withdrawn: the item loses the material it built, tagged by the request", async () => {
    await createMaterialRequest(db, site, "p1", siteActor, { title: "", needBy: null, notes: null, lines: [{ itemId: "i2", name: "Mesh", unit: "m2", qty: 60 }] })
    expect(meshLine()?.rates.i2).toMatchObject({ src: "first", rq: "01", r: null })
    await withdrawMaterialRequest(db, site, "p1", siteActor, "01")
    expect(meshLine()?.rates.i2).toBeUndefined()
  })

  it("rejected: the same — unless a rate was set on it since", async () => {
    await createMaterialRequest(db, site, "p1", siteActor, { title: "", needBy: null, notes: null, lines: [{ itemId: "i2", name: "Mesh", unit: "m2", qty: 60 }] })
    await rejectMaterialRequest(db, pm, "p1", pmActor, "01", { why: "spec", text: null })
    expect(meshLine()?.rates.i2).toBeUndefined()
    const rated = { rates: { i2: { r: 1.05, w: 5, ex0: 0, src: "first" as const, rq: "02" } } }
    expect(ratesWithoutRequest(rated, "02")).toBeNull()
    expect(ratesWithoutRequest({ rates: { i2: { r: null, w: 5, ex0: 0, src: "first" as const, rq: "03" } } }, "02")).toBeNull()
  })
})

describe("REQ-01 — a material the subcontractor supplies is refused at save", () => {
  it("pure: the items let to a sub who supplies them", () => {
    const set = subSuppliedItems([{ materials: "his", lines: [{ itemId: "i2" }] }, { materials: "ours", lines: [{ itemId: "i1" }] }, { lines: [{ itemId: "i3" }] }])
    expect([...set]).toEqual(["i2"])
    expect(requestBlocks({ archived: false, lines: [{ itemId: "i2", name: "Mesh", unit: "m2", qty: 1 }], needBy: null, today: "2026-10-01", subSupplied: set })).toEqual(["sub_supplies"])
    expect(requestBlocks({ archived: false, lines: [{ itemId: "i1", name: "Mesh", unit: "m2", qty: 1 }], needBy: null, today: "2026-10-01", subSupplied: set })).toEqual([])
  })
  it("the write refuses it", async () => {
    seed(`${P}/pmSubcontracts/01`, { seq: 1, party: { name: "Al Noor" }, partyKey: "al-noor", materials: "his", lines: [{ itemId: "i2", qty: 500, rate: 10 }] })
    await expect(createMaterialRequest(db, site, "p1", siteActor, { title: "", needBy: null, notes: null, lines: [{ itemId: "i2", name: "Mesh", unit: "m2", qty: 60 }] })).rejects.toMatchObject({ blocks: ["sub_supplies"] })
    expect(await createMaterialRequest(db, site, "p1", siteActor, { title: "", needBy: null, notes: null, lines: [{ itemId: "i1", name: "Mesh", unit: "m2", qty: 60 }] })).toBe(1)
  })
})

describe("SUB-03 (FX-32) — a sample still with the consultant blocks approval", () => {
  it("pend joins rej and none", () => {
    const request = { status: "pending" as const, lines: [] }
    expect(approveBlocks({ archived: false, request, sample: "pend" })).toEqual(["sample_pending"])
    expect(approveBlocks({ archived: false, request, sample: "ok" })).toEqual([])
  })
})

describe("STK-09 (FX-36) — a rejected quantity carries its reason", () => {
  it("pure: required when anything is rejected, «other» with its text", () => {
    const base = { archived: false, receivable: true, remaining: 100, acc: 10 }
    expect(receiveBlocks({ ...base, rej: 0 })).toEqual([])
    expect(receiveBlocks({ ...base, rej: 2 })).toEqual(["rej_why"])
    expect(receiveBlocks({ ...base, rej: 2, rejWhy: "oth", rejNote: " " })).toEqual(["rej_text"])
    expect(receiveBlocks({ ...base, rej: 2, rejWhy: "exp" })).toEqual([])
  })
  it("the reason rides the receipt Procurement and Inventory read", async () => {
    await createMaterialRequest(db, site, "p1", siteActor, { title: "", needBy: null, notes: null, lines: [{ itemId: "i2", name: "Mesh", unit: "m2", qty: 60 }] })
    await approveMaterialRequest(db, pm, "p1", pmActor, "01")
    seed(`${P}/purchaseRequests/01`, { ...(readDoc<Record<string, unknown>>(`${P}/purchaseRequests/01`) as Record<string, unknown>), poId: "po1", poNumber: "PO-2026/001" })
    await receiveOnProject(db, site, "p1", siteActor, "01", 0, { acc: 20, rej: 3, rejWhy: "oth", rejNote: "wet rolls", dn: "DN-1", note: null, short: false })
    expect(reqDoc().lines[0].receipts?.[0]).toMatchObject({ q: 20, rej: 3, rejWhy: "oth", rejNote: "wet rolls" })
  })
})
