/**
 * The receiving desk (ReceiveDeliveryDialog) rendered for real: typing a count
 * must reach the derived state — the supplier's notice revealed, the accepted
 * total, and the save button unlocked.
 *
 * Regression for the UAT run of 23 Sep: the dialog memoised its lines on
 * `watch("lines")`, which React Hook Form returns as the same array it mutates
 * in place, so the memo never recomputed. Whatever was typed, the desk said
 * "nothing counted" and no PO-backed receipt could be saved anywhere.
 */

import { fireEvent, render, screen } from "@testing-library/react"
import fs from "fs"
import path from "path"
import { DEFAULT_POLICIES, type PoLine, type ProcActor, type PurchaseOrder } from "@/lib/procurement/types"
import type { DeskDelivery } from "@/lib/procurement/receipt-desk"

const mockMessages: Record<string, unknown> = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "messages", "en.json"), "utf8"))

function mockFormat(message: string, vars: Record<string, unknown>): string {
  return message.replace(/\{\s*(\w+)\s*(?:,[^{}]*(?:\{[^{}]*\}[^{}]*)*)?\}/g, (_m, name: string) => (name in vars ? String(vars[name]) : `MISSING_VAR:${name}`))
}

jest.mock("next-intl", () => {
  const table = (namespace: string, key: string) =>
    [...namespace.split("."), ...key.split(".")].reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), mockMessages)
  return {
    useLocale: () => "en",
    useTranslations: (namespace: string) => {
      const t = (key: string, vars?: Record<string, unknown>) => {
        const raw = table(namespace, key)
        return typeof raw === "string" ? mockFormat(raw, vars || {}) : `MISSING:${namespace}.${key}`
      }
      t.has = (key: string) => typeof table(namespace, key) === "string"
      return t
    },
  }
})

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : () => React.createElement("svg", { "data-icon": String(name) })) })
})

jest.mock("@/firebase", () => ({ useFirestore: () => ({}) }))
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }))
jest.mock("@/components/SignaturePad", () => ({ SignaturePad: () => null }))

// jsdom has neither; the Radix dialog and select measure themselves on mount.
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView = () => {}

import { ReceiveDeliveryDialog } from "@/components/procurement/ReceiveDeliveryDialog"

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "Rebar 12 mm", unit: "t", quantity: 10, unitPrice: 2900, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })

const po: PurchaseOrder = {
  id: "po1",
  organizationId: "org",
  docNumber: "PO-2026/001",
  status: "accepted",
  basis: "rfq",
  rfqId: "r1",
  rfqTitle: "Rebar",
  offerId: "o1",
  projectId: null,
  supplierOrgId: "sup1",
  supplierUserId: null,
  supplierName: "Al-Hadid",
  isGuestSupplier: false,
  lines: [line()],
  totalExVat: 29000,
  vatRate: 0.15,
  offersCount: 1,
  lowestOfferTotal: 29000,
  shortCompetition: false,
  noOfficialQuote: false,
  preparedById: "buyer",
  preparedByName: "Sara",
  createdAt: "2026-09-20T08:00:00Z",
  approverKind: "manager",
  supplierAcceptedAt: "2026-09-21T08:00:00Z",
  promisedDate: "2026-09-25",
  log: [],
}

const delivery: DeskDelivery = {
  id: "d1",
  status: "pending_confirmation",
  poId: "po1",
  poNumber: "PO-2026/001",
  supplierName: "Al-Hadid",
  deliveryDate: "2026-09-24",
  lines: [{ poLineId: "l1", name: "Rebar 12 mm", unit: "t", noticeQuantity: 10 }],
}

const RECEIVER: ProcActor = { uid: "rcv", name: "Store keeper", isOwner: false, canApprove: false, canPrepare: false, canExpedite: false, canReceive: true, seesPrices: false }

const receiveMessages = (mockMessages as { Portal: { ProcReceipts: { receive: { noticeHidden: string; openOnOrder: string } } } }).Portal.ProcReceipts.receive
const noticeHidden = receiveMessages.noticeHidden
const openOnOrderPrefix = receiveMessages.openOnOrder.replace(/\{[^}]*\}/g, "").trim()

function renderDesk() {
  render(
    <ReceiveDeliveryDialog
      open
      onOpenChange={() => {}}
      delivery={delivery}
      po={po}
      policies={DEFAULT_POLICIES}
      actor={RECEIVER}
      orgId="org"
      warehouses={[{ id: "w1", name: "Central" }]}
      onDone={() => {}}
    />
  )
  const submit = () => screen.getAllByRole("button").find((b) => b.getAttribute("type") === "submit") as HTMLButtonElement
  return { counted: () => document.getElementById("counted-0") as HTMLInputElement, submit }
}

describe("ReceiveDeliveryDialog — a typed count reaches the derived state", () => {
  test("before any count: the notice is hidden and the receipt cannot be saved", () => {
    const { submit } = renderDesk()
    expect(screen.getByText(noticeHidden)).toBeInTheDocument()
    expect(submit().disabled).toBe(true)
  })

  test("typing a count reveals the notice, leaves 'hidden', and unlocks save", () => {
    const { counted, submit } = renderDesk()
    fireEvent.change(counted(), { target: { value: "9" } })
    expect(screen.queryByText(noticeHidden)).not.toBeInTheDocument()
    expect(submit().disabled).toBe(false)
    expect(submit().textContent).toContain("9")
  })

  test("what is left on the order stays hidden until a count is typed — it would give the count away", () => {
    const { counted } = renderDesk()
    expect(document.body.textContent).not.toContain(openOnOrderPrefix)
    fireEvent.change(counted(), { target: { value: "9" } })
    expect(document.body.textContent).toContain(openOnOrderPrefix)
  })

  test("a second edit is seen too — the memo keeps up, not just the first render", () => {
    const { counted, submit } = renderDesk()
    fireEvent.change(counted(), { target: { value: "9" } })
    fireEvent.change(counted(), { target: { value: "7" } })
    expect(submit().textContent).toContain("7")
    expect(submit().textContent).not.toContain("9")
  })
})
