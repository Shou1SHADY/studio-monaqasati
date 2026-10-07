/**
 * Posting on a document's thread: what is stored for which company, who is told,
 * and what is refused before anything is written.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, resetFakeDb } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { ThreadError, attachThreadFile, postComment } from "@/lib/document-thread-writes"

const db = fakeFirestore as unknown as Firestore
const target = { kind: "po" as const, id: "p1", label: "PO-2026/012", href: "/contractor/rfqs/orders?po=p1", supplierHref: "/supplier/orders?po=p1" }
const parties = { buyerOrgId: "buy", supplierOrgId: "sup" }
const notify = { buyer: ["bu1"], supplier: ["su1"] }
const buyer = { uid: "bu1", name: "Mona", orgId: "buy" }
const supplier = { uid: "su1", name: "Khaled", orgId: "sup" }

type Note = Record<string, unknown>
const notes = () => listCollection<Note>("documentNotes")

beforeEach(() => resetFakeDb())

describe("a comment", () => {
  it("shared: stored for both companies, in the author's name, and the other side is told with its own link", async () => {
    await postComment(db, buyer, { target, parties, visibility: "shared", notify, body: "  When can you deliver? " })
    expect(notes()).toHaveLength(1)
    expect(notes()[0]).toMatchObject({ targetKey: "po:p1", kind: "comment", visibility: "shared", body: "When can you deliver?", authorId: "bu1", authorOrgId: "buy", buyerOrgId: "buy", supplierOrgId: "sup" })
    const [n] = listCollection<{ type: string; link: string; i18n: { params: Record<string, unknown> } }>("users/su1/notifications")
    expect(n).toMatchObject({ type: "doc_comment", link: "/supplier/orders?po=p1", i18n: { params: { about: "PO-2026/012", text: "When can you deliver?" } } })
    expect(listCollection("users/bu1/notifications")).toHaveLength(0)
  })

  it("keeps the document's name and where it opens on each side, so the Documents page can link back to it", async () => {
    await postComment(db, buyer, { target, parties, visibility: "shared", notify, body: "hi" })
    expect(notes()[0]).toMatchObject({ targetLabel: "PO-2026/012", targetHref: "/contractor/rfqs/orders?po=p1", targetSupplierHref: "/supplier/orders?po=p1" })
  })

  it("the supplier's reply goes to the buyer's side", async () => {
    await postComment(db, supplier, { target, parties, visibility: "shared", notify, body: "Sunday" })
    const [n] = listCollection<{ link: string }>("users/bu1/notifications")
    expect(n.link).toBe("/contractor/rfqs/orders?po=p1")
  })

  it("internal: stored for the author's company only and nobody is told", async () => {
    await postComment(db, buyer, { target, parties, visibility: "internal", notify, body: "Price looks high" })
    expect(notes()[0]).toMatchObject({ visibility: "internal", buyerOrgId: "buy", supplierOrgId: null })
    expect(listCollection("users/su1/notifications")).toHaveLength(0)
    await postComment(db, supplier, { target, parties, visibility: "internal", notify, body: "Margin is thin" })
    expect(notes()[1]).toMatchObject({ visibility: "internal", buyerOrgId: null, supplierOrgId: "sup" })
  })

  it("on a guest supplier's document is refused as shared and fine as internal", async () => {
    const guest = { buyerOrgId: "buy", supplierOrgId: "guest" }
    await expect(postComment(db, buyer, { target, parties: guest, visibility: "shared", body: "x" })).rejects.toMatchObject({ blocks: ["not_shareable"] })
    await postComment(db, buyer, { target, parties: guest, visibility: "internal", body: "x" })
    expect(notes()).toHaveLength(1)
  })

  it("is refused for a company that is not a party, an empty text, and writes nothing", async () => {
    await expect(postComment(db, { uid: "z", name: "Z", orgId: "other" }, { target, parties, visibility: "internal", body: "hi" })).rejects.toBeInstanceOf(ThreadError)
    await expect(postComment(db, buyer, { target, parties, visibility: "shared", body: "   " })).rejects.toMatchObject({ blocks: ["no_body"] })
    expect(notes()).toHaveLength(0)
  })
})

describe("an attachment", () => {
  const file = { name: "quote.pdf", size: 2048, contentType: "application/pdf", path: "documents/buy/po:p1/1-quote.pdf" }

  it("is stored with its file, a caption, and tells the other side its name", async () => {
    await attachThreadFile(db, supplier, { target, parties, visibility: "shared", notify, file, body: "signed copy" })
    expect(notes()[0]).toMatchObject({ kind: "file", body: "signed copy", file, authorId: "su1", visibility: "shared" })
    const [n] = listCollection<{ type: string; i18n: { params: Record<string, unknown> } }>("users/bu1/notifications")
    expect(n).toMatchObject({ type: "doc_file", i18n: { params: { text: "quote.pdf" } } })
  })

  it("refuses a big, empty or wrong-typed file before writing", async () => {
    await expect(attachThreadFile(db, buyer, { target, parties, visibility: "internal", file: { ...file, size: 20 * 1024 * 1024 } })).rejects.toMatchObject({ blocks: ["file_big"] })
    await expect(attachThreadFile(db, buyer, { target, parties, visibility: "internal", file: { ...file, contentType: "application/zip" } })).rejects.toMatchObject({ blocks: ["file_type"] })
    expect(notes()).toHaveLength(0)
  })
})
