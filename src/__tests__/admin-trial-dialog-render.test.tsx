/**
 * The admin opens a contractor as a trial from the request: a switch in the account dialog, a length that defaults to two
 * weeks, and the length goes to the server with the account. A supplier is never offered one. Rendered in Arabic.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)

import React from "react"
import { act, fireEvent, render } from "@testing-library/react"
import { resetFakeDb } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setSignedIn } from "@/test-utils/render-world"
import { CreateAccountDialog } from "@/components/admin/CreateAccountDialog"

installDomShims()
jest.setTimeout(30_000)

const fetchMock = jest.fn(async (_url: string, _init?: { body?: string }) => ({ ok: true, json: async () => ({ success: true, data: { uid: "new1" } }) }))

beforeAll(() => {
  ;(global as unknown as { fetch: unknown }).fetch = fetchMock
})
beforeEach(() => {
  resetFakeDb()
  setSignedIn("admin1")
  missingKeys.clear()
  fetchMock.mockClear()
})

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const text = () => document.body.textContent ?? ""
const lead = (kind: "contractor" | "supplier") => ({ id: "l1", source: "demo" as const, name: "فهد", company: "شركة الشرق", email: "f@x.sa", phone: "0555", kind })
const trialSwitch = () => document.querySelector<HTMLButtonElement>("#acc-trial")
const daysInput = () => document.querySelector<HTMLInputElement>("#acc-trial-days")
const createBody = (): Record<string, unknown> => {
  const call = fetchMock.mock.calls.find(([url]) => url === "/api/admin/users/create")
  expect(call).toBeDefined()
  return JSON.parse(call?.[1]?.body ?? "{}") as Record<string, unknown>
}
const submit = async () => {
  const button = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("إنشاء حساب") && !b.disabled)
  expect(button).toBeDefined()
  await act(async () => void fireEvent.click(button as HTMLButtonElement))
  await flush()
}

describe("opening a contractor as a trial", () => {
  it("offers the switch for a contractor, with no length until it is on, then two weeks", async () => {
    render(<CreateAccountDialog lead={lead("contractor")} onOpenChange={jest.fn()} />)
    await flush()
    expect(text()).toContain("افتح الحساب كتجربة")
    expect(trialSwitch()).not.toBeNull()
    expect(daysInput()).toBeNull()
    await act(async () => void fireEvent.click(trialSwitch() as HTMLButtonElement))
    expect(daysInput()?.value).toBe("14")
    expect(Array.from(missingKeys)).toEqual([])
  })

  it("sends the length with the account, as typed", async () => {
    render(<CreateAccountDialog lead={lead("contractor")} onOpenChange={jest.fn()} />)
    await flush()
    await act(async () => void fireEvent.click(trialSwitch() as HTMLButtonElement))
    await act(async () => void fireEvent.change(daysInput() as HTMLInputElement, { target: { value: "30" } }))
    await submit()
    const body = createBody()
    expect(body).toMatchObject({ role: "Contractor", trialDays: 30 })
  })

  it("an account opened without the switch carries no trial", async () => {
    render(<CreateAccountDialog lead={lead("contractor")} onOpenChange={jest.fn()} />)
    await flush()
    await submit()
    const body = createBody()
    expect(body).not.toHaveProperty("trialDays")
  })

  it("will not create the account while the length is empty or out of range", async () => {
    render(<CreateAccountDialog lead={lead("contractor")} onOpenChange={jest.fn()} />)
    await flush()
    await act(async () => void fireEvent.click(trialSwitch() as HTMLButtonElement))
    for (const bad of ["", "0", "400"]) {
      await act(async () => void fireEvent.change(daysInput() as HTMLInputElement, { target: { value: bad } }))
      const create = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("إنشاء حساب"))
      expect(create).toBeDefined()
      expect((create as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it("a supplier is not offered the contractor's trial", async () => {
    render(<CreateAccountDialog lead={lead("supplier")} onOpenChange={jest.fn()} />)
    await flush()
    expect(trialSwitch()).toBeNull()
  })

  it("a supplier can be given the paid portal for a week, as a trial that starts with the account", async () => {
    render(<CreateAccountDialog lead={lead("supplier")} onOpenChange={jest.fn()} />)
    await flush()
    const paid = document.querySelector<HTMLButtonElement>("#acc-paid-trial")
    expect(paid).not.toBeNull()
    expect(text()).toContain("امنحها الباقة الكاملة كتجربة")
    expect(document.querySelector("#acc-paid-trial-days")).toBeNull()
    await act(async () => void fireEvent.click(paid as HTMLButtonElement))
    expect((document.querySelector("#acc-paid-trial-days") as HTMLInputElement).value).toBe("7")
    expect(Array.from(missingKeys)).toEqual([])
  })

  it("a contractor is not offered the supplier's paid trial", async () => {
    render(<CreateAccountDialog lead={lead("contractor")} onOpenChange={jest.fn()} />)
    await flush()
    expect(document.querySelector("#acc-paid-trial")).toBeNull()
  })
})
