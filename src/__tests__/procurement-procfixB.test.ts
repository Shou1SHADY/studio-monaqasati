/**
 * Procurement fix wave (procfixB) — the rules added for prototype parity:
 * who manages the supplier file, a buyer's suppliers and scope, a supplier
 * who joins through our invitation, the service / lump-sum direct order, the
 * rail and the sidebar reading one gate list, and the Today rows the audit
 * found missing (sourcing members, finance holds, budget and advance waits,
 * the owner's Finance tile, Projects' stop on a line).
 */

import { CONTRACTOR_COMPONENTS } from "@/lib/portal-components"
import { CATEGORIES_DATA } from "@/lib/constants"
import { needLineState } from "@/lib/procurement/need-desk"
import type { NeedRow } from "@/lib/procurement/need-desk"
import type { Need } from "@/lib/procurement/needs"
import type { PoFinanceHold } from "@/lib/procurement/po-extras"
import { LUMP_SUM_UNIT, serviceOrderLine, serviceOrderRefusal, serviceOrderValue, serviceSupplierOk } from "@/lib/procurement/service-order"
import { procRole, procTabCounts, visibleProcTabs } from "@/lib/procurement/shell"
import {
  OPEN_WITH_SUPPLIER,
  canManageSuppliers,
  canRenewAgreements,
  canSignAgreements,
  canVouchSuppliers,
  categoryRoot,
  directSupplierOptions,
  invitedSupplierRecord,
  supplierInScope,
  supplierSourcingBlock,
  verifyRefusal,
} from "@/lib/procurement/supplier-file"
import { PROC_TAB_GATES } from "@/lib/procurement/tab-gates"
import { canAssignCategories, cleanCategories, mayInviteSuppliers, procTeam } from "@/lib/procurement/team"
import { COMMITMENTS_HREF, actorKind, financeDue, todayKpis, todayTasks, todayWaits, type ProcWorld, type RfqFact, type TodayActor } from "@/lib/procurement/today"
import { DEFAULT_POLICIES, type PoLine, type ProcActor, type PurchaseOrder, type ReceiptFact } from "@/lib/procurement/types"
import type { PermissionId } from "@/lib/permissions"

const NOW = new Date("2026-09-22T08:00:00Z")
const TODAY = "2026-09-22"

const actor = (over: Partial<TodayActor> = {}): TodayActor => ({ uid: "u", name: "U", isOwner: false, canApprove: false, canPrepare: false, canExpedite: false, canReceive: false, seesPrices: false, ...over })
const OWNER = actor({ uid: "owner", isOwner: true, canApprove: true, canPrepare: true, canExpedite: true, canReceive: true, seesPrices: true })
const MANAGER = actor({ uid: "mgr", canApprove: true, canPrepare: true, canExpedite: true, seesPrices: true })
const BUYER = actor({ uid: "buyer", canPrepare: true, canExpedite: true, seesPrices: true })
const EXPEDITER = actor({ uid: "exp", canExpedite: true })
/** The seeded supply-chain group: rfq.manage + po.expedite + offers.view, no offers.accept. */
const SOURCER = actor({ uid: "src", canExpedite: true, seesPrices: true, canSource: true })

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "Rebar 12 mm", unit: "t", quantity: 100, unitPrice: 2800, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
const po = (over: Partial<PurchaseOrder> & Record<string, unknown> = {}): PurchaseOrder =>
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
const kinds = (w: ProcWorld, a: TodayActor) => todayTasks(w, a, NOW).map((t) => t.kind)

// ---------------------------------------------------------------------------

describe("the supplier file is the manager's and the buyer's (prototype CAN('sup') && !ro)", () => {
  it("manager and buyer manage; the expediter and the reading owner do not; a solo owner does", () => {
    expect(canManageSuppliers(MANAGER, true)).toBe(true)
    expect(canManageSuppliers(BUYER, true)).toBe(true)
    expect(canManageSuppliers(EXPEDITER, true)).toBe(false)
    expect(canManageSuppliers(OWNER, true)).toBe(false)
    expect(canManageSuppliers(OWNER, false)).toBe(true)
  })

  it("verify and edit the record: the manager only (CAN('all')), never the owner with a team", () => {
    expect(canVouchSuppliers(MANAGER, true)).toBe(true)
    expect(canVouchSuppliers(BUYER, false)).toBe(false)
    expect(canVouchSuppliers(OWNER, true)).toBe(false)
    expect(canVouchSuppliers(OWNER, false)).toBe(true)
    expect(verifyRefusal(OWNER, { verified: false }, "300000000000003", true)).toBe("no_permission")
    expect(verifyRefusal(OWNER, { verified: false }, "300000000000003", false)).toBeNull()
  })

  it("agreements: the buyer signs, only the manager renews or ends (prototype «جدّد»)", () => {
    expect(canSignAgreements(BUYER, true)).toBe(true)
    expect(canRenewAgreements(BUYER, true)).toBe(false)
    expect(canRenewAgreements(MANAGER, true)).toBe(true)
    expect(canRenewAgreements(OWNER, true)).toBe(false)
  })

  it("an invitation leaves only by the manager's or a buyer's hand (server gate)", () => {
    const can = (...p: PermissionId[]) => (x: PermissionId) => p.includes(x)
    expect(mayInviteSuppliers(can("po.approve"))).toBe(true)
    expect(mayInviteSuppliers(can("offers.accept"))).toBe(true)
    expect(mayInviteSuppliers(can("po.expedite", "suppliers.manage", "offers.view"))).toBe(false)
    expect(mayInviteSuppliers(() => true)).toBe(true)
  })

  it("«N أوامر مفتوحة» counts an approved order not yet sent (the prototype's poLive)", () => {
    expect(OPEN_WITH_SUPPLIER.has("approved")).toBe(true)
    expect(OPEN_WITH_SUPPLIER.has("awaiting_approval")).toBe(false)
    expect(OPEN_WITH_SUPPLIER.has("received")).toBe(false)
  })
})

describe("a buyer's suppliers (S-32, the prototype's supScope)", () => {
  const steel = { categories: ["حديد تسليح"], record: { kind: "mat" as const } }
  const cement = { categories: ["أسمنت وخرسانة"], record: null }
  const haulage = { categories: ["أسمنت وخرسانة"], record: { kind: "svc" as const } }
  const sub = { categories: [], record: { kind: "sub" as const } }

  it("a specialty belongs to its top-level category", () => {
    expect(categoryRoot("حديد تسليح", CATEGORIES_DATA)).toBe("حديد ومعادن")
    expect(categoryRoot("حديد ومعادن", CATEGORIES_DATA)).toBe("حديد ومعادن")
    expect(categoryRoot("شيء آخر", CATEGORIES_DATA)).toBe("شيء آخر")
  })

  it("material suppliers of his categories, plus every service company and subcontractor; no categories = all", () => {
    const mine = ["حديد ومعادن"]
    expect(supplierInScope(steel, mine, CATEGORIES_DATA)).toBe(true)
    expect(supplierInScope(cement, mine, CATEGORIES_DATA)).toBe(false)
    expect(supplierInScope(haulage, mine, CATEGORIES_DATA)).toBe(true)
    expect(supplierInScope(sub, mine, CATEGORIES_DATA)).toBe(true)
    expect(supplierInScope(cement, null, CATEGORIES_DATA)).toBe(true)
  })
})

describe("sourcing from a supplier nobody vouched for (prototype wAll / canOrder)", () => {
  it("unverified first, then no VAT number, then a lapsed CR; our record wins over his profile", () => {
    expect(supplierSourcingBlock({ verified: false, vatNumber: "300000000000003" }, null, TODAY)).toBe("unverified")
    expect(supplierSourcingBlock({ verified: true }, { vat: "" }, TODAY)).toBe("no_vat")
    expect(supplierSourcingBlock(null, { vat: "300000000000003", crExpiry: "2026-09-01" }, TODAY)).toBe("cr_expired")
    expect(supplierSourcingBlock({ verified: true, crExpiry: "2027-01-01" }, { vat: "300000000000003", crExpiry: "2026-09-01" }, TODAY)).toBeNull()
    // A legacy record (no `verified` field) blocks nothing.
    expect(supplierSourcingBlock({ vatNumber: "300000000000003" }, null, TODAY)).toBeNull()
  })
})

describe("a supplier who joins through our invitation lands UNVERIFIED (P-16, prototype 2016-2019)", () => {
  it("is a material supplier on 30 days, source invite, added by the inviter, waiting for the manager", () => {
    const r = invitedSupplierRecord({ organizationId: "org", supplierOrgId: "s9", supplierName: "Najd Steel", vat: " ", invitedById: "buyer", invitedByName: "Sara", at: "2026-09-22T08:00:00Z" })
    expect(r).toMatchObject({ organizationId: "org", supplierOrgId: "s9", source: "invite", verified: false, kind: "mat", paymentTermsDays: 30, vatNumber: null, addedById: "buyer", addedByName: "Sara" })
    expect(r.log).toEqual([{ action: "added", at: "2026-09-22T08:00:00Z", byId: "buyer", byName: "Sara", params: { source: "invite" } }])
    // …and so the manager's Today asks him to vouch for the supplier.
    const t = todayTasks(world({ supplierRecords: [{ ...r, supplierName: r.supplierName }] }), MANAGER, NOW)
    expect(t.find((x) => x.kind === "supplier_verify")).toMatchObject({ titleParams: { supplier: "Najd Steel" }, subParams: { name: "Sara" } })
  })

  it("a guest registered from his offer keeps what the buyer recorded, tagged «سُجّل من رابط زوار»", () => {
    const r = invitedSupplierRecord({ organizationId: "org", supplierOrgId: "s9", supplierName: "Najd Steel", vat: null, invitedById: "buyer", invitedByName: "Sara", at: "2026-09-22T08:00:00Z", guest: { vatNumber: "300000000000003", crExpiry: "2027-03-01", paymentTermsDays: 45 } })
    expect(r).toMatchObject({ source: "guest_link", verified: false, vatNumber: "300000000000003", crExpiry: "2027-03-01", paymentTermsDays: 45 })
    expect(r.log?.[0]?.params).toEqual({ source: "guest_link" })
  })
})

describe("the buyer's categories (P-21/P-40) — who sets them, who they scope", () => {
  const can = (...p: PermissionId[]) => (x: PermissionId) => p.includes(x)
  const members = [
    { id: "owner", name: "Owner", can: () => true, isOwner: true },
    { id: "mgr", name: "Noura", can: can("po.approve", "offers.accept"), isOwner: false },
    { id: "buyer", name: "Sara", can: can("offers.accept"), isOwner: false, procurementCategories: ["حديد ومعادن", "", 3, "حديد ومعادن"] },
    { id: "src", name: "Majed", can: can("rfq.manage", "po.expedite"), isOwner: false, procurementCategories: ["أسمنت وخرسانة"] },
    { id: "store", name: "Store", can: can("deliveries.confirm"), isOwner: false },
  ]

  it("buyers = sourcers who do not approve, with their categories cleaned; the owner has a team", () => {
    const team = procTeam(members, MANAGER, null)
    expect(team.buyers).toEqual([
      { uid: "buyer", name: "Sara", categories: ["حديد ومعادن"] },
      { uid: "src", name: "Majed", categories: ["أسمنت وخرسانة"] },
    ])
    expect(team.ownerHasTeam).toBe(true)
    expect(procTeam(members.filter((m) => m.id === "owner" || m.id === "store"), OWNER, null).ownerHasTeam).toBe(false)
  })

  it("scopes the viewer only when he is a buyer (a sourcer counts), never a manager", () => {
    expect(procTeam(members, BUYER, ["حديد ومعادن"]).viewerCategories).toEqual(["حديد ومعادن"])
    expect(procTeam(members, SOURCER, ["أسمنت وخرسانة"]).viewerCategories).toEqual(["أسمنت وخرسانة"])
    expect(procTeam(members, MANAGER, ["حديد ومعادن"]).viewerCategories).toBeNull()
    expect(procTeam(members, BUYER, []).viewerCategories).toBeNull()
  })

  it("the owner or the manager sets them (the users rule mirrors this)", () => {
    expect(canAssignCategories({ isOwner: true, canApprove: true })).toBe(true)
    expect(canAssignCategories({ isOwner: false, canApprove: true })).toBe(true)
    expect(canAssignCategories({ isOwner: false, canApprove: false })).toBe(false)
    expect(cleanCategories("x")).toEqual([])
  })
})

describe("«أمر مباشر لخدمة أو مقطوعية» (poFree)", () => {
  it("asks the description, then the supplier, then the value — the prototype's order", () => {
    expect(serviceOrderRefusal({ description: " ", supplierName: "", value: "" }, TODAY)).toBe("description_missing")
    expect(serviceOrderRefusal({ description: "Haulage", supplierName: "", value: "" }, TODAY)).toBe("supplier_missing")
    expect(serviceOrderRefusal({ description: "Haulage", supplierName: "Najd", value: "0" }, TODAY)).toBe("value_missing")
    expect(serviceOrderRefusal({ description: "Haulage", supplierName: "Najd", value: "3,400", dueBy: "2026-09-21" }, TODAY)).toBe("due_past")
    expect(serviceOrderRefusal({ description: "Haulage", supplierName: "Najd", value: "3,400", dueBy: TODAY }, TODAY)).toBeNull()
  })

  it("is ONE lump-sum line at the agreed value; never to a subcontractor", () => {
    expect(serviceOrderValue("3,400.456")).toBe(3400.46)
    expect(serviceOrderLine(" Steel haulage ", 3400)).toMatchObject({ name: "Steel haulage", unit: LUMP_SUM_UNIT, quantity: 1, unitPrice: 3400, boqItemId: null })
    expect(serviceSupplierOk("sub")).toBe(false)
    expect(serviceSupplierOk("svc")).toBe(true)
    expect(serviceSupplierOk(null)).toBe(true)
  })
})

describe("a direct order's supplier list (prototype supOpts)", () => {
  const keyOf = (o: PurchaseOrder) => o.supplierOrgId
  it("material suppliers of the lines' categories; unknown ones stay; lapsed CR and unvouched are flagged", () => {
    const opts = directSupplierOptions({
      records: [
        { supplierOrgId: "a", supplierName: "Alpha", kind: "mat", crExpiry: "2026-01-01" },
        { supplierOrgId: "b", supplierName: "Beta", kind: "svc" },
        { supplierOrgId: "c", supplierName: "Cement Co", kind: "mat", verified: false },
        { supplierOrgId: "d", supplierName: "Delta", kind: "sub" },
      ],
      orders: [po({ supplierOrgId: "c", supplierName: "Cement Co", category: "أسمنت وخرسانة" }), po({ supplierOrgId: "e", supplierName: "Echo", category: "حديد ومعادن" })],
      keyOf,
      categories: ["حديد ومعادن"],
      today: TODAY,
    })
    expect(opts.map((o) => [o.key, o.crExpired, o.unverified])).toEqual([
      ["a", true, false],
      ["e", false, false],
    ])
  })
})

describe("one gate list for the rail and the sidebar (P-08, G2, G12)", () => {
  const items = CONTRACTOR_COMPONENTS.find((c) => c.id === "procurement")!.sections.flatMap((s) => s.items.flatMap((i) => [i, ...(i.children || [])]))
  const gate = (href: string) => {
    const it = items.find((i) => i.href === href)!
    return it.requiredAnyPermission ?? (it.requiredPermission ? [it.requiredPermission] : [])
  }
  it("every Procurement tab's sidebar entry is gated exactly like its rail tab", () => {
    expect(gate("/contractor/rfqs/today")).toEqual(PROC_TAB_GATES.today)
    expect(gate("/contractor/rfqs/requests")).toEqual(PROC_TAB_GATES.requests)
    expect(gate("/contractor/rfqs")).toEqual(PROC_TAB_GATES.rfqs)
    expect(gate("/contractor/rfqs/orders")).toEqual(PROC_TAB_GATES.orders)
    expect(gate("/contractor/goods-received")).toEqual(PROC_TAB_GATES.receipts)
    expect(gate("/contractor/suppliers")).toEqual(PROC_TAB_GATES.suppliers)
    expect(gate("/contractor/rfqs/reports")).toEqual(PROC_TAB_GATES.reports)
    expect(gate("/contractor/rfqs/settings")).toEqual(PROC_TAB_GATES.settings)
  })
  it("the manager (finance seed: offers.accept + po.approve) sees the RFQ tab; the expediter does not", () => {
    const can = (...p: PermissionId[]) => (x: PermissionId) => p.includes(x)
    expect(visibleProcTabs(can("offers.accept", "po.approve")).map((t) => t.id)).toContain("rfqs")
    expect(visibleProcTabs(can("po.expedite")).map((t) => t.id)).not.toContain("rfqs")
  })
})

describe("the shell: a sourcer's chip, a buyer's RFQ count", () => {
  it("an rfq.manage-only member reads as a buyer, not a receiver", () => {
    expect(procRole(SOURCER, true)).toBe("buyer")
    expect(procRole(EXPEDITER, true)).toBe("expediter")
  })
  it("counts a buyer's own open RFQs only (the prototype's rfqMine)", () => {
    const rfqs = [
      { id: "a", status: "New", createdByUserId: "buyer" },
      { id: "b", status: "New", createdByUserId: "other" },
    ]
    const counts = procTabCounts({ tasks: 0, incomingRequests: 0, rfqs, orders: [], now: NOW, rfqInScope: (r) => (r as { createdByUserId?: string }).createdByUserId === "buyer" })
    expect(counts.rfqs).toBe(1)
    expect(procTabCounts({ tasks: 0, incomingRequests: 0, rfqs, orders: [], now: NOW }).rfqs).toBe(2)
  })
})

describe("Today — the rows the audit found missing", () => {
  const rfq = (over: Partial<RfqFact> = {}): RfqFact => ({ id: "r1", status: "Draft", title: "Rebar", ...over })

  it("G1 · a member who runs RFQs without preparing orders gets the RFQ and need tasks", () => {
    const needRow = { key: "n1", needKey: "n", state: "open", path: "rfq", name: "Cement", unit: "bag", open: 10, total: 10, lastOrderIn: 1, estimate: 500, category: null, need: { refLabel: "PR-1", projectName: "Tower A" } } as unknown as NeedRow
    const w = world({ rfqs: [rfq({ createdByUserId: "src" })], needDesk: { rows: [needRow], buyers: [], viewerCategories: null } })
    expect(kinds(w, SOURCER).sort()).toEqual(["need_line", "rfq_draft"])
    // The manager without offers.accept sources too; the expediter never.
    expect(kinds(w, actor({ uid: "m2", canApprove: true, seesPrices: true }))).toContain("rfq_draft")
    expect(kinds(w, EXPEDITER)).toEqual([])
  })

  it("G4 · Projects closed a material still owed (`pmCancels`): cancel the rest with the supplier", () => {
    const stopped = po({ lines: [line({ id: "l1", accepted: 40 })], pmCancels: { l1: { byName: "PM", reason: "design change" } } })
    expect(todayTasks(world({ orders: [stopped] }), MANAGER, NOW).find((t) => t.kind === "cancel_remainder")).toMatchObject({ titleParams: { qty: 60, unit: "t", name: "Rebar 12 mm" }, amount: 168000 })
    // Nothing left to arrive: no row.
    expect(kinds(world({ orders: [po({ lines: [line({ accepted: 100 })], pmCancels: { l1: {} } })] }), MANAGER)).not.toContain("cancel_remainder")
  })

  const hold = (reason: PoFinanceHold["reason"]): PoFinanceHold => ({ id: "h1", invoiceNo: "INV-77", amount: 11500, reason, text: "differs", need: "a corrected invoice", at: "2026-09-21T08:00:00Z", byName: "Fin", state: "open" })

  it("G5 · a finance hold is ours to decide (red, first), the receiver's to chase, the supplier's through us, the reading owner's to see", () => {
    const w = (reason: PoFinanceHold["reason"]) => world({ orders: [po({ financeHolds: [hold(reason)] })], ownerHasTeam: true })
    expect(todayTasks(w("price"), MANAGER, NOW)[0]).toMatchObject({ kind: "finance_hold", priority: 0, severity: "red", titleKey: "task.finance_hold.proc.title", titleParams: { invoice: "INV-77", holdReason: "price" }, actionKey: "actions.decide", amount: 11500 })
    expect(todayTasks(w("nogrn"), MANAGER, NOW).find((t) => t.kind === "finance_hold")).toMatchObject({ titleKey: "task.finance_hold.rcv.title", subParams: { where: "projects" }, actionKey: "actions.open" })
    expect(todayTasks(w("vat"), BUYER, NOW).find((t) => t.kind === "finance_hold")).toMatchObject({ titleKey: "task.finance_hold.sup.title" })
    expect(todayTasks(w("price"), OWNER, NOW).find((t) => t.kind === "finance_hold")).toMatchObject({ titleKey: "task.finance_hold.owner.title", subParams: { holdOwner: "proc" }, actionKey: "actions.view" })
    // Finance's own hold is a wait, not a task; and a held order is not yet «سداد وإقفال».
    expect(kinds(w("dup"), MANAGER)).not.toContain("finance_hold")

    expect(todayWaits(w("dup"), MANAGER, NOW).map((x) => [x.kind, x.module])).toContainEqual(["invoice_hold", "finance"])
    expect(todayWaits(w("nogrn"), MANAGER, NOW).map((x) => [x.kind, x.module])).toContainEqual(["invoice_hold", "projects"])
  })

  it("G5 · a price hold names its variance; a higher price asked by the buyer waits on the approver", () => {
    const priced = { ...hold("price"), price: 2900, lineId: "l1" }
    const received = po({ lines: [line({ id: "l1", accepted: 40 })], financeHolds: [priced] })
    expect(todayTasks(world({ orders: [received] }), MANAGER, NOW).find((t) => t.kind === "finance_hold")).toMatchObject({ titleKey: "task.finance_hold.price.title", amount: 4000 })
    const asked = po({ lines: [line({ id: "l1", accepted: 40 })], financeHolds: [{ ...priced, pend: { price: 2850, why: "mill circular", byUid: "buyer", byName: "Buyer", at: "2026-09-22T08:00:00Z" } }] })
    expect(todayTasks(world({ orders: [asked] }), MANAGER, NOW).find((t) => t.kind === "finance_hold")).toMatchObject({ titleKey: "task.finance_hold.pend.title", subParams: { name: "Buyer", why: "mill circular" }, actionKey: "actions.review", amount: 2000 })
    expect(kinds(world({ orders: [asked] }), BUYER)).not.toContain("finance_hold")
  })

  it("G6 · the project manager's budget decision and the supplier's advance are waits", () => {
    const waiting = po({ id: "b", status: "awaiting_approval", pmBudget: { state: "pending" } })
    const advance = po({ id: "a", docNumber: "PO-2026/015", status: "approved", approvedAt: "2026-09-20T08:00:00Z", advancePercent: 20 })
    const ws = todayWaits(world({ orders: [waiting, advance], budgetOverruns: { b: 12000 } }), MANAGER, NOW)
    expect(ws.find((x) => x.kind === "pm_budget")).toMatchObject({ module: "projects", subParams: { over: 12000, hasOver: 1 } })
    expect(ws.find((x) => x.kind === "supplier_advance")).toMatchObject({ module: "finance", titleParams: { percent: 20, number: "PO-2026/015" }, subParams: { advance: "ADV-2026/015" } })
    // The amount is withheld from a viewer without prices.
    expect(todayWaits(world({ orders: [waiting], budgetOverruns: { b: 12000 } }), EXPEDITER, NOW)[0]).toMatchObject({ subParams: { over: 0, hasOver: 0 } })
  })

  it("the owner's «ستطلبه المالية» = requested advances + received unpaid, and opens the commitments report", () => {
    const advance = po({ id: "a", status: "approved", approvedAt: "2026-09-20T08:00:00Z", advancePercent: 10, lines: [line({ quantity: 10, unitPrice: 1000 })] })
    const received = po({ id: "r", lines: [line({ quantity: 10, unitPrice: 500, accepted: 10 })] })
    // The advance is a share of the commitment, VAT included (advanceAmount).
    expect(financeDue([advance, received])).toEqual({ advances: 1150, received: 5000, total: 6150 })
    const tile = todayKpis(world({ orders: [advance, received], ownerHasTeam: true }), OWNER, NOW).tiles.find((t) => t.id === "finance_due")
    expect(tile).toMatchObject({ value: 6150, href: COMMITMENTS_HREF, noteKey: "kpi.finance_due.note_split" })
  })

  it("a one-person company's owner gets the working numbers, not the reading owner's", () => {
    expect(actorKind(OWNER, false)).toBe("buyer")
    expect(actorKind(OWNER, true)).toBe("owner")
    expect(actorKind(OWNER)).toBe("owner")
    expect(todayKpis(world({ ownerHasTeam: false, needDesk: { rows: [], buyers: [], viewerCategories: null } }), OWNER, NOW).tiles.map((t) => t.id)).toEqual(["needs", "committed", "drift"])
  })

  it("the needs tile counts lines («سطراً»); the drift tile opens 30 days", () => {
    const k = todayKpis(world({ needDesk: { rows: [], buyers: [], viewerCategories: null } }), MANAGER, NOW)
    expect(k.tiles[0]).toMatchObject({ id: "needs", unit: "lines" })
    expect(k.tiles[2].href).toBe("/contractor/rfqs/reports?report=drift&period=30")
  })

  it("arrived today is flagged per receipt and is not the reading owner's", () => {
    const got: ReceiptFact = { id: "g1", status: "confirmed", poId: "po1", docNumber: "GR-2026/031", supplierName: "Al-Hadid", confirmedAt: "2026-09-22T06:00:00Z", lines: [{ poLineId: "l1", name: "Rebar", unit: "t", noticeQuantity: 50, counted: 45, rejected: 2, accepted: 43 }] }
    const w = world({ orders: [po()], receipts: [got], ownerHasTeam: true })
    expect(todayTasks(w, MANAGER, NOW).find((t) => t.kind === "arrived_today")).toMatchObject({ subKey: "task.arrived_today.sub_flags", subParams: { rejects: 1, short: 1 } })
    expect(kinds(w, OWNER)).not.toContain("arrived_today")
  })

  it("the forward task names where the goods go; an expediter gets no overdue/late-date rows (prototype `see`)", () => {
    const notice: ReceiptFact = { id: "n1", status: "pending_confirmation", poId: "po1", supplierName: "Al-Hadid", deliveryDate: "2026-09-18", lines: [] }
    expect(todayTasks(world({ orders: [po()], receipts: [notice] }), MANAGER, NOW).find((t) => t.kind === "notice_forward")).toMatchObject({ subKey: "task.notice_forward.sub_place_rcv", subParams: { place: "Tower A", hasPlace: 1, hasReceiver: 0 } })
    const told = { ...notice, forwardedTo: { name: "Majed" } }
    expect(kinds(world({ orders: [po()], receipts: [told] }), MANAGER)).toContain("notice_overdue")
    expect(kinds(world({ orders: [po()], receipts: [told] }), EXPEDITER)).toEqual([])
    // Under «both» routing the receiver already has it: no forward task.
    const both = { ...DEFAULT_POLICIES, noticeRouting: "both" } as typeof DEFAULT_POLICIES
    expect(kinds(world({ orders: [po()], receipts: [notice], policies: both }), MANAGER)).not.toContain("notice_forward")
  })

  it("a buyer's Today orders are the ones he prepared — his categories widen the list, not Today; the agreement task opens that agreement", () => {
    const other = po({ id: "x", status: "approved", preparedById: "someone", category: "حديد ومعادن" })
    const w = (cats: string[] | null) => world({ orders: [other], needDesk: { rows: [], buyers: [], viewerCategories: cats } })
    expect(kinds(w(null), BUYER)).not.toContain("send")
    expect(kinds(w(["حديد ومعادن"]), BUYER)).not.toContain("send")
    const agr = { id: "ag1", organizationId: "org", docNumber: "AG-2026/001", supplierOrgId: "s", supplierName: "Q", from: "2026-01-01", until: "2026-09-30", lines: [{ name: "x", unit: "t", price: 1 }], preparedById: "m", preparedByName: "M", createdAt: "2026-01-01" }
    expect(todayTasks(world({ agreements: [agr] }), MANAGER, NOW).find((t) => t.kind === "agreement_expiring")?.href).toBe("/contractor/suppliers?segment=agreements&agreement=ag1")
  })

  it("the need desk's waits reach the expediter too (G20)", () => {
    const row = { key: "n1", needKey: "n", state: "chk", name: "Cement", unit: "bag", open: 10, total: 10, onHand: 4, need: { refLabel: "PR-1" } } as unknown as NeedRow
    expect(todayWaits(world({ needDesk: { rows: [row], buyers: [], viewerCategories: null } }), EXPEDITER, NOW).map((w) => w.kind)).toEqual(["stock_check"])
  })
})

describe("the needs desk reads the org's reply window (replyWindowDays)", () => {
  const waiting = { state: "waiting", waitingOn: "warehouse", at: "2026-09-20T08:00:00Z" } as unknown as Need
  it("a stock check lapses after the policy's window, not a fixed day", () => {
    expect(needLineState(waiting, { now: NOW, mfgRequests: {}, policies: DEFAULT_POLICIES })).toBe("late")
    const wide = { ...DEFAULT_POLICIES, replyWindowDays: 3 } as typeof DEFAULT_POLICIES
    expect(needLineState(waiting, { now: NOW, mfgRequests: {}, policies: wide })).toBe("chk")
  })
})

// Types only — keeps the actor fixture honest against the app's type.
export const _typecheck: ProcActor = MANAGER
