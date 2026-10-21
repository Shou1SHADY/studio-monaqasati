/**
 * Procurement 2.0, G-11 / NAV-02 — ONE name per page: the rail's tab and the sidebar's entry read the same words in both
 * languages, the English names are the prototype's, and the sidebar carries the guide, the chats and the two «قريباً» entries.
 */

import fs from "fs"
import path from "path"
import { CONTRACTOR_COMMUNICATION_SECTION, CONTRACTOR_COMPONENTS } from "@/lib/portal-components"
import { PROC_TABS } from "@/lib/procurement/shell"
import { NAV_BADGE_HREFS } from "@/lib/procurement/nav-badges"

type Messages = { Portal: { Sidebar: Record<string, string>; Shared: Record<string, string> } }
const load = (l: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", `${l}.json`), "utf8")) as Messages
const MESSAGES = { ar: load("ar"), en: load("en") }

const procurement = CONTRACTOR_COMPONENTS.find((c) => c.id === "procurement")!
const mainItems = procurement.sections[0].items

describe("G-11: the rail and the sidebar say the same thing", () => {
  for (const locale of ["ar", "en"] as const) {
    it.each(PROC_TABS.map((t) => [t.id, t.railKey, t.labelKey]))(`${locale}: %s — rail %s = sidebar %s`, (_id, railKey, labelKey) => {
      const m = MESSAGES[locale].Portal
      expect(m.Shared[railKey as string]).toBeTruthy()
      expect(m.Shared[railKey as string]).toBe(m.Sidebar[labelKey as string])
    })
  }

  it("the sidebar's Procurement items are the rail's eight pages, in the rail's order, then the two «قريباً» entries", () => {
    expect(mainItems.slice(0, 8).map((i) => [i.titleKey, i.href])).toEqual(PROC_TABS.map((t) => [t.labelKey, t.href]))
    expect(mainItems.slice(8).map((i) => [i.titleKey, i.comingSoon])).toEqual([
      ["contractor_catalog", true],
      ["contractor_bnpl", true],
    ])
  })

  it("the English names are the prototype's", () => {
    const sidebar = MESSAGES.en.Portal.Sidebar
    expect(sidebar.contractor_purchase_requests).toBe("Incoming requests")
    expect(sidebar.contractor_goods_received).toBe("Receipts")
    expect(sidebar.contractor_chats).toBe("My chats")
    expect(sidebar.contractor_team_chat).toBe("Team chat")
    expect(sidebar.contractor_catalog).toBe("Materials market")
    expect(sidebar.contractor_bnpl).toBe("Buy now, pay later")
    expect(sidebar.contractor_proc_guide).toBe("How Procurement works")
    expect(sidebar.admin_contractors).toBe("Contractors & packages")
    expect(sidebar.admin_pipeline).toBe("Pipeline & contract")
  })

  it("the Arabic names are the prototype's", () => {
    const sidebar = MESSAGES.ar.Portal.Sidebar
    expect([sidebar.contractor_proc_today, sidebar.contractor_purchase_requests, sidebar.contractor_rfqs, sidebar.contractor_purchase_orders, sidebar.contractor_goods_received, sidebar.contractor_browse_suppliers, sidebar.contractor_proc_reports, sidebar.contractor_proc_settings]).toEqual([
      "اليوم",
      "طلبات الشراء الواردة",
      "طلبات العروض",
      "أوامر الشراء",
      "سندات الاستلام",
      "الموردون",
      "التقارير",
      "الإعدادات",
    ])
    expect([sidebar.contractor_catalog, sidebar.contractor_bnpl, sidebar.contractor_proc_guide, sidebar.section_guide, sidebar.contractor_chats]).toEqual(["سوق المواد", "الشراء بالأجل", "كيف تعمل المشتريات؟", "الدليل", "محادثاتي"])
    expect(sidebar.admin_contractors).toBe("المقاولون والباقات")
    expect(sidebar.admin_pipeline).toBe("المسار والعقود")
  })
})

describe("NAV-02: the guide, the chats, the coming-soon entries", () => {
  it("«الدليل» is its own section holding the one guide page, opened by whoever opens Today", () => {
    const guide = procurement.sections[1]
    expect(guide.labelKey).toBe("section_guide")
    expect(guide.items).toHaveLength(1)
    expect(guide.items[0]).toMatchObject({ titleKey: "contractor_proc_guide", href: "/contractor/rfqs/guide" })
    expect(guide.items[0].requiredAnyPermission).toEqual(mainItems[0].requiredAnyPermission)
  })

  it("the two unreleased entries are dimmed; pay-later opens its dialog, the market is plain text", () => {
    const [market, bnpl] = mainItems.slice(8)
    expect(market.comingSoon).toBe(true)
    expect(market.soonModal).toBeUndefined()
    expect(bnpl).toMatchObject({ comingSoon: true, soonModal: "bnpl" })
  })

  it("«محادثاتي» sits under the communication section for every member", () => {
    const chats = CONTRACTOR_COMMUNICATION_SECTION.items.find((i) => i.titleKey === "contractor_chats")
    expect(chats).toMatchObject({ href: "/contractor/chats" })
    expect(chats?.requiredPermission).toBeUndefined()
    expect(chats?.requiredAnyPermission).toBeUndefined()
  })
})

describe("NAV-02: the counts beside the entries", () => {
  it("name the same addresses as the rail's tabs", () => {
    const href = (id: string) => PROC_TABS.find((t) => t.id === id)?.href
    expect(NAV_BADGE_HREFS).toEqual({ requests: href("requests"), rfqs: href("rfqs"), receipts: href("receipts") })
  })
})
