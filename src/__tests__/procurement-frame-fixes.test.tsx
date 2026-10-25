/**
 * The UI review's frame findings, pinned:
 *  - Radix primitives take the page's direction from ONE provider at the locale layout (review 1 #1 — the RFQ page's Tabs
 *    stamped `dir="ltr"` on an Arabic page); an explicit `dir` still wins.
 *  - `.rtl-flip` mirrors on a right-to-left page only (review 3 #1), and no icon fights it with a rotate utility.
 *  - An RFQ without a number shows no number chip (review 1 #2), and Today's row does not say its title twice.
 *  - `/contractor/rfqs/chats` forwards to `/contractor/chats`, the sidebar's address (review 3 #3).
 */

jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("@/i18n/routing", () => ({ redirect: jest.fn() }))

import fs from "fs"
import path from "path"
import React from "react"
import { render } from "@testing-library/react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RadixDirection } from "@/components/layout/RadixDirection"
import { RfqNumber } from "@/components/procurement/RfqCard"
import { ModuleHeader } from "@/components/module-ui/ModuleHeader"
import { intlMock, setLocale } from "@/test-utils/render-world"
import { redirect } from "@/i18n/routing"
import ProcurementChatsRedirect from "@/app/[locale]/(contractor)/contractor/rfqs/chats/page"

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8")

function TwoTabs({ dir }: { dir?: "ltr" | "rtl" }) {
  return (
    <Tabs defaultValue="offers" dir={dir} data-testid="tabs">
      <TabsList>
        <TabsTrigger value="offers">offers</TabsTrigger>
        <TabsTrigger value="details">details</TabsTrigger>
      </TabsList>
      <TabsContent value="offers">body</TabsContent>
    </Tabs>
  )
}

describe("Radix takes the page's direction (review 1 #1)", () => {
  it("an Arabic page's Tabs and RadioGroup are right-to-left without a dir prop", () => {
    const { getByTestId, container } = render(
      <RadixDirection locale="ar">
        <TwoTabs />
        <RadioGroupPrimitive.Root defaultValue="a" aria-label="g">
          <RadioGroupPrimitive.Item value="a" />
        </RadioGroupPrimitive.Root>
      </RadixDirection>,
    )
    expect(getByTestId("tabs").getAttribute("dir")).toBe("rtl")
    expect(container.querySelector('[role="radiogroup"]')?.getAttribute("dir")).toBe("rtl")
  })

  it("an English page's stay left-to-right, and an explicit dir prop still wins", () => {
    const en = render(
      <RadixDirection locale="en">
        <TwoTabs />
      </RadixDirection>,
    )
    expect(en.getByTestId("tabs").getAttribute("dir")).toBe("ltr")
    en.unmount()
    const forced = render(
      <RadixDirection locale="ar">
        <TwoTabs dir="ltr" />
      </RadixDirection>,
    )
    expect(forced.getByTestId("tabs").getAttribute("dir")).toBe("ltr")
  })

  it("the locale layout wraps every page in the provider", () => {
    const layout = read("src/app/[locale]/layout.tsx")
    expect(layout).toMatch(/<RadixDirection locale=\{locale\}>[\s\S]*\{children\}[\s\S]*<\/RadixDirection>/)
  })
})

describe(".rtl-flip mirrors on a right-to-left page only (review 3 #1)", () => {
  it("the rule is scoped to [dir=rtl]", () => {
    const css = read("src/app/globals.css")
    expect(css).toMatch(/\[dir="rtl"\] \.rtl-flip \{\s*transform: scaleX\(-1\);/)
    expect(css).not.toMatch(/^\.rtl-flip\s*\{/m)
  })

  it("no icon combines it with a rotate utility (which the scoped rule would now override in Arabic)", () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name)
        if (fs.statSync(full).isDirectory()) {
          if (name !== "__tests__") walk(full)
        } else if (/\.tsx?$/.test(name)) {
          for (const m of fs.readFileSync(full, "utf8").matchAll(/className=(?:"([^"]*)"|\{[^}]*\})/g)) {
            const cls = m[0]
            if (cls.includes("rtl-flip") && /\brotate-|scale-x/.test(cls)) offenders.push(`${path.relative(ROOT, full)}: ${cls}`)
          }
        }
      }
    }
    walk(path.join(ROOT, "src"))
    expect(offenders).toEqual([])
  })

  it("the back arrows that relied on the old always-flip now draw the LTR 'back' icon", () => {
    for (const file of ["src/components/procurement/ProcurementReports.tsx", "src/components/procurement/rfq/LinkPreview.tsx", "src/components/hr/HrReportsView.tsx"]) {
      const src = read(file)
      expect(src).not.toMatch(/<ArrowRight[^>]*rtl-flip/)
      expect(src).toMatch(/<ArrowLeft[^>]*rtl-flip/)
    }
    expect(read("src/components/module-ui/ModuleHeader.tsx")).toMatch(/<ChevronRight size=\{12\} className="rtl-flip"/)
  })
})

describe("an RFQ without a number (review 1 #2)", () => {
  beforeEach(() => setLocale("ar"))

  it("shows no number chip at all — never «RFQ-—»", () => {
    const none = render(<RfqNumber rfq={{ id: "r1", rfqNumber: null }} />)
    expect(none.container.innerHTML).toBe("")
    expect(none.container.textContent).not.toContain("RFQ-")
    none.unmount()
    const numbered = render(<RfqNumber rfq={{ id: "r1", rfqNumber: "RFQ-2026/011" }} />)
    expect(numbered.getByTestId("rfq-number").textContent).toBe("RFQ-2026/011")
  })

  it("Today's rows name it by the title once", () => {
    for (const locale of ["ar", "en"] as const) {
      setLocale(locale)
      const t = intlMock.useTranslations("Portal.ProcToday")
      const subs = [
        t("task.rfq_no_live.sub", { title: "حديد", hasTitle: 0 }),
        t("task.rfq_award.sub", { title: "حديد", hasTitle: 0, date: "2026-09-22", when: "today", n: 0 }),
        t("task.rfq_can_award.sub", { title: "حديد", hasTitle: 0, hasLowest: 1, lowest: 100, vat: 1, date: "2026-09-25" }),
        t("task.rfq_query.sub", { title: "حديد", hasTitle: 0, closed: 0, date: "2026-09-25", question: "q", more: 0 }),
      ]
      for (const s of subs) {
        expect(s).not.toContain("حديد")
        expect(s).not.toMatch(/^\s*·/)
        expect(s).not.toContain("MISSING")
      }
      expect(t("task.rfq_can_award.sub", { title: "حديد", hasTitle: 1, hasLowest: 1, lowest: 100, vat: 1, date: "2026-09-25" })).toMatch(/^حديد · /)
    }
  })
})

describe("ModuleHeader on a phone (review 3 #19)", () => {
  it("a KPI note wraps on a phone instead of being cut, and stays one line from sm up", () => {
    const { getByText } = render(<ModuleHeader icon={() => null} title="t" kpis={[{ id: "a", label: "طلبات", value: "13", note: "13 في تخصصك هذا الأسبوع" }]} />)
    const note = getByText("13 في تخصصك هذا الأسبوع")
    expect(note.className).toContain("sm:truncate")
    expect(note.className.split(/\s+/)).not.toContain("truncate")
  })
})

describe("/contractor/rfqs/chats is not the RFQs tab (review 3 #3)", () => {
  it("forwards to the sidebar's /contractor/chats, its query with it", async () => {
    await ProcurementChatsRedirect({ params: Promise.resolve({ locale: "ar" }), searchParams: Promise.resolve({ po: "po1" }) })
    expect(redirect).toHaveBeenLastCalledWith({ href: "/contractor/chats?po=po1", locale: "ar" })
    await ProcurementChatsRedirect({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({}) })
    expect(redirect).toHaveBeenLastCalledWith({ href: "/contractor/chats", locale: "en" })
  })
})
