/**
 * Procurement 2.0 — the lifecycle row and the «لا عرض حيّاً» banner on screen (RFQ-13…15, WF-26): which buttons each state shows
 * and to whom, and that a dialog's act goes to the server route with what the buyer picked.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
const mockCall = jest.fn()
jest.mock("@/lib/procurement/rfq-lifecycle-client", () => ({ ...jest.requireActual("@/lib/procurement/rfq-lifecycle-client"), lifecycleCall: (i: unknown) => mockCall(i) }))
jest.mock("@/lib/hr/format", () => ({ ...jest.requireActual("@/lib/hr/format"), riyadhDay: () => "2026-10-22" }))

import React from "react"
import { act, fireEvent, render } from "@testing-library/react"
import { installDomShims, missingKeys } from "@/test-utils/render-world"
import { RfqLifecycleBar, lifecycleState, type LifecycleRfq } from "@/components/procurement/rfq/RfqLifecycleBar"
import { NoLiveBanner } from "@/components/procurement/rfq/NoLiveBanner"
import { RFQ_EXTEND_EVENT } from "@/components/procurement/rfq/rfqPageEvents"
import type { RfqWriteActor } from "@/lib/procurement/rfq-access"
import { addDays, todayOf } from "@/lib/procurement/po"

installDomShims()

const OWNER: RfqWriteActor = { uid: "o", name: "Saad", isOwner: true, canApprove: true, canPrepare: true, canExpedite: true, canReceive: true, seesPrices: true }
const EXPEDITER: RfqWriteActor = { uid: "x", name: "Ex", isOwner: false, canApprove: false, canPrepare: false, canExpedite: true, canReceive: false, seesPrices: false }
const rfq = (over: Partial<LifecycleRfq> = {}): LifecycleRfq => ({ id: "R1", status: "New", deadline: "2026-10-25", rfqNumber: "RFQ-2026/011", title: "زوايا", createdByUserId: "o", ...over })
const text = () => document.body.textContent ?? ""
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === label) as HTMLButtonElement | undefined
const flush = async () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))

beforeEach(() => mockCall.mockReset())

describe("lifecycleState", () => {
  it("open until the date passes, then comparing; nothing for a draft, an award or a cancellation", () => {
    expect(lifecycleState(rfq(), "2026-10-22")).toBe("open")
    expect(lifecycleState(rfq({ deadline: "2026-10-25" }), "2026-10-25")).toBe("open")
    expect(lifecycleState(rfq({ deadline: "2026-10-20" }), "2026-10-22")).toBe("compare")
    expect(lifecycleState(rfq({ closedEarly: { at: "x" } }), "2026-10-22")).toBe("compare")
    for (const status of ["Draft", "Awarded", "Cancelled"]) expect(lifecycleState(rfq({ status }), "2026-10-22")).toBeNull()
  })
})

describe("RfqLifecycleBar", () => {
  it("an open RFQ offers extend, remind and cancel", () => {
    const v = render(<RfqLifecycleBar rfq={rfq()} actor={OWNER} />)
    expect(button("مدّد")).toBeDefined()
    expect(button("ذكّر من لم يقدّم")).toBeDefined()
    expect(button("ألغِ الطلب")).toBeDefined()
    expect(button("أعد فتحه")).toBeUndefined()
    v.unmount()
  })

  it("a comparing RFQ offers reopen and cancel — no extend, no remind", () => {
    const v = render(<RfqLifecycleBar rfq={rfq({ deadline: "2026-10-20" })} actor={OWNER} />)
    expect(button("أعد فتحه")).toBeDefined()
    expect(button("ألغِ الطلب")).toBeDefined()
    expect(button("مدّد")).toBeUndefined()
    expect(button("ذكّر من لم يقدّم")).toBeUndefined()
    v.unmount()
  })

  it("an awarded or cancelled RFQ, and a member who runs no RFQs, see nothing", () => {
    for (const [r, who] of [[rfq({ status: "Awarded" }), OWNER], [rfq({ status: "Cancelled" }), OWNER], [rfq(), EXPEDITER]] as const) {
      const v = render(<RfqLifecycleBar rfq={r} actor={who} />)
      expect(document.querySelectorAll("button").length).toBe(0)
      v.unmount()
    }
  })

  it("the extend dialog sends the picked date to the server and says so", async () => {
    const deadline = addDays(todayOf(new Date()), 3)
    const picked = addDays(deadline, 4)
    mockCall.mockResolvedValue({ action: "extend", rfqId: "R1", deadline: picked, count: 0, told: 2, reopened: false })
    const v = render(<RfqLifecycleBar rfq={rfq({ deadline })} actor={OWNER} />)
    await act(async () => void fireEvent.click(button("مدّد")!))
    const date = document.querySelector('input[type="date"]') as HTMLInputElement
    expect(date.min).toBe(addDays(deadline, 1))
    const go = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => (b.textContent || "").trim() === "مدّد") as HTMLButtonElement
    expect(go.disabled).toBe(true)
    await act(async () => void fireEvent.change(date, { target: { value: picked } }))
    expect(go.disabled).toBe(false)
    await act(async () => void fireEvent.click(go))
    await flush()
    expect(mockCall).toHaveBeenCalledWith({ action: "extend", rfqId: "R1", deadline: picked })
    expect([...missingKeys]).toEqual([])
    v.unmount()
  })

  it("the cancel dialog needs a reason, and «سبب آخر» four letters", async () => {
    mockCall.mockResolvedValue({ action: "cancel", rfqId: "R1", count: 0, told: 1 })
    const v = render(<RfqLifecycleBar rfq={rfq()} actor={OWNER} />)
    await act(async () => void fireEvent.click(button("ألغِ الطلب")!))
    const go = () => Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => (b.textContent || "").trim() === "ألغِ الطلب") as HTMLButtonElement
    expect(go().disabled).toBe(true)
    await act(async () => void fireEvent.click(button("سبب آخر")!))
    expect(go().disabled).toBe(true)
    await act(async () => void fireEvent.change(document.querySelector('input[placeholder="اكتب السبب"]')!, { target: { value: "تغيّر القرار" } }))
    expect(go().disabled).toBe(false)
    await act(async () => void fireEvent.click(go()))
    await flush()
    expect(mockCall).toHaveBeenCalledWith({ action: "cancel", rfqId: "R1", code: "other", note: "تغيّر القرار" })
    v.unmount()
  })

  it("the browser event from a question opens the extend dialog", async () => {
    const v = render(<RfqLifecycleBar rfq={rfq()} actor={OWNER} />)
    await act(async () => void window.dispatchEvent(new CustomEvent(RFQ_EXTEND_EVENT, { detail: { rfqId: "R1" } })))
    expect(text()).toContain("مدّد الموعد")
    v.unmount()
  })
})

describe("NoLiveBanner", () => {
  it("says why and offers both exits to whoever runs the RFQ", () => {
    const v = render(<NoLiveBanner rfq={rfq({ deadline: "2026-10-20" })} actor={OWNER} reason="closed_empty" />)
    expect(text()).toContain("أُغلق بلا عروض.")
    expect(button("أعد فتحه")).toBeDefined()
    expect(button("ألغِ الطلب")).toBeDefined()
    v.unmount()
    const w = render(<NoLiveBanner rfq={rfq()} actor={EXPEDITER} reason="all_excluded" />)
    expect(text()).toContain("لا عرض حيّاً: كل العروض مستبعدة.")
    expect(button("أعد فتحه")).toBeUndefined()
    w.unmount()
  })
})
