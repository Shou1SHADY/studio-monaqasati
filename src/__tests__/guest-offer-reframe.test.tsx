/**
 * Procurement 2.0, VL-01 — the guest's follow-up link `/offer/[token]` in the visitor link's frame: «طلب عرض سعر · {company}»
 * on top, the decided result as the link's result card (with the order's link once the order is out — the delivery is
 * reported there), the buyer's price request under «طُلب منك», and the registration card at the foot. Its acts stay.
 */

jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => ({ ...jest.requireActual("@/test-utils/render-world").navigationMock, useParams: () => ({ token: "tok123" }) }))
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }))
jest.mock("@/components/supplier-free/JoinFreeButton", () => ({ JoinFreeButton: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button> }))

import React from "react"
import { act, render } from "@testing-library/react"
import { installDomShims, missingKeys, setLocale } from "@/test-utils/render-world"
import { GuestOfferContent } from "@/app/[locale]/offer/[token]/GuestOfferContent"

installDomShims()
jest.setTimeout(30_000)

const text = () => document.body.textContent ?? ""
const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

function payload(offer: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const status = String(offer.status ?? "قيد المراجعة")
  return {
    offer: { id: "offer12345", companyName: "مؤسسة النور", contactName: "سامي", price: 1000, status, sampleStatus: null, targetPrice: null, reductionNote: null, decidedAt: "2026-10-20T10:00:00Z", sampleUpdatedAt: null, deliveryLocation: "الرياض", executionDuration: null, executionDurationUnit: null, offerPdfUrl: null, guestReplyNote: null, priceHistory: [], lines: [], createdAt: "2026-10-10T10:00:00Z", vatNumber: "300000000000003", papers: [{ kind: "cr", name: "cr.pdf", at: "x" }, { kind: "vat", name: "vat.pdf", at: "x" }], ...offer },
    queries: [],
    rfq: { title: "حديد للفيلا", city: "الرياض", deadline: "2026-10-18", notes: null, pdfUrl: null, products: [{ name: "حديد", quantity: 10, unitOfMeasure: "طن" }], quantity: null, unitOfMeasure: null },
    contractorName: "شركة البنيان",
    delivery: null,
    availability: { canRevisePrice: status === "مطلوب تخفيض", canMarkSampleSent: false, canSendDeliveryNotice: status === "مقبول", isClosed: status === "مرفوض" },
    ...extra,
  }
}

async function open(data: unknown) {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data }) })) as unknown as typeof fetch
  const view = render(<GuestOfferContent />)
  await flush()
  return view
}

beforeEach(() => {
  setLocale("ar")
  missingKeys.clear()
})

describe("the guest's follow-up link in the visitor frame (VL-01)", () => {
  it("opens in the link's frame — «طلب عرض سعر» with the buyer's company — and ends with the registration card", async () => {
    const view = await open(payload({}))
    const header = document.querySelector("header") as HTMLElement
    expect(header.textContent).toContain("طلب عرض سعر")
    expect(header.textContent).toContain("شركة البنيان")
    expect(text()).toContain("سجّل في مدماك مجاناً، وكن أول من يقدّم العرض")
    expect(text()).toContain("حديد للفيلا")
    expect(document.querySelector("[data-result]")).toBeNull()
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("a price request reads under «طُلب منك», with its form", async () => {
    const view = await open(payload({ status: "مطلوب تخفيض", reductionNote: "أقل قليلاً" }))
    const task = document.querySelector('[data-task="reduction"]') as HTMLElement
    expect(task.textContent).toContain("طُلب منك")
    expect(task.textContent).toContain("المقاول يطلب تخفيض السعر")
    expect(task.querySelector("form")).toBeTruthy()
    view.unmount()
  })

  it("awarded with the order out: «رُسّي عليك» with the order's link, and no delivery form here", async () => {
    const view = await open(payload({ status: "مقبول" }, { orderUrl: "https://uat.mdmaktech.sa/po/abc" }))
    expect(document.querySelector("[data-result]")?.getAttribute("data-result")).toBe("awarded")
    const link = Array.from(document.querySelectorAll("a")).find((a) => a.getAttribute("href") === "https://uat.mdmaktech.sa/po/abc")
    expect(link?.textContent).toBe("افتح أمر الشراء")
    expect(text()).not.toContain("إرسال إشعار تسليم")
    view.unmount()
  })

  it("awarded on a legacy order with no link: the delivery notice stays here", async () => {
    const view = await open(payload({ status: "مقبول" }, { orderUrl: null }))
    expect(document.querySelector("[data-result]")?.getAttribute("data-result")).toBe("awarded")
    expect(text()).toContain("إرسال إشعار تسليم")
    view.unmount()
  })

  it("not awarded reads as the link's «لم يُرسَ عليك هذه المرة»", async () => {
    const view = await open(payload({ status: "مرفوض" }))
    expect(document.querySelector("[data-result]")?.getAttribute("data-result")).toBe("lost")
    expect(text()).toContain("لم يُرسَ عليك هذه المرة")
    view.unmount()
  })
})
