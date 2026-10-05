/**
 * documentNotes in firestore.rules (DEV-68): a thread entry is read only by a
 * company it names, written by a member of one of the document's own companies in
 * his own name, and never changed or deleted. Jest runs over an in-memory
 * Firestore with no rules, so the rule text is pinned here.
 */
import fs from "fs"
import path from "path"

const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8").replace(/\r\n/g, "\n")
const strip = (s: string) => s.replace(/\/\/[^\n]*/g, "")

function block(): string {
  const start = rules.indexOf("match /documentNotes/{noteId} {")
  expect(start).toBeGreaterThan(-1)
  const rest = rules.slice(start + 1)
  const next = rest.search(/\n {4}(match \/|function |\/\/ [A-Z])/)
  return strip(next < 0 ? rest : rest.slice(0, next))
}
const rule = (body: string, kind: string) => body.match(new RegExp(`allow ${kind}[^:]*: if ([\\s\\S]*?);`))?.[1] ?? ""

describe("documentNotes rules", () => {
  const body = block()

  it("is read by a member of a company the entry names, or the admin", () => {
    const read = rule(body, "get, list")
    expect(read).toContain("isOrgMember(resource.data.buyerOrgId)")
    expect(read).toContain("isOrgMember(resource.data.supplierOrgId)")
    expect(read).toContain("isAdmin()")
  })

  it("is written in the author's own name, by a member of one of the named companies", () => {
    const create = rule(body, "create")
    expect(create).toContain("request.resource.data.authorId == request.auth.uid")
    expect(create).toContain("isOrgMember(request.resource.data.buyerOrgId) || isOrgMember(request.resource.data.supplierOrgId)")
  })

  it("is a comment or a file, shared or internal, with a bounded text and a comment that has one", () => {
    const create = rule(body, "create")
    expect(create).toContain("request.resource.data.kind in ['comment', 'file']")
    expect(create).toContain("request.resource.data.visibility in ['shared', 'internal']")
    expect(create).toContain("request.resource.data.body.size() <= 2000")
    expect(create).toContain("request.resource.data.kind == 'file' || request.resource.data.body.size() > 0")
  })

  it("keeps an internal entry to one company: the other is null", () => {
    expect(rule(body, "create")).toContain("visibility == 'shared' || request.resource.data.buyerOrgId == null || request.resource.data.supplierOrgId == null")
  })

  it("names only the order's own companies, on the order it points at", () => {
    const create = rule(body, "create")
    expect(create).toContain("targetKind == 'po'")
    expect(create).toContain("targetKey == 'po:' + request.resource.data.targetId")
    expect(create).toContain("noteMatchesPo(request.resource.data.targetId)")
    const fn = strip(rules.slice(rules.indexOf("function noteMatchesPo(poId) {")))
    expect(fn).toContain("purchaseOrders/$(poId)")
    expect(fn).toContain("request.resource.data.buyerOrgId == p.organizationId")
    expect(fn).toContain("request.resource.data.supplierOrgId == p.supplierOrgId")
  })

  it("is never edited or deleted", () => {
    expect(rule(body, "update, delete")).toBe("false")
  })
})
