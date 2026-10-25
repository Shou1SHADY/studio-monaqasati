/**
 * Procurement 2.0 — step 2 of the editor (ED-06, ED-07, ED-08): the three payment-term chips and the switched-off «بالأجل عبر مدماك»
 * that only explains, the visitor-link switch (on for «عام», off for the others), the deadline for every audience, the direct
 * award's estimate with its reason chips only above the cap — and no title field any more (ED-05).
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)

import React from "react"
import { act, fireEvent, render } from "@testing-library/react"
import { installDomShims, missingKeys } from "@/test-utils/render-world"
import { EditorPublish, linkOn, type PublishValues } from "@/components/procurement/rfq-editor/EditorPublish"
import { EditorReview, type ReviewModel } from "@/components/procurement/rfq-editor/EditorReview"

installDomShims()

const values = (over: Partial<PublishValues> = {}): PublishValues => ({
  audience: "public",
  deadline: "2026-10-25",
  pricing: "line",
  title: "حديد",
  terms: [{ pct: "100", days: "30" }],
  termsSet: true,
  notes: "",
  budget: "",
  attachments: [],
  recipients: null,
  directSupplierOrgId: "",
  directReason: "",
  directNote: "",
  link: null,
  ...over,
})

const text = () => document.body.textContent ?? ""
const buttons = () => Array.from(document.querySelectorAll("button"))
const byLabel = (label: string) => buttons().find((b) => (b.textContent || "").includes(label))

function mount(v: PublishValues, extra: Partial<React.ComponentProps<typeof EditorPublish>> = {}) {
  const onChange = jest.fn()
  const view = render(
    <EditorPublish
      values={v}
      onChange={onChange}
      publicReachCount={4}
      linesCount={2}
      favouriteName={null}
      recipientOptions={[]}
      recipientFacts={new Map()}
      selectedRecipients={[]}
      directPool={[{ orgId: "s1", name: "مورد الأفق", platform: true, favourite: false }]}
      matching={new Set<string>()}
      estimate={null}
      directCap={5000}
      firstDeadline="2026-10-22"
      deadlineHint="hint"
      onInvite={() => undefined}
      onUpload={() => undefined}
      uploading={false}
      onRemoveAttachment={() => undefined}
      showProblems={false}
      {...extra}
    />,
  )
  return { view, onChange }
}

describe("the link switch (ED-08, R-06)", () => {
  it("is on by default for «عام» and off for «خاص» and «إسناد مباشر», unless asked", () => {
    expect(linkOn(values())).toBe(true)
    expect(linkOn(values({ audience: "private" }))).toBe(false)
    expect(linkOn(values({ audience: "direct" }))).toBe(false)
    expect(linkOn(values({ audience: "private", link: true }))).toBe(true)
    expect(linkOn(values({ link: false }))).toBe(false)
  })

  it("the switch writes the choice; changing the audience returns to the default", () => {
    const { view, onChange } = mount(values({ audience: "private" }))
    const sw = document.querySelector('[role="switch"]') as HTMLElement
    expect(sw.getAttribute("aria-checked")).toBe("false")
    fireEvent.click(sw)
    expect(onChange).toHaveBeenCalledWith({ link: true })
    fireEvent.click(byLabel("عام")!)
    expect(onChange).toHaveBeenCalledWith({ audience: "public", link: null })
    view.unmount()
  })
})

describe("payment terms (ED-07)", () => {
  it("three chips set the stored rows; the pay-later chip only opens the explanation", async () => {
    const { view, onChange } = mount(values())
    fireEvent.click(byLabel("100% عند الاستلام")!)
    expect(onChange).toHaveBeenCalledWith({ terms: [{ pct: "100", days: "0" }], termsSet: true })
    fireEvent.click(byLabel("دفعة مقدّمة 30% والباقي بعد الاستلام")!)
    expect(onChange).toHaveBeenLastCalledWith({ terms: [{ pct: "30", days: "0" }, { pct: "70", days: "0" }], termsSet: true })
    const calls = onChange.mock.calls.length
    await act(async () => void fireEvent.click(byLabel("بالأجل عبر مدماك")!))
    expect(text()).toContain("الشراء بالأجل — قريباً")
    expect(onChange.mock.calls.length).toBe(calls)
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("the chip matching the rows is the one pressed", () => {
    const { view } = mount(values({ terms: [{ pct: "100", days: "30" }] }))
    expect(byLabel("100% · 30 يوماً بعد الفاتورة")!.getAttribute("aria-pressed")).toBe("true")
    expect(byLabel("100% عند الاستلام")!.getAttribute("aria-pressed")).toBe("false")
    view.unmount()
  })
})

describe("the deadline and the rest", () => {
  it("every audience, a direct award included, asks for the deadline; there is no title field", () => {
    const { view } = mount(values({ audience: "direct" }))
    expect(document.querySelector('input[type="date"]')).not.toBeNull()
    fireEvent.click(byLabel("خيارات أخرى")!)
    expect(text()).not.toContain("العنوان")
    expect(text()).toContain("الملاحظات والمرفقات")
    view.unmount()
  })
})

describe("the direct award (ED-06)", () => {
  it("under the cap it shows the estimate and asks no reason; no price field is typed by the buyer", () => {
    const { view } = mount(values({ audience: "direct" }), { estimate: { total: 1150, missing: 0 } })
    expect(text()).toContain("1,150")
    expect(text()).not.toContain("سبب الإسناد المباشر فوق السقف")
    expect(document.querySelectorAll('input[inputmode="decimal"]').length).toBe(0)
    view.unmount()
  })

  it("over the cap the four reasons appear; «سبب آخر» opens a field; the estimate names the rows without a past price", () => {
    const { view, onChange } = mount(values({ audience: "direct", directReason: "other" }), { estimate: { total: 11500, missing: 1 } })
    expect(text()).toContain("11,500")
    expect(text()).toContain("سبب الإسناد المباشر فوق السقف")
    expect(text()).toContain("فوقه: يُطلب السبب، ويعتمد المالك الأمر قبل إرساله.")
    for (const label of ["مورّد وحيد لهذه المادة", "عاجل لا يحتمل طلب عروض", "استكمال أمر سابق بسعره", "سبب آخر"]) expect(byLabel(label)).toBeDefined()
    expect(document.querySelector('input[placeholder="اكتب السبب"]')).not.toBeNull()
    fireEvent.click(byLabel("عاجل لا يحتمل طلب عروض")!)
    expect(onChange).toHaveBeenCalledWith({ directReason: "urgent" })
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })
})

describe("the review (ED-08)", () => {
  const model = (over: Partial<ReviewModel> = {}): ReviewModel => ({ lines: 3, subs: 2, groups: 1, audience: "public", reach: 9, favourite: null, perSub: [], privateCount: 0, directName: null, deadline: "2026-10-25", daysToDeadline: 3, pricing: "line", link: true, terms: "100%", delivery: "x", files: [], budget: null, noSpec: [], outside: [], unitDiffers: [], ...over })

  it("says whether the visitor link will be made", () => {
    const a = render(<EditorReview model={model()} fmtDay={(d) => d} />)
    expect(text()).toContain("رابط الزوار")
    expect(text()).toContain("يعمل حتى الموعد النهائي")
    a.unmount()
    const b = render(<EditorReview model={model({ audience: "private", link: false })} fmtDay={(d) => d} />)
    expect(text()).toContain("بلا رابط")
    b.unmount()
  })
})
