/**
 * Fix wave F — V6-proc-back 05/06/07, rendered: receiving is Inventory's and
 * Projects' act, so the owner of a company with a procurement team gets no
 * «سجّل الاستلام» and no «ألحِقه بأمر…» in the receipt drawer; a cash expense
 * is offered only for a receipt Procurement typed by hand.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)

import React from "react"
import { act, render } from "@testing-library/react"
import { resetFakeDb } from "@/test-utils/fake-firestore"
import { installDomShims, messages, setSignedIn } from "@/test-utils/render-world"
import { ReceiptDrawer } from "@/components/procurement/ReceiptDrawer"
import { RegulariseReceiptDialog } from "@/components/procurement/RegulariseReceiptDialog"
import type { DeskDelivery } from "@/lib/procurement/receipt-desk"
import { DEFAULT_POLICIES, type ProcActor } from "@/lib/procurement/types"

installDomShims()

const NOW = new Date("2026-09-22T09:00:00Z")
const actor = (over: Partial<ProcActor> = {}): ProcActor => ({ uid: "buyer", name: "Badr", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true, ...over })
const OWNER = actor({ uid: "own", name: "Owner", isOwner: true, canApprove: true, canReceive: true })

type Tree = Record<string, unknown>
const msg = (path: string): string => {
  const v = path.split(".").reduce<unknown>((n, k) => (n && typeof n === "object" ? (n as Tree)[k] : undefined), messages("ar"))
  return typeof v === "string" ? v : `MISSING:${path}`
}
const buttons = () => Array.from(document.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim())

const notice: DeskDelivery = { id: "n1", status: "pending_confirmation", supplierName: "Al-Ufuq", deliveryDate: "2026-09-23", lines: [{ poLineId: "l1", name: "Cement", unit: "bag", noticeQuantity: 10 }] }
const manual: DeskDelivery = {
  id: "m1",
  status: "confirmed",
  source: "manual",
  docNumber: "GR-2026/004",
  supplierName: "Corner shop",
  confirmedAt: "2026-09-20T08:00:00Z",
  items: [{ name: "Nails", quantity: 10, unit: "box" }],
  lines: [{ poLineId: "i1", name: "Nails", unit: "box", noticeQuantity: 0, counted: 10, accepted: 10, rejected: 0, held: 0 }],
}

function drawer(d: DeskDelivery, who: ProcActor, ownerReadOnly: boolean) {
  return render(
    <ReceiptDrawer
      delivery={d}
      po={null}
      deliveries={[d]}
      onOpenChange={() => {}}
      actor={who}
      orgName="Org"
      company={{ name: "Org", cr: null, vat: null, address: null, phone: null, email: null }}
      warehouseName={() => null}
      projectName={() => null}
      placeKind={() => null}
      now={NOW}
      onReceive={() => {}}
      onRegularise={() => {}}
      policies={DEFAULT_POLICIES}
      ownerReadOnly={ownerReadOnly}
    />
  )
}

beforeEach(() => {
  resetFakeDb()
  setSignedIn("buyer")
})

describe("05 · «سجّل الاستلام» is never the owner's on a Procurement page once he has a team", () => {
  it("hidden when he only reads; shown to a one-person company's owner", () => {
    let view = drawer(notice, OWNER, true)
    expect(buttons()).not.toContain(msg("Portal.ProcReceipts.drawer.record"))
    view.unmount()
    view = drawer(notice, OWNER, false)
    expect(buttons()).toContain(msg("Portal.ProcReceipts.drawer.record"))
    view.unmount()
  })
})

describe("06 · the owner who reads raises no retroactive order from a no-PO receipt", () => {
  it("no «ألحِقه بأمر…» for him; the buyer has it", () => {
    let view = drawer(manual, OWNER, true)
    expect(buttons()).not.toContain(msg("Portal.ProcReceipts.drawer.regulariseOrExpense"))
    view.unmount()
    view = drawer(manual, actor(), false)
    expect(buttons()).toContain(msg("Portal.ProcReceipts.drawer.regulariseOrExpense"))
    view.unmount()
  })
})

describe("07 · a cash expense only for a receipt Procurement typed by hand", () => {
  const options = () => Array.from(document.querySelectorAll("[role=radio]")).map((b) => (b.textContent ?? "").trim())
  const open = async (d: DeskDelivery) => {
    const view = render(<RegulariseReceiptDialog delivery={d} actor={actor()} orgId="org" orders={[]} placeName={null} onOpenChange={() => {}} onDone={() => {}} />)
    await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
    return view
  }

  it("manual: new order or expense; recorded by a receiver: an order only", async () => {
    let view = await open(manual)
    expect(options()).toEqual([msg("Portal.ProcReceipts.regularise.optNew"), msg("Portal.ProcReceipts.regularise.optExpense")])
    view.unmount()
    view = await open({ ...manual, source: null })
    expect(options()).toEqual([msg("Portal.ProcReceipts.regularise.optNew")])
    view.unmount()
  })
})
