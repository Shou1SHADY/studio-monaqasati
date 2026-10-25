jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => {
  const nav = jest.requireActual("@/test-utils/render-world").navigationMock
  return { ...nav, useParams: () => ({ token: "t".repeat(64), locale: "ar" }) }
})
jest.mock("@/hooks/useMaterialTree", () => ({ useMaterialTree: () => ({ index: null }) }))
jest.mock("@/hooks/useSupplierVat", () => ({ useSupplierVat: () => "" }))
jest.mock("@/lib/upload-fit", () => ({ UPLOAD_MAX_BYTES: 4_000_000, fitForUpload: async (f: File) => f }))

/**
 * Procurement 2.0 prototype gaps, rendered: the receipt as its A4 page in a dialog (RC-01/02), the receiver's page head (RC-06) and the
 * preview that IS that page (RC-07); the supplier's profile slots that open (SP-01), the directory's profile (SP-02), the name that opens
 * the file in place (SP-03) and the head's three pills (SP-06).
 */

import React from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { installDomShims, messages, missingKeys, setLocale, setSignedIn } from "@/test-utils/render-world"
import { resetFakeDb } from "@/test-utils/fake-firestore"
import { ReceiptDocumentDialog } from "@/components/procurement/ReceiptDocumentDialog"
import { ReceiverPreviewDialog } from "@/components/procurement/ReceiverPreviewDialog"
import { SupplierFileDrawer } from "@/components/procurement/SupplierFileDrawer"
import { DirectoryDrawer } from "@/components/procurement/DirectoryDrawer"
import { SupplierLink, SupplierLinkContext } from "@/components/procurement/SupplierLink"
import { ReceiveLinkContent } from "@/app/[locale]/receive/[token]/ReceiveLinkContent"
import type { ReceiptPrintInput } from "@/lib/procurement/receipt-print"
import type { DeskDelivery } from "@/lib/procurement/receipt-desk"
import type { PlatformSupplier } from "@/hooks/useSupplierDirectory"
import type { ProcActor, PurchaseOrder } from "@/lib/procurement/types"

installDomShims()
jest.setTimeout(60_000)

type Tree = Record<string, unknown>
const msg = (path: string): string => {
  const v = path.split(".").reduce<unknown>((n, k) => (n && typeof n === "object" ? (n as Tree)[k] : undefined), messages("ar"))
  return typeof v === "string" ? v : `MISSING:${path}`
}
async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const NOW = new Date("2026-10-21T09:00:00Z")

beforeEach(() => {
  resetFakeDb()
  setLocale("ar")
  missingKeys.clear()
  document.body.innerHTML = ""
})
afterEach(() => cleanup())

describe("RC-01/RC-02: the receipt opens as its A4 page inside the app — download as PDF · print · close", () => {
  const input: ReceiptPrintInput = {
    delivery: { id: "d1", status: "confirmed", docNumber: "GR-2026/001", supplierName: "مصنع الجودة", confirmedAt: "2026-10-20T08:00:00Z", lines: [{ poLineId: "l1", name: "حديد 12 مم", unit: "طن", noticeQuantity: 0, counted: 3, accepted: 3 }] } as DeskDelivery,
    po: null,
    company: { name: "شركة البناء" },
    placeName: "مستودع البرج",
    projectName: null,
    displayNumber: "ا.س-2026/001",
    displayPoNumber: null,
    withPrices: false,
    locale: "ar",
    t: (k) => k,
    tp: (k) => k,
    now: NOW,
  }

  it("shows the document in a frame with the prototype's title and caption; «نزّل PDF» prints the frame under the receipt's number", async () => {
    render(<ReceiptDocumentDialog input={input} onOpenChange={() => {}} />)
    expect(screen.getByText(msg("Portal.ProcReceipts.doc.title").replace("{number}", "ا.س-2026/001"))).toBeTruthy()
    expect(screen.getByText(msg("Portal.ProcReceipts.doc.caption"))).toBeTruthy()
    const frame = document.querySelector("iframe") as HTMLIFrameElement
    expect(frame.getAttribute("srcdoc")).toContain("ا.س-2026/001")
    expect(frame.getAttribute("srcdoc")).toContain('dir="rtl"')
    expect(frame.getAttribute("srcdoc")).not.toContain("window.print()")
    const print = jest.fn()
    Object.defineProperty(frame, "contentWindow", { value: { print, focus: () => {} }, configurable: true })
    let titleAtPrint = ""
    print.mockImplementation(() => void (titleAtPrint = document.title))
    await act(async () => void fireEvent.click(screen.getByText(msg("Portal.ProcReceipts.doc.download"))))
    expect(print).toHaveBeenCalledTimes(1)
    expect(titleAtPrint).toBe("ا.س-2026/001")
    await act(async () => void fireEvent.click(screen.getByText(msg("Portal.ProcReceipts.doc.print"))))
    expect(print).toHaveBeenCalledTimes(2)
    expect(missingKeys.size).toBe(0)
  })
})

describe("RC-07: «كما يراه المستلم» is the receiver's page, read-only", () => {
  const po = { id: "po1", docNumber: "PO-2026/021", supplierName: "مصنع الجودة", rfqTitle: "حديد التسليح", projectId: null, site: { id: "site_malqa", name: "فيلا الملقا", city: "الرياض", district: "الملقا" }, lines: [{ id: "l1", name: "حديد 12 مم", unit: "طن", quantity: 10, accepted: 0, rejected: 0, held: 0, cancelled: 0 }] } as unknown as PurchaseOrder
  const notice = (forwardedTo: Record<string, unknown>) => ({ id: "n1", status: "pending_confirmation", poId: "po1", supplierName: "مصنع الجودة", deliveryDate: "2026-10-22", notes: "البوابة الشمالية", forwardedTo }) as unknown as DeskDelivery

  it("a link receiver: the address strip, the company's head, the code step, the blind count, the proof buttons and the where-line", async () => {
    render(<ReceiverPreviewDialog open onOpenChange={() => {}} delivery={notice({ name: "سامي", userId: null, phoneMasked: "05••12" })} po={po} placeName="المستودع المركزي" companyName="شركة البناء" noticeNumber="ASN-2026/021-1" />)
    await flush()
    const text = document.body.textContent ?? ""
    expect(text).toContain("mdmaktech.sa/receive/")
    expect(text).toContain("شركة البناء")
    expect(text).toContain(msg("ReceiveLink.from_supplier").replace("{name}", "مصنع الجودة"))
    expect(text).toContain("فيلا الملقا · الرياض — الملقا")
    expect(text).toContain("إ.ت-2026/021-1")
    expect(text).toContain(msg("Portal.ProcReceipts.preview.code_step").replace("{phone}", "05••12"))
    expect(text).toContain(msg("ReceiveLink.file_ticket"))
    expect(text).toContain(msg("ReceiveLink.where_warehouse"))
    expect(text).not.toMatch(/10 طن/)
    expect(missingKeys.size).toBe(0)
  })

  it("a member: «مدماك · مهامي», no code step; phone or full width", async () => {
    render(<ReceiverPreviewDialog open onOpenChange={() => {}} delivery={notice({ name: "سامي", userId: "rcv", phoneMasked: "05••" })} po={po} placeName="المستودع المركزي" />)
    await flush()
    const text = document.body.textContent ?? ""
    expect(text).toContain(msg("Portal.ProcReceipts.preview.tasks_frame"))
    expect(text).not.toContain(msg("Portal.ProcReceipts.preview.code_step").replace("{phone}", "05••"))
    const full = screen.getByText(msg("Portal.ProcReceipts.preview.view_full")).closest("button") as HTMLButtonElement
    await act(async () => void fireEvent.click(full))
    expect(full.getAttribute("aria-pressed")).toBe("true")
  })
})

describe("RC-06: the receiver's page head says where, when and for whom — with the language switch", () => {
  it("renders the strip, the order · notice, «شحنة من …», the place with its map, the delivery day", async () => {
    setSignedIn(null)
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { receiverName: "سامي", phoneMasked: "05••", supplierName: "مصنع الجودة", poNumber: "PO-2026/021", noticeNumber: "ASN-2026/021-2", rfqTitle: "حديد", deliveryDate: "2026-10-22", forwardedBy: "ريم", where: "warehouse", placeName: "فيلا الملقا", address: "الرياض — الملقا", mapUrl: "https://maps.example/x", companyName: "شركة البناء", receiverUserId: null, files: [], lines: [{ poLineId: "l1", name: "حديد 12 مم", unit: "طن" }] },
      }),
    })) as never
    render(<ReceiveLinkContent />)
    await flush()
    const text = document.body.textContent ?? ""
    expect(text).toContain("شركة البناء")
    expect(text).toContain(msg("ReceiveLink.from_supplier").replace("{name}", "مصنع الجودة"))
    expect(text).toContain("فيلا الملقا · الرياض — الملقا")
    expect(text).toContain("إ.ت-2026/021-2")
    expect(text).toContain(msg("ReceiveLink.delivery_on"))
    expect((screen.getByText(msg("ReceiveLink.map")).closest("a") as HTMLAnchorElement).getAttribute("href")).toBe("https://maps.example/x")
    expect((screen.getByText(msg("ReceiveLink.switch_lang")).closest("a") as HTMLAnchorElement).getAttribute("href")).toBe(`/receive/${"t".repeat(64)}`)
    expect(missingKeys.size).toBe(0)
  })
})

describe("SP-01/02/06: the supplier's profile — its slots open, the directory shows it too, the head says three things at once", () => {
  const actor = { isOwner: true, canApprove: true, canPrepare: true, seesPrices: true, uid: "u", name: "سعد" } as unknown as ProcActor
  const supplier = (over: Partial<PlatformSupplier> = {}) =>
    ({
      orgId: "s1",
      memberIds: ["s1"],
      name: "مصنع الجودة للخرسانة",
      city: "الرياض",
      coverageCities: [],
      categories: [],
      subIds: [],
      certificates: [
        { id: "c1", name: "شهادة الأيزو", expiryDate: "2026-11-20", documentUrl: "https://firebasestorage.googleapis.com/iso.pdf" },
        { id: "c2", name: "شهادة المطابقة", expiryDate: "2027-12-01" },
      ],
      worksCount: 1,
      works: [{ id: "w1", title: "برج الملقا", description: null, images: ["https://firebasestorage.googleapis.com/a.jpg", "https://firebasestorage.googleapis.com/b.jpg"] }],
      files: [{ id: "f1", name: "كتالوج المنتجات.pdf", url: "https://firebasestorage.googleapis.com/cat.pdf", kind: "document" }],
      profileFileUrl: "https://firebasestorage.googleapis.com/profile.pdf",
      bio: "نصنع الخرسانة الجاهزة",
      phone: "0551234567",
      email: null,
      international: false,
      since: "2024-03-01",
      platformVerified: true,
      profileVat: null,
      profileHasVat: true,
      profileCrExpiry: "2027-01-01",
      reviews: [],
      rating: null,
      isMine: true,
      isFavorite: false,
      isExplicitFavorite: false,
      linkId: "l1",
      linkRequestedBy: null,
      record: { id: "r1", organizationId: "acme", supplierOrgId: "s1", supplierName: "مصنع الجودة للخرسانة", verified: true, vatNumber: "300000000000003", kind: "mat" },
      crNumber: "1010101010",
      contactName: "خالد",
      ...over,
    }) as unknown as PlatformSupplier
  const viewLinks = () => Array.from(document.querySelectorAll(`a[aria-label="${msg("Portal.ProcSuppliers.file2.view")}"]`)).map((a) => a.getAttribute("href"))

  it("our file: the three pills, the two initials, previous work with its photos, certificates and files that open", async () => {
    render(<SupplierFileDrawer supplier={supplier()} open onOpenChange={() => {}} score={null} invited={0} orders={[]} agreements={[]} actor={actor} orgId="acme" canManage now={NOW} onToggleFavorite={() => {}} onRemove={() => {}} onOpenAgreement={() => {}} />)
    await flush()
    const text = document.body.textContent ?? ""
    expect(text).toContain(msg("Portal.ProcSuppliers.file2.pill_verified"))
    expect(text).toContain(msg("Portal.ProcSuppliers.file2.pill_ours"))
    expect(text).toContain(msg("Portal.ProcSuppliers.file2.pill_on_platform_since").split("{")[0].trim())
    expect(text).toContain("جخ")
    expect(text).toContain("برج الملقا")
    expect(viewLinks()).toEqual(["https://firebasestorage.googleapis.com/profile.pdf", "https://firebasestorage.googleapis.com/iso.pdf", "https://firebasestorage.googleapis.com/cat.pdf"])
    // A certificate ending within 60 days is amber.
    const iso = screen.getByText(msg("Portal.ProcSuppliers.file2.valid_until").replace("{date}", "").trim(), { exact: false, selector: "span.text-warning" })
    expect(iso).toBeTruthy()
    await act(async () => void fireEvent.click(screen.getByText("برج الملقا").closest("button") as HTMLButtonElement))
    expect(document.querySelectorAll('a[href="https://firebasestorage.googleapis.com/b.jpg"]').length).toBe(1)
    expect(missingKeys.size).toBe(0)
  })

  it("the directory's drawer shows the same profile — official data and the slots — above «before adding»", async () => {
    render(<DirectoryDrawer supplier={supplier({ isMine: false, record: null, linkId: null })} open onOpenChange={() => {}} actor={actor} orgId="acme" canManage onOpenOurs={() => {}} />)
    await flush()
    const text = document.body.textContent ?? ""
    expect(text).toContain(msg("Portal.ProcSuppliers.file2.official"))
    expect(text).toContain("1010101010")
    expect(text).toContain("خالد")
    expect(text).toContain("برج الملقا")
    expect(text).toContain(msg("Portal.ProcSuppliers.dir.before_adding"))
    expect(text).not.toContain(msg("Portal.ProcSuppliers.file2.pill_ours"))
    expect(viewLinks()).toHaveLength(3)
    expect(missingKeys.size).toBe(0)
  })
})

describe("SP-03: a supplier's name opens his file where the buyer stands", () => {
  it("hands the id to the page that holds the file; a guest key or a bare name stays text", async () => {
    const open = jest.fn()
    render(
      <SupplierLinkContext.Provider value={open}>
        <SupplierLink orgId="s1" name="مصنع الجودة" />
        <SupplierLink orgId="guest_9665" name="أبو خالد" />
        <SupplierLink orgId="محل الحي" name="محل الحي" />
      </SupplierLinkContext.Provider>
    )
    await act(async () => void fireEvent.click(screen.getByText("مصنع الجودة")))
    expect(open).toHaveBeenCalledWith("s1")
    expect(screen.getByText("أبو خالد").tagName).toBe("SPAN")
    expect(screen.getByText("محل الحي").tagName).toBe("SPAN")
  })
})
