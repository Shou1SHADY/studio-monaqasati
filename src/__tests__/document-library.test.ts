/**
 * The Documents page's pure rules (DEV-71): which thread entries are files, how a file is
 * typed, how the list is searched and filtered, what the counters say, and where a file's
 * document opens on each side.
 */
import {
  NO_LIBRARY_FILTER,
  applyLibraryFilter,
  countLibraryFilters,
  fileKindOf,
  filesOf,
  isShared,
  libraryCounts,
  sourceHref,
  sourceLabel,
  type LibraryFile,
} from "@/lib/document-library"
import type { ThreadEntry } from "@/lib/document-thread"

const entry = (over: Partial<ThreadEntry> = {}): ThreadEntry => ({
  id: "n1",
  targetKey: "po:p1",
  targetKind: "po",
  targetId: "p1",
  targetLabel: "PO-2026/012",
  targetHref: "/contractor/rfqs/orders?po=p1",
  targetSupplierHref: "/supplier/orders?po=p1",
  kind: "file",
  visibility: "shared",
  body: "",
  file: { name: "quote.pdf", size: 2048, contentType: "application/pdf", path: "documents/buy/po:p1/1-quote.pdf" },
  authorId: "u1",
  authorName: "Mona",
  authorOrgId: "buy",
  buyerOrgId: "buy",
  supplierOrgId: "sup",
  at: "2026-10-05T10:00:00.000Z",
  ...over,
})

const files = (list: ThreadEntry[]) => filesOf(list)

describe("what counts as a file", () => {
  it("is a file entry with its file, newest first; comments are not files", () => {
    const list = files([
      entry({ id: "old", at: "2026-10-01T09:00:00.000Z" }),
      entry({ id: "comment", kind: "comment", file: null, body: "hi" }),
      entry({ id: "new", at: "2026-10-06T09:00:00.000Z" }),
      entry({ id: "broken", file: null }),
    ])
    expect(list.map((e) => e.id)).toEqual(["new", "old"])
  })

  it("is shared when both companies of the document read it", () => {
    expect(isShared(entry())).toBe(true)
    expect(isShared(entry({ supplierOrgId: null }))).toBe(false)
    expect(isShared(entry({ buyerOrgId: null }))).toBe(false)
  })
})

describe("the type of a file", () => {
  it("is read from the content type, then from the extension", () => {
    expect(fileKindOf("application/pdf")).toBe("pdf")
    expect(fileKindOf("image/png")).toBe("image")
    expect(fileKindOf("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("sheet")
    expect(fileKindOf("text/csv")).toBe("sheet")
    expect(fileKindOf("application/msword")).toBe("doc")
    expect(fileKindOf("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("doc")
    expect(fileKindOf("application/octet-stream", "scan.PDF")).toBe("pdf")
    expect(fileKindOf("", "book.xlsx")).toBe("sheet")
    expect(fileKindOf("application/zip", "a.zip")).toBe("other")
  })
})

describe("searching and filtering", () => {
  const list: LibraryFile[] = files([
    entry({ id: "a", file: { name: "Steel quote.pdf", size: 1, contentType: "application/pdf", path: "p1" }, authorId: "u1", authorName: "Mona", targetLabel: "PO-2026/012" }),
    entry({ id: "b", file: { name: "site photo.png", size: 1, contentType: "image/png", path: "p2" }, authorId: "u2", authorName: "Omar", targetKind: "offer", targetId: "o1", targetLabel: "Rebar RFQ", supplierOrgId: null, body: "the gate" }),
    entry({ id: "c", file: { name: "prices.xlsx", size: 1, contentType: "application/vnd.ms-excel", path: "p3" }, authorId: "u1", authorName: "Mona", targetKind: "offer", targetId: "o2", targetLabel: "Cement RFQ" }),
  ])
  const ids = (f: Partial<typeof NO_LIBRARY_FILTER>) => applyLibraryFilter(list, { ...NO_LIBRARY_FILTER, ...f }, "u1").map((e) => e.id).sort()

  it("with no filter shows everything", () => {
    expect(ids({})).toEqual(["a", "b", "c"])
    expect(countLibraryFilters(NO_LIBRARY_FILTER)).toBe(0)
  })

  it("searches the file name, the caption, the document and who added it — every word, case blind", () => {
    expect(ids({ q: "steel" })).toEqual(["a"])
    expect(ids({ q: "gate" })).toEqual(["b"])
    expect(ids({ q: "rebar" })).toEqual(["b"])
    expect(ids({ q: "omar" })).toEqual(["b"])
    expect(ids({ q: "cement prices" })).toEqual(["c"])
    expect(ids({ q: "nothing like this" })).toEqual([])
  })

  it("filters by type, by who sees it, by kind of document, and by 'added by me'", () => {
    expect(ids({ type: "pdf" })).toEqual(["a"])
    expect(ids({ type: "image" })).toEqual(["b"])
    expect(ids({ audience: "internal" })).toEqual(["b"])
    expect(ids({ audience: "shared" })).toEqual(["a", "c"])
    expect(ids({ source: "offer" })).toEqual(["b", "c"])
    expect(ids({ mine: true })).toEqual(["a", "c"])
  })

  it("filters combine, and each applied one is counted", () => {
    expect(ids({ source: "offer", mine: true })).toEqual(["c"])
    expect(countLibraryFilters({ q: " x ", type: "pdf", audience: "shared", source: "po", mine: true })).toBe(5)
    expect(countLibraryFilters({ ...NO_LIBRARY_FILTER, q: "   " })).toBe(0)
  })

  it("counts what each chip would show", () => {
    expect(libraryCounts(list, "u1")).toEqual({ all: 3, shared: 2, internal: 1, mine: 2, byType: { pdf: 1, image: 1, sheet: 1, doc: 0, other: 0 }, bySource: { po: 1, offer: 2 } })
  })
})

describe("the document a file sits on", () => {
  it("is named by its label, or by its id when written before labels were kept", () => {
    expect(sourceLabel(entry())).toBe("PO-2026/012")
    expect(sourceLabel(entry({ targetLabel: "", targetId: "p9" }))).toBe("p9")
  })

  it("opens on the viewer's own side", () => {
    expect(sourceHref(entry(), "contractor")).toBe("/contractor/rfqs/orders?po=p1")
    expect(sourceHref(entry(), "supplier")).toBe("/supplier/orders?po=p1")
  })

  it("falls back to the document's list when no link was kept", () => {
    const bare = { targetHref: "", targetSupplierHref: "" }
    expect(sourceHref(entry({ ...bare }), "contractor")).toBe("/contractor/rfqs/orders?po=p1")
    expect(sourceHref(entry({ ...bare }), "supplier")).toBe("/supplier/orders?po=p1")
    expect(sourceHref(entry({ ...bare, targetKind: "offer", targetId: "o1" }), "contractor")).toBe("/contractor/rfqs")
    expect(sourceHref(entry({ ...bare, targetKind: "offer", targetId: "o1" }), "supplier")).toBe("/supplier/offers")
  })
})
