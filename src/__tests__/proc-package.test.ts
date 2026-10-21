/**
 * Procurement 2.0 — the package (PKG-02, G-10): the base and three connectors, the eight states read from the switches the
 * company already has, the 36 events of the contract and their idempotency keys (NFR-02).
 */

import {
  CONNECTORS,
  CONNECTOR_SWITCH,
  PACKAGE_STATES,
  PACKAGE_STATE_IDS,
  PRESETS,
  connectorTexts,
  connectorsOf,
  offFor,
  packageLabel,
  packageOf,
  packageStateOf,
  packageTitle,
  unitIn,
  type Connector,
  type PackageFlags,
} from "@/lib/procurement/package"
import { EIGHT_RULES, EVENTS, EVENT_IDS, STAGES } from "@/lib/procurement/package-data"
import {
  EVENT_KEY_BUILDERS,
  PROC_EVENTS,
  advancePaidKey,
  advanceRequestKey,
  buildProcEvent,
  commitmentKey,
  holdKey,
  issueRequestKey,
  manualReceiptKey,
  matchesTemplate,
  needLineKey,
  paidKey,
  paymentKey,
  poAcceptKey,
  poDeclineKey,
  poEscalateKey,
  poForwardKey,
  poInboundKey,
  poMessageKey,
  poMessageSupplierKey,
  poRejectKey,
  poReportKey,
  poVersionKey,
  procEventDocId,
  projectReceiptKey,
  projectRequestCancelKey,
  projectRequestKey,
  requestStatusKey,
  rfqAnswerKey,
  rfqAskKey,
  rfqCutKey,
  rfqOfferKey,
  rfqOutcomeKey,
  rfqPublishKey,
  shortageKey,
  shouldEmit,
  stockCheckKey,
  varianceKey,
  warehouseReceiptKey,
  workshopAskKey,
  workshopReplyKey,
  workshopStatusKey,
} from "@/lib/procurement/event-keys"
import enMessages from "../../messages/en.json"
import arMessages from "../../messages/ar.json"

const pkg = (...on: Connector[]): PackageFlags => ({ pm: on.includes("pm"), fin: on.includes("fin"), mfg: on.includes("mfg") })

describe("the eight states", () => {
  const OFF: Array<[string, string[]]> = [
    ["full", []],
    ["fin", ["project-management", "manufacturing"]],
    ["pm", ["payments", "manufacturing"]],
    ["pm_fin", ["manufacturing"]],
    ["fin_mfg", ["project-management"]],
    ["mfg", ["project-management", "payments"]],
    ["base", ["project-management", "payments", "manufacturing"]],
    ["pm_mfg", ["payments"]],
  ]

  it("every combination of the three switches is one state, and back", () => {
    expect(PACKAGE_STATES).toHaveLength(8)
    expect(new Set(PACKAGE_STATES.map((s) => s.id))).toEqual(new Set(PACKAGE_STATE_IDS))
    for (const [id, off] of OFF) {
      const flags = packageOf(off)
      expect({ id, state: packageStateOf(flags) }).toEqual({ id, state: id })
      expect(offFor(flags).filter((m) => off.includes(m)).sort()).toEqual([...off].sort())
    }
  })

  it("a company with no document is the full package, and so is one that only closed HR", () => {
    expect(packageOf(undefined)).toEqual(pkg("pm", "fin", "mfg"))
    expect(packageOf(null)).toEqual(pkg("pm", "fin", "mfg"))
    expect(packageStateOf(packageOf(["hr"]))).toBe("full")
  })

  it("the three connectors are three of the switches the company already has", () => {
    expect(CONNECTORS.map((c) => CONNECTOR_SWITCH[c])).toEqual(["project-management", "payments", "manufacturing"])
  })

  it("closing Finance closes HR with it, and the other switches of the company are kept", () => {
    expect(offFor(pkg("pm", "mfg"), [])).toEqual(expect.arrayContaining(["payments", "hr"]))
    expect(offFor(pkg("pm", "fin", "mfg"), ["hr"])).toEqual(["hr"])
    expect(offFor(pkg("fin"), ["hr", "crm"])).toEqual(expect.arrayContaining(["hr", "project-management", "manufacturing"]))
  })

  it("presets name five of the eight", () => {
    expect(PRESETS.map((p) => packageStateOf(p.pkg))).toEqual(["base", "pm", "pm_fin", "fin_mfg", "full"])
  })

  it("connectors are listed in package order", () => {
    expect(connectorsOf(pkg("mfg", "pm"))).toEqual(["pm", "mfg"])
  })
})

describe("the package's words", () => {
  const translator = (messages: unknown) => (key: string, values?: Record<string, string | number>) => {
    const node = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], (messages as { Portal: { ProcPackage: unknown } }).Portal.ProcPackage)
    if (typeof node !== "string") throw new Error(`missing ${key}`)
    return node.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ""))
  }
  const ar = translator(arMessages)
  const en = translator(enMessages)

  it("names the package as the prototype does", () => {
    expect(packageLabel(pkg(), ar)).toBe("الأساسية")
    expect(packageLabel(pkg("pm", "fin", "mfg"), ar)).toBe("الكاملة")
    expect(packageLabel(pkg("pm", "fin"), ar)).toBe("الأساسية + المشاريع + المالية")
    expect(packageLabel(pkg("pm", "fin"), en)).toBe("Base + Projects + Finance")
    expect(packageLabel(pkg(), en)).toBe("Base")
    expect(packageTitle(pkg(), ar)).toBe("المشتريات وحدها (مع المخزون)")
    expect(packageTitle(pkg("mfg"), en)).toBe("Procurement + Manufacturing")
  })

  it("every connector has its question, adds, fallbacks and both rules in both languages", () => {
    for (const t of [ar, en]) {
      for (const c of CONNECTORS) {
        const x = connectorTexts(c, t)
        expect(x.adds).toHaveLength(3)
        expect(x.without.length).toBeGreaterThanOrEqual(1)
        for (const s of [x.name, x.short, x.question, x.onRule, x.offRule, ...x.adds, ...x.without]) expect(s.length).toBeGreaterThan(3)
      }
    }
    expect(connectorTexts("fin", ar).without).toHaveLength(3)
  })

  it("no programme key reaches the customer's words (B-12) in what the package, the policies and the roles say", () => {
    for (const messages of [arMessages, enMessages]) {
      const portal = (messages as unknown as { Portal: Record<string, Record<string, unknown>> }).Portal
      const owned: Record<string, unknown> = {
        ProcPackage: portal.ProcPackage,
        "ProcSettings.policy": portal.ProcSettings.policy,
        "ProcSettings.policies": portal.ProcSettings.policies,
        "ProcSettings.roles2": portal.ProcSettings.roles2,
      }
      for (const [ns, node] of Object.entries(owned)) expect({ ns, leaks: JSON.stringify(node).match(/\b(proc|prj|inv|fin|mfg|sup):[A-Z]/g) }).toEqual({ ns, leaks: null })
    }
  })
})

describe("the contract of 36 events (ADM-04)", () => {
  it("has the 36 rows, in the counts of the Pipeline: 15 base, 6 inventory, 4 projects, 7 finance, 4 manufacturing", () => {
    expect(EVENTS).toHaveLength(36)
    expect(EVENT_IDS).toHaveLength(36)
    const count = (u: string) => EVENTS.filter((e) => e.unit === u).length
    expect([count("core"), count("inv"), count("pm"), count("fin"), count("mfg")]).toEqual([15, 6, 4, 7, 4])
  })

  it("every key is Latin, owned by a unit prefix, and no two rows share one", () => {
    for (const e of EVENTS) expect({ id: e.id, ok: /^(proc|prj|inv|fin|mfg):[A-Za-z<>_:0-9]+$/.test(e.key) }).toEqual({ id: e.id, ok: true })
    expect(new Set(EVENTS.map((e) => e.key)).size).toBe(36)
    expect(new Set(EVENTS.map((e) => e.id)).size).toBe(36)
  })

  it("each row has its stage, direction and the four texts in two languages", () => {
    const stages = new Set(STAGES.map((s) => s.id))
    for (const e of EVENTS) {
      expect(stages.has(e.stage)).toBe(true)
      expect(["in", "out"]).toContain(e.dir)
      for (const text of [e.title, e.carries, e.late, e.without]) {
        expect(text[0].length).toBeGreaterThan(0)
        expect(text[1].length).toBeGreaterThan(0)
      }
    }
    expect(STAGES).toHaveLength(6)
    expect(EIGHT_RULES).toHaveLength(8)
  })

  it("a connector's events are sent only while it is in the package; the base always sends", () => {
    for (const e of EVENTS) {
      expect(unitIn(e.unit, pkg("pm", "fin", "mfg"))).toBe(true)
      expect({ id: e.id, base: shouldEmit(e.unit, ["project-management", "payments", "manufacturing"]) }).toEqual({ id: e.id, base: e.unit === "core" || e.unit === "inv" })
    }
    expect(shouldEmit("fin", ["payments"])).toBe(false)
    expect(shouldEmit("fin", ["project-management"])).toBe(true)
  })
})

describe("idempotency keys (NFR-02)", () => {
  const SAMPLES: Record<string, string> = {
    rfq_offer: rfqOfferKey("RFQ-2026/003", "sup1", 2),
    rfq_publish: rfqPublishKey("RFQ-2026/003", 1),
    rfq_ask: rfqAskKey("RFQ-2026/003", 4),
    rfq_answer: rfqAnswerKey("RFQ-2026/003", 2),
    rfq_cut: rfqCutKey("RFQ-2026/003", "sup1"),
    rfq_outcome: rfqOutcomeKey("RFQ-2026/003", "sup1", 2),
    po_message: poMessageKey("PO-2026/014", 3),
    po_message_supplier: poMessageSupplierKey("PO-2026/014", 3),
    po_version: poVersionKey("PO-2026/014", 2),
    po_accept: poAcceptKey("PO-2026/014", 2),
    po_report: poReportKey("PO-2026/014", 1),
    po_forward: poForwardKey("PO-2026/014", 1, 2),
    po_decline: poDeclineKey("PO-2026/014", 1),
    po_reject: poRejectKey("PO-2026/014", 1),
    po_escalate: poEscalateKey("PO-2026/014", 2),
    inv_need: needLineKey("need9"),
    inv_issue: issueRequestKey("mr1", 2),
    inv_check: stockCheckKey("mr1", 2, 1),
    po_inbound: poInboundKey("PO-2026/014", 1),
    inv_receipt: warehouseReceiptKey("GR-2026/027"),
    receipt_manual: manualReceiptKey("GR-2026/028"),
    pm_request: projectRequestKey("mr77"),
    pm_cancel: projectRequestCancelKey("mr77", 3),
    pm_status: requestStatusKey("mr77", 3, 2),
    pm_receipt: projectReceiptKey("GR-2026/029"),
    fin_commitment: commitmentKey("PO-2026/014", 1),
    fin_advance_request: advanceRequestKey("ADV-2026/002"),
    fin_variance: varianceKey("INV-901"),
    fin_advance_paid: advancePaidKey("ADV-2026/002"),
    fin_payment: paymentKey("PAY-2026/044"),
    fin_paid: paidKey("PO-2026/014"),
    fin_hold: holdKey("INV-901"),
    mfg_shortage: shortageKey("prq5"),
    mfg_ask: workshopAskKey("mr77", 1),
    mfg_reply: workshopReplyKey("mr77", 1, 1),
    mfg_status: workshopStatusKey("prq5", 1, 3),
  }

  it("has one builder per row of the contract, and each builds a key of its own row", () => {
    expect(Object.keys(EVENT_KEY_BUILDERS).sort()).toEqual([...EVENT_IDS].sort())
    expect(Object.keys(SAMPLES).sort()).toEqual([...EVENT_IDS].sort())
    for (const id of EVENT_IDS) expect({ id, ok: matchesTemplate(id, SAMPLES[id]) }).toEqual({ id, ok: true })
  })

  it("a key belongs to exactly one row — except the status back to a project and to a work order, which share one shape by design", () => {
    const shared = ["pm_status", "mfg_status"]
    for (const id of EVENT_IDS) {
      const owners = EVENT_IDS.filter((other) => matchesTemplate(other, SAMPLES[id]))
      expect({ id, owners }).toEqual({ id, owners: shared.includes(id) ? shared : [id] })
    }
  })

  it("versions and counters must be positive whole numbers; parts may not hold a colon or a space", () => {
    expect(() => poVersionKey("PO-2026/014", 0)).toThrow()
    expect(() => poReportKey("PO-2026/014", 1.5)).toThrow()
    expect(() => rfqOfferKey("RFQ 1", "s", 1)).toThrow()
    expect(() => rfqOfferKey("RFQ-1", "s:1", 1)).toThrow()
    expect(() => needLineKey("")).toThrow()
  })

  it("the document id is the organisation then the key, with the slash made safe", () => {
    expect(procEventDocId("org1", "proc:PO:PO-2026/014:V1")).toBe("org1__proc:PO:PO-2026_014:V1")
    expect(PROC_EVENTS).toBe("procEvents")
  })

  it("the same key twice is the same document, so a resend cannot act twice; two companies never meet", () => {
    const key = poVersionKey("PO-2026/001", 1)
    expect(procEventDocId("orgA", key)).toBe(procEventDocId("orgA", key))
    expect(procEventDocId("orgA", key)).not.toBe(procEventDocId("orgB", key))
  })

  it("builds the event for an open connector, nothing for a closed one, and refuses a key that is not the row's", () => {
    const base = { organizationId: "orgA", by: "u1", at: "2026-10-21T08:00:00Z" }
    const open = buildProcEvent({ ...base, id: "fin_commitment", key: commitmentKey("PO-2026/001", 1), off: [] })
    expect(open).toMatchObject({ unit: "fin", dir: "out", connectors: pkg("pm", "fin", "mfg"), organizationId: "orgA" })
    expect(buildProcEvent({ ...base, id: "fin_commitment", key: commitmentKey("PO-2026/001", 1), off: ["payments"] })).toBeNull()
    expect(buildProcEvent({ ...base, id: "po_version", key: poVersionKey("PO-2026/001", 1), off: ["payments", "project-management", "manufacturing"] })).not.toBeNull()
    expect(() => buildProcEvent({ ...base, id: "po_version", key: poAcceptKey("PO-2026/001", 1), off: [] })).toThrow()
  })
})
