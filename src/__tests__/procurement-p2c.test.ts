/**
 * Procurement parity (p2c): RFQ lines charged to their own projects, the need
 * each line came from (and handing it back when a draft is deleted), the RFQ
 * form's open-needs chips, the supplier file beyond our records, Today's rows
 * (send form, forward place + receiver, no-PO receipts) and the favourites log.
 */

import { lineNeed, needKeyOfSource, offerersByRfq, passesFilters, rfqNeedSources, rfqProjectKeys, lineProjectNames, spansProjects, GENERAL_STOCK, WORKSHOP } from "@/lib/procurement/rfq-view"
import { releaseRfqFromRequests } from "@/lib/procurement/needs-writes"
import { formNeedChoices, goesToWorkshop } from "@/lib/procurement/need-desk"
import type { Need } from "@/lib/procurement/needs"
import { directSupplierOptions, favouriteLogEntry, isOffPlatform, SUPPLIER_LOG_ACTIONS } from "@/lib/procurement/supplier-file"
import { SEND_HREF, TODAY_KEYS, todayTasks, type ProcWorld } from "@/lib/procurement/today"
import { DEFAULT_POLICIES, type PoLine, type ProcActor, type PurchaseOrder, type ReceiptFact } from "@/lib/procurement/types"
import { lineForKey, profilePapers } from "@/components/procurement/rfq/rfqOfferView"
import { inventoryIndex } from "@/hooks/useInventoryCatalog"
import type { PurchaseRequestRecord } from "@/lib/manufacturing-engine"
import { foldSearchText } from "@/lib/search-text"

const NOW = new Date("2026-09-22T08:00:00Z")
const TODAY = "2026-09-22"

describe("RFQ lines charged to their own projects (rows 22, 95)", () => {
  const rfq = {
    id: "r1",
    projectId: null,
    purchaseSource: null,
    products: [
      { name: "Rebar", projectId: "p1", projectName: "Tower A" },
      { name: "Cement", projectId: "p2", projectName: "Villa B" },
      { name: "Sand" },
    ],
  }

  it("one key per place, a line without a project falls back to the RFQ's (general stock here)", () => {
    expect(rfqProjectKeys(rfq)).toEqual(["p1", "p2", GENERAL_STOCK])
    expect(rfqProjectKeys({ projectId: null, purchaseSource: { kind: "mfg_purchase" }, products: [] })).toEqual([WORKSHOP])
    expect(lineProjectNames(rfq).get("p2")).toBe("Villa B")
  })

  it("the project filter finds the RFQ by any of its lines' projects", () => {
    expect(passesFilters(rfq, { project: "p2" }, NOW)).toBe(true)
    expect(passesFilters(rfq, { project: "p9" }, NOW)).toBe(false)
  })

  it("«الطلب يخص أكثر من مشروع» only when the lines really span projects", () => {
    expect(spansProjects(["p1", "p1"])).toBe(false)
    expect(spansProjects(["p1", null])).toBe(true)
    expect(spansProjects(["p1", "p2"])).toBe(true)
  })

  it("«for (project)» under a line: its own, the RFQ's, the workshop or general", () => {
    expect(lineForKey({ products: rfq.products, projectId: null, purchaseSource: null }, 1)).toEqual({ kind: "project", id: "p2", name: "Villa B" })
    expect(lineForKey({ products: [{}], projectId: "p7", purchaseSource: null }, 0)).toEqual({ kind: "project", id: "p7", name: null })
    expect(lineForKey({ products: [{}], projectId: null, purchaseSource: { kind: "mfg_purchase" } }, 0)).toEqual({ kind: "workshop" })
    expect(lineForKey({ products: [{}], projectId: null, purchaseSource: null }, 0)).toEqual({ kind: "general" })
  })
})

describe("search finds the RFQs a supplier offered on (row 10)", () => {
  it("names each company once per RFQ, a guest by his contact name", () => {
    const by = offerersByRfq([
      { rfqId: "r1", companyName: "Al-Hadid" },
      { rfqId: "r1", supplierName: "Al-Hadid" },
      { rfqId: "r1", guestContact: { name: "Guest Co" } },
      { rfqId: "r2", companyName: "  " },
    ])
    expect(by.get("r1")).toEqual(["Al-Hadid", "Guest Co"])
    expect(by.has("r2")).toBe(false)
  })
})

describe("the need behind each line (rows 109, 149) and deleting a draft (row 47)", () => {
  const mfg = { kind: "mfg_purchase", workOrderId: "wo1", purchaseRequestId: "pr1" }
  const prj = { kind: "project_request", projectId: "p1", purchaseRequestId: "q1" }

  it("a line's own source wins; an older RFQ with one source lends it to every line; a mixed RFQ does not", () => {
    expect(lineNeed({ products: [{ needSource: prj, needLine: 2 }, {}] }, 0)).toEqual({ source: prj, line: 2 })
    expect(lineNeed({ products: [{ needSource: prj }, {}] }, 1)).toBeNull()
    expect(lineNeed({ purchaseSource: mfg, products: [{}, {}] }, 1)).toEqual({ source: mfg, line: 0 })
    expect(lineNeed({ needSources: [prj], products: [{}] }, 0)).toEqual({ source: prj, line: 0 })
    expect(lineNeed({ needSources: [prj, mfg], products: [{}] }, 0)).toBeNull()
    expect(lineNeed({ products: [{}] }, 0)).toBeNull()
  })

  it("the desk's key for each kind of need", () => {
    expect(needKeyOfSource({ kind: "mfg_purchase", workOrderId: "wo1", purchaseRequestId: "pr1" })).toBe("mfg:wo1:pr1")
    expect(needKeyOfSource({ kind: "project_request", projectId: "p1", purchaseRequestId: "q1" })).toBe("project:p1:q1")
    expect(needKeyOfSource({ kind: "stock_gap", warehouseId: "w1", itemId: "i1" })).toBe("stock:w1:i1")
    expect(needKeyOfSource({ kind: "stock_gap" })).toBeNull()
  })

  it("every need the RFQ held, each once", () => {
    expect(rfqNeedSources({ purchaseSource: mfg, needSources: [mfg, prj], products: [{ needSource: prj }, { needSource: null }] })).toEqual([mfg, prj])
  })

  it("a work order's request goes back to «sent» only while THIS RFQ holds it and no order does", () => {
    const base: PurchaseRequestRecord = { id: "pr1", itemName: "Rebar", unit: "t", quantity: 5, needBy: null, note: null, by: "W", at: "2026-09-01", state: "ordered", rfqId: "r1", rfqNumber: "RFQ-1", orderedAt: "2026-09-02" }
    const rows = [base, { ...base, id: "pr2" }, { ...base, id: "pr3", rfqId: "other" }]
    const out = releaseRfqFromRequests(rows, "pr1", "r1")
    expect(out[0]).toMatchObject({ state: "sent", rfqId: null, rfqNumber: null, orderedAt: null })
    expect(out[1]).toBe(rows[1])
    expect(releaseRfqFromRequests(rows, "pr3", "r1")[2]).toBe(rows[2])
    expect(releaseRfqFromRequests([{ ...base, poId: "po1" }], "pr1", "r1")[0].state).toBe("ordered")
  })
})

describe("the RFQ form's «من الاحتياج المفتوح» (row 147)", () => {
  const need = (key: string, over: Partial<Need> = {}): Need =>
    ({
      key,
      kind: "project",
      state: "action",
      lines: [{ name: key, unit: "t", quantity: 1 }],
      needBy: null,
      requestedBy: "",
      at: "",
      refLabel: key,
      context: "",
      note: null,
      rfqId: null,
      rfqNumber: null,
      poId: null,
      poNumber: null,
      endNote: null,
      endKind: null,
      waitingOn: null,
      projectId: "p1",
      projectName: "Tower A",
      source: { kind: "project_request", projectId: "p1", purchaseRequestId: key },
      stock: null,
      ownerId: "p1",
      mfgRequestId: null,
      decision: null,
      ...over,
    }) as Need
  const facts = { orders: [], rfqs: [], policies: DEFAULT_POLICIES }
  const none = () => false

  it("nearest last order day first; the lines' categories and a buyer's scope filter; unknown categories stay", () => {
    const needs = [
      need("late", { needBy: "2026-12-01", lines: [{ name: "late", unit: "t", quantity: 1, category: "حديد ومعادن" }] }),
      need("soon", { needBy: "2026-10-05", lines: [{ name: "soon", unit: "t", quantity: 1, category: "حديد ومعادن" }] }),
      need("wood", { needBy: "2026-10-01", lines: [{ name: "wood", unit: "m3", quantity: 1, category: "أخشاب" }] }),
      need("unknown", { needBy: "2026-11-01" }),
    ]
    const pick = (categories: string[], buyerCategories: string[] | null) => formNeedChoices(needs, { exclude: none, categories, buyerCategories, makeable: none, facts }).map((n) => n.key)
    expect(pick([], null)).toEqual(["wood", "soon", "unknown", "late"])
    expect(pick(["حديد ومعادن"], null)).toEqual(["soon", "unknown", "late"])
    expect(pick([], ["أخشاب"])).toEqual(["wood", "unknown"])
  })

  it("never a need our workshop should make, never one already picked, eight at most", () => {
    const makeable = (name: string) => name === "slab"
    expect(goesToWorkshop(need("slab"), makeable)).toBe(true)
    expect(goesToWorkshop(need("slab", { mfgRequestId: "mr1" }), makeable)).toBe(false)
    expect(goesToWorkshop(need("slab", { decision: { kind: "buy", at: "", byName: "" } }), makeable)).toBe(false)
    const many = Array.from({ length: 12 }, (_, i) => need(`n${i}`))
    const got = formNeedChoices([need("slab"), ...many], { exclude: (n) => n.key === "n0", categories: [], buyerCategories: null, makeable, facts })
    expect(got).toHaveLength(8)
    expect(got.map((n) => n.key)).not.toContain("slab")
    expect(got.map((n) => n.key)).not.toContain("n0")
  })
})

describe("the direct order's supplier comes from the supplier file (Today row 137)", () => {
  it("our records and past suppliers first, then the platform's — flagged, never twice", () => {
    const opts = directSupplierOptions({
      records: [{ supplierOrgId: "a", supplierName: "Alpha", kind: "mat" }],
      orders: [],
      keyOf: (o) => o.supplierOrgId,
      categories: [],
      today: TODAY,
      platform: [
        { orgId: "a", name: "Alpha" },
        { orgId: "z", memberIds: ["a"], name: "Alpha member" },
        { orgId: "p", name: "Platform Steel", profileCrExpiry: "2026-01-01" },
      ],
    })
    expect(opts.map((o) => [o.key, Boolean(o.platform), o.crExpired])).toEqual([
      ["a", false, false],
      ["p", true, true],
    ])
  })
})

describe("Today (rows 59, 72, 77)", () => {
  const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "Rebar 12 mm", unit: "t", quantity: 100, unitPrice: 2800, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
  const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder =>
    ({
      id: "po1",
      organizationId: "org",
      docNumber: "PO-2026/014",
      status: "accepted",
      basis: "rfq",
      rfqId: "r1",
      rfqTitle: "Rebar",
      offerId: "o1",
      projectId: "p1",
      projectName: "Tower A",
      supplierOrgId: "sup1",
      supplierUserId: null,
      supplierName: "Al-Hadid",
      isGuestSupplier: false,
      lines: [line()],
      totalExVat: 280000,
      vatRate: 0.15,
      offersCount: 3,
      lowestOfferTotal: 280000,
      shortCompetition: false,
      noOfficialQuote: false,
      preparedById: "buyer",
      preparedByName: "Sara",
      createdAt: "2026-09-10T08:00:00Z",
      approverKind: "manager",
      supplierAcceptedAt: "2026-09-12T08:00:00Z",
      promisedDate: "2026-09-30",
      log: [],
      ...over,
    }) as PurchaseOrder
  const world = (over: Partial<ProcWorld> = {}): ProcWorld => ({ orders: [], receipts: [], rfqs: [], offers: [], policies: DEFAULT_POLICIES, supplierFacts: {}, ...over })
  const MANAGER: ProcActor = { uid: "mgr", name: "Manager", isOwner: false, canApprove: true, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }
  const BUYER: ProcActor = { uid: "buyer", name: "Sara", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }

  it("«أرسِله للمورد» opens the order's send form", () => {
    expect(SEND_HREF("po9")).toBe("/contractor/rfqs/orders?po=po9&act=send")
    expect(todayTasks(world({ orders: [po({ id: "a", status: "approved" })] }), MANAGER, NOW).find((t) => t.kind === "send")).toMatchObject({ href: SEND_HREF("a") })
  })

  it("the forward task names the store and the register's suggested receiver when the screen knows them", () => {
    const notice: ReceiptFact = { id: "n1", status: "pending_confirmation", poId: "po1", supplierName: "Al-Hadid", deliveryDate: "2026-09-23", lines: [] }
    const task = (forwardFacts?: ProcWorld["forwardFacts"]) => todayTasks(world({ orders: [po()], receipts: [notice], forwardFacts }), MANAGER, NOW).find((t) => t.kind === "notice_forward")
    expect(task({ n1: { place: "Central store", receiver: "Majed" } })).toMatchObject({ subKey: "task.notice_forward.sub_place_rcv", subParams: { place: "Central store", hasPlace: 1, receiver: "Majed", hasReceiver: 1 } })
    expect(task()).toMatchObject({ subParams: { place: "Tower A", hasReceiver: 0 } })
  })

  it("a no-PO receipt says what came; one settled as an expense or by a retroactive order is gone; a buyer sees his categories", () => {
    const manual = (id: string, over: Partial<ReceiptFact> = {}): ReceiptFact => ({ id, status: "confirmed", source: "manual", poId: null, docNumber: `GR-${id}`, supplierName: "Yard", confirmedAt: "2026-09-20T08:00:00Z", lines: [{ poLineId: "x", name: "Timber", unit: "m3", noticeQuantity: 4, counted: 4, accepted: 4 }], ...over })
    const timberPo = po({ id: "t", category: "أخشاب", lines: [line({ name: "Timber", unit: "m3" })] } as Partial<PurchaseOrder>)
    const w = world({ orders: [timberPo], receipts: [manual("m1"), manual("m2", { regularisation: "expense" }), manual("m3", { regularisedByName: "Owner" })] })
    const rows = todayTasks(w, MANAGER, NOW).filter((t) => t.kind === "receipt_no_po")
    expect(rows.map((t) => t.id)).toEqual(["nopo:m1"])
    expect(rows[0]).toMatchObject({ titleKey: "task.receipt_no_po.title_line", titleParams: { qty: 4, unit: "m3", material: "Timber", more: 0, supplier: "Yard" } })
    const steelBuyer = { ...world({ ...w, needDesk: { rows: [], buyers: [], viewerCategories: ["حديد ومعادن"] } }) }
    expect(todayTasks(steelBuyer, BUYER, NOW).filter((t) => t.kind === "receipt_no_po")).toEqual([])
  })

  it("the new keys are declared for the i18n check", () => {
    expect(TODAY_KEYS).toEqual(expect.arrayContaining(["task.notice_forward.sub_place_rcv", "task.receipt_no_po.title_line"]))
  })
})

describe("the supplier file (#98, #86) and his papers on an offer (row 72)", () => {
  it("a favourite toggle is a log line with who and when", () => {
    expect(SUPPLIER_LOG_ACTIONS).toEqual(expect.arrayContaining(["favourite_on", "favourite_off"]))
    expect(favouriteLogEntry({ uid: "u1", name: "Sara" }, true, "2026-09-22T08:00:00Z")).toEqual({ action: "favourite_on", at: "2026-09-22T08:00:00Z", byId: "u1", byName: "Sara" })
    expect(favouriteLogEntry({ uid: "u1", name: "Sara" }, false, "t").action).toBe("favourite_off")
  })

  it("off the platform: no account, or a record born of a guest link", () => {
    expect(isOffPlatform({ memberIds: [], record: null })).toBe(true)
    expect(isOffPlatform({ memberIds: ["u"], record: { source: "guest_link" } })).toBe(true)
    expect(isOffPlatform({ memberIds: ["u"], record: { source: "directory" } })).toBe(false)
  })

  it("a registered supplier's CR and VAT certificate from his profile, only those uploaded", () => {
    expect(profilePapers({ cr: { url: "https://x/cr.pdf" }, vat: { url: "" } })).toEqual([{ kind: "cr", name: "cr", url: "https://x/cr.pdf" }])
    expect(profilePapers(null)).toEqual([])
  })
})

describe("the stores' item card for a material (#126, #132)", () => {
  it("indexed by folded name; an entry with a code wins over one without", () => {
    const idx = inventoryIndex([
      { warehouseId: "w1", name: "أسمنت بورتلاندي", sku: null },
      { warehouseId: "w2", name: "اسمنت بورتلاندي", sku: "CEM-01" },
      { warehouseId: "w3", name: "", sku: "X" },
    ])
    expect(idx.get(foldSearchText("اسمنت بورتلاندي"))).toEqual({ code: "CEM-01", warehouseId: "w2" })
    expect(idx.size).toBe(1)
  })
})
