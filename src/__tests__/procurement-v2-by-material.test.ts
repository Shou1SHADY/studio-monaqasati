/** @jest-environment node */
/**
 * Procurement 2.0 — «بالمادة — قارن واجمع» (WP-S2-09, INC-05, WF-07): what is still to be bought, grouped by material AS SPECIFIED;
 * the total, the nearest last day to order and the last price paid for THAT specification; «اجمعها في طلب عروض واحد» opens the editor on
 * exactly the picked materials' lines; and the editor reads a line selection back (`incomingFromNeed`).
 */

import { byMaterial, combinable, combineHref, materialGroupKey, parseLinesParam } from "@/lib/procurement/by-material"
import { incomingFromNeed } from "@/lib/procurement/rfq-editor"
import { specKeyOf, type PriceHistoryEntry } from "@/lib/procurement/prices"
import type { MaterialPick } from "@/lib/materials/types"
import type { NeedRow } from "@/lib/procurement/need-desk"
import type { Need, NeedLine } from "@/lib/procurement/needs"

const pick = (nodeId: string, specs: Array<[string, string]>): MaterialPick => ({
  nodeId,
  subId: nodeId,
  rootId: "r",
  path: [{ ar: "الارضيات والجدران", en: "Floors and walls" }, { ar: "الرخام", en: "Marble" }],
  specs: specs.map(([n, v]) => ({ name: { ar: n, en: n }, value: { ar: v, en: v } })),
})

const CEMENT = pick("cement", [["الوزن", "50 كجم"]])
const MARBLE_ES = pick("marble", [["صنع في", "إسبانيا"], ["السمك", "20 مم"]])
const MARBLE_IT = pick("marble", [["صنع في", "إيطاليا"], ["السمك", "20 مم"]])

interface Line {
  name: string
  unit: string
  qty: number
  material?: MaterialPick | null
  state?: NeedRow["state"]
}

const request = (key: string, no: string, place: string, needBy: string, lastIn: number, lines: Line[], st = "new"): NeedRow[] => {
  const need = {
    key,
    refLabel: no,
    projectName: null,
    context: place,
    lines: lines.map((l): NeedLine => ({ name: l.name, unit: l.unit, quantity: l.qty, material: l.material ?? undefined })),
    incoming: { st, place: { label: place, city: "", district: "" }, lines: lines.map((l) => ({ name: l.name, unit: l.unit, qty: l.qty, material: l.material })) },
  } as unknown as Need
  return lines.map(
    (l, index) =>
      ({
        key: `${key}#${index}`,
        needKey: key,
        need,
        index,
        name: l.name,
        unit: l.unit,
        total: l.qty,
        open: l.state && l.state !== "open" ? 0 : l.qty,
        state: l.state ?? "open",
        needBy,
        lastOrderDay: `2026-10-${23 + lastIn}`,
        lastOrderIn: lastIn,
      }) as unknown as NeedRow
  )
}

const history = (specKey: string | null, extra: Partial<PriceHistoryEntry> = {}): PriceHistoryEntry => ({
  id: "h1",
  organizationId: "o",
  materialKey: "k",
  ...(specKey ? { specKey, materialId: "marble" } : {}),
  name: "رخام",
  unit: "م²",
  supplierOrgId: "s",
  supplierName: "مورد",
  price: 15.8,
  day: "2026-10-08",
  kind: "po",
  poId: "p13",
  poNumber: "ط.ش-2026/013",
  ...extra,
})

const rows = (): NeedRow[] => [
  ...request("team:t1", "ط.م-2026/014", "فيلا الملقا", "2026-11-22", 2, [
    { name: "الاسمنت العادي", unit: "كيس", qty: 200, material: CEMENT },
    { name: "رخام", unit: "م²", qty: 30, material: MARBLE_ES },
  ]),
  ...request("project:P1:03", "ط.م 03", "مجمع الياسمين", "2026-11-11", 0, [
    { name: "الاسمنت العادي", unit: "كيس", qty: 150, material: CEMENT },
    { name: "رخام", unit: "م²", qty: 26, material: MARBLE_ES },
    { name: "رخام إيطالي", unit: "م²", qty: 9, material: MARBLE_IT },
    { name: "رمل", unit: "م³", qty: 4, material: null },
  ]),
]

describe("INC-05 / WF-07 — the incoming requests by material", () => {
  it("the same material from two requests is one group with two sources and one total — 56 m² from two requests", () => {
    const groups = byMaterial(rows())
    const marble = groups.find((g) => g.key === materialGroupKey({ name: "رخام", unit: "م²", material: MARBLE_ES }))
    expect(marble).toMatchObject({ total: 56, requests: 2, unit: "م²" })
    expect(marble?.items.map((i) => [i.requestNo, i.place, i.qty])).toEqual([["ط.م-2026/014", "فيلا الملقا", 30], ["ط.م 03", "مجمع الياسمين", 26]])
    expect(marble?.path).toEqual({ ar: "الارضيات والجدران › الرخام", en: "Floors and walls › Marble" })
    expect(marble?.specs.map((s) => s.value.ar)).toEqual(["إسبانيا", "20 مم"])
  })

  it("cement from two requests is two sources (WF-07); the more requests a material is in, the earlier it is listed", () => {
    const groups = byMaterial(rows())
    const cement = groups.find((g) => g.name === "الاسمنت العادي")
    expect(cement).toMatchObject({ total: 350, requests: 2 })
    expect(groups.slice(0, 2).map((g) => g.requests)).toEqual([2, 2])
    expect(combinable(groups).map((g) => g.name).sort()).toEqual(["الاسمنت العادي", "رخام"])
  })

  it("two specifications of one node are two materials; a row typed outside the list is its own name and unit", () => {
    const groups = byMaterial(rows())
    expect(groups.filter((g) => g.name.startsWith("رخام"))).toHaveLength(2)
    expect(groups.find((g) => g.name === "رمل")).toMatchObject({ total: 4, requests: 1, specs: [], path: { ar: "", en: "" } })
  })

  it("the nearest last day to order is the earliest of its sources", () => {
    const cement = byMaterial(rows()).find((g) => g.name === "الاسمنت العادي")
    expect(cement).toMatchObject({ lastOrderIn: 0, lastOrderDay: "2026-10-23" })
  })

  it("only what is still to be bought counts: a line in an RFQ or waiting for a reply, and a request that ended, are out", () => {
    const grouped = byMaterial([
      ...request("team:a", "A", "x", "2026-11-22", 1, [{ name: "رخام", unit: "م²", qty: 30, material: MARBLE_ES, state: "rfq" }, { name: "الاسمنت العادي", unit: "كيس", qty: 5, material: CEMENT }]),
      ...request("team:b", "B", "y", "2026-11-22", 1, [{ name: "الاسمنت العادي", unit: "كيس", qty: 7, material: CEMENT }], "fail"),
      ...request("team:c", "C", "z", "2026-11-22", 1, [{ name: "الاسمنت العادي", unit: "كيس", qty: 11, material: CEMENT, state: "chk" }]),
    ])
    expect(grouped.map((g) => [g.name, g.total])).toEqual([["الاسمنت العادي", 5]])
  })

  it("the last price is that of the SAME specification, with its order's number and day; another size's price is no evidence", () => {
    const key = specKeyOf({ name: "رخام", unit: "م²", material: MARBLE_ES }).specKey
    const other = specKeyOf({ name: "رخام إيطالي", unit: "م²", material: MARBLE_IT }).specKey
    expect(key).not.toBe(other)
    const groups = byMaterial(rows(), [history(key)])
    expect(groups.find((g) => g.name === "رخام")?.last).toEqual({ price: 15.8, poNumber: "ط.ش-2026/013", day: "2026-10-08" })
    expect(groups.find((g) => g.name === "رخام إيطالي")?.last).toBeNull()
    expect(groups.find((g) => g.name === "الاسمنت العادي")?.last).toBeNull()
  })
})

describe("«اجمعها في طلب عروض واحد» — the editor on exactly the picked lines", () => {
  it("names the requests the picked materials come from and the lines of each", () => {
    const groups = byMaterial(rows())
    const marble = groups.find((g) => g.name === "رخام")?.key as string
    const href = combineHref(groups, new Set([marble]))
    const url = new URL(`http://x${href}`)
    expect(url.pathname).toBe("/contractor/rfqs/new")
    expect(url.searchParams.get("requests")).toBe("team:t1|project:P1:03")
    const lines = parseLinesParam(url.searchParams.get("lines"))
    expect([...(lines.get("team:t1") ?? [])]).toEqual([1])
    expect([...(lines.get("project:P1:03") ?? [])]).toEqual([1])
  })

  it("two picked materials of one request take both lines", () => {
    const groups = byMaterial(rows())
    const picked = new Set(groups.filter((g) => g.name === "رخام" || g.name === "الاسمنت العادي").map((g) => g.key))
    const lines = parseLinesParam(new URL(`http://x${combineHref(groups, picked)}`).searchParams.get("lines"))
    expect([...(lines.get("team:t1") ?? [])]).toEqual([0, 1])
  })

  it("the editor takes a request's lines the way the selection says, and never a line that is not to be bought", () => {
    const need = {
      key: "team:t1",
      refLabel: "ط.م-2026/014",
      source: { kind: "team_request", purchaseRequestId: "t1" },
      projectId: null,
      requestedBy: "م. فهد",
      approved: null,
      lines: [
        { name: "أ", unit: "كيس", quantity: 5, lineKind: "buy" },
        { name: "ب", unit: "كيس", quantity: 6, lineKind: "wait" },
        { name: "ج", unit: "كيس", quantity: 7, lineKind: "buy" },
        { name: "د", unit: "كيس", quantity: 8, lineKind: "rfq", link: { rfqId: "q", rfqNumber: "R", poId: null, poNumber: null } },
      ],
      place: { label: "x", city: "", district: "" },
      context: "x",
      needBy: "2026-11-22",
      siteId: null,
    } as unknown as Need
    expect(incomingFromNeed(need, []).lines.map((l) => l.name)).toEqual(["أ", "ج"])
    expect(incomingFromNeed(need, [], null, new Set([2])).lines.map((l) => l.name)).toEqual(["ج"])
    expect(incomingFromNeed(need, [], null, new Set([1, 3])).lines).toEqual([])
  })

  it("an unreadable selection is no selection", () => {
    expect(parseLinesParam(null).size).toBe(0)
    expect(parseLinesParam("a@x.y|@1|b").size).toBe(0)
    expect([...(parseLinesParam("a@0.2|b@3").get("a") ?? [])]).toEqual([0, 2])
  })
})
