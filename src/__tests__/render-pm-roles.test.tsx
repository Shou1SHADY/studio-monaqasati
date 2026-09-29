/**
 * PM 1.0 — every project view rendered for real, as each role, in Arabic: a
 * stand-in for clicking through the project page before anyone signs in on UAT.
 *
 * The whole project page (`/contractor/projects/[id]?tab=…`) mounts over the
 * in-memory Firestore with the demo project of scripts/seed-pm-demo.ts plus a
 * record in every register, written through the real write layers. The roles
 * are the seeded groups: the org owner (no seat, `all`), the project manager
 * (`pm.manage`, seat pm), the QS (`pm.cost`, seat qs) and the site engineer
 * (`pm.site`, seat site). Each render must not throw, must resolve every
 * message key, and must show the prototype's panel titles; the role gates
 * (money hidden from site, approve-only acts hidden from qs/site, tabs a role
 * does not get) are asserted per view. Portfolio Today and New projects too.
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

import React from "react"
import { act, render } from "@testing-library/react"
import type { Firestore } from "firebase/firestore"
import { fakeFirestore, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setPathname, setSignedIn } from "@/test-utils/render-world"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { sectionsForKind } from "@/lib/pm/sections"
import { todayDay } from "@/lib/pm/format"
import { approveMaterialRequest, createMaterialRequest, logDirectPurchase } from "@/lib/pm/supply-writes"
import { registerSubcontract } from "@/lib/pm/subcontract-writes"
import { fileDailyReport, openObstacle } from "@/lib/pm/site-writes"
import { registerDocument } from "@/lib/pm/documents-writes"
import { logLetter } from "@/lib/pm/correspondence-writes"
import ProjectPage from "@/app/[locale]/(contractor)/contractor/projects/[id]/page"
import { PmPortfolioToday } from "@/components/pm/PmPortfolioToday"
import { HandoverInbox } from "@/components/pm/HandoverInbox"

installDomShims()
jest.setTimeout(60_000)

// ---------------------------------------------------------------------------
// The world: the demo project (scripts/seed-pm-demo.ts), four people
// ---------------------------------------------------------------------------

const ORG = "own"
const P = "P1"
const DAY = 86_400_000
const base = new Date(`${todayDay()}T00:00:00Z`).getTime()
const d = (n: number) => new Date(base + n * DAY).toISOString().slice(0, 10)
const iso = (n: number) => new Date(base + n * DAY + 9 * 3600_000).toISOString()
const r2 = (n: number) => Math.round(n * 100) / 100

type Role = "owner" | "pm" | "qs" | "site"
const ROLES: Role[] = ["owner", "pm", "qs", "site"]
const UID: Record<Role, string> = { owner: ORG, pm: "pm1", qs: "qs1", site: "se1" }
const NAME: Record<Role, string> = { owner: "المالك", pm: "عبدالله", qs: "هدى", site: "عمر" }
const GROUP: Record<Exclude<Role, "owner">, string> = { pm: "pm.manage", qs: "pm.cost", site: "pm.site" }
const ctxOf = (r: Role): PmContext => ({
  ceiling: pmCeiling({ owner: r === "owner", permissions: r === "owner" ? [] : [GROUP[r]] }),
  seat: r === "owner" ? null : { uid: UID[r], role: r },
  archived: false,
})
const actorOf = (r: Role) => ({ uid: UID[r], name: NAME[r] })

const TERMS = {
  payer: "owner",
  basis: "rem",
  advance: 0.1,
  advanceRecovery: "pro",
  retention: 0.05,
  retentionCap: 0.05,
  retentionRelease: "half",
  paymentDays: 30,
  consultantDays: 14,
  claimNoticeDays: 28,
  defectsDays: 365,
  damages: { on: true, weeklyRate: 0.005, cap: 0.1 },
}
const SNAP = { payer: "owner", advance: 0.1, advanceRecovery: "pro", retention: 0.05, retentionCap: 0.05, paymentDays: 30, consultantDays: 14 }

type Item = { id: string; code: string; div: string; divAr: string; ar: string; unit: string; qty: number; rate: number; exec: number; inspect?: boolean; wir?: string; sample?: boolean }
const ITEMS: Item[] = [
  { id: "i01", code: "02-01-01", div: "02", divAr: "أعمال ترابية", ar: "حفر وردم للقواعد", unit: "م³", qty: 1200, rate: 35, exec: 1200 },
  { id: "i02", code: "03-02-01", div: "03", divAr: "أعمال خرسانية", ar: "خرسانة مسلحة للقواعد", unit: "م³", qty: 480, rate: 950, exec: 480 },
  { id: "i03", code: "03-03-01", div: "03", divAr: "أعمال خرسانية", ar: "أعمدة وأسقف الفلل", unit: "م³", qty: 900, rate: 1100, exec: 610, inspect: true, wir: "pass" },
  { id: "i04", code: "04-01-01", div: "04", divAr: "أعمال البناء", ar: "بناء بلوك 20 سم", unit: "م²", qty: 5200, rate: 85, exec: 1400 },
  { id: "i05", code: "07-01-01", div: "07", divAr: "العزل", ar: "عزل مائي للأسطح", unit: "م²", qty: 2100, rate: 60, exec: 0, sample: true },
  { id: "i06", code: "09-01-01", div: "09", divAr: "التشطيبات", ar: "لياسة داخلية", unit: "م²", qty: 9800, rate: 38, exec: 900, inspect: true, wir: "fail" },
  { id: "i07", code: "15-01-01", div: "15", divAr: "الأعمال الميكانيكية", ar: "تمديدات السباكة لكل فيلا", unit: "فيلا", qty: 5, rate: 185000, exec: 1 },
]
const BUDGET = r2(ITEMS.reduce((a, i) => a + i.qty * i.rate, 0))
const byId = new Map(ITEMS.map((i) => [i.id, i]))
const amounts = (gross: number, held: number, recovered: number) => {
  const recovery = r2(Math.min(gross * 0.1, BUDGET * 0.1 - recovered))
  const retention = r2(Math.max(0, Math.min(gross * 0.05, 0.05 * BUDGET - held)))
  const vat = r2((gross - recovery) * 0.15)
  return { gross: r2(gross), recovery, retention, vat, net: r2(gross - recovery - retention + vat) }
}
const linesOf = (ls: Array<[string, number]>) => ls.map(([itemId, qty]) => ({ itemId, code: byId.get(itemId)!.code, qty, rate: byId.get(itemId)!.rate, amount: r2(qty * byId.get(itemId)!.rate) }))
const cert1 = linesOf([["i01", 1200], ["i02", 480], ["i03", 610], ["i07", 1]])
const cert2 = linesOf([["i04", 1400], ["i06", 900]])
const a1 = amounts(cert1.reduce((a, l) => a + l.amount, 0), 0, 0)
const a2 = amounts(cert2.reduce((a, l) => a + l.amount, 0), a1.retention, a1.recovery)
const billed = new Map([...cert1, ...cert2].map((l) => [l.itemId, l.qty]))

const writeFailures: string[] = []
async function attempt(label: string, fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (e) {
    writeFailures.push(`${label}: ${(e as Error).message}`)
  }
}

async function buildWorld() {
  resetFakeDb()
  const stamp = { organizationId: ORG, createdAt: iso(-1) }
  const by = { by: ORG, byName: NAME.owner }
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: NAME.owner, email: "owner@test.sa" })
  for (const r of ["pm", "qs", "site"] as const) {
    seed(`teamGroups/g_${r}`, { organizationId: ORG, name: r, key: null, permissions: [GROUP[r], "projects.view"] })
    seed(`users/${UID[r]}`, { organizationId: ORG, organizationRole: "member", defaultGroupId: `g_${r}`, name: NAME[r], email: `${UID[r]}@test.sa` })
  }
  seed(`projects/${P}`, {
    organizationId: ORG,
    contractorId: ORG,
    name: "مجمع الياسمين السكني — 5 فلل",
    location: "الرياض — حي الياسمين",
    budget: BUDGET,
    status: "in_progress",
    projectType: "bld",
    clientName: "شركة الياسمين للتطوير العقاري",
    enabledSections: [...sectionsForKind("bld"), "zone"],
    rfqIds: [],
    projectManagerId: UID.pm,
    projectManagerName: NAME.pm,
    pm: {
      no: "PJ-2026/009",
      lifecycle: "live",
      kind: "bld",
      startOn: d(-150),
      startedAt: d(-150),
      indirect: { stf: 620_000, eq: 270_000, ovh: 340_000, ins: 96_000 },
      durationDays: 365,
      signedOn: d(-170),
      terms: TERMS,
      original: TERMS,
      acceptances: {},
      sheetCount: 4,
      wirCount: 2,
      sampleCount: 1,
      voCount: 2,
      claimCount: 2,
      programmeRev: 1,
      addendaCount: 1,
      ipcCount: 2,
      lastIpcOn: d(-2),
      punchCount: 2,
      ncrCount: 1,
      activityCount: 3,
      retentionHeld: r2(a1.retention + a2.retention),
      advanceRecovered: r2(a1.recovery + a2.recovery),
      cutPool: 0,
    },
    createdAt: iso(-170),
  })
  for (const r of ["pm", "qs", "site"] as const) seed(`projects/${P}/members/${UID[r]}`, { userId: UID[r], groupId: null, organizationId: ORG, addedBy: ORG, pmRole: r, off: [], from: d(-150), to: null })
  for (const i of ITEMS)
    seed(`projects/${P}/boqItems/${i.id}`, {
      itemNo: i.code,
      sheet: "BOQ",
      divisionNo: i.div,
      divisionNameAr: i.divAr,
      divisionNameEn: i.divAr,
      descriptionAr: i.ar,
      descriptionEn: i.ar,
      unit: i.unit,
      quantity: i.qty,
      unitPrice: i.rate,
      // Every prototype BOQ line carries an estimated unit cost (ucost) — here 80% of the rate.
      estCost: r2(i.rate * 0.8),
      totalPrice: r2(i.qty * i.rate),
      executedQuantity: i.exec,
      billedQuantity: billed.get(i.id) ?? 0,
      groupId: null,
      isEditable: true,
      ...(i.inspect ? { pmInspect: true, pmWir: i.wir ?? null } : {}),
      ...(i.sample ? { pmSample: true, pmSub: null } : {}),
    })
  const sheet = (seq: number, day: number, status: string, lines: Array<[string, number]>) =>
    seed(`projects/${P}/pmSheets/0${seq}`, {
      seq,
      status,
      day: d(day),
      by: UID.site,
      byName: NAME.site,
      lines: lines.map(([itemId, qty]) => ({ itemId, code: byId.get(itemId)!.code, qty, approved: status === "ok" ? qty : null })),
      note: null,
      okBy: status === "ok" ? UID.pm : null,
      okByName: status === "ok" ? NAME.pm : null,
      okAt: status === "ok" ? iso(day + 1) : null,
      self: false,
      ...stamp,
    })
  sheet(1, -120, "ok", [["i01", 1200], ["i02", 480]])
  sheet(2, -75, "ok", [["i03", 610], ["i07", 1]])
  sheet(3, -30, "ok", [["i04", 1400], ["i06", 900]])
  sheet(4, -3, "wait", [["i04", 300]])
  seed(`projects/${P}/pmInspections/01`, { seq: 1, itemId: "i03", code: "03-03-01", location: "الفيلا 2 — السقف الأول", party: "consultant", status: "pass", attempts: [{ n: 1, on: d(-80), result: "pass", note: null, ...by, rBy: ORG, rByName: NAME.owner, rAt: iso(-80) }], ...stamp })
  seed(`projects/${P}/pmInspections/02`, { seq: 2, itemId: "i06", code: "09-01-01", location: "الفيلا 1 — الدور الأرضي", party: "consultant", status: "fail", attempts: [{ n: 1, on: d(-10), result: "fail", note: "سماكة اللياسة أقل من المواصفة", ...by, rBy: ORG, rByName: NAME.owner, rAt: iso(-10) }], ...stamp })
  seed(`projects/${P}/pmSubmittals/01`, { seq: 1, itemId: "i05", code: "07-01-01", supplier: "مصنع الجزيرة للعوازل", rev: 1, status: "rej", day: d(-25), ...by, reply: { on: d(-18), by: ORG, byName: NAME.owner, note: "السماكة 3 مم بدل 4 مم المطلوبة" }, ...stamp })
  seed(`projects/${P}/pmVariations/01`, { seq: 1, title: "إضافة غرفة خادمة للفيلا 5", source: "client", instructionNo: "CI-07", day: d(-60), value: 85000, cost: 62000, executedPct: 0.4, status: "appr", ...by, decision: { on: d(-50), by: ORG, byName: NAME.owner, ref: "APP-VO-01", reason: null }, ...stamp })
  seed(`projects/${P}/pmVariations/02`, { seq: 2, title: "تغيير نوع البلاط الخارجي", source: "cons", instructionNo: "SI-12", day: d(-12), value: 46000, cost: 35000, executedPct: 0, status: "wait", ...by, decision: null, ...stamp })
  seed(`projects/${P}/pmClaims/01`, { seq: 1, kind: "time", cause: "تأخر الاستشاري في اعتماد المخططات الإنشائية", eventOn: d(-110), daysAsked: 45, amountAsked: 0, status: "part", ...by, noticeOn: d(-100), submittedOn: d(-90), response: { on: d(-70), by: ORG, byName: NAME.owner, days: 30, amount: 0 }, revision: 1, ...stamp })
  seed(`projects/${P}/pmClaims/02`, { seq: 2, kind: "time", cause: "توقف العمل بسبب إغلاق الطريق من البلدية", eventOn: d(-35), daysAsked: 10, amountAsked: 0, status: "draft", ...by, noticeOn: null, submittedOn: null, response: null, revision: null, ...stamp })
  seed(`projects/${P}/pmAddenda/01`, { seq: 1, status: "draft", day: d(-5), ...by, reason: "client", reasonText: null, changes: [{ key: "paymentDays", from: 30, to: 45 }], note: "طلب المالك تمديد مهلة الدفع", ...stamp })
  seed(`projects/${P}/pmCertificates/01`, { seq: 1, status: "appr", lines: cert1, cutsIncluded: 0, terms: SNAP, contractValue: BUDGET, ...a1, prep: UID.qs, prepName: NAME.qs, prepOn: d(-60), appr: UID.pm, apprName: NAME.pm, apprOn: d(-55), selfApp: false, certified: a1.gross, cut: 0, cutReason: null, consultantRef: "CONS-IPC-01", certOn: d(-45), certBy: UID.pm, certByName: NAME.pm, dueOn: d(-15), submitted: a1, ...stamp })
  seed(`projects/${P}/pmCertificates/02`, { seq: 2, status: "int", lines: cert2, cutsIncluded: 0, terms: SNAP, contractValue: BUDGET, ...a2, prep: UID.qs, prepName: NAME.qs, prepOn: d(-2), appr: null, apprName: null, apprOn: null, selfApp: false, certified: null, cut: null, cutReason: null, consultantRef: null, certOn: null, certBy: null, certByName: null, dueOn: null, submitted: null, ...stamp })
  seed(`projects/${P}/pmPunch/01`, { seq: 1, what: "تشققات شعرية في لياسة الممر", location: "الفيلا 1 — الممر الرئيسي", severity: "b", source: "cons", status: "open", day: d(-8), ...by, itemId: "i06", fix: null, conf: null, ...stamp })
  seed(`projects/${P}/pmPunch/02`, { seq: 2, what: "ميول تصريف السطح غير كافية", location: "الفيلا 2 — السطح", severity: "a", source: "int", status: "fix", day: d(-20), ...by, itemId: "i05", fix: { on: d(-4), by: ORG, byName: NAME.owner, note: "أُعيدت الميول" }, conf: null, ...stamp })
  seed(`projects/${P}/pmUnits/01`, { seq: 1, name: "الفيلا 1", plan: d(20), ho: null, lines: { i03: { q: 450, ex: 380 }, i07: { q: 2.5, ex: 1 } }, ...by, ...stamp })
  seed(`projects/${P}/pmUnits/02`, { seq: 2, name: "الفيلا 2", plan: null, ho: null, lines: { i03: { q: 450, ex: 230 }, i07: { q: 2.5, ex: 0 } }, ...by, ...stamp })
  seed(`projects/${P}/pmNcrs/01`, { seq: 1, itemId: "i06", code: "09-01-01", severity: "a", root: "لم تُستخدم أدلة السماكة قبل اللياسة", cost: 12500, status: "open", day: d(-9), ...by, plan: null, accepted: null, ...stamp })
  const activity = (seq: number, name: string, from: number, to: number, itemIds: string[], pred: number | null) =>
    seed(`projects/${P}/pmActivities/0${seq}`, { seq, name, from: d(from), to: d(to), itemIds, pred: pred ? `0${pred}` : null, by: ORG, byName: NAME.owner, at: iso(-140), ...stamp })
  activity(1, "أعمال الحفر والقواعد", -150, -100, ["i01", "i02"], null)
  activity(2, "هيكل الفلل الخرساني", -100, -20, ["i03"], 1)
  activity(3, "بناء البلوك", -40, 40, ["i04"], 2)
  seed(`pmEvents/prj:IPC:PJ-2026_009:01`, { key: "prj:IPC:PJ-2026/009:01", kind: "IPC", organizationId: ORG, projectId: P, projectNo: "PJ-2026/009", amount: a1.gross, params: { certificate: "01", gross: a1.gross, net: a1.net, due: d(-15) }, by: ORG, at: iso(-45) })
  seed(`pmHandovers/H1`, {
    organizationId: ORG,
    status: "wait",
    to: UID.pm,
    toName: NAME.pm,
    opportunityId: "opp1",
    contactId: null,
    title: "مدرسة الرياض الأهلية — المبنى الجديد",
    clientName: "مدارس الرياض الأهلية",
    clientType: "company",
    kind: "bld",
    location: "الرياض — حي النرجس",
    contractNumber: "RYS-2026-031",
    value: 18_500_000,
    durationDays: 540,
    signedOn: d(-6),
    startOn: d(14),
    advance: 0.1,
    retention: 0.05,
    note: null,
    requestedBy: ORG,
    requestedByName: NAME.owner,
    createdAt: iso(-2),
  })

  const db = fakeFirestore as unknown as Firestore
  await attempt("material request", () => createMaterialRequest(db, ctxOf("site"), P, actorOf("site"), { title: "حديد الأسقف", needBy: d(7), notes: null, lines: [{ itemId: "i03", name: "حديد تسليح 16 مم", unit: "طن", qty: 40 }] }))
  await attempt("approve request", () => approveMaterialRequest(db, ctxOf("pm"), P, actorOf("pm"), "01"))
  await attempt("second request", () => createMaterialRequest(db, ctxOf("site"), P, actorOf("site"), { title: "بلوك", needBy: d(10), notes: null, lines: [{ itemId: "i04", name: "بلوك 20 سم", unit: "حبة", qty: 5000 }] }))
  await attempt("subcontract", () => registerSubcontract(db, ctxOf("pm"), P, actorOf("pm"), { party: { name: "مؤسسة الإتقان" }, retentionPct: 10, startOn: d(-40), endOn: null, note: null, lines: [{ itemId: "i04", qty: 1500, rate: 40 }] }))
  await attempt("daily", () => fileDailyReport(db, ctxOf("site"), P, actorOf("site"), { labour: 58, plant: 4, done: "صب سقف الفيلا 4", obstacle: "", files: [] }))
  await attempt("obstacle", () => openObstacle(db, ctxOf("site"), P, actorOf("site"), { type: "rfi", title: "تعارض مجاري التكييف — الفيلا 3", party: "consultant", partyName: "مكتب البناء", itemIds: ["i06"], impact: "يوقف الأسقف", openOn: d(-4) }))
  await attempt("document", () => registerDocument(db, ctxOf("pm"), P, actorOf("pm"), { name: "المخططات المعمارية", type: "dwg", code: "R01", day: d(-30) }))
  await attempt("letter", () => logLetter(db, ctxOf("qs"), P, actorOf("qs"), { dir: "out", party: "cons", subject: "طلب توضيح", day: d(-12), due: 14, links: "" }))
  await attempt("petty", () => logDirectPurchase(db, ctxOf("site"), P, actorOf("site"), { what: "مسامير", supplier: "محل البناء", amount: 350, receipt: "R-1", day: d(-1) }))
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

async function openAs(role: Role, tab: string) {
  setSignedIn(UID[role])
  setPathname(`/contractor/projects/${P}`, `tab=${tab}`)
  missingKeys.clear()
  const view = render(<ProjectPage />)
  await flush()
  return view
}

const text = () => document.body.textContent ?? ""
const buttons = () => Array.from(document.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim())
const enabledButtons = () => Array.from(document.querySelectorAll("button")).filter((b) => !b.disabled).map((b) => (b.textContent ?? "").trim())
const RIYAL = "⃁"

function dump(role: Role, tab: string) {
  if (!process.env.RENDER_DUMP) return
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("fs").appendFileSync(
    process.env.RENDER_DUMP,
    JSON.stringify({
      role,
      tab,
      text: text(),
      buttons: Array.from(document.querySelectorAll("button")).map((b) => `${(b.textContent ?? "").trim() || b.getAttribute("aria-label")}${b.disabled ? " [x]" : ""}`),
      heads: Array.from(document.querySelectorAll("h1,h2,h3,h4,th")).map((h) => (h.textContent ?? "").trim()),
    }) + "\n"
  )
}

beforeAll(async () => {
  await buildWorld()
})

it("the fixture's writes all landed", () => {
  expect(writeFailures).toEqual([])
})

// ---------------------------------------------------------------------------
// What each view must show (the prototype's panel titles and columns, v21 —
// see audit/pm-parts), who sees money in it, and which acts are whose.
// `only`: the roles the rail offers the tab to; anyone else is sent to the
// first tab of the group (the page's visibleTab), so the titles are absent.
// ---------------------------------------------------------------------------

const O: Role[] = ["owner"]
const OP: Role[] = ["owner", "pm"]
const OPQ: Role[] = ["owner", "pm", "qs"]
const OPS: Role[] = ["owner", "pm", "site"]
const ALL: Role[] = ROLES

interface ViewSpec {
  titles: string[]
  /** Shown to money holders only (owner / pm / qs) — never to the site engineer. */
  money?: string[]
  /** Button label → the roles that get it (enabled or not); nobody else may see it. */
  acts?: Record<string, Role[]>
  only?: Role[]
}

const VIEWS: Record<string, ViewSpec> = {
  pmToday: { titles: ["يحتاج قرارك", "أكثر الأقسام تأخراً", "معلّق عند غيرنا", "سجل المشروع"], money: ["مسار المال"], acts: { "افتح التحصيل": OPQ, "افتح المستخلص": ["qs"] } },
  info: { titles: ["معلومات المشروع", "الاستلام الابتدائي", "الاستلام النهائي"], money: ["شروط العقد باختصار"], acts: { تعديل: OP, "افتح الشروط": OPQ, "مسموح ويُسجَّل": O, "تسجيل الاستلام الابتدائي": OP } },
  boq: { titles: ["البند", "متعاقد", "المنفَّذ", "حفر وردم للقواعد"], money: ["غير مفوتر", "التكلفة", "الهامش"], acts: { "بنود تنزف": OPQ } },
  pmTerms: { titles: ["العقد الساري", "ما يعنيه هذا العقد نقداً", "الأصلي كما وُقّع"], acts: { "تسجيل التوقيع": OP, سحب: OP, "تعديل العقد": OPQ }, only: OPQ },
  pmUnits: { titles: ["متوسط المشروع", "جاهزة للاستلام", "موعدها غير واقعي", "الفيلا 1", "الفيلا 2", "المتبقي من قيمتها", "لا تُسلَّم قبل:"], money: ["قيمة الوحدة"], acts: { "بنود الوحدة": ALL, "سلّم الوحدة": OP } },
  pmMeasure: { titles: ["قياس الفترة", "محاضر القياس"], acts: { "ابدأ قياساً": ALL, اعتماد: OP, إعادة: OP } },
  pmQa: {
    titles: ["طلبات الفحص", "قائمة الملاحظات", "خطة الفحص والاختبار", "تقارير عدم المطابقة"],
    acts: { "طلب فحص": OPS, "إعادة الفحص": OPS, "رصد ملاحظة": OPS, "تسجيل عدم مطابقة": OPS, "بنود تتطلب فحصاً (2)": OP },
  },
  pmSite: {
    titles: ["الخطة الأسبوعية", "المعدات في الموقع", "التقرير اليومي", "السلامة", "المعوّقات و RFI"],
    acts: { "سجّل معوّقاً": OPS, "سجّل حادثاً": OP, "سجّل تصريح عمل": OP, "سجّل مطالبة": OP },
  },
  pmSubs: {
    titles: ["مقاولو الباطن", "المقاول", "النطاق", "الإنجاز", "العقود المسجّلة", "مستخلصات الباطن", "مؤسسة الإتقان"],
    money: ["قيمة العقد", "مدفوع"],
    acts: { "سجّل عقد باطن": OPQ, "أعِدّ مستخلص باطن": OPQ, "اصرف لعهدة مقاول باطن": OPS },
  },
  pmVo: { titles: ["أوامر التغيير", "أمر التغيير", "الحالة", "المنفَّذ منه", "تغيير نوع البلاط الخارجي"], money: ["الأثر على العقد", "قيمة العقد السارية"], acts: { "سجّل أمر تغيير": OPQ } },
  pmClaims: { titles: ["سجل المطالبات", "توقف العمل بسبب إغلاق الطريق من البلدية"], acts: { "مطالبة جديدة": OPQ, "سجّل إرسال الإشعار": OP } },
  pmProgramme: { titles: ["منحنى الإنجاز: المخطط مقابل الفعلي", "إصدارات البرنامج الزمني", "المخطط مقابل الفعلي بالقسم", "الأنشطة", "هيكل الفلل الخرساني"], acts: { "أضف نشاطاً": OP } },
  pmClose: { titles: ["إغلاق المشروع", "ما تعلّمناه من هذا المشروع"], acts: { "إغلاق وأرشفة": OP } },
  pmDocs: { titles: ["المستندات وإصداراتها", "المخططات المعمارية"], acts: { "إصدار جديد": OP } },
  pmCorr: { titles: ["المراسلات الرسمية", "بوابة الاستشاري", "طلب توضيح"], acts: { "سجّل مراسلة": OPQ, "سجّل الرد": OPQ } },
  pmReq: { titles: ["طلبات المواد", "طلبات المعدات", "حديد الأسقف", "بانتظار الاعتماد الفني"], acts: { "طلب مواد": OPS, اعتمد: OP, ارفض: OP, "اطلب معدة": OPS } },
  pmStore: { titles: ["مستودع المشروع", "بانتظار الاستلام"], money: ["أين ذهبت المواد"] },
  pmSubm: { titles: ["اعتماد المواد والعيّنات", "المورّد المقترح", "مصنع الجزيرة للعوازل"], acts: { "تقديم عيّنة": ALL, "البنود التي تتطلب عيّنة": OP } },
  pmPetty: { titles: ["الشراء المباشر", "مسامير"], acts: { "سجّل شراءً مباشراً": OPS } },
  pmPo: { titles: ["أوامر الشراء", "تاريخ أسعار المواد"] },
  team: { titles: ["الفريق والصلاحيات", "كيف تُحسب صلاحية الشخص هنا", NAME.pm, NAME.qs, NAME.site], acts: { "تعيين في المشروع": OPQ, أخرِجه: OPQ, "طلب عمالة من الموارد البشرية": OP } },
  pmSections: { titles: ["أقسام المشروع", "لماذا تُطفأ الأقسام"] },
  pmBoundary: { titles: ["حدود الوحدة", "ما تنتظره المالية منّا — وحالته الآن", "مفتاح التفرّد", "اعتماد مستخلص للمالك", "شراء مباشر من الموقع"] },
  pmCost: { titles: ["التكلفة على مستوى القسم", "موازنة المنفَّذ", "الانحراف", "البنود التي تنزف", "التكاليف غير المباشرة", "تكاليف غير مباشرة", "طاقم الموقع — مدير ومهندسون وأمن"], acts: { الموازنات: OP }, only: OPQ },
  pmMatch: { titles: ["المطابقة الثلاثية"], only: OPQ },
  pmCvr: { titles: ["اعتماد التسوية وإرسال التوقّع للمالية", "التسوية على مستوى القسم", "القيمة المكتسبة", "التكلفة المتوقّعة", "الهامش المتوقّع"], acts: { "اعتمد وأرسل للمالية": OP }, only: OPQ },
  ipc: { titles: ["المستخلصات", "المستخلص والفترة", "قيمة الأعمال", "صافي المطالبة", "التحصيل", "الدفعة المقدمة والمحتجز"], acts: { "إعداد مستخلص": OPQ }, only: OPQ },
}

// What sits on every screen of the project: the head's acts and the rail's groups.
const HEAD_ACTS: Record<string, Role[]> = { "أجّل المشروع": OP, المال: OPQ, قياس: ALL, النبض: ALL, العقد: ALL, التنفيذ: ALL, التوريد: ALL, الملف: ALL, الإعدادات: ALL }

describe.each(ROLES)("as %s", (role) => {
  it.each(Object.keys(VIEWS))("%s renders, every key resolved, titles and gates as the prototype", async (tab) => {
    const spec = VIEWS[tab]
    const view = await openAs(role, tab)
    dump(role, tab)
    expect([...missingKeys]).toEqual([])
    expect(text()).not.toMatch(/MISSING/)
    expect(text()).toContain("مجمع الياسمين السكني")

    const offered = !spec.only || spec.only.includes(role)
    if (offered) expect({ tab, role, missing: spec.titles.filter((x) => !text().includes(x)) }).toEqual({ tab, role, missing: [] })
    else expect({ tab, role, fellBackButShows: spec.titles.filter((x) => text().includes(x)) }).toEqual({ tab, role, fellBackButShows: [] })
    for (const title of spec.money ?? []) {
      expect({ tab, role, title, shown: text().includes(title) }).toEqual({ tab, role, title, shown: offered && role !== "site" })
    }
    // The Pulse shows five decisions and folds the rest behind «عرض N قرارات أخرى» (the prototype's cap).
    const more = Array.from(document.querySelectorAll("button")).find((b) => /قرارات? أخرى|قراران آخران|قرار آخر/.test(b.textContent ?? ""))
    if (more) await act(async () => { more.click() })
    const now = buttons()
    for (const [label, who] of Object.entries(HEAD_ACTS)) expect({ tab, role, label, shown: now.includes(label) }).toEqual({ tab, role, label, shown: who.includes(role) })
    for (const [label, who] of Object.entries(spec.acts ?? {})) expect({ tab, role, label, shown: now.includes(label) }).toEqual({ tab, role, label, shown: offered && who.includes(role) })
    if (role === "site") expect({ tab, riyal: text().includes(RIYAL) }).toEqual({ tab, riyal: false })
    view.unmount()
  })
})

describe("acts a role holds are live, not just drawn", () => {
  it("the site engineer can start a measurement and request material; the QS cannot approve a sheet", async () => {
    let view = await openAs("site", "pmMeasure")
    expect(enabledButtons()).toContain("ابدأ قياساً")
    view.unmount()
    view = await openAs("site", "pmReq")
    expect(enabledButtons()).toContain("طلب مواد")
    view.unmount()
    view = await openAs("qs", "pmMeasure")
    expect(buttons()).not.toContain("اعتماد")
    view.unmount()
  })

  it("direct purchases: the site engineer logs them but reads ••• for the spend, as the prototype's money()", async () => {
    const view = await openAs("site", "pmPetty")
    expect(text()).toContain("صُرف خلال 30 يوماً")
    expect(text()).toContain("•••")
    expect(text()).not.toContain(RIYAL)
    view.unmount()
  })

  it("a section toggle is the approver's: live for owner and PM, disabled for QS and site", async () => {
    for (const role of ROLES) {
      const view = await openAs(role, "pmSections")
      const toggle = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").startsWith("المستودعات"))
      expect({ role, disabled: toggle?.disabled }).toEqual({ role, disabled: role === "qs" || role === "site" })
      view.unmount()
    }
  })
})

// ---------------------------------------------------------------------------
// Across projects: Portfolio Today and New projects (the handover inbox)
// ---------------------------------------------------------------------------

describe("PM portfolio screens", () => {
  it.each(ROLES)("Portfolio Today renders for %s with the project and no missing key", async (role) => {
    setSignedIn(UID[role])
    setPathname("/contractor/projects/today")
    missingKeys.clear()
    const view = render(<PmPortfolioToday />)
    await flush()
    dump(role, "portfolioToday")
    expect([...missingKeys]).toEqual([])
    expect(text()).not.toMatch(/MISSING/)
    expect(text()).toContain("مجمع الياسمين السكني")
    expect(text()).toContain("يحتاج قرارك")
    // The CRM handover waits on the addressed manager and the owner — nobody else is offered it.
    expect({ role, handover: buttons().includes("اقبل أو أعِد التوجيه") }).toEqual({ role, handover: role === "owner" || role === "pm" })
    if (role === "site") expect(text()).not.toContain(RIYAL)
    view.unmount()
  })

  it.each(ROLES)("New projects renders for %s; the file is the addressed manager's and the owner's", async (role) => {
    setSignedIn(UID[role])
    setPathname("/contractor/projects/inbox")
    missingKeys.clear()
    const view = render(<HandoverInbox />)
    await flush()
    dump(role, "inbox")
    expect([...missingKeys]).toEqual([])
    expect(text()).not.toMatch(/MISSING/)
    expect({ role, shown: text().includes("مدرسة الرياض الأهلية — المبنى الجديد") }).toEqual({ role, shown: role === "owner" || role === "pm" })
    expect({ role, accept: buttons().includes("اقبل وأنشئ المشروع") }).toEqual({ role, accept: role === "owner" || role === "pm" })
    view.unmount()
  })
})
