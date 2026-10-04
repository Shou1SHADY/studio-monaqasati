/**
 * HR 1.0 — letters (EM-08, WF-24): five types — salary, embassy and experience
 * from the card with nothing typed; no-objection and other carry the
 * employee's words (the purpose required there only, the letter named in
 * "other"); addressee and language. The HR manager signs, government
 * relations signs an embassy letter, nobody signs his own; issued with a
 * yearly serial (LT / خ) or declined with a reason; the figures never sit on
 * the letter (RL-03).
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { hrAllowed, type HrContext, type HrRole } from "@/lib/hr/access"
import type { HrEmployee } from "@/lib/hr/employee"
import { declineLetter, fileLetter, issueLetter } from "@/lib/hr/letter-writes"
import {
  initialLetterText,
  issueBlocks,
  letterBlocks,
  letterNoDisplay,
  letterSignerLevel,
  letterTodayRows,
  lettersToSign,
  letterTotal,
  maySignLetter,
  requestableKinds,
  type HrLetter,
  type LetterPay,
} from "@/lib/hr/letters"
import { HrWriteError } from "@/lib/hr/write-guard"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const hrm = ctx(["manager"], { uid: "hrm", employeeId: "e-hrm" })
const gov = ctx(["gov"], { uid: "gov", employeeId: "e-gov" })
const mgmt = ctx(["management"], { uid: "ceo", employeeId: "e-ceo" })
const payroll = ctx(["payroll"], { uid: "pay", employeeId: "e-pay" })
const worker = ctx([], { uid: "wu", employeeId: "e1" })
const owner = ctx(["manager", "management"], { uid: "own", owner: true, employeeId: "e-own" })
const who = (c: HrContext) => ({ uid: c.uid, name: c.uid })
const head = { name: "شركة البناء", cr: "1010", mol: "7-1" }

const empBase: Omit<HrEmployee, "id"> = {
  organizationId: ORG,
  no: 7,
  names: { ar: "سارة", en: "Sara" },
  nationality: "eg",
  gender: "f",
  idNo: "2412345678",
  trade: "accountant",
  category: "staff",
  siteId: null,
  userId: "wu",
  join: "2023-05-01",
  source: "local",
  contract: { type: "open" },
  probation: { end: "2023-07-29", decision: "confirmed" },
  status: "active",
  docs: {},
  leaveTaken: 0,
}
const letter = (id: string) => readDoc<HrLetter>(`hrLetters/${id}`) as HrLetter
const letterPay = (id: string) => readDoc<LetterPay>(`hrLetterPay/${id}`)
const logOf = (e: string) => listCollection<{ kind: string; params: Record<string, unknown> }>(`employees/${e}/log`)

async function refusal(p: Promise<unknown>): Promise<{ code: string; blocks: string[] }> {
  try {
    await p
  } catch (e) {
    if (e instanceof HrWriteError) return { code: e.code, blocks: e.blocks }
    throw e
  }
  throw new Error("expected a refusal")
}

beforeEach(() => {
  resetFakeDb()
  seed("employees/e1", { ...empBase })
  seed("employees/e-hrm", { ...empBase, no: 2, userId: "hrm", gender: "m" })
  seed("employees/e-gov", { ...empBase, no: 3, userId: "gov", gender: "m" })
  seed("employeePay/e1", { employeeId: "e1", organizationId: ORG, basic: 6_000, housing: 1_500, transport: 600 })
  seed("employeePay/e-hrm", { employeeId: "e-hrm", organizationId: ORG, basic: 12_000, housing: 3_000, transport: 1_000 })
  seed("employeePay/e-gov", { employeeId: "e-gov", organizationId: ORG, basic: 8_000, housing: 2_000, transport: 800 })
})

describe("the request (WF-24 step 1)", () => {
  const ok = { status: "active" as const, hasWage: true }

  it("a standard letter needs only the addressee; the purpose is optional there", () => {
    expect(letterBlocks({ kind: "sal", addressee: "بنك الراجحي", lang: "ar" }, ok)).toEqual([])
    expect(letterBlocks({ kind: "emb", addressee: "  ", lang: "en" }, ok)).toEqual(["no_addressee"])
  })

  it("other names the letter; other and no-objection state the purpose — not sent without them", () => {
    expect(letterBlocks({ kind: "oth", addressee: "الجامعة", lang: "ar" }, ok)).toEqual(["no_title", "no_purpose"])
    expect(letterBlocks({ kind: "noc", addressee: "المرور", lang: "en" }, ok)).toEqual(["no_purpose"])
    expect(letterBlocks({ kind: "oth", title: "خطاب للجامعة", purpose: "على رأس العمل", addressee: "الجامعة", lang: "ar" }, ok)).toEqual([])
  })

  it("the experience certificate is for one leaving; a leaver asks for nothing else", () => {
    expect(requestableKinds("active")).toEqual(["sal", "emb", "noc", "oth"])
    expect(requestableKinds("leaving")).toEqual(["sal", "emb", "noc", "oth", "exp"])
    expect(requestableKinds("left")).toEqual(["exp"])
    expect(letterBlocks({ kind: "exp", addressee: "x", lang: "ar" }, ok)).toEqual(["exp_on_exit"])
    expect(letterBlocks({ kind: "sal", addressee: "x", lang: "ar" }, { status: "left", hasWage: true })).toEqual(["left"])
  })

  it("a letter that states the wage needs one on the record", () => {
    expect(letterBlocks({ kind: "sal", addressee: "x", lang: "ar" }, { status: "active", hasWage: false })).toEqual(["no_wage"])
    expect(letterBlocks({ kind: "noc", purpose: "رخصة", addressee: "x", lang: "ar" }, { status: "active", hasWage: false })).toEqual([])
  })

  it("a bad language or type is refused at the boundary", () => {
    expect(letterBlocks({ kind: "sal", addressee: "x", lang: "fr" as "ar" }, ok)).toEqual(["bad_input"])
  })
})

describe("who signs (WF-24 step 2, RL-02)", () => {
  it("the HR manager signs; government relations an embassy letter", () => {
    expect(letterSignerLevel("sal", { isHrManager: false, isGov: false })).toBe("manager")
    expect(letterSignerLevel("emb", { isHrManager: false, isGov: false })).toBe("gov")
    expect(letterSignerLevel("oth", { isHrManager: false, isGov: false })).toBe("manager")
  })

  it("nobody signs his own: the HR manager's own to management, the officer's embassy letter to the HR manager", () => {
    expect(letterSignerLevel("sal", { isHrManager: true, isGov: false })).toBe("management")
    expect(letterSignerLevel("emb", { isHrManager: false, isGov: true })).toBe("manager")
    expect(letterSignerLevel("emb", { isHrManager: true, isGov: true })).toBe("management")
  })

  it("maySignLetter: by level; the HR manager stands in for government relations; never his own (owner excepted)", () => {
    const l = (signerLevel: HrLetter["signerLevel"], employeeId = "e1") => ({ employeeId, signerLevel })
    expect(maySignLetter(hrm, l("manager"))).toBeNull()
    expect(maySignLetter(hrm, l("gov"))).toBeNull()
    expect(maySignLetter(hrm, l("management"))).toBe("no_role")
    expect(maySignLetter(gov, l("gov"))).toBeNull()
    expect(maySignLetter(gov, l("manager"))).toBe("no_role")
    expect(maySignLetter(mgmt, l("management"))).toBeNull()
    expect(maySignLetter(mgmt, l("manager"))).toBe("no_role")
    expect(maySignLetter(payroll, l("manager"))).toBe("no_role")
    expect(maySignLetter(hrm, l("gov", "e-hrm"))).toBe("own_request")
    expect(maySignLetter(owner, l("management", "e-own"))).toBeNull()
  })

  it("the guard: the HR manager asks for others; three roles may sign at all", () => {
    expect(hrAllowed(hrm, "letter.file")).toBe(true)
    expect(hrAllowed(gov, "letter.file")).toBe(false)
    for (const c of [hrm, gov, mgmt]) expect(hrAllowed(c, "letter.sign")).toBe(true)
    for (const c of [payroll, worker]) expect(hrAllowed(c, "letter.sign")).toBe(false)
  })

  it("issue blocks: a free letter needs its text; once decided it is stale", () => {
    expect(issueBlocks({ state: "pending", kind: "oth" }, { text: " " })).toEqual(["no_text"])
    expect(issueBlocks({ state: "pending", kind: "sal" }, {})).toEqual([])
    expect(issueBlocks({ state: "issued", kind: "sal" }, {})).toEqual(["stale"])
    expect(initialLetterText({ text: null, purpose: "على رأس العمل" })).toBe("على رأس العمل")
  })
})

describe("filing (fileLetter)", () => {
  it("the employee asks from My file; the figures go apart, copied from pay", async () => {
    const { id } = await fileLetter(db, worker, ORG, who(worker), { employeeId: "e1", kind: "sal", addressee: "بنك الراجحي", lang: "ar" })
    const l = letter(id)
    expect(l).toMatchObject({ kind: "sal", state: "pending", signerLevel: "manager", employeeUserId: "wu", onBehalf: false, addressee: "بنك الراجحي", lang: "ar", title: null, purpose: null })
    expect(JSON.stringify(l)).not.toMatch(/6000|basic/)
    expect(letterPay(id)).toMatchObject({ organizationId: ORG, employeeId: "e1", employeeUserId: "wu", basic: 6_000, housing: 1_500, transport: 600 })
    expect(letterTotal(letterPay(id)!)).toBe(8_100)
    expect(logOf("e1").map((x) => x.kind)).toEqual(["letter_filed"])
    // No serial until it is signed.
    expect(l.serial).toBeUndefined()
  })

  it("a free letter carries his words and no figures", async () => {
    const { id } = await fileLetter(db, worker, ORG, who(worker), { employeeId: "e1", kind: "oth", title: "خطاب للجامعة", purpose: "على رأس العمل للدراسة المسائية", addressee: "جامعة الملك سعود", lang: "ar" })
    expect(letter(id)).toMatchObject({ title: "خطاب للجامعة", purpose: "على رأس العمل للدراسة المسائية" })
    expect(letterPay(id)).toBeNull()
  })

  it("refuses what the form refuses", async () => {
    expect(await refusal(fileLetter(db, worker, ORG, who(worker), { employeeId: "e1", kind: "noc", addressee: "المرور", lang: "en" }))).toEqual({ code: "blocked", blocks: ["no_purpose"] })
    seed("employees/e2", { ...empBase, userId: "w2" })
    expect(await refusal(fileLetter(db, ctx([], { uid: "w2", employeeId: "e2" }), ORG, { uid: "w2", name: null }, { employeeId: "e2", kind: "sal", addressee: "x", lang: "ar" }))).toEqual({ code: "blocked", blocks: ["no_wage"] })
  })

  it("only the HR manager asks for someone else", async () => {
    expect((await refusal(fileLetter(db, gov, ORG, who(gov), { employeeId: "e1", kind: "noc", purpose: "x", addressee: "x", lang: "ar" }))).code).toBe("no_role")
    const { id } = await fileLetter(db, hrm, ORG, who(hrm), { employeeId: "e1", kind: "emb", addressee: "سفارة إيطاليا", lang: "en" })
    expect(letter(id)).toMatchObject({ onBehalf: true, signerLevel: "gov", employeeUserId: "wu" })
  })

  it("the HR manager's own goes to management; the officer's own embassy letter to the HR manager", async () => {
    const a = await fileLetter(db, hrm, ORG, who(hrm), { employeeId: "e-hrm", kind: "sal", addressee: "x", lang: "ar" })
    expect(letter(a.id).signerLevel).toBe("management")
    const b = await fileLetter(db, gov, ORG, who(gov), { employeeId: "e-gov", kind: "emb", addressee: "x", lang: "ar" })
    expect(letter(b.id).signerLevel).toBe("manager")
  })
})

describe("signing (issueLetter / declineLetter)", () => {
  it("a standard letter issues from the card with a yearly serial; the card and letterhead are frozen on it", async () => {
    const { id } = await fileLetter(db, worker, ORG, who(worker), { employeeId: "e1", kind: "sal", addressee: "بنك", lang: "ar" })
    const { serial } = await issueLetter(db, hrm, id, who(hrm), { head }, { today: "2026-10-04" })
    expect(serial).toBe("LT-2026/001")
    const l = letter(id)
    expect(l).toMatchObject({ state: "issued", serial, issuedOn: "2026-10-04", text: null, head, decision: { by: "hrm", role: "manager", ownFlagged: false } })
    expect(l.card).toEqual({ nameAr: "سارة", nameEn: "Sara", nationality: "eg", gender: "f", idNo: "2412345678", trade: "accountant", join: "2023-05-01", lastDay: null })
    expect(readDoc("mfgCounters/org__LT__2026")).toMatchObject({ last: 1 })
    const second = await fileLetter(db, worker, ORG, who(worker), { employeeId: "e1", kind: "noc", purpose: "رخصة", addressee: "المرور", lang: "ar" })
    expect((await issueLetter(db, hrm, second.id, who(hrm), { head, text: "لا مانع من استخراج رخصة قيادة." }, { today: "2026-10-05" })).serial).toBe("LT-2026/002")
    expect(logOf("e1").map((x) => x.kind)).toEqual(["letter_filed", "letter_issued", "letter_filed", "letter_issued"])
  })

  it("signing refreshes the figures when the signer may read pay", async () => {
    const { id } = await fileLetter(db, worker, ORG, who(worker), { employeeId: "e1", kind: "sal", addressee: "بنك", lang: "ar" })
    seed("employeePay/e1", { employeeId: "e1", organizationId: ORG, basic: 7_000, housing: 1_750, transport: 600 })
    await issueLetter(db, hrm, id, who(hrm), { head }, { today: "2026-10-04" })
    expect(letterPay(id)).toMatchObject({ basic: 7_000, housing: 1_750 })
  })

  it("government relations signs an embassy letter without reading pay; it may name the approved leave", async () => {
    seed("hrRequests/lv1", { organizationId: ORG, kind: "leave", state: "approved", employeeId: "e1", leave: { type: "annual", from: "2026-11-01", to: "2026-11-20" } })
    seed("hrRequests/lv2", { organizationId: ORG, kind: "leave", state: "pending", employeeId: "e1", leave: { type: "annual", from: "2026-12-01", to: "2026-12-05" } })
    const { id } = await fileLetter(db, worker, ORG, who(worker), { employeeId: "e1", kind: "emb", addressee: "سفارة إيطاليا", lang: "en" })
    seed("employeePay/e1", { employeeId: "e1", organizationId: ORG, basic: 9_999, housing: 0, transport: 0 })
    expect(await refusal(issueLetter(db, gov, id, who(gov), { head, travelRequestId: "lv2" }))).toEqual({ code: "blocked", blocks: ["bad_travel"] })
    await issueLetter(db, gov, id, who(gov), { head, travelRequestId: "lv1" }, { today: "2026-10-04" })
    expect(letter(id)).toMatchObject({ state: "issued", travel: { from: "2026-11-01", to: "2026-11-20", requestId: "lv1" }, decision: { role: "gov" } })
    // Not refreshed: government relations never reads pay (RL-03).
    expect(letterPay(id)).toMatchObject({ basic: 6_000 })
  })

  it("the HR manager standing in for government relations signs as the HR manager", async () => {
    const { id } = await fileLetter(db, worker, ORG, who(worker), { employeeId: "e1", kind: "emb", addressee: "x", lang: "ar" })
    await issueLetter(db, hrm, id, who(hrm), { head }, { today: "2026-10-04" })
    expect(letter(id).decision).toMatchObject({ role: "manager" })
  })

  it("a free letter is not issued without its text, and the text is the signer's", async () => {
    const { id } = await fileLetter(db, worker, ORG, who(worker), { employeeId: "e1", kind: "oth", title: "خطاب للجامعة", purpose: "على رأس العمل", addressee: "الجامعة", lang: "ar" })
    expect(await refusal(issueLetter(db, hrm, id, who(hrm), { head, text: "  " }))).toEqual({ code: "blocked", blocks: ["no_text"] })
    expect(letter(id).state).toBe("pending")
    await issueLetter(db, hrm, id, who(hrm), { head, text: "لا مانع من التحاقها بالدراسة المسائية." })
    expect(letter(id).text).toBe("لا مانع من التحاقها بالدراسة المسائية.")
  })

  it("nobody signs or declines his own; the wrong role is refused", async () => {
    const own = await fileLetter(db, hrm, ORG, who(hrm), { employeeId: "e-hrm", kind: "emb", addressee: "x", lang: "ar" })
    expect((await refusal(issueLetter(db, hrm, own.id, who(hrm), { head }))).code).toBe("own_request")
    expect((await refusal(declineLetter(db, hrm, own.id, who(hrm), "no")))).toMatchObject({ code: "own_request" })
    const sal = await fileLetter(db, worker, ORG, who(worker), { employeeId: "e1", kind: "sal", addressee: "x", lang: "ar" })
    expect((await refusal(issueLetter(db, gov, sal.id, who(gov), { head }))).code).toBe("no_role")
    expect((await refusal(issueLetter(db, payroll, sal.id, who(payroll), { head }))).code).toBe("no_role")
    const mine = await fileLetter(db, hrm, ORG, who(hrm), { employeeId: "e-hrm", kind: "sal", addressee: "x", lang: "ar" })
    await issueLetter(db, mgmt, mine.id, who(mgmt), { head })
    expect(letter(mine.id).decision).toMatchObject({ role: "management", by: "ceo" })
  })

  it("a decline needs a reason the employee sees; a decided letter never moves again", async () => {
    const { id } = await fileLetter(db, worker, ORG, who(worker), { employeeId: "e1", kind: "noc", purpose: "رخصة قيادة", addressee: "المرور", lang: "en" })
    expect(await refusal(declineLetter(db, hrm, id, who(hrm), "  "))).toEqual({ code: "blocked", blocks: ["no_reason"] })
    await declineLetter(db, hrm, id, who(hrm), "أرفق خطاب المرور")
    expect(letter(id)).toMatchObject({ state: "declined", decision: { note: "أرفق خطاب المرور", role: "manager" } })
    expect(letter(id).serial).toBeUndefined()
    expect(await refusal(issueLetter(db, hrm, id, who(hrm), { head, text: "x" }))).toEqual({ code: "blocked", blocks: ["stale"] })
    expect(await refusal(declineLetter(db, hrm, id, who(hrm), "again"))).toEqual({ code: "blocked", blocks: ["stale"] })
  })

  it("the employee is told, in keys each reader renders in his language", async () => {
    const { id } = await fileLetter(db, worker, ORG, who(worker), { employeeId: "e1", kind: "sal", addressee: "x", lang: "ar" })
    await issueLetter(db, hrm, id, who(hrm), { head }, { today: "2026-10-04" })
    const [n] = listCollection<{ type: string; link: string; title: string; message: string; i18n: { title: string; params: Record<string, string> } }>("users/wu/notifications")
    expect(n).toMatchObject({ type: "hr_letter_issued", link: "hr/me", i18n: { title: "pn_hr_letter_issued_title", params: { serial: "LT-2026/001", letter: "@hr_letter_kind.sal" } } })
    // The stored text (push, the mobile app) in the Arabic copy, the serial as it reads in Arabic.
    expect(n).toMatchObject({ title: "صدر خطابك", message: "تعريف بالراتب — خ-2026/001" })
  })
})

describe("display and the signer's queue (Today)", () => {
  it("the serial reads خ in Arabic, the digits unchanged", () => {
    expect(letterNoDisplay("LT-2026/118", "ar")).toBe("خ-2026/118")
    expect(letterNoDisplay("LT-2026/118", "en")).toBe("LT-2026/118")
    expect(letterNoDisplay(null, "ar")).toBe("")
  })

  it("letters waiting for this viewer only, oldest first, with the purpose", () => {
    const base = { organizationId: ORG, addressee: "x", lang: "ar" as const, employeeUserId: null, employeeName: "سارة", filedBy: { by: "wu", byName: null, at: "" }, onBehalf: false, title: null }
    const letters: HrLetter[] = [
      { ...base, id: "a", kind: "sal", purpose: null, employeeId: "e1", signerLevel: "manager", state: "pending", createdAt: "2026-10-02" },
      { ...base, id: "b", kind: "emb", purpose: null, employeeId: "e1", signerLevel: "gov", state: "pending", createdAt: "2026-10-01" },
      { ...base, id: "c", kind: "noc", purpose: "x".repeat(80), employeeId: "e1", signerLevel: "manager", state: "pending", createdAt: "2026-09-30" },
      { ...base, id: "d", kind: "sal", purpose: null, employeeId: "e-hrm", signerLevel: "management", state: "pending", createdAt: "2026-09-29" },
      { ...base, id: "e", kind: "sal", purpose: null, employeeId: "e1", signerLevel: "manager", state: "issued", createdAt: "2026-09-28" },
    ]
    expect(lettersToSign(hrm, letters).map((l) => l.id)).toEqual(["c", "b", "a"])
    expect(lettersToSign(gov, letters).map((l) => l.id)).toEqual(["b"])
    expect(lettersToSign(mgmt, letters).map((l) => l.id)).toEqual(["d"])
    expect(lettersToSign(worker, letters)).toEqual([])
    const [row] = letterTodayRows(hrm, letters)
    expect(row).toMatchObject({ key: "letter:c", kind: "letter_to_sign", action: "sign", href: "people/e1", params: { letter: "noc", name: "سارة" } })
    expect(row.params.purpose).toHaveLength(71)
  })
})
