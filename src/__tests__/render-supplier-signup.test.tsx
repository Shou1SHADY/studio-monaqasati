jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("firebase/auth", () => ({ signInWithCustomToken: jest.fn(async () => ({})) }))

/**
 * /supplier-signup — the public, open door for a supplier: what the free account gives, the next step said honestly
 * (documents for the admin's approval, required before the first quotation), and a sign-up that goes mobile → code →
 * name + company → signed in and sent to /supplier.
 */

import React from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { signInWithCustomToken } from "firebase/auth"
import { installDomShims, missingKeys, pushed, setLocale } from "@/test-utils/render-world"
import { SupplierSignupContent } from "@/app/[locale]/supplier-signup/SupplierSignupContent"
import ar from "../../messages/ar.json"
import en from "../../messages/en.json"

installDomShims()
jest.setTimeout(30_000)

type Bundle = { SupplierSignup: Record<string, string>; SupplierFree: Record<string, string> }
const words = (locale: "ar" | "en") => (locale === "ar" ? (ar as unknown as Bundle) : (en as unknown as Bundle))

const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

type Call = { url: string; body: Record<string, unknown> }
let calls: Call[] = []
const answers: Record<string, unknown[]> = {}
const stubFetch = () => {
  calls = []
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const key = String(url)
    calls.push({ url: key, body: JSON.parse(String(init?.body ?? "{}")) })
    const next = answers[key]?.shift()
    return { ok: true, status: 200, json: async () => next } as Response
  }) as unknown as typeof fetch
}

beforeEach(() => {
  setLocale("ar")
  missingKeys.clear()
  pushed.length = 0
  ;(signInWithCustomToken as jest.Mock).mockClear()
  answers["/api/supplier-free/phone/code"] = [{ success: true, data: { challengeId: "challenge-12345", phoneMasked: "+966 5** *** 567", sent: true } }]
  answers["/api/supplier-free/phone/verify"] = []
  stubFetch()
})

describe.each(["ar", "en"] as const)("the page in %s", (locale) => {
  it("says what the free account gives and what comes next, with every word in the message files", () => {
    setLocale(locale)
    const t = words(locale).SupplierSignup
    render(<SupplierSignupContent />)
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(t.title)
    for (const k of ["g1_t", "g2_t", "g3_t", "g4_t", "g5_t", "s1_t", "s2_t", "s3_t", "approvalTitle"]) expect(screen.getByText(t[k])).toBeTruthy()
    expect(screen.getByText(t.approvalBody)).toBeTruthy()
    expect([...missingKeys]).toEqual([])
  })

  it("links the legal-documents tab of the profile, the contractor's demo and the terms, and no supplier link goes to the demo", () => {
    setLocale(locale)
    const t = words(locale).SupplierSignup
    render(<SupplierSignupContent />)
    expect(screen.getByRole("link", { name: new RegExp(t.approvalLink.slice(0, 12)) }).getAttribute("href")).toBe("/supplier/profile?tab=legal")
    expect(screen.getByRole("link", { name: t.contractorLink }).getAttribute("href")).toBe("/#demo")
    expect(screen.getByRole("link", { name: t.terms }).getAttribute("href")).toBe("/terms")
    expect(screen.getByRole("link", { name: t.privacy }).getAttribute("href")).toBe("/privacy")
    const demoLinks = [...document.querySelectorAll('a[href*="demo"]')]
    expect(demoLinks.map((a) => a.textContent)).toEqual([t.contractorLink])
  })
})

describe("the sign-up", () => {
  const open = async () => {
    render(<SupplierSignupContent />)
    fireEvent.click(screen.getByRole("button", { name: new RegExp(words("ar").SupplierSignup.cta) }))
    await flush()
  }

  it("opens the mobile sign-up from the call to action", async () => {
    await open()
    expect(screen.getByText(words("ar").SupplierFree.phTitleUp)).toBeTruthy()
    expect(document.getElementById("ph-mobile")).toBeTruthy()
  })

  it("mobile → code → name and company → signed in with the token and sent to /supplier, as a self sign-up", async () => {
    answers["/api/supplier-free/phone/verify"] = [{ success: true, data: { needsProfile: true } }, { success: true, data: { token: "custom-token", created: true, claimed: 0 } }]
    await open()
    const f = words("ar").SupplierFree
    fireEvent.change(document.getElementById("ph-mobile") as HTMLInputElement, { target: { value: "0551234567" } })
    fireEvent.click(screen.getByRole("button", { name: f.phSend }))
    await flush()
    expect(calls[0]).toEqual({ url: "/api/supplier-free/phone/code", body: { phone: "0551234567", locale: "ar" } })

    fireEvent.change(document.getElementById("ph-code") as HTMLInputElement, { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("button", { name: f.phContinue }))
    await flush()
    expect(screen.getByText(f.phNew)).toBeTruthy()
    expect(signInWithCustomToken).not.toHaveBeenCalled()

    fireEvent.change(document.getElementById("ph-name") as HTMLInputElement, { target: { value: "سامي العتيبي" } })
    fireEvent.change(document.getElementById("ph-company") as HTMLInputElement, { target: { value: "مؤسسة النور" } })
    fireEvent.click(screen.getByRole("button", { name: f.phCreate }))
    await waitFor(() => expect(signInWithCustomToken).toHaveBeenCalledTimes(1))
    expect((signInWithCustomToken as jest.Mock).mock.calls[0][1]).toBe("custom-token")
    expect(calls.at(-1)).toEqual({ url: "/api/supplier-free/phone/verify", body: { challengeId: "challenge-12345", phone: "0551234567", code: "123456", name: "سامي العتيبي", company: "مؤسسة النور", source: "self" } })
    await waitFor(() => expect(pushed).toContain("/supplier"))
  })

  it("a mobile that already has an account is signed in at once and sent to /supplier", async () => {
    answers["/api/supplier-free/phone/verify"] = [{ success: true, data: { token: "existing-token", created: false, claimed: 0 } }]
    await open()
    const f = words("ar").SupplierFree
    fireEvent.change(document.getElementById("ph-mobile") as HTMLInputElement, { target: { value: "0551234567" } })
    fireEvent.click(screen.getByRole("button", { name: f.phSend }))
    await flush()
    fireEvent.change(document.getElementById("ph-code") as HTMLInputElement, { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("button", { name: f.phContinue }))
    await waitFor(() => expect(signInWithCustomToken).toHaveBeenCalledWith(expect.anything(), "existing-token"))
    await waitFor(() => expect(pushed).toContain("/supplier"))
  })

  it("a contractor's or admin's mobile gets the refusal message and stays on the page", async () => {
    answers["/api/supplier-free/phone/verify"] = [{ error: true, code: "WRONG_ROLE" }]
    await open()
    const f = words("ar").SupplierFree
    fireEvent.change(document.getElementById("ph-mobile") as HTMLInputElement, { target: { value: "0551234567" } })
    fireEvent.click(screen.getByRole("button", { name: f.phSend }))
    await flush()
    fireEvent.change(document.getElementById("ph-code") as HTMLInputElement, { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("button", { name: f.phContinue }))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(f.phErrRole))
    expect(signInWithCustomToken).not.toHaveBeenCalled()
    expect(pushed).not.toContain("/supplier")
  })
})
