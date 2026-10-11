/**
 * The Documents page lists files that were attached on records long before the document thread
 * existed. Each source keeps its files in its own shape; these tests pin how every one of them
 * becomes a library item, how a file that is both a record's and a thread's is kept once, and
 * that the page's filters and counters treat both kinds alike.
 */
import {
  NO_LIBRARY_FILTER,
  applyLibraryFilter,
  fileKey,
  filesOf,
  itemHref,
  itemLabel,
  libraryCounts,
  mergeLibrary,
  storagePathOfUrl,
  type LibraryItem,
  type RecordFile,
} from "@/lib/document-library"
import {
  crmRecordFiles,
  handoverRecordFiles,
  isoOf,
  offerRecordFiles,
  opportunityHasFiles,
  pmSubsWithRecords,
  projectRecordFiles,
  receiptRecordFiles,
  refOf,
  rfqRecordFiles,
} from "@/lib/document-records"
import type { ThreadEntry } from "@/lib/document-thread"

const link = (path: string) => `https://firebasestorage.googleapis.com/v0/b/mdmak.appspot.com/o/${encodeURIComponent(path)}?alt=media&token=abc`
const project = { id: "pj1", name: "Yasmin Villas", pm: { no: "PJ-2026/001", docCount: 2, sheetCount: 1, wirCount: 0, ncrCount: 1 } }

const thread = (over: Partial<ThreadEntry> = {}): ThreadEntry => ({
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

describe("how a stored file reference is read", () => {
  it("accepts a link, a {url, name}, a {path, name, size, contentType}, and nothing else", () => {
    expect(refOf(link("rfqs/pdfs/1700000000000-spec.pdf"))).toMatchObject({ name: "spec.pdf", path: null })
    expect(refOf({ url: "https://x.test/a.png", name: "site.png" })).toMatchObject({ url: "https://x.test/a.png", name: "site.png" })
    expect(refOf({ path: "organizations/o/crm/opportunities/d/1_boq.xlsx", name: "boq.xlsx", size: 90, contentType: "application/vnd.ms-excel" })).toMatchObject({ path: "organizations/o/crm/opportunities/d/1_boq.xlsx", size: 90 })
    expect(refOf({ name: "no place" })).toBeNull()
    expect(refOf("")).toBeNull()
    expect(refOf("javascript:alert(1)")).toBeNull()
    expect(refOf({ url: "javascript:alert(1)", name: "x" })).toBeNull()
  })

  it("finds the Storage object inside a download link, so a link and a path to one file are one file", () => {
    const path = "rfqs/pdfs/1700000000000-spec.pdf"
    expect(storagePathOfUrl(link(path))).toBe(path)
    expect(fileKey({ url: link(path) })).toBe(fileKey({ path }))
    expect(fileKey({ url: "https://x.test/a.png" })).toBe("u:https://x.test/a.png")
  })

  it("reads a stored time whatever it was written as", () => {
    expect(isoOf("2026-10-05T10:00:00.000Z")).toBe("2026-10-05T10:00:00.000Z")
    expect(isoOf({ toDate: () => new Date("2026-10-05T10:00:00.000Z") })).toBe("2026-10-05T10:00:00.000Z")
    expect(isoOf({ seconds: 1790000000 })).toBe(new Date(1790000000 * 1000).toISOString())
    expect(isoOf(undefined)).toBe("")
  })
})

describe("RFQ files", () => {
  const url = link("rfqs/pdfs/1700000000000-spec.pdf")
  const rfq = {
    id: "r1",
    title: "Rebar supply",
    rfqNumber: "RFQ-12",
    status: "New",
    createdAt: "2026-09-20T08:00:00.000Z",
    createdByUserId: "u9",
    createdByUserName: "Omar",
    attachments: [{ name: "spec.pdf", url, path: "rfqs/pdfs/1700000000000-spec.pdf" }],
    pdfUrl: url,
    pdfStoragePath: "rfqs/pdfs/1700000000000-spec.pdf",
  }

  it("lists each attachment once even though pdfUrl repeats the first, and is shared once published", () => {
    const files = rfqRecordFiles(rfq)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ kind: "record", source: "rfq", recordKind: "rfq_file", name: "spec.pdf", url, path: "rfqs/pdfs/1700000000000-spec.pdf", authorId: "u9", authorName: "Omar", shared: true, targetLabel: "Rebar supply", detail: "RFQ-12", at: "2026-09-20T08:00:00.000Z" })
    expect(files[0].href).toBe("/contractor/rfqs/r1")
    expect(files[0].supplierHref).toBe("/supplier/rfqs")
  })

  it("keeps a draft's files to the buyer, and reads older bare-link attachments", () => {
    expect(rfqRecordFiles({ ...rfq, status: "Draft" })[0].shared).toBe(false)
    const old = rfqRecordFiles({ id: "r2", title: "Old", status: "New", attachments: ["https://old.test/files/plan.pdf"] })
    expect(old).toHaveLength(1)
    expect(old[0].url).toBe("https://old.test/files/plan.pdf")
    expect(old[0].at).toBe("")
  })

  it("lists nothing for an RFQ with no files", () => {
    expect(rfqRecordFiles({ id: "r3", title: "Bare", status: "New" })).toEqual([])
  })
})

describe("offer files", () => {
  const offer = {
    id: "o1",
    rfqId: "r1",
    rfqTitle: "Rebar supply",
    companyName: "Acme Steel",
    supplierId: "s1",
    submittedByUserId: "s2",
    submittedByUserName: "Sara",
    createdAt: "2026-09-22T09:00:00.000Z",
    offerPdfUrl: link("offers/pdfs/1701000000000-quote.pdf"),
    manualProofUrl: link("rfqs/proof/1702000000000-mail.png"),
    guestPapers: [{ kind: "cr", name: "cr.pdf", url: link("rfqShareLinks/l1/papers/o1/cr-1-cr.pdf"), contentType: "application/pdf", size: 10, at: "2026-09-22T10:00:00.000Z" }],
  }

  it("separates the supplier's quote, the buyer's own proof and a guest's papers", () => {
    const files = offerRecordFiles(offer)
    expect(files.map((f) => [f.recordKind, f.name, f.shared])).toEqual([
      ["offer_quote", "quote.pdf", true],
      ["offer_proof", "mail.png", false],
      ["offer_paper", "cr.pdf", true],
    ])
    const quote = files[0]
    expect(quote).toMatchObject({ source: "offer", authorId: "s2", authorName: "Sara", targetLabel: "Rebar supply", detail: "Acme Steel" })
    expect(files[2].at).toBe("2026-09-22T10:00:00.000Z")
  })

  it("opens the offers of the RFQ on the buyer's side and the supplier's offers on his", () => {
    const [quote] = offerRecordFiles(offer)
    expect(quote.href).toBe("/contractor/rfqs/r1/offers")
    expect(quote.supplierHref).toBe("/supplier/offers")
    expect(offerRecordFiles({ id: "o2", offerPdfUrl: "https://x.test/q.pdf" })[0].href).toBe("/contractor/rfqs")
  })

  it("lists nothing for an offer that attached no file", () => {
    expect(offerRecordFiles({ id: "o3", companyName: "X" })).toEqual([])
  })
})

describe("goods receipt and delivery notice files", () => {
  const notice = {
    id: "d1",
    docNumber: "GR-2026/031",
    poNumber: "PO-2026/014",
    poId: "p1",
    contractorOrgId: "buy",
    supplierOrgId: "sup",
    supplierId: "s1",
    supplierName: "Acme Steel",
    createdAt: { toDate: () => new Date("2026-10-01T07:00:00.000Z") },
    attachmentUrls: [link("deliveries/manual/buy/1703000000000_note.jpg"), "https://other.test/delivery.pdf"],
  }

  it("names a bare link after its file, and a supplier's notice is shared", () => {
    const files = receiptRecordFiles(notice, "en")
    expect(files.map((f) => f.name)).toEqual(["note.jpg", "delivery.pdf"])
    expect(files[0]).toMatchObject({ source: "receipt", recordKind: "receipt_file", shared: true, authorId: "s1", authorName: "Acme Steel", at: "2026-10-01T07:00:00.000Z", targetLabel: "GR-2026/031", detail: "PO-2026/014" })
    expect(files[0].href).toBe("/contractor/goods-received?delivery=d1")
    expect(files[0].supplierHref).toBe("/supplier/orders?po=p1")
  })

  it("shows the number with the Arabic prefix in Arabic", () => {
    expect(receiptRecordFiles(notice, "ar")[0].targetLabel).toBe("ا.س-2026/031")
  })

  it("keeps a receipt the buyer keyed in to the buyer, in the receiver's name", () => {
    const manual = receiptRecordFiles({ id: "d2", source: "manual", contractorOrgId: "buy", confirmedByUserId: "u1", receivedByName: "Khaled — site store", poNumber: "PO-2026/020", attachmentUrls: ["https://x.test/inv.jpg"] }, "en")
    expect(manual[0]).toMatchObject({ shared: false, authorId: "u1", authorName: "Khaled", targetLabel: "PO-2026/020" })
  })
})

describe("project record files", () => {
  const f = (name: string) => ({ url: `https://files.test/${name}`, name })
  const stamp = { by: "u3", byName: "Hind", day: "2026-09-10" }

  it("reads the document register: the file and every revision, naming the revision", () => {
    const files = projectRecordFiles("pmDocs", { id: "01", seq: 1, name: "Floor plan", type: "dwg", file: f("p0.pdf"), revisions: [{ code: "R01", day: "2026-09-11", file: f("p1.pdf") }, { code: "R02", day: "2026-09-12", file: f("p2.pdf") }], ...stamp }, project)
    expect(files.map((x) => [x.name, x.detail, x.at])).toEqual([
      ["p0.pdf", "Floor plan", "2026-09-10"],
      ["p1.pdf", "Floor plan · R01", "2026-09-11"],
      ["p2.pdf", "Floor plan · R02", "2026-09-12"],
    ])
    expect(files[0]).toMatchObject({ source: "project", recordKind: "pm_doc", shared: false, authorId: "u3", authorName: "Hind", targetLabel: "Yasmin Villas", href: "/contractor/projects/pj1?tab=pmDocs" })
  })

  it("reads a letter and its reply", () => {
    const files = projectRecordFiles("pmLetters", { id: "02", seq: 2, no: "001/004", file: f("out.pdf"), reply: { on: "2026-09-20", file: f("in.pdf") }, ...stamp }, project)
    expect(files.map((x) => [x.name, x.detail, x.at, x.recordKind])).toEqual([
      ["out.pdf", "001/004", "2026-09-10", "pm_letter"],
      ["in.pdf", "001/004", "2026-09-20", "pm_letter"],
    ])
    expect(files[0].href).toBe("/contractor/projects/pj1?tab=pmCorr")
  })

  it("reads a measurement sheet's take-off", () => {
    const [x] = projectRecordFiles("pmSheets", { id: "03", seq: 3, files: [f("takeoff.pdf")], ...stamp }, project)
    expect(x).toMatchObject({ name: "takeoff.pdf", detail: "#03", recordKind: "pm_sheet" })
    expect(x.href).toBe("/contractor/projects/pj1?tab=pmMeasure")
  })

  it("reads every attempt of an inspection, the request's photos and the signed form", () => {
    const files = projectRecordFiles("pmInspections", { id: "01", seq: 1, attempts: [{ files: [f("ready.jpg")], rFiles: [f("form1.pdf")] }, { files: [], rFiles: [f("form2.pdf")] }], ...stamp }, project)
    expect(files.map((x) => x.name)).toEqual(["ready.jpg", "form1.pdf", "form2.pdf"])
    expect(files[0].recordKind).toBe("pm_inspection")
  })

  it("reads an NCR, its plan and its acceptance", () => {
    const files = projectRecordFiles("pmNcrs", { id: "01", seq: 1, files: [f("a.jpg")], plan: { files: [f("plan.pdf")] }, accepted: { files: [f("ok.pdf")] }, ...stamp }, project)
    expect(files.map((x) => x.name)).toEqual(["a.jpg", "plan.pdf", "ok.pdf"])
  })

  it("reads a punch item, its fix and its confirmation", () => {
    const files = projectRecordFiles("pmPunch", { id: "01", seq: 1, files: [f("a.jpg")], fix: { files: [f("fixed.jpg")] }, conf: { files: [f("signed.pdf")] }, ...stamp }, project)
    expect(files.map((x) => x.name)).toEqual(["a.jpg", "fixed.jpg", "signed.pdf"])
    expect(files[0].recordKind).toBe("pm_punch")
  })

  it("reads a submittal and its reply", () => {
    const files = projectRecordFiles("pmSubmittals", { id: "01", seq: 1, files: [f("catalogue.pdf")], reply: { files: [f("reply.pdf")] }, ...stamp }, project)
    expect(files.map((x) => x.name)).toEqual(["catalogue.pdf", "reply.pdf"])
    expect(files[0].recordKind).toBe("pm_sample")
  })

  it("reads a variation and its decision", () => {
    const files = projectRecordFiles("pmVariations", { id: "01", seq: 1, files: [f("instruction.pdf")], decision: { files: [f("approval.pdf")] }, ...stamp }, project)
    expect(files.map((x) => x.name)).toEqual(["instruction.pdf", "approval.pdf"])
    expect(files[0].recordKind).toBe("pm_variation")
  })

  it("reads a contract addendum's copies, opening the project's info tab", () => {
    const [x] = projectRecordFiles("pmAddenda", { id: "01", seq: 1, files: [f("addendum.pdf")], ...stamp }, project)
    expect(x).toMatchObject({ name: "addendum.pdf", recordKind: "pm_addendum", href: "/contractor/projects/pj1?tab=info" })
  })

  it("falls back to the project's number when it has no name, and never reads a record that holds nothing", () => {
    expect(projectRecordFiles("pmSheets", { id: "04", seq: 4, files: [f("a.pdf")], ...stamp }, { id: "pj2", name: "", pm: { no: "PJ-2026/002" } })[0].targetLabel).toBe("PJ-2026/002")
    expect(projectRecordFiles("pmSheets", { id: "05", seq: 5, lines: [], ...stamp }, project)).toEqual([])
  })

  it("opens only the subcollections whose counters say they hold records", () => {
    expect(pmSubsWithRecords(project)).toEqual(["pmDocs", "pmSheets", "pmNcrs"])
    expect(pmSubsWithRecords({ id: "legacy", name: "Old", pm: null })).toEqual([])
    expect(pmSubsWithRecords({ id: "bare", name: "Bare", pm: {} })).toEqual([])
  })

  it("reads the files CRM sent with a handover, as Storage paths", () => {
    const files = handoverRecordFiles(
      { id: "h1", title: "Tower B", dealNo: "OP-2026/014", requestedBy: "u5", requestedByName: "Reem", createdAt: "2026-09-30T08:00:00.000Z", files: [{ name: "contract.pdf", path: "organizations/o/crm/opportunities/d1/1_contract.pdf", kind: "contract" }] },
      "ar"
    )
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ source: "project", recordKind: "pm_handover", name: "contract.pdf", path: "organizations/o/crm/opportunities/d1/1_contract.pdf", authorName: "Reem", targetLabel: "Tower B", detail: "ف-2026/014", href: "/contractor/projects/inbox" })
  })
})

describe("CRM deal files", () => {
  const deal = { id: "d1", title: "Tower B fit-out", docNumber: "OP-2026/014" }
  const file = { id: "f1", opportunityId: "d1", kind: "boq", name: "boq.xlsx", path: "organizations/o/crm/opportunities/d1/1_boq.xlsx", size: 4096, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", byId: "u2", byName: "Nader", at: "2026-10-02T11:00:00.000Z", source: "page" }

  it("reads a deal file with its adder, size and the deal it sits on", () => {
    const [x] = crmRecordFiles(file, deal, "en")
    expect(x).toMatchObject({ source: "crm", recordKind: "crm_file", name: "boq.xlsx", path: file.path, size: 4096, authorId: "u2", authorName: "Nader", at: "2026-10-02T11:00:00.000Z", shared: false, targetLabel: "Tower B fit-out", detail: "OP-2026/014" })
    expect(x.href).toBe("/contractor/crm/opportunities/d1")
    expect(x.supplierHref).toBe("/supplier/crm/opportunities/d1")
  })

  it("opens only the deals whose counters hold a file", () => {
    expect(opportunityHasFiles({ fileCounts: { boq: 1, drawings: 0 } })).toBe(true)
    expect(opportunityHasFiles({ fileCounts: { boq: 0 } })).toBe(false)
    expect(opportunityHasFiles({})).toBe(false)
  })
})

describe("one library from both kinds", () => {
  const crm = crmRecordFiles(
    { id: "f1", name: "boq.xlsx", path: "organizations/o/crm/opportunities/d1/1_boq.xlsx", byId: "u2", byName: "Nader", at: "2026-10-02T11:00:00.000Z" },
    { id: "d1", title: "Tower B", docNumber: null },
    "en"
  )
  const rfq = rfqRecordFiles({ id: "r1", title: "Rebar", status: "New", createdAt: "2026-09-20T08:00:00.000Z", attachments: [{ name: "spec.pdf", url: link("rfqs/pdfs/1700000000000-spec.pdf"), path: "rfqs/pdfs/1700000000000-spec.pdf" }] })

  it("lists a file that is both a thread entry and a record once, as the thread entry — however it was linked", () => {
    const asThread = thread({ id: "t1", file: { name: "spec (with notes).pdf", size: 10, contentType: "application/pdf", path: "rfqs/pdfs/1700000000000-spec.pdf" }, at: "2026-10-06T00:00:00.000Z" })
    const merged = mergeLibrary(filesOf([asThread]), [...rfq, ...crm])
    expect(merged.map((i) => i.id)).toEqual(["t1", crm[0].id])
  })

  it("keeps a file two records point at once, the first one", () => {
    const handover = handoverRecordFiles({ id: "h1", title: "Tower B", files: [{ name: "boq.xlsx", path: "organizations/o/crm/opportunities/d1/1_boq.xlsx" }] }, "en")
    const merged = mergeLibrary([], [...crm, ...handover])
    expect(merged).toHaveLength(1)
    expect((merged[0] as RecordFile).source).toBe("crm")
  })

  it("orders everything newest first, a record with no date last", () => {
    const undated = rfqRecordFiles({ id: "r9", title: "Undated", status: "New", attachments: ["https://old.test/a.pdf"] })
    const merged = mergeLibrary(filesOf([thread({ id: "t1", at: "2026-09-01T00:00:00.000Z", file: { name: "t.pdf", size: 1, contentType: "application/pdf", path: "p/t" } })]), [...undated, ...crm, ...rfq])
    expect(merged.map((i) => i.id)).toEqual([crm[0].id, rfq[0].id, "t1", undated[0].id])
  })

  describe("filters and counters", () => {
    const sheet = projectRecordFiles("pmSheets", { id: "03", seq: 3, by: "u1", byName: "Mona", day: "2026-10-03", files: [{ url: "https://files.test/takeoff.png", name: "takeoff.png" }] }, project)
    const offerFiles = offerRecordFiles({ id: "o1", rfqId: "r1", rfqTitle: "Rebar", companyName: "Acme Steel", submittedByUserId: "u8", createdAt: "2026-09-22T09:00:00.000Z", offerPdfUrl: link("offers/pdfs/1701000000000-quote.pdf") })
    const list: LibraryItem[] = mergeLibrary(filesOf([thread({ id: "t1", authorId: "u1" })]), [...rfq, ...crm, ...sheet, ...offerFiles])
    const ids = (f: Partial<typeof NO_LIBRARY_FILTER>, uid = "u1") => applyLibraryFilter(list, { ...NO_LIBRARY_FILTER, ...f }, uid).map((i) => i.id).sort()
    const idOf = (r: RecordFile[]) => r[0].id

    it("filters by the new sources, by who sees the file, by type read from the extension, and by 'added by me'", () => {
      expect(ids({ source: "rfq" })).toEqual([idOf(rfq)])
      expect(ids({ source: "crm" })).toEqual([idOf(crm)])
      expect(ids({ source: "project" })).toEqual([idOf(sheet)])
      expect(ids({ source: "offer" })).toEqual([idOf(offerFiles)])
      expect(ids({ source: "po" })).toEqual(["t1"])
      expect(ids({ audience: "internal" }).sort()).toEqual([idOf(crm), idOf(sheet)].sort())
      expect(ids({ audience: "shared" }).sort()).toEqual(["t1", idOf(rfq), idOf(offerFiles)].sort())
      expect(ids({ type: "image" })).toEqual([idOf(sheet)])
      expect(ids({ type: "sheet" })).toEqual([idOf(crm)])
      expect(ids({ mine: true }).sort()).toEqual(["t1", idOf(sheet)].sort())
      expect(ids({ mine: true }, "")).toEqual([])
    })

    it("searches the record's name, its line, who added it and the file", () => {
      expect(ids({ q: "tower" })).toEqual([idOf(crm)])
      expect(ids({ q: "yasmin" })).toEqual([idOf(sheet)])
      expect(ids({ q: "#03" })).toEqual([idOf(sheet)])
      expect(ids({ q: "acme" })).toEqual([idOf(offerFiles)])
      expect(ids({ q: "nader" })).toEqual([idOf(crm)])
      expect(ids({ q: "spec" })).toEqual([idOf(rfq)])
    })

    it("counts both kinds, adding a source only once it has a file", () => {
      const counts = libraryCounts(list, "u1")
      expect(counts).toMatchObject({ all: 5, shared: 3, internal: 2, mine: 2 })
      expect(counts.byType).toEqual({ pdf: 3, image: 1, sheet: 1, doc: 0, other: 0 })
      expect(counts.bySource).toEqual({ po: 1, offer: 1, rfq: 1, crm: 1, project: 1 })
      expect(libraryCounts(filesOf([thread()]), "u1").bySource).toEqual({ po: 1, offer: 0 })
    })

    it("names a record's source and opens it on the viewer's side", () => {
      expect(itemLabel(crm[0])).toBe("Tower B")
      expect(itemHref(crm[0], "contractor")).toBe("/contractor/crm/opportunities/d1")
      expect(itemHref(crm[0], "supplier")).toBe("/supplier/crm/opportunities/d1")
      expect(itemHref(offerFiles[0], "supplier")).toBe("/supplier/offers")
      expect(itemHref(filesOf([thread()])[0], "supplier")).toBe("/supplier/orders?po=p1")
    })
  })
})
