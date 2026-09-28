/**
 * PM 1.0 — the document register (DOC-01), official correspondence (COR-01)
 * and what the consultant portal shows as waiting on him. A drawing revised
 * after the last certificate is stale; revision codes run R01, R02…; a letter
 * past its deadline with no reply is late; letters number ص-/و- per direction.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { portalItems } from "@/lib/pm/consultant-portal"
import {
  isLetterLate,
  lateBy,
  letterAge,
  letterBlocks,
  letterLabel,
  letterNumber,
  parseLinks,
  projectSeq,
  replyBlocks,
  type PmLetter,
} from "@/lib/pm/correspondence"
import { logLetter, logReply, PmLetterError } from "@/lib/pm/correspondence-writes"
import {
  currentRevision,
  isStale,
  issuedAfterCertificate,
  lastCertificateDay,
  nextRevisionCode,
  previousCode,
  revisionBlocks,
  staleDocuments,
  type PmDocument,
} from "@/lib/pm/documents"
import { issueRevision, PmDocError, registerDocument } from "@/lib/pm/documents-writes"
import { todayDay } from "@/lib/pm/format"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const qs: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.cost"] }), seat: { uid: "qs1", role: "qs" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const pmA = { uid: "pm1", name: "Abdullah" }
const qsA = { uid: "qs1", name: "Mona" }

const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const today = todayDay()
const rev = (code: string, day: string) => ({ code, day, by: "pm1" })

beforeEach(() => {
  resetFakeDb()
  seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/014", lifecycle: "live" } })
})

describe("documents — which revision is current, and is it stale", () => {
  it("revision codes run R01, R02… whatever the stored code looks like", () => {
    expect(nextRevisionCode(null)).toBe("R01")
    expect(nextRevisionCode("—")).toBe("R01")
    expect(nextRevisionCode("R03")).toBe("R04")
    expect(nextRevisionCode("rev 9")).toBe("R10")
  })

  it("the current revision is the last one, and it superseded the one before", () => {
    const d = { revisions: [rev("R01", "2026-01-01"), rev("R02", "2026-03-01")] }
    expect(currentRevision(d)?.code).toBe("R02")
    expect(previousCode(d)).toBe("R01")
    expect(currentRevision({ revisions: [] })).toBeNull()
    expect(previousCode({ revisions: [rev("R01", "2026-01-01")] })).toBeNull()
  })

  it("the last certificate is the latest prepared one that was not voided", () => {
    expect(lastCertificateDay([])).toBeNull()
    expect(lastCertificateDay([{ status: "appr", prepOn: "2026-05-01" }, { status: "void", prepOn: "2026-07-01" }, { status: "sub", prepOn: "2026-06-01" }])).toBe("2026-06-01")
  })

  it("only a drawing revised after the last certificate is stale — and nothing is before any certificate", () => {
    const revised = { type: "dwg" as const, revisions: [rev("R01", "2026-01-01"), rev("R02", "2026-06-10")] }
    expect(isStale(revised, "2026-06-01")).toBe(true)
    expect(isStale(revised, "2026-06-10")).toBe(false)
    expect(isStale(revised, null)).toBe(false)
    expect(isStale({ ...revised, type: "spec" }, "2026-06-01")).toBe(false)
    expect(isStale({ type: "dwg", revisions: [rev("R01", "2026-06-10")] }, "2026-06-01")).toBe(false)
    expect(staleDocuments([revised, { ...revised, type: "permit" as const }], "2026-06-01")).toHaveLength(1)
  })

  it("the form warns when an existing drawing's new revision is dated after the last certificate", () => {
    expect(issuedAfterCertificate({ type: "dwg", hasCurrent: true, day: "2026-06-10", lastCertDay: "2026-06-01" })).toBe(true)
    expect(issuedAfterCertificate({ type: "dwg", hasCurrent: false, day: "2026-06-10", lastCertDay: "2026-06-01" })).toBe(false)
    expect(issuedAfterCertificate({ type: "dwg", hasCurrent: true, day: "2026-05-10", lastCertDay: "2026-06-01" })).toBe(false)
    expect(issuedAfterCertificate({ type: "dwg", hasCurrent: true, day: "2026-06-10", lastCertDay: null })).toBe(false)
  })

  it("a new document needs a name; a revision needs an unused code dated no earlier than the current one", () => {
    expect(revisionBlocks({ archived: false, isNew: true, doc: null, name: " ", code: "", day: today, today })).toEqual(["no_name"])
    const d = { revisions: [rev("R01", "2026-01-01"), rev("R02", "2026-03-01")] }
    expect(revisionBlocks({ archived: false, isNew: false, doc: d, code: "", day: "2026-04-01", today: "2026-05-01" })).toEqual(["no_code"])
    expect(revisionBlocks({ archived: false, isNew: false, doc: d, code: "r02", day: "2026-04-01", today: "2026-05-01" })).toEqual(["same_code"])
    expect(revisionBlocks({ archived: false, isNew: false, doc: d, code: "R03", day: "2026-02-01", today: "2026-05-01" })).toEqual(["before_current"])
    expect(revisionBlocks({ archived: false, isNew: false, doc: d, code: "R03", day: "2026-06-01", today: "2026-05-01" })).toEqual(["future_day"])
    expect(revisionBlocks({ archived: true, isNew: false, doc: null, code: "R03", day: "2026-04-01", today: "2026-05-01" })).toEqual(["archived", "no_doc"])
  })

  it("the project manager registers a document and appends revisions; the numbers come from pm.docCount", async () => {
    const seq = await registerDocument(db, pm, "p1", pmA, { name: "Architectural drawings", type: "dwg", code: "r01", day: shift(today, -30) })
    expect(seq).toBe(1)
    expect(readDoc<{ pm: { docCount: number } }>("projects/p1")!.pm.docCount).toBe(1)
    await issueRevision(db, pm, "p1", pmA, 1, { code: "R02", day: today, file: { url: "https://x/y.pdf", name: "y.pdf" } })
    const d = readDoc<PmDocument>("projects/p1/pmDocs/01")!
    expect(d.revisions.map((r) => r.code)).toEqual(["R01", "R02"])
    expect(d.revisions[1]).toMatchObject({ by: "pm1", file: { name: "y.pdf" } })
    await expect(issueRevision(db, pm, "p1", pmA, 1, { code: "R02", day: today })).rejects.toBeInstanceOf(PmDocError)

    await registerDocument(db, pm, "p1", pmA, { name: "Building permit", type: "permit", code: "", day: today })
    expect(readDoc<PmDocument>("projects/p1/pmDocs/02")!.revisions).toEqual([])
  })

  it("the register is the manager's: a QS without approve is refused", async () => {
    await expect(registerDocument(db, qs, "p1", qsA, { name: "Spec", type: "spec", code: "R01", day: today })).rejects.toBeInstanceOf(PmAccessError)
  })
})

describe("correspondence — dates, deadlines and replies", () => {
  const letter = (over: Partial<PmLetter>): PmLetter => ({ id: "01", seq: 1, no: "014/001", dir: "out", party: "cons", subject: "x", day: "2026-09-01", due: 7, status: "out", links: [], by: "u", ...over })

  it("a letter past its deadline with no reply is late, by the days past it", () => {
    const l = letter({ day: "2026-09-01", due: 7 })
    expect(letterAge(l, "2026-09-13")).toBe(12)
    expect(isLetterLate(l, "2026-09-08")).toBe(false)
    expect(isLetterLate(l, "2026-09-13")).toBe(true)
    expect(lateBy(l, "2026-09-13")).toBe(5)
    expect(isLetterLate({ ...l, status: "rep" }, "2026-09-13")).toBe(false)
    expect(isLetterLate({ ...l, status: "in" }, "2026-09-13")).toBe(true)
    expect(isLetterLate({ ...l, due: 0 }, "2026-12-31")).toBe(false)
  })

  it("numbers read ص-014/023 and و-014/017, the prefix following the language", () => {
    expect(projectSeq("PJ-2026/014")).toBe("014")
    expect(projectSeq(null)).toBe("000")
    expect(letterNumber("PJ-2026/014", 23)).toBe("014/023")
    expect(letterLabel({ dir: "out", no: "014/023" }, "ar")).toBe("ص-014/023")
    expect(letterLabel({ dir: "in", no: "014/017" }, "ar")).toBe("و-014/017")
    expect(letterLabel({ dir: "out", no: "014/023" }, "en")).toBe("OUT-014/023")
  })

  it("linked references split on any separator, once each", () => {
    expect(parseLinks("أ.ت-03، مط-014/02; RFI-07, RFI-07")).toEqual(["أ.ت-03", "مط-014/02", "RFI-07"])
    expect(parseLinks("  ")).toEqual([])
  })

  it("a letter needs a subject, a past date and a whole-day deadline; a reply needs text dated between the letter and today", () => {
    expect(letterBlocks({ archived: false, subject: " ", day: "2026-10-01", due: -1, today: "2026-09-28" })).toEqual(["no_subject", "future_day", "bad_due"])
    expect(letterBlocks({ archived: false, subject: "x", day: "2026-09-28", due: 7, today: "2026-09-28" })).toEqual([])
    expect(replyBlocks({ archived: false, status: "rep", text: "", on: "2026-08-01", letterDay: "2026-09-01", today: "2026-09-28" })).toEqual(["wrong_state", "no_text", "before_letter"])
    expect(replyBlocks({ archived: false, status: "in", text: "ok", on: "2026-09-10", letterDay: "2026-09-01", today: "2026-09-28" })).toEqual([])
  })

  it("letters number per direction and a reply closes them; corr is the duty", async () => {
    const a = await logLetter(db, qs, "p1", qsA, { dir: "out", party: "cons", subject: "Clarification", day: shift(today, -12), due: 7, links: "RFI-07" })
    const b = await logLetter(db, qs, "p1", qsA, { dir: "in", party: "cons", subject: "Site instruction 17", day: shift(today, -5), due: 5, links: "" })
    const c = await logLetter(db, qs, "p1", qsA, { dir: "out", party: "gov", subject: "Permit", day: today, due: 30, links: "" })
    expect([a.no, b.no, c.no]).toEqual(["014/001", "014/001", "014/002"])
    expect(readDoc<{ pm: Record<string, number> }>("projects/p1")!.pm).toMatchObject({ letterCount: 3, lettersOut: 2, lettersIn: 1 })
    const first = readDoc<PmLetter>("projects/p1/pmLetters/01")!
    expect(first).toMatchObject({ status: "out", links: ["RFI-07"], due: 7 })
    expect(isLetterLate(first, today)).toBe(true)
    expect(readDoc<PmLetter>("projects/p1/pmLetters/02")!.status).toBe("in")

    await logReply(db, qs, "p1", qsA, 1, { text: "Relocate the duct 20 cm", on: today })
    expect(readDoc<PmLetter>("projects/p1/pmLetters/01")!).toMatchObject({ status: "rep", reply: { text: "Relocate the duct 20 cm", by: "qs1" } })
    await expect(logReply(db, qs, "p1", qsA, 1, { text: "again", on: today })).rejects.toBeInstanceOf(PmLetterError)
    await expect(logLetter(db, site, "p1", { uid: "se1", name: "Omar" }, { dir: "out", party: "cons", subject: "x", day: today, due: 7, links: "" })).rejects.toBeInstanceOf(PmAccessError)
  })
})

describe("consultant portal — what waits on him", () => {
  it("five sources, only what is with him, oldest first", () => {
    const items = portalItems({
      submittals: [
        { seq: 1, status: "sub", day: "2026-09-10", title: "Marble" },
        { seq: 2, status: "appA", day: "2026-09-01", title: "Tiles" },
      ],
      inspections: [
        { seq: 3, status: "open", party: "consultant", day: "2026-09-20", location: "Villa 3" },
        { seq: 4, status: "open", party: "authority", day: "2026-09-02", location: "Gate" },
        { seq: 5, status: "pass", party: "consultant", day: "2026-09-02", location: "Roof" },
      ],
      punch: [
        { seq: 6, status: "fix", source: "cons", day: "2026-08-01", fixOn: "2026-09-15", what: "Crack" },
        { seq: 7, status: "fix", source: "own", day: "2026-08-01", fixOn: "2026-09-15", what: "Paint" },
      ],
      letters: [
        { no: "014/023", dir: "out", party: "cons", status: "out", day: "2026-09-05", subject: "Clash" },
        { no: "014/017", dir: "in", party: "cons", status: "in", day: "2026-09-04", subject: "SI 17" },
        { no: "014/021", dir: "out", party: "own", status: "out", day: "2026-09-03", subject: "Access" },
      ],
      ncrs: [{ seq: 8, status: "plan", day: "2026-08-20", planOn: "2026-09-12", title: "Honeycombing" }],
    })
    expect(items.map((x) => `${x.kind}:${x.no}`)).toEqual(["corr:014/023", "subm:01", "ncr:08", "punch:06", "wir:03"])
  })
})
