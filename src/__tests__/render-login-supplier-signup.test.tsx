jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("next/image", () => ({ __esModule: true, default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} /> }))
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }))
jest.mock("@/lib/loginHint", () => ({ fetchLoginHint: jest.fn(async () => null) }))
jest.mock("firebase/auth", () => ({
  GoogleAuthProvider: class {},
  signInWithEmailAndPassword: jest.fn(),
  signInWithPopup: jest.fn(),
  signInWithRedirect: jest.fn(),
  getRedirectResult: jest.fn(async () => null),
  sendPasswordResetEmail: jest.fn(),
  fetchSignInMethodsForEmail: jest.fn(async () => []),
  signInWithCustomToken: jest.fn(),
}))

/** The login page offers «ليس لديك حساب؟ سجّل مورّداً مجاناً» beside the contractor's demo request. */

import React from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { installDomShims, missingKeys, setLocale } from "@/test-utils/render-world"
import LoginPage from "@/app/[locale]/login/page"
import ar from "../../messages/ar.json"
import en from "../../messages/en.json"

installDomShims()
jest.setTimeout(30_000)

type Login = { Auth: { Login: Record<string, string> } }
const words = (locale: "ar" | "en") => (locale === "ar" ? (ar as unknown as Login) : (en as unknown as Login)).Auth.Login

const flush = async () => {
  for (let i = 0; i < 3; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

beforeEach(() => missingKeys.clear())

describe.each(["ar", "en"] as const)("the login page in %s", (locale) => {
  it("offers the free supplier sign-up first and keeps the contractor's demo request", async () => {
    setLocale(locale)
    render(<LoginPage />)
    await flush()
    const t = words(locale)
    const signup = screen.getByRole("link", { name: t.supplier_signup })
    expect(signup.getAttribute("href")).toBe("/supplier-signup")
    expect(signup.parentElement?.textContent).toBe(`${t.no_account} ${t.supplier_signup} ${t.no_account_or} ${t.create_account}`)
    expect(screen.getByRole("button", { name: t.create_account })).toBeTruthy()
    expect([...missingKeys]).toEqual([])
  })

  it("the contractor's demo request still opens the Join form", async () => {
    setLocale(locale)
    render(<LoginPage />)
    await flush()
    fireEvent.click(screen.getByRole("button", { name: words(locale).create_account }))
    expect(screen.getByRole("dialog")).toBeTruthy()
  })
})
