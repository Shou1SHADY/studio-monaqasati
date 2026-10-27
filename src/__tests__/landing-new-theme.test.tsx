import React from "react"
import { render } from "@testing-library/react"
import { storedLandingTheme } from "@/hooks/useLandingTheme"
import { DemoRequestSection } from "@/components/DemoRequestSection"

jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)

describe("the new landing's theme", () => {
  it("is light unless the visitor chose dark", () => {
    expect(storedLandingTheme(null)).toBe("light")
    expect(storedLandingTheme("light")).toBe("light")
    expect(storedLandingTheme("anything")).toBe("light")
    expect(storedLandingTheme("dark")).toBe("dark")
  })
})

describe("the shared demo form", () => {
  const sectionClass = (ui: React.ReactElement) => render(ui).container.querySelector("section#demo")?.className ?? ""

  it("keeps the current landing's dark look by default", () => {
    const cls = sectionClass(<DemoRequestSection />)
    expect(cls).toContain("bg-[#030712]")
    expect(cls).not.toContain("dark:")
  })

  it("is light first, with dark variants, on the new landing", () => {
    const cls = sectionClass(<DemoRequestSection tone="auto" />)
    expect(cls).toContain("bg-slate-50")
    expect(cls).toContain("dark:bg-slate-950")
    expect(cls).not.toContain("bg-[#030712]")
  })
})
