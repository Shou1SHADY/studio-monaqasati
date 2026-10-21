// PUR-03: «ينشر من المراجعة وحدها». A draft keeps rows begun but unfinished, so no list or tab may flip
// it to «New» in one click; both open the editor on its review step instead.
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")
const list = read("src/app/[locale]/(contractor)/contractor/rfqs/page.tsx")
const project = read("src/app/[locale]/(contractor)/contractor/projects/[id]/page.tsx")

describe("no one-click publish of a draft", () => {
  it.each([
    ["the RFQ list", list],
    ["the project's tenders tab", project],
  ])("%s has no publish write of its own and links to the review step", (_name, source) => {
    expect(source).not.toMatch(/handleBatchPublish|handlePublishTender|handleBulkPublishTenders|bulkPublishPatch|publishFields/)
    expect(source).toContain("rfqReviewHref(")
  })

  it("the BOQ dialog prepares a draft and opens the editor — it creates no published RFQ and no old-category RFQ per section", () => {
    const publish = project.slice(project.indexOf("const handlePublish = async"), project.indexOf("// Starts the custom pointer-based row drag"))
    expect(publish).toContain("boqDraftDoc(")
    expect(publish).toContain("rfqReviewHref(created.id)")
    expect(publish).not.toMatch(/status: *["']New["']|categoryAr|CATEGORIES_DATA/)
  })
})
