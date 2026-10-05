/**
 * The documents component's pure rules (DEV-68): which company an entry is
 * stored for, who may read it, what blocks a post, and how the history merges
 * the thread, the follow-ups and the document's own log.
 */
import {
  canShare,
  entryFromDoc,
  fileTypeAllowed,
  historyOf,
  mergeEntries,
  readableBy,
  sideOf,
  storedParties,
  threadBlocks,
  threadFilePath,
  threadKey,
  threadPrefix,
  type DocParties,
  type ThreadEntry,
} from "@/lib/document-thread"
import type { Activity } from "@/lib/activities"

const registered: DocParties = { buyerOrgId: "buy", supplierOrgId: "sup" }
const guest: DocParties = { buyerOrgId: "buy", supplierOrgId: "guest" }
const offPlatform: DocParties = { buyerOrgId: "buy", supplierOrgId: null }

const entry = (over: Partial<ThreadEntry> = {}): ThreadEntry => ({
  id: "n1",
  targetKey: "po:p1",
  targetKind: "po",
  targetId: "p1",
  kind: "comment",
  visibility: "shared",
  body: "hello",
  file: null,
  authorId: "u1",
  authorName: "Mona",
  authorOrgId: "buy",
  buyerOrgId: "buy",
  supplierOrgId: "sup",
  at: "2026-10-05T10:00:00.000Z",
  ...over,
})

describe("the two companies of a document", () => {
  it("shares only with a supplier who is on the platform", () => {
    expect(canShare(registered)).toBe(true)
    expect(canShare(guest)).toBe(false)
    expect(canShare(offPlatform)).toBe(false)
  })

  it("knows which side the viewer is on, and neither for a stranger", () => {
    expect(sideOf("buy", registered)).toBe("buyer")
    expect(sideOf("sup", registered)).toBe("supplier")
    expect(sideOf("other", registered)).toBeNull()
    expect(sideOf("", registered)).toBeNull()
    expect(sideOf("guest", guest)).toBeNull()
  })

  it("stores both companies for a shared entry, only the author's for an internal one", () => {
    expect(storedParties("shared", "buyer", registered)).toEqual({ buyerOrgId: "buy", supplierOrgId: "sup" })
    expect(storedParties("internal", "buyer", registered)).toEqual({ buyerOrgId: "buy", supplierOrgId: null })
    expect(storedParties("internal", "supplier", registered)).toEqual({ buyerOrgId: null, supplierOrgId: "sup" })
  })

  it("falls back to internal when the document cannot be shared", () => {
    expect(storedParties("shared", "buyer", guest)).toEqual({ buyerOrgId: "buy", supplierOrgId: null })
  })

  it("is readable only by a company the entry names", () => {
    const internal = entry({ visibility: "internal", supplierOrgId: null })
    expect(readableBy(entry(), "sup")).toBe(true)
    expect(readableBy(internal, "sup")).toBe(false)
    expect(readableBy(internal, "buy")).toBe(true)
    expect(readableBy(entry(), "")).toBe(false)
  })
})

describe("what blocks a post", () => {
  const ok = { kind: "comment" as const, body: "ok", visibility: "shared" as const, side: "buyer" as const, parties: registered }
  const file = { name: "a.pdf", size: 1000, contentType: "application/pdf" }

  it("lets a comment through and asks for text", () => {
    expect(threadBlocks(ok)).toEqual([])
    expect(threadBlocks({ ...ok, body: "  " })).toEqual(["no_body"])
    expect(threadBlocks({ ...ok, body: "x".repeat(2001) })).toEqual(["body_long"])
  })

  it("refuses a company that is not a party, and sharing on a guest's document", () => {
    expect(threadBlocks({ ...ok, side: null })).toEqual(["not_a_party"])
    expect(threadBlocks({ ...ok, parties: guest })).toEqual(["not_shareable"])
    expect(threadBlocks({ ...ok, parties: guest, visibility: "internal" })).toEqual([])
  })

  it("takes a file with or without a caption, within 15 MB, of an allowed type", () => {
    expect(threadBlocks({ ...ok, kind: "file", body: "", file })).toEqual([])
    expect(threadBlocks({ ...ok, kind: "file", body: "" })).toEqual(["no_file"])
    expect(threadBlocks({ ...ok, kind: "file", body: "", file: { ...file, size: 0 } })).toEqual(["file_empty"])
    expect(threadBlocks({ ...ok, kind: "file", body: "", file: { ...file, size: 15 * 1024 * 1024 + 1 } })).toEqual(["file_big"])
    expect(threadBlocks({ ...ok, kind: "file", body: "", file: { ...file, contentType: "application/zip" } })).toEqual(["file_type"])
  })

  it("keeps a file under the document's own folder", () => {
    const prefix = threadPrefix("buy", "po:p1")
    expect(threadBlocks({ ...ok, kind: "file", body: "", file: { ...file, path: `${prefix}1-a.pdf` }, pathPrefix: prefix })).toEqual([])
    expect(threadBlocks({ ...ok, kind: "file", body: "", file: { ...file, path: "elsewhere/a.pdf" }, pathPrefix: prefix })).toEqual(["bad_path"])
  })

  it("knows the allowed types", () => {
    for (const t of ["image/png", "application/pdf", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/msword"]) expect(fileTypeAllowed(t)).toBe(true)
    for (const t of ["application/zip", "text/html", "application/x-msdownload", ""]) expect(fileTypeAllowed(t)).toBe(false)
  })
})

describe("storage paths", () => {
  it("names the buyer's company, the document and a cleaned file name", () => {
    expect(threadFilePath("buy", threadKey("po", "p1"), "My offer (final).pdf", 123)).toBe("documents/buy/po:p1/123-My offer _final_.pdf")
  })

  it("cannot be steered out of its folder", () => {
    const p = threadFilePath("buy", "po:p1", "../../etc/passwd", 5)
    expect(p.startsWith("documents/buy/po:p1/5-")).toBe(true)
    expect(p.slice("documents/buy/po:p1/".length)).not.toContain("/")
    expect(threadFilePath("buy", "po:p1", "...", 5)).toBe("documents/buy/po:p1/5-file")
  })
})

describe("reading and merging", () => {
  it("fills what is missing from a stored entry", () => {
    const e = entryFromDoc("x", { kind: "file", file: { name: "a", size: 3, contentType: "image/png", path: "p" }, buyerOrgId: "buy", supplierOrgId: "", visibility: "weird" })
    expect(e).toMatchObject({ id: "x", kind: "file", visibility: "shared", buyerOrgId: "buy", supplierOrgId: null, file: { path: "p", size: 3 } })
    expect(entryFromDoc("y", {}).file).toBeNull()
  })

  it("keeps a shared entry once when both queries return it, oldest first", () => {
    const a = entry({ id: "a", at: "2026-10-05T09:00:00.000Z" })
    const b = entry({ id: "b", at: "2026-10-05T11:00:00.000Z" })
    expect(mergeEntries([b, a], [a]).map((e) => e.id)).toEqual(["a", "b"])
  })
})

describe("the history", () => {
  const act = (over: Partial<Activity>): Activity => ({
    id: "a1",
    organizationId: "buy",
    type: "todo",
    summary: "Chase",
    note: null,
    dueOn: "2026-10-06",
    assigneeId: "u1",
    assigneeName: "Mona",
    createdById: "u1",
    createdByName: "Mona",
    status: "done",
    target: null,
    targetKey: "po:p1",
    doneOn: "2026-10-05",
    doneByName: "Mona",
    ...over,
  })

  it("merges thread entries, closed follow-ups and the document's own log, newest first", () => {
    const items = historyOf([entry({ at: "2026-10-05T10:00:00.000Z" })], [act({ doneOn: "2026-10-04" })], [{ at: "2026-10-05T12:00:00.000Z", byName: "Omar", text: "approved" }])
    expect(items.map((i) => i.type)).toEqual(["host", "comment", "activity_done"])
  })

  it("leaves open follow-ups out and marks a cancelled one as cancelled", () => {
    const items = historyOf([], [act({ id: "o", status: "open", doneOn: null }), act({ id: "c", status: "cancelled" })])
    expect(items.map((i) => i.type)).toEqual(["activity_cancelled"])
  })

  it("is empty for a document nothing happened to", () => {
    expect(historyOf([], [])).toEqual([])
  })
})
