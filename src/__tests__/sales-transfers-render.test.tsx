import { render, screen, fireEvent } from "@testing-library/react"
import fs from "fs"
import path from "path"
import { INSTALLMENT_DEPOSIT_ID, type CrmQuotation } from "@/lib/crm"
import type { QuoteRequest, TransferNotice } from "@/lib/sales-transfers"
import { AnswerTransferDialog, ReportTransferDialog, TransferNoticesList } from "@/components/sales/TransferNotices"
import { QuoteRequestsInbox } from "@/components/sales/QuoteRequestsInbox"

let mockLocale: "ar" | "en" = "ar"
const mockMessages = (locale: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "messages", `${locale}.json`), "utf8"))

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy(
    {},
    {
      get: (_target, name) =>
        name === "__esModule" ? false : (props: Record<string, unknown>) => React.createElement("svg", { "data-icon": String(name), "aria-hidden": props["aria-hidden"] }),
    }
  )
})

jest.mock("next-intl", () => ({
  useLocale: () => mockLocale,
  useTranslations: (namespace: string) => (key: string, vars?: Record<string, string | number>) => {
    const table = namespace
      .split(".")
      .reduce<Record<string, unknown> | undefined>((node, part) => node?.[part] as Record<string, unknown> | undefined, mockMessages(mockLocale))
    let text = typeof table?.[key] === "string" ? (table[key] as string) : `MISSING:${namespace}.${key}`
    for (const [name, value] of Object.entries(vars || {})) text = text.replace(`{${name}}`, String(value))
    return text
  },
}))

jest.mock("@/i18n/routing", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return {
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
      React.createElement("a", { href, ...rest }, children),
    usePathname: () => "/",
    useRouter: () => ({ push: jest.fn() }),
  }
})

const mockToast = jest.fn()
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }))
jest.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ can: () => true, isLoading: false, isOrgOwner: true, groups: [] }),
}))

let mockRequests: QuoteRequest[] = []
jest.mock("@/firebase", () => ({
  useFirestore: () => ({}),
  useUser: () => ({ user: { uid: "u1", email: "seller@x.sa" } }),
  useMemoFirebase: (fn: () => unknown) => fn(),
  useCollection: () => ({ data: mockRequests, isLoading: false }),
}))
jest.mock("firebase/firestore", () => ({
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  doc: jest.fn(),
  getDocs: jest.fn(),
  writeBatch: jest.fn(),
  serverTimestamp: jest.fn(),
}))

const notice = (over: Partial<TransferNotice>): TransferNotice => ({
  id: "n1",
  organizationId: "org",
  noticeNumber: "TN-AAAAAA",
  quotationId: "q1",
  quotationNumber: "QT-001",
  installmentId: INSTALLMENT_DEPOSIT_ID,
  installmentLabel: "دفعة مقدمة",
  contactId: "c1",
  contactName: "شركة النرجس",
  amountStated: 19734,
  transferDate: "2026-09-14",
  status: "reported",
  reportedAt: "2026-09-14T10:00:00.000Z",
  createdByUserId: "u1",
  createdByUserName: "ريم الغامدي",
  ...over,
})

const quotation: CrmQuotation = {
  id: "q1",
  contactId: "c1",
  contactName: "شركة النرجس",
  quotationNumber: "QT-001",
  amount: 65780,
  status: "accepted",
  organizationId: "org",
  installments: [
    { id: INSTALLMENT_DEPOSIT_ID, label: "دفعة مقدمة", percent: 30 },
    { id: "balance", label: "الباقي عند التسليم", percent: 70 },
  ],
  payments: null,
}

afterEach(() => {
  mockToast.mockClear()
  mockRequests = []
})

describe("TransferNoticesList", () => {
  it.each(["ar", "en"] as const)("renders every state in %s with no missing keys or NaN", (locale) => {
    mockLocale = locale
    const { container } = render(
      <TransferNoticesList
        notices={[
          notice({ id: "n1", status: "reported" }),
          notice({ id: "n2", status: "confirmed", noticeNumber: "TN-BBBBBB" }),
          notice({ id: "n3", status: "not_found", noticeNumber: "TN-CCCCCC", financeMessage: "الوارد 12,000 لا 13,082" }),
        ]}
        canAnswer
        onAnswer={jest.fn()}
      />
    )
    expect(container.textContent).not.toContain("MISSING:")
    expect(container.textContent).not.toMatch(/NaN|undefined/)
    expect(container.textContent).toContain("TN-AAAAAA")
    expect(container.textContent).toContain("الوارد 12,000 لا 13,082")
  })

  it("only reported rows carry the answer button, and only for Finance", () => {
    mockLocale = "ar"
    const onAnswer = jest.fn()
    render(
      <TransferNoticesList
        notices={[notice({ id: "n1", status: "reported" }), notice({ id: "n2", status: "confirmed", noticeNumber: "TN-BBBBBB" })]}
        canAnswer
        onAnswer={onAnswer}
      />
    )
    const buttons = screen.getAllByRole("button", { name: /تحقّق وردّ/ })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ id: "n1" }))
  })

  it("hides the answer button from non-Finance roles", () => {
    mockLocale = "ar"
    render(<TransferNoticesList notices={[notice({})]} canAnswer={false} onAnswer={jest.fn()} />)
    expect(screen.queryByRole("button", { name: /تحقّق وردّ/ })).not.toBeInTheDocument()
  })
})

describe("ReportTransferDialog", () => {
  it("prefills the instalment remainder and warns (without blocking) on a different amount", () => {
    mockLocale = "ar"
    const { container } = render(
      <ReportTransferDialog
        target={{ quotation, installmentId: INSTALLMENT_DEPOSIT_ID }}
        order={null}
        onOpenChange={jest.fn()}
        actorName="ريم"
      />
    )
    expect(container.ownerDocument.body.textContent).not.toContain("MISSING:")
    const amount = screen.getByLabelText(/المبلغ كما ذكره العميل/) as HTMLInputElement
    // 30% of 65,780 = 19,734
    expect(amount.value).toBe("19734")
    expect(screen.queryByText(/يختلف عن المتبقي/)).not.toBeInTheDocument()
    fireEvent.change(amount, { target: { value: "12000" } })
    expect(screen.getByText(/يختلف عن المتبقي/)).toBeInTheDocument()
  })
})

describe("AnswerTransferDialog", () => {
  it("shows the notice's facts and refuses 'not found' without a message", () => {
    mockLocale = "ar"
    const n = notice({ bankRef: "SA-778812", note: "حوالة من الأهلي" })
    render(<AnswerTransferDialog notice={n} quotation={quotation} order={null} onOpenChange={jest.fn()} actorName="وليد" />)
    const body = document.body.textContent || ""
    expect(body).not.toContain("MISSING:")
    expect(body).toContain("SA-778812")
    expect(body).toContain("حوالة من الأهلي")
    fireEvent.click(screen.getByRole("button", { name: /لم أجد الإيداع/ }))
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }))
  })
})

describe("QuoteRequestsInbox", () => {
  const request = (over: Partial<QuoteRequest>): QuoteRequest => ({
    id: "rq1",
    organizationId: "org",
    requestNumber: "RQ-AAAAAA",
    contactId: "c1",
    contactName: "مقاولات الديار",
    lines: [
      { name: "باب خشبي HDF", unit: "باب", quantity: 60 },
      { name: "خزانة ملابس", unit: "وحدة", quantity: 18 },
    ],
    status: "new",
    requestedByUserId: "crm1",
    requestedByUserName: "نواف السبيعي",
    requestedAt: "2026-09-14T08:00:00.000Z",
    ...over,
  })

  it("renders nothing while the inbox is empty", () => {
    mockRequests = []
    const { container } = render(<QuoteRequestsInbox portal="contractor" orgId="org" actorName="ريم" />)
    expect(container.firstChild).toBeNull()
  })

  it.each(["ar", "en"] as const)("renders requests in %s: lines, requester, overdue flag, both actions", (locale) => {
    mockLocale = locale
    mockRequests = [request({}), request({ id: "rq2", requestNumber: "RQ-BBBBBB", dueDate: "2020-01-01" })]
    const { container } = render(<QuoteRequestsInbox portal="contractor" orgId="org" actorName="ريم" />)
    const text = container.textContent || ""
    expect(text).not.toContain("MISSING:")
    expect(text).not.toMatch(/NaN|undefined/)
    expect(text).toContain("RQ-AAAAAA")
    expect(text).toContain("نواف السبيعي")
    expect(text).toContain("60 باب باب خشبي HDF")
    // The price link carries the request into the composer.
    const links = container.querySelectorAll('a[href*="request=rq1"]')
    expect(links.length).toBe(1)
  })

  it("opens the decline dialog with exactly the five factual reasons", () => {
    mockLocale = "ar"
    mockRequests = [request({})]
    render(<QuoteRequestsInbox portal="contractor" orgId="org" actorName="ريم" />)
    fireEvent.click(screen.getByRole("button", { name: /تعذّر التسعير/ }))
    const radios = screen.getAllByRole("radio")
    expect(radios).toHaveLength(5)
    expect(document.body.textContent).toContain("ليس في خط إنتاجنا")
    expect(document.body.textContent).toContain("يُشترى جاهزاً")
  })
})
