/**
 * PUR-01 p.2 (R2): «جهّزه» then a row deleted, then the rest published — only the lines actually published
 * leave the desk. The request is linked line by line, the dropped row stays on the incoming page as new and the
 * request reads «جزء منه في عروض»; the project sees the same per material. A request taken whole is still linked as one.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { todayDay } from "@/lib/pm/format"
import { linePhase, requestOf } from "@/lib/pm/supply"
import { approveMaterialRequest, createMaterialRequest } from "@/lib/pm/supply-writes"
import { buildNeedRows, type DeskFacts } from "@/lib/procurement/need-desk"
import { requestCards } from "@/lib/procurement/incoming-requests"
import { linkNeed } from "@/lib/procurement/needs-writes"
import { projectNeed, type Need, type NeedSource, type ProjectRequestDoc } from "@/lib/procurement/needs"
import { resolvePolicies } from "@/lib/procurement/policies"
import { addRequests, incomingFromNeed, newGroup, partialRequestKeys, removeLine, rfqLinesDoc, type EditorGroup } from "@/lib/procurement/rfq-editor"

const db = fakeFirestore as unknown as Firestore
const ctx: PmContext = { ceiling: pmCeiling({ owner: true, permissions: [] }), seat: null, archived: false }
const actor = { uid: "own", name: "م. فهد" }
const project = { id: "P1", name: "مجمع الياسمين" }
const R = "projects/P1/purchaseRequests/01"
const facts: DeskFacts = { now: new Date(`${todayDay()}T08:00:00Z`), policies: resolvePolicies(null), agreements: [], history: [], orders: [], rfqs: [], onHand: () => null, makeable: () => false, mfgRequests: {} }
const names = ["بلوك أسمنتي مفرغ 20 سم", "أسمنت بورتلاندي عادي", "رمل أبيض للياسة"]

const raw = () => ({ id: "01", ...(readDoc<Record<string, unknown>>(R) as Record<string, unknown>) }) as ProjectRequestDoc
const need = (): Need => projectNeed(project, raw(), "MR 01")
const cards = () => requestCards(buildNeedRows([need()], facts), [])

/** The editor's groups for a request, every row finished (as if its material were picked). */
const editorGroups = (n: Need): EditorGroup[] =>
  addRequests([newGroup()], [incomingFromNeed(n, [])]).map((g) => ({ ...g, city: "الرياض", lines: g.lines.map((l) => ({ ...l, legacy: { category: "مواد بناء", subCategory: "بناء" } })) }))

/** What «انشر» does with the groups: the RFQ's products, then each source linked on its request. */
async function publish(groups: EditorGroup[], rfqId: string, number: string) {
  const perLine = partialRequestKeys(groups)
  const { products } = rfqLinesDoc(groups, "ar", () => null, { perLine })
  const sources = Array.from(new Map(products.flatMap((p) => ("needSource" in p ? [[JSON.stringify(p.needSource), p.needSource as NeedSource] as const] : []))).values())
  for (const src of sources) await linkNeed(db, src, { rfqId, rfqNumber: number }, "Badr")
  return { perLine, sources }
}

beforeEach(async () => {
  resetFakeDb()
  seed("projects/P1", { organizationId: "own", contractorId: "own", name: project.name, status: "in_progress", projectManagerId: "own", enabledSections: ["procure"], pm: { no: "PJ-2026/001", lifecycle: "live", startOn: todayDay(), durationDays: 200 } })
  seed("projects/P1/boqItems/b1", { itemNo: "09-01-01", descriptionAr: "لياسة داخلية", unit: "م²", quantity: 5000, unitPrice: 40, executedQuantity: 0 })
  await createMaterialRequest(db, ctx, "P1", actor, {
    title: "مواد",
    needBy: null,
    notes: null,
    lines: [
      { itemId: "b1", name: names[0], unit: "قطعة", qty: 2000 },
      { itemId: "b1", name: names[1], unit: "كيس", qty: 200 },
      { itemId: "b1", name: names[2], unit: "م³", qty: 15 },
    ],
  })
  await approveMaterialRequest(db, ctx, "P1", actor, "01")
})

describe("a row dropped before publishing", () => {
  it("each line of the request knows its place in it, and where the project sees it", () => {
    expect(need().lines.map((l) => [l.name, l.requestLine])).toEqual(names.map((n, i) => [n, i]))
    expect(incomingFromNeed(need(), [])).toMatchObject({ total: 3, linkedBefore: 0, fact: { ref: "MR 01", requestedBy: "م. فهد", approvedBy: "م. فهد", approvedOn: todayDay() } })
  })

  it("links only the published lines; the dropped one stays on the incoming page as new, the request «جزء منه في عروض»", async () => {
    const groups = editorGroups(need())
    const dropped = removeLine(groups, groups[0].key, groups[0].lines[2].key)
    const { perLine, sources } = await publish(dropped, "r1", "RFQ-2026/001")
    expect([...perLine]).toEqual([need().key])
    expect(sources.map((s) => s.line)).toEqual([0, 1])

    const stored = raw()
    expect(stored.rfqId ?? null).toBeNull()
    expect(stored.lineLinks).toMatchObject({ "0": { rfqId: "r1", rfqNumber: "RFQ-2026/001" }, "1": { rfqId: "r1" } })
    expect((stored.lineLinks as Record<string, unknown>)["2"]).toBeUndefined()

    const n = need()
    expect(n.state).toBe("action")
    const [card] = cards()
    expect(card.state).toBe("partial")
    expect(card.rows.map((r) => [r.name, r.state])).toEqual([[names[0], "rfq"], [names[1], "rfq"], [names[2], "open"]])
    expect(card.rfqs).toEqual([{ id: "r1", number: "RFQ-2026/001" }])
    expect(card.selectable).toBe(true)

    const project1 = requestOf({ ...(readDoc<Record<string, unknown>>(R) as Record<string, unknown>), id: "01" })
    expect(project1.lines.map((l) => linePhase(project1, l))).toEqual(["rfq", "rfq", "ask"])
  })

  it("the editor offers only what is left, and publishing it links per line too — then the whole request is in hand", async () => {
    const first = editorGroups(need())
    await publish(removeLine(first, first[0].key, first[0].lines[2].key), "r1", "RFQ-2026/001")

    const rest = incomingFromNeed(need(), [])
    expect(rest).toMatchObject({ total: 3, linkedBefore: 2 })
    expect(rest.lines.map((l) => l.name)).toEqual([names[2]])
    const second = editorGroups(need())
    expect(second[0].lines.map((l) => l.name)).toEqual([names[2]])
    const { sources } = await publish(second, "r2", "RFQ-2026/002")
    expect(sources.map((s) => s.line)).toEqual([2])

    const n = need()
    expect(n.state).toBe("rfq")
    expect(cards()[0].state).toBe("rfq")
    expect(cards()[0].rfqs.map((r) => r.id)).toEqual(["r1", "r2"])
  })

  it("a request taken whole is linked as one, on the request itself", async () => {
    const { perLine, sources } = await publish(editorGroups(need()), "r1", "RFQ-2026/001")
    expect(perLine.size).toBe(0)
    expect(sources).toHaveLength(1)
    expect(sources[0].line).toBeUndefined()
    expect(raw()).toMatchObject({ rfqId: "r1", rfqNumber: "RFQ-2026/001" })
    expect(cards()[0].state).toBe("rfq")
  })
})
