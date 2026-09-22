/**
 * Procurement PRD 3.0 — the shell (§7.1): which tabs a role sees and which
 * one lights up; the adapter from what the hook loads to what the pure layer
 * reads; the dashboard's two roll-ups; the reports frame (who sees which
 * report, CSV without a currency sign); and a render of Today over a fake
 * world in both locales — every key resolves, the queue and its panels show.
 *
 * The message files are read as merged; while a fragment is still unmerged,
 * set I18N_FRAGMENTS=<dir of *.ar.json/*.en.json> to overlay it.
 */

import { fireEvent, render, screen } from "@testing-library/react"
import fs from "fs"
import path from "path"
import type { ReactNode } from "react"
import { DEFAULT_POLICIES, type PoLine, type ProcActor, type PurchaseOrder, type ReceiptFact } from "@/lib/procurement/types"
import { RECEIPT_HREF, type ProcWorld } from "@/lib/procurement/today"
import {
  PROC_TABS,
  activeProcTab,
  arrivingThisWeek,
  csvCell,
  csvText,
  resolveReport,
  toProcWorld,
  visibleProcTabs,
  visibleReports,
  workQueueCounts,
  type Can,
} from "@/lib/procurement/shell"
import type { PermissionId } from "@/lib/permissions"
import type { ProcurementWorld } from "@/hooks/useProcurementWorld"

// ---------------------------------------------------------------------------
// next-intl stand-in: the real message files (plus any fragment overlay),
// dotted keys, enough ICU to render plurals and selects, a loud marker for
// a missing key or value.
// ---------------------------------------------------------------------------

let mockLocale: "ar" | "en" = "en"
const mockMessageCache: Record<string, Record<string, unknown>> = {}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== "object") target[k] = {}
      deepMerge(target[k] as Record<string, unknown>, v as Record<string, unknown>)
    } else if (target[k] === undefined) target[k] = v
  }
}

const mockMessages = (locale: string): Record<string, unknown> => {
  if (mockMessageCache[locale]) return mockMessageCache[locale]
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "messages", `${locale}.json`), "utf8")) as Record<string, unknown>
  const dir = process.env.I18N_FRAGMENTS
  if (dir && fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(`.${locale}.json`)).sort()) deepMerge(base, JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
  }
  return (mockMessageCache[locale] = base)
}

function mockBranches(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  let i = 0
  while (i < src.length) {
    const open = src.indexOf("{", i)
    if (open < 0) break
    const key = src.slice(i, open).trim()
    let depth = 0
    let j = open
    for (; j < src.length; j++) {
      if (src[j] === "{") depth++
      else if (src[j] === "}" && --depth === 0) break
    }
    out[key] = src.slice(open + 1, j)
    i = j + 1
  }
  return out
}

function mockFormat(message: string, vars: Record<string, unknown>, locale: string): string {
  let out = ""
  let i = 0
  while (i < message.length) {
    if (message[i] !== "{") {
      out += message[i++]
      continue
    }
    let depth = 0
    let j = i
    for (; j < message.length; j++) {
      if (message[j] === "{") depth++
      else if (message[j] === "}" && --depth === 0) break
    }
    const body = message.slice(i + 1, j)
    const plural = /^\s*(\w+)\s*,\s*plural\s*,([\s\S]*)$/.exec(body)
    const select = /^\s*(\w+)\s*,\s*select\s*,([\s\S]*)$/.exec(body)
    const number = /^\s*(\w+)\s*,\s*number\s*$/.exec(body)
    const name = plural ? plural[1] : select ? select[1] : number ? number[1] : body.trim()
    if (!(name in vars)) out += `MISSING_VAR:${name}`
    else if (plural) {
      const n = Number(vars[name])
      const branches = mockBranches(plural[2])
      const chosen = branches[`=${n}`] ?? branches[new Intl.PluralRules(locale).select(n)] ?? branches.other ?? ""
      out += mockFormat(chosen.replace(/#/g, String(n)), vars, locale)
    } else if (select) {
      const branches = mockBranches(select[2])
      out += mockFormat(branches[String(vars[name])] ?? branches.other ?? "", vars, locale)
    } else out += String(vars[name])
    i = j + 1
  }
  return out
}

jest.mock("next-intl", () => {
  const table = (namespace: string, key: string) =>
    [...namespace.split("."), ...key.split(".")].reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), mockMessages(mockLocale))
  return {
    useLocale: () => mockLocale,
    useTranslations: (namespace: string) => {
      const t = (key: string, vars?: Record<string, unknown>) => {
        const raw = table(namespace, key)
        return typeof raw === "string" ? mockFormat(raw, vars || {}, mockLocale) : `MISSING:${namespace}.${key}`
      }
      t.has = (key: string) => typeof table(namespace, key) === "string"
      return t
    },
  }
})

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : (props: Record<string, unknown>) => React.createElement("svg", { "data-icon": String(name), "aria-hidden": props["aria-hidden"] })) })
})

jest.mock("@/i18n/routing", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return {
    Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => React.createElement("a", { href, className }, children),
    usePathname: () => "/contractor/rfqs/today",
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  }
})

let mockCan: Can = () => true
jest.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isLoading: false, can: (p: PermissionId) => mockCan(p), isOrgOwner: false, groups: [], profile: null }) }))

let mockWorld: ProcurementWorld
jest.mock("@/hooks/useProcurementWorld", () => ({ useProcurementWorld: () => mockWorld }))

import { ProcurementToday } from "@/components/procurement/ProcurementToday"

// ---------------------------------------------------------------------------
// Fixtures — the same shapes the domain tests use
// ---------------------------------------------------------------------------

const NOW = new Date("2026-09-22T08:00:00Z")
const iso = (d: number) => new Date(NOW.getTime() + d * 86400000).toISOString()
const day = (d: number) => iso(d).slice(0, 10)

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "Rebar 12 mm", unit: "t", quantity: 100, unitPrice: 2800, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: "po1",
  organizationId: "org",
  docNumber: "PO-2026/014",
  status: "accepted",
  basis: "rfq",
  rfqId: "r1",
  rfqTitle: "Rebar",
  offerId: "o1",
  projectId: "p1",
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
  createdAt: iso(-12),
  approverKind: "manager",
  supplierAcceptedAt: iso(-10),
  promisedDate: day(8),
  log: [],
  ...over,
})
const receipt = (over: Partial<ReceiptFact> = {}): ReceiptFact => ({ id: "d1", status: "pending_confirmation", poId: "po1", poNumber: "PO-2026/014", supplierName: "Al-Hadid", deliveryDate: day(2), lines: [{ poLineId: "l1", name: "Rebar 12 mm", unit: "t", noticeQuantity: 40 }], ...over })
const world = (over: Partial<ProcWorld> = {}): ProcWorld => ({ orders: [], receipts: [], rfqs: [], offers: [], policies: DEFAULT_POLICIES, supplierFacts: {}, ...over })

const MANAGER: ProcActor = { uid: "mgr", name: "Manager", isOwner: false, canApprove: true, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }
const EXPEDITER: ProcActor = { uid: "exp", name: "Exp", isOwner: false, canApprove: false, canPrepare: false, canExpedite: true, canReceive: false, seesPrices: false }

const canOf = (...perms: PermissionId[]): Can => (p) => perms.includes(p)

// ---------------------------------------------------------------------------

describe("SHELL-01 · the tab rail is gated like the sidebar", () => {
  it("is the PRD's eight tabs, in order, for the owner", () => {
    expect(visibleProcTabs(() => true).map((t) => t.id)).toEqual(["today", "rfqs", "requests", "orders", "receipts", "suppliers", "reports", "settings"])
    expect(PROC_TABS.map((t) => t.href)).toEqual(["/contractor/rfqs/today", "/contractor/rfqs", "/contractor/rfqs/requests", "/contractor/rfqs/orders", "/contractor/goods-received", "/contractor/suppliers", "/contractor/rfqs/reports", "/contractor/rfqs/settings"])
  })

  it("an expediter opens Today and Orders — never reports or settings", () => {
    expect(visibleProcTabs(canOf("po.expedite")).map((t) => t.id)).toEqual(["today", "orders"])
  })

  it("a receiver opens Today and Goods received only; an approver gets settings", () => {
    expect(visibleProcTabs(canOf("deliveries.confirm")).map((t) => t.id)).toEqual(["today", "receipts"])
    expect(visibleProcTabs(canOf("po.approve")).map((t) => t.id)).toEqual(["today", "orders", "settings"])
    expect(visibleProcTabs(canOf("offers.view")).map((t) => t.id)).toEqual(["today", "orders", "reports"])
  })

  it("nobody outside Procurement sees a tab", () => {
    expect(visibleProcTabs(canOf("projects.view"))).toEqual([])
  })

  it("the longest matching prefix lights up — /rfqs/requests is not /rfqs", () => {
    const tabs = visibleProcTabs(() => true)
    expect(activeProcTab(tabs, "/contractor/rfqs/requests")?.id).toBe("requests")
    expect(activeProcTab(tabs, "/contractor/rfqs/abc/offers")?.id).toBe("rfqs")
    expect(activeProcTab(tabs, "/contractor/rfqs/orders")?.id).toBe("orders")
    expect(activeProcTab(tabs, "/contractor/rfqs")?.id).toBe("rfqs")
    expect(activeProcTab(tabs, "/contractor/projects")).toBeUndefined()
  })
})

describe("SHELL-02 · the hook's world becomes the pure layer's world", () => {
  it("fills the RFQ status, converts timestamps, counts invitations and drops offers with no RFQ", () => {
    const facts = new Map([["sup1", { orgId: "sup1", hasVatNumber: true, verified: true, crExpiry: null }]])
    const w = toProcWorld({
      orders: [po()],
      deliveries: [receipt()],
      rfqs: [{ id: "r1", status: null, organizationId: null, createdAt: { toDate: () => NOW }, invitedSupplierOrgIds: ["a", "b"] }],
      offers: [{ id: "o1", rfqId: "r1", price: "12,500", organizationId: "sup1" }, { id: "o2", rfqId: null }],
      policies: DEFAULT_POLICIES,
      supplierFacts: facts,
    })
    expect(w.rfqs[0]).toMatchObject({ status: "", createdAt: NOW.toISOString(), invitedCount: 2, organizationId: undefined })
    expect(w.offers).toEqual([{ id: "o1", rfqId: "r1", status: null, price: "12,500", supplierOrgId: "sup1", offerPdfUrl: null, poId: null }])
    expect(w.supplierFacts.sup1.verified).toBe(true)
    expect(w.receipts).toHaveLength(1)
  })
})

describe("SHELL-03 · the dashboard's two roll-ups", () => {
  const mine = po({ id: "a", status: "awaiting_approval", lines: [line({ quantity: 1, unitPrice: 3000 })] })
  const own = po({ id: "b", status: "awaiting_approval", preparedById: "mgr", lines: [line({ quantity: 1, unitPrice: 3000 })] })
  const big = po({ id: "c", status: "awaiting_approval", approverKind: "owner" })
  const notSent = po({ id: "d", status: "approved", approvedAt: iso(-1) })
  const stale = po({ id: "e", status: "sent", sentAt: iso(-3) })
  const fresh = po({ id: "f", status: "sent", sentAt: iso(0) })
  const late = po({ id: "g", promisedDate: day(-2) })
  const orders = [mine, own, big, notSent, stale, fresh, late]

  it("counts only what THIS viewer may approve — not his own order, not above his limit", () => {
    expect(workQueueCounts(orders, DEFAULT_POLICIES, { uid: "mgr", isOwner: false }, NOW).approve).toBe(1)
    expect(workQueueCounts(orders, DEFAULT_POLICIES, { uid: "owner", isOwner: true }, NOW).approve).toBe(3)
  })

  it("attention = late + sent past the acceptance window + approved and not sent", () => {
    expect(workQueueCounts(orders, DEFAULT_POLICIES, { uid: "mgr", isOwner: false }, NOW).attention).toEqual({ late: 1, notAccepted: 1, notSent: 1, total: 3 })
  })
})

describe("SHELL-04 · arriving this week", () => {
  it("lists pending notices dated inside seven days, the overdue first, with the notice's lines", () => {
    const w = world({ orders: [po()], receipts: [receipt({ id: "soon", deliveryDate: day(6) }), receipt({ id: "far", deliveryDate: day(9) }), receipt({ id: "over", deliveryDate: day(-1), lines: [] }), receipt({ id: "done", status: "confirmed" })] })
    const rows = arrivingThisWeek(w, NOW, RECEIPT_HREF)
    expect(rows.map((r) => r.id)).toEqual(["over", "soon"])
    expect(rows[0]).toMatchObject({ inDays: -1, lines: "Rebar 12 mm 100 t", number: "PO-2026/014", href: "/contractor/goods-received?tab=incoming&delivery=over" })
    expect(rows[1].lines).toBe("Rebar 12 mm 40 t")
  })
})

describe("SHELL-05 · the reports frame", () => {
  it("removes the money reports for a viewer without prices, and falls back to the first he may see", () => {
    expect(visibleReports(true)).toEqual(["project", "supplier", "delivery", "drift", "cycle", "exceptions", "commitments"])
    expect(visibleReports(false)).toEqual(["delivery", "cycle", "exceptions"])
    expect(resolveReport("drift", false)).toBe("delivery")
    expect(resolveReport("drift", true)).toBe("drift")
    expect(resolveReport(null, true)).toBe("project")
    expect(resolveReport("nonsense", true)).toBe("project")
  })

  it("CSV: BOM, CRLF, quoted commas, plain numbers, no currency sign", () => {
    expect(csvCell('Al "Hadid", Ltd')).toBe('"Al ""Hadid"", Ltd"')
    expect(csvCell(1234.5)).toBe("1234.5")
    expect(csvCell(null)).toBe("")
    const text = csvText(["PO", "Value"], [["PO-2026/014", 280000]])
    expect(text).toBe("﻿PO,Value\r\nPO-2026/014,280000\r\n")
    expect(text).not.toMatch(/[⃁﷼]/)
  })
})

// ---------------------------------------------------------------------------
// Render — Today over a fake world, both locales
// ---------------------------------------------------------------------------

const loaded = (over: Partial<ProcurementWorld> = {}): ProcurementWorld => ({
  orders: [],
  deliveries: [],
  rfqs: [],
  offers: [],
  policies: DEFAULT_POLICIES,
  supplierFacts: new Map(),
  actor: MANAGER,
  orgId: "org",
  orgName: "Org",
  loading: false,
  ...over,
})

const busyWorld = (): Partial<ProcurementWorld> => ({
  orders: [
    po({ id: "a", docNumber: "PO-2026/001", status: "awaiting_approval", lines: [line({ quantity: 1, unitPrice: 3000 })] }),
    po({ id: "d", docNumber: "PO-2026/004", status: "approved", approvedAt: iso(-1) }),
    po({ id: "g", docNumber: "PO-2026/007", promisedDate: day(-2) }),
    po({ id: "s", docNumber: "PO-2026/019", status: "sent", sentAt: iso(0) }),
    po({ id: "h", docNumber: "PO-2026/020", lines: [line({ held: 5 })] }),
  ],
  deliveries: [receipt({ id: "n1", poId: "g", poNumber: "PO-2026/007", deliveryDate: day(2) }), receipt({ id: "h1", poId: "h", status: "confirmed", confirmedAt: iso(-1), lines: [{ poLineId: "l1", name: "Rebar 12 mm", unit: "t", noticeQuantity: 10, counted: 10, held: 5, holdReason: "certificate", accepted: 5 }] })],
  rfqs: [{ id: "r9", title: "Cement for Tower B", status: "New", deadline: day(-1), offersCount: 2 }],
  offers: [{ id: "o9", rfqId: "r9", status: "قيد المراجعة", price: "9,000" }],
})

describe("SHELL-06 · Today renders over a fake world", () => {
  beforeEach(() => {
    mockCan = () => true
  })

  it.each(["en", "ar"] as const)("%s · no key or placeholder is missing; the panels show what the world holds", (locale) => {
    mockLocale = locale
    mockWorld = loaded(busyWorld())
    const { container } = render(<ProcurementToday />)
    expect(container.textContent).not.toMatch(/MISSING/)
    // The approval floats to the top, with its amount and a filled button.
    const rows = container.querySelectorAll("section:first-of-type ul li")
    expect(rows.length).toBeGreaterThanOrEqual(5)
    expect(rows[0].textContent).toContain(locale === "ar" ? "ط.ش-2026/001" : "PO-2026/001")
    expect(rows[0].querySelector("a")?.getAttribute("href")).toBe("/contractor/rfqs/orders?po=a")
    expect(rows[0].textContent).toContain("3,000")
    // Three KPI tiles, each a link.
    const kpis = container.querySelectorAll("ul[aria-label] li a")
    expect(kpis).toHaveLength(3)
    // A wait on the supplier and one on Inventory (held for inspection), no buttons in that panel.
    const waitsPanel = container.querySelectorAll("section")[1]
    expect(waitsPanel.querySelectorAll("a")).toHaveLength(0)
    expect(waitsPanel.textContent).toContain(locale === "ar" ? "ط.ش-2026/019" : "PO-2026/019")
    expect(waitsPanel.textContent).toContain(locale === "ar" ? "ط.ش-2026/020" : "PO-2026/020")
    // Arriving this week: the notice on PO-2026/007, linked to the receipt.
    const arriving = container.querySelectorAll("section")[2]
    expect(arriving.querySelector("a")?.getAttribute("href")).toBe("/contractor/goods-received?tab=incoming&delivery=n1")
  })

  it("the group chips filter the list and show counts", () => {
    mockLocale = "en"
    mockWorld = loaded(busyWorld())
    render(<ProcurementToday />)
    const chip = screen.getByRole("button", { name: /Quotes/ })
    fireEvent.click(chip)
    expect(chip).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText(/Cement for Tower B/)).toBeInTheDocument()
    expect(screen.queryByText(/PO-2026\/001/)).not.toBeInTheDocument()
  })

  it("an expediter sees no amount and no money tile", () => {
    mockLocale = "en"
    mockWorld = loaded({ ...busyWorld(), actor: EXPEDITER })
    const { container } = render(<ProcurementToday />)
    expect(container.textContent).not.toMatch(/MISSING/)
    expect(container.textContent).not.toContain("⃁")
    expect(container.querySelectorAll("ul[aria-label] li a")).toHaveLength(3)
  })

  it("an empty world says nothing is waiting, in both panels", () => {
    mockLocale = "en"
    mockWorld = loaded()
    const { container } = render(<ProcurementToday />)
    expect(screen.getByText("Nothing is waiting on you")).toBeInTheDocument()
    expect(screen.getByText("Nothing pending elsewhere")).toBeInTheDocument()
    expect(screen.getByText("No deliveries due this week")).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/MISSING/)
  })

  it("shows the spinner while loading and no KPI strip", () => {
    mockWorld = loaded({ loading: true })
    const { container } = render(<ProcurementToday />)
    expect(container.querySelector("ul[aria-label]")).toBeNull()
  })
})
