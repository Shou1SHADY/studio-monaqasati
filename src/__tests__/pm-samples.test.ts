/**
 * PM 1.0 — material samples (SUB-01…03, INV-18). An item that requires a
 * sample is approved iff the consultant approved it; no sample is not consent;
 * never two with the consultant; a reply is one of three.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { replyBlocks, sampleApproved, sampleStateOf, submitBlocks, type PmSubmittal } from "@/lib/pm/sample"
import { PmSampleError, recordSampleReply, setSampleRequired, submitSample } from "@/lib/pm/sample-writes"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const seA = { uid: "se1", name: "Omar" }
const line = () => readDoc<{ pmSample?: boolean; pmSub?: string; pmSubRev?: number }>("projects/p1/boqItems/i1")!
const sub = (n: string) => readDoc<PmSubmittal>(`projects/p1/pmSubmittals/${n}`) as PmSubmittal

beforeEach(() => {
  resetFakeDb()
  seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/003", lifecycle: "live" } })
  seed("projects/p1/boqItems/i1", { itemNo: "05-02", quantity: 400, unitPrice: 90 })
})

describe("the sample gate", () => {
  it("no sample means not approved; only appA/appB approve (SUB-02, INV-18)", () => {
    expect(sampleStateOf({ pmSample: true })).toBe("not_submitted")
    expect(sampleApproved({ pmSample: true })).toBe(false)
    expect(sampleApproved({ pmSample: true, pmSub: "sub" })).toBe(false)
    expect(sampleApproved({ pmSample: true, pmSub: "rej" })).toBe(false)
    expect(sampleApproved({ pmSample: true, pmSub: "appB" })).toBe(true)
    expect(sampleApproved({ pmSample: false })).toBe(true)
  })

  it("never two with the consultant, never after approval; a reply needs its choice", () => {
    expect(submitBlocks({ archived: false, itemId: "i1", supplier: " ", pmSub: "sub" })).toEqual(["no_supplier", "with_consultant"])
    expect(submitBlocks({ archived: false, itemId: "i1", supplier: "X", pmSub: "appA" })).toEqual(["already_approved"])
    expect(replyBlocks({ archived: false, status: "sub", reply: undefined })).toEqual(["no_choice"])
  })
})

describe("the writes", () => {
  it("a rejected sample is resubmitted as the next revision, then approved", async () => {
    await setSampleRequired(db, pm, "p1", "i1", true)
    expect(line().pmSample).toBe(true)
    const a = await submitSample(db, site, "p1", seA, { itemId: "i1", supplier: "Saudi Ceramics" })
    expect(line()).toMatchObject({ pmSub: "sub", pmSubRev: 1 })
    await expect(submitSample(db, site, "p1", seA, { itemId: "i1", supplier: "Other" })).rejects.toBeInstanceOf(PmSampleError)
    await expect(recordSampleReply(db, site, "p1", seA, a, { reply: null })).rejects.toBeInstanceOf(PmSampleError)
    await recordSampleReply(db, site, "p1", seA, a, { reply: "rej", note: "Wrong shade" })
    expect(sampleApproved(line())).toBe(false)
    const b = await submitSample(db, site, "p1", seA, { itemId: "i1", supplier: "Saudi Ceramics" })
    expect(sub("02")).toMatchObject({ rev: 2, status: "sub" })
    await recordSampleReply(db, site, "p1", seA, b, { reply: "appB" })
    expect(line().pmSub).toBe("appB")
    expect(sampleApproved(line())).toBe(true)
  })

  it("which items require a sample is approve's — the site engineer cannot mark them", async () => {
    await expect(setSampleRequired(db, site, "p1", "i1", true)).rejects.toBeInstanceOf(PmAccessError)
  })
})
