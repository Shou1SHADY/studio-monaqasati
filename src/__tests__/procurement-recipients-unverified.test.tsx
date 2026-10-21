/**
 * PUR-05 (spec p.1): a supplier who joined through OUR invitation is «غير موثّق» until his file is complete — yet
 * «خاص» reaches him: he may be picked, with the tag. «حدّد الكل» does not tick him for us; an expired CR still blocks.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)

import React from "react"
import { fireEvent, render } from "@testing-library/react"
import { missingKeys } from "@/test-utils/render-world"
import { SupplierRecipientsPicker } from "@/components/contractor/SupplierRecipientsPicker"

const options = [
  { orgId: "a", name: "مصنع الجودة", isFavorite: true },
  { orgId: "b", name: "مصنع الشرق للحديد", isFavorite: false },
  { orgId: "c", name: "ورشة النخبة", isFavorite: false },
]
const facts = new Map([
  ["a", { onTime: 90, crExpired: false, block: null }],
  ["b", { onTime: null, crExpired: false, block: null, unverified: true }],
  ["c", { onTime: null, crExpired: true, block: "cr_expired" as const }],
])

describe("the private recipients picker", () => {
  it("shows the unverified supplier with his tag, lets him be ticked, and keeps the expired CR blocked", () => {
    const onChange = jest.fn()
    const view = render(<SupplierRecipientsPicker options={options} selected={["a"]} onChange={onChange} facts={facts} />)
    expect(view.container.textContent).toContain("غير موثّق")
    const boxes = Array.from(view.container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[]
    expect(boxes.map((b) => b.disabled)).toEqual([false, false, true])
    fireEvent.click(boxes[1])
    expect(onChange).toHaveBeenCalledWith(["a", "b"])
    expect([...missingKeys]).toEqual([])
  })

  it("«حدّد الكل» ticks the verified ones only: an unverified supplier is picked by hand", () => {
    const onChange = jest.fn()
    const view = render(<SupplierRecipientsPicker options={options} selected={[]} onChange={onChange} facts={facts} />)
    fireEvent.click(Array.from(view.container.querySelectorAll("button")).find((b) => (b.textContent || "").includes("تحديد"))!)
    expect(onChange).toHaveBeenCalledWith(["a"])
  })
})
