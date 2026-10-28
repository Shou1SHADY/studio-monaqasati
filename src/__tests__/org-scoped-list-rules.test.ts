import fs from "fs"
import path from "path"

const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8").replace(/\r\n/g, "\n")

const listRule = (collection: string): string => {
  const start = rules.indexOf(`match /${collection}/{`)
  expect(start).toBeGreaterThan(-1)
  return rules.slice(start).match(/allow list: if ([^;]*);/)?.[1] ?? ""
}

describe("collections every client reads with an organizationId filter", () => {
  it.each(["crmContacts", "crmOpportunities", "crmQuotations", "crmOrgProfile", "crmActivities", "warehouses"])(
    "%s can be listed only inside the reader's own company",
    (collection) => {
      expect(listRule(collection)).toBe("orgReadable()")
    }
  )
})
