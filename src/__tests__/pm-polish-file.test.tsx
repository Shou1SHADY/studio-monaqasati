/**
 * PM 1.1 phase 2 — the File / Supply / Team / portfolio panels polished (a5-ux UX-08, 11, 12, 14, 15, 16, 17, 20, 25;
 * portal audit CP-01).
 *
 * Pinned here: no hand-made `<table>` with a fixed `min-w` left in these panels (they are module-ui `DataTable`s), no
 * bordered subtitle band under a Panel header (the subtitle is the Panel's `description`), every grid has a bounded
 * base track; the consultant portal is its own File screen and the decisions about it open there; and the legacy
 * project's head folds its secondary acts behind «…» from three acts, as the PM head does.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => {
  const nav = jest.requireActual("@/test-utils/render-world").navigationMock
  return { ...nav, useParams: () => ({ id: "P1", locale: "ar" }) }
})
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/layout/portal-layout", () => jest.requireActual("@/test-utils/render-world").portalLayoutMock)

import fs from "fs"
import path from "path"
import React from "react"
import { act, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, messages, missingKeys, setPathname, setSignedIn } from "@/test-utils/render-world"
import ProjectPage from "@/app/[locale]/(contractor)/contractor/projects/[id]/page"
import type { PmAccess } from "@/hooks/usePmAccess"
import { effectiveDuties, pmCan, pmCeiling, pmRefusal, type PmContext } from "@/lib/pm/access"
import { todayDay } from "@/lib/pm/format"
import { sectionsForKind } from "@/lib/pm/sections"
import { ProjectPurchasingPanel } from "@/components/pm/ProjectPurchasingPanel"
import { PlantPanel } from "@/components/pm/PlantPanel"
import { ConsultantPortalPanel } from "@/components/pm/ConsultantPortalPanel"

installDomShims()
jest.setTimeout(60_000)

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8")
const PM = "src/components/pm"
const FILES = [
  "SupplyRequestsPanel", "SupplyDialogs", "ProjectStorePanel", "ProjectPurchasingPanel", "DirectPurchasesPanel",
  "PlantPanel", "PlantRequestsPanel", "SubcontractorsPanel", "SubCustodyDialogs",
  "PmFilePanels", "DocumentsPanel", "CorrespondencePanel", "ConsultantPortalPanel", "ConsultantReply", "ConsultantRepDialog", "PmAttachments",
  "PmTeamPanel", "AssignSeatDialog", "RemoveSeatDialog", "PmSeatChip",
  "SectionsPanel", "PmSelfApprovalSetting",
  "HandoverInbox", "AcceptHandoverWizard", "ReturnHandoverDialog", "ReassignHandoverDialog", "AdoptProjectDialog",
  "PmProjectCard", "PmPortfolioViews",
].map((n) => `${PM}/${n}.tsx`)

const AR = messages("ar") as Record<string, Record<string, unknown>>
const msg = (ns: string, key: string): string => {
  const v = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], (AR.Portal as Record<string, unknown>)[ns])
  if (typeof v !== "string") throw new Error(`no message Portal.${ns}.${key}`)
  return v
}

/** Why a grid's class list can grow wider than its container (pm-frame-390's rule), or null. */
function unbounded(cls: string[]): string | null {
  const responsive = cls.filter((c) => /^(sm|md|lg|xl|2xl):grid-cols-/.test(c))
  if (responsive.length && !cls.some((c) => /^grid-cols-/.test(c))) return "no base track"
  for (const c of cls.filter((x) => /grid-cols-\[/.test(x))) {
    const tracks = c.slice(c.indexOf("[") + 1, c.lastIndexOf("]")).split(/_(?![^(]*\))/)
    if (tracks.some((t) => /fr/.test(t) && !/^minmax\(0,/.test(t))) return `bare fr track in ${c}`
  }
  return null
}

describe("the panels' source keeps the phase-2 grammar", () => {
  it("no hand-made table with a fixed min-w is left (UX-11/12)", () => {
    const offenders = FILES.filter((f) => /<table\b/.test(read(f)) || /<Table\b/.test(read(f)) || /<table[^>]*min-w-\[/.test(read(f)))
    expect(offenders).toEqual([])
  })

  it("the tables that were hand-made are module-ui DataTables now", () => {
    for (const f of ["ProjectPurchasingPanel", "SubcontractorsPanel", "PmPortfolioViews", "AcceptHandoverWizard"]) expect({ f, dataTable: /<DataTable\b/.test(read(`${PM}/${f}.tsx`)) }).toEqual({ f, dataTable: true })
  })

  it("no bordered subtitle band under a Panel header — the subtitle is the Panel's description (UX-14)", () => {
    const offenders = FILES.filter((f) => /<p className="border-b px-4 py-2 text-xs text-muted-foreground"/.test(read(f)) || /<p className="(?:-mt-1 )?mb-[234] text-xs text-muted-foreground">\{t\("[a-z_.]*sub/.test(read(f)))
    expect(offenders).toEqual([])
  })

  it("every grid has a bounded base track (UX-08/09)", () => {
    const offenders: string[] = []
    for (const f of FILES)
      for (const m of read(f).matchAll(/className="([^"]*\bgrid\b[^"]*)"/g)) {
        const why = unbounded(m[1].split(/\s+/))
        if (why) offenders.push(`${f}: ${why} — ${m[1]}`)
      }
    expect(offenders).toEqual([])
  })

  it("the panels' empty states inside a Panel are bare (UX-17)", () => {
    for (const f of ["SupplyRequestsPanel", "ProjectStorePanel", "ProjectPurchasingPanel", "DocumentsPanel", "CorrespondencePanel", "SubcontractorsPanel"])
      expect({ f, framed: (read(`${PM}/${f}.tsx`).match(/<EmptyState (?![^>]*\bbare\b)/g) ?? []).length }).toEqual({ f, framed: 0 })
  })
})

// ---------------------------------------------------------------------------
// Rendered
// ---------------------------------------------------------------------------

const owner: PmContext = { ceiling: pmCeiling({ owner: true, permissions: [] }), seat: null, archived: false }
const accessOf = (ctx: PmContext): PmAccess => ({
  ctx,
  uid: "own",
  isLoading: false,
  duties: effectiveDuties(ctx.ceiling, ctx.seat),
  allowed: (a) => pmRefusal(ctx, a) === null,
  refusal: (a) => pmRefusal(ctx, a),
  has: (k) => pmCan(ctx, k),
})

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

const panelTitled = (title: string) => Array.from(document.querySelectorAll("section h3")).find((h) => (h.textContent ?? "").includes(title))?.closest("section") ?? null
const descriptionOf = (section: Element | null) => section?.querySelector("header [data-panel-description]")?.textContent ?? null

describe("panels rendered", () => {
  beforeEach(() => {
    resetFakeDb()
    setSignedIn("own")
    seed("purchaseOrders/po1", {
      organizationId: "own",
      projectId: "P1",
      docNumber: "PO-2026/014",
      status: "sent",
      supplierName: "مورّد",
      vatRate: 0.15,
      createdAt: "2026-09-01T09:00:00Z",
      lines: [{ name: "حديد", unit: "طن", quantity: 10, unitPrice: 3_000, accepted: 0, cancelled: 0, rejected: 0, held: 0 }],
    })
  })

  it("project purchasing: the orders are a DataTable (caption, sticky head), Status shown", () => {
    const { container } = render(<ProjectPurchasingPanel projectId="P1" orgId="own" items={[]} startOn={null} access={accessOf(owner)} withPrices={false} />)
    const table = container.querySelector("table")
    expect(table).not.toBeNull()
    expect(table!.querySelector("caption")?.textContent).toBe(msg("PM", "po.title"))
    expect(table!.querySelector("thead")?.className).toContain("sticky")
    expect(table!.className).not.toMatch(/min-w-/)
    expect(container.textContent).toContain(msg("PM", "po.col.status"))
  })

  it("plant: the subtitle sits in the panel head", () => {
    render(<PlantPanel projectId="P1" orgId="own" access={accessOf(owner)} actor={{ uid: "own", name: "Owner" }} />)
    expect(descriptionOf(panelTitled(msg("PM", "plant.title")))).toBe(msg("PM", "plant.sub"))
  })

  it("the consultant portal reads the project's letters itself on its own screen, its subtitle in the head (CP-01)", async () => {
    seed("projects/P1", { organizationId: "own", name: "مشروع", consultant: "دار الهندسة", consultantRep: { name: "م. سالم", phone: "+966501234567" }, pm: { portal: null } })
    seed("projects/P1/pmLetters/o1", { seq: 1, no: "OUT-001", dir: "out", party: "cons", subject: "طلب توضيح المخططات", day: todayDay(), due: 7, status: "out" })
    render(<ConsultantPortalPanel projectId="P1" projectName="مشروع" portal={null} items={[]} access={accessOf(owner)} />)
    await flush()
    const panel = panelTitled(msg("PM", "portal.title"))
    expect(descriptionOf(panel)).toBe(msg("PM", "portal.sub"))
    expect(panel?.textContent).toContain("طلب توضيح المخططات")
  })
})

// ---------------------------------------------------------------------------
// The project page: the portal's own File screen, and the legacy head
// ---------------------------------------------------------------------------

const ORG = "own"
const P = "P1"
const TERMS = { payer: "owner", basis: "rem", advance: 0.1, advanceRecovery: "pro", retention: 0.05, retentionCap: 0.05, retentionRelease: "half", paymentDays: 30, consultantDays: 14, claimNoticeDays: 28, defectsDays: 365, damages: { on: true, weeklyRate: 0.005, cap: 0.1 } }

function world(pm: boolean) {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", email: "owner@test.sa" })
  seed(`projects/${P}`, {
    organizationId: ORG,
    contractorId: ORG,
    name: "مجمع الياسمين السكني",
    budget: 1_000_000,
    status: "in_progress",
    projectType: "bld",
    enabledSections: sectionsForKind("bld"),
    rfqIds: [],
    projectManagerId: ORG,
    projectManagerName: "المالك",
    consultant: "دار الهندسة",
    ...(pm ? { pm: { no: "PJ-2026/001", lifecycle: "live", kind: "bld", startOn: todayDay(), startedAt: todayDay(), durationDays: 365, terms: TERMS, original: TERMS, acceptances: {}, retentionHeld: 0, advanceRecovered: 0, cutPool: 0 } } : {}),
  })
}

async function openProject(tab: string) {
  setSignedIn(ORG)
  setPathname(`/contractor/projects/${P}`, `tab=${tab}`)
  missingKeys.clear()
  const view = render(<ProjectPage />)
  await flush()
  return view
}

describe("CP-01: the consultant portal is its own File screen", () => {
  it("the File tray offers it beside Correspondence; it opens there, and Correspondence no longer carries it", async () => {
    world(true)
    let view = await openProject("pmPortal")
    expect([...missingKeys]).toEqual([])
    const tray = document.querySelector('[role="tablist"][data-variant="tray"]')
    const segs = Array.from(tray?.querySelectorAll('[role="tab"]') ?? []).map((b) => b.textContent ?? "")
    expect(segs.some((s) => s.includes(msg("PM", "corr.tab")))).toBe(true)
    expect(segs.some((s) => s.includes(msg("PM", "portal.title")))).toBe(true)
    expect(panelTitled(msg("PM", "portal.title"))).not.toBeNull()
    expect(panelTitled(msg("PM", "corr.title"))).toBeNull()
    view.unmount()
    view = await openProject("pmCorr")
    expect(panelTitled(msg("PM", "corr.title"))).not.toBeNull()
    expect(panelTitled(msg("PM", "portal.title"))).toBeNull()
    view.unmount()
  })
})

describe("UX-25: the legacy project's head reads like the PM one", () => {
  it("the owner sees adopt and edit as small buttons, sections and delete behind «…»", async () => {
    world(false)
    const view = await openProject("info")
    const names = Array.from(document.querySelectorAll("button")).map((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim())
    expect(names).toContain(msg("PM", "head.more"))
    expect(names).toContain(msg("PM", "adopt.button"))
    expect(names).toContain(msg("Contractor", "proj_edit"))
    expect(names).not.toContain(msg("Contractor", "proj_delete"))
    expect(names).not.toContain(msg("Contractor", "proj_manage_sections_btn"))
    const edit = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === msg("Contractor", "proj_edit"))
    expect(edit?.className).toContain("h-9")
    view.unmount()
  })
})
