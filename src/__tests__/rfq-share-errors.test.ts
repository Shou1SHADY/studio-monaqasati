/**
 * The share dialog says why a link could not be created: each code the create route returns has its own sentence in both
 * languages, and an unknown failure falls back to the generic one.
 */
import { SHARE_ERROR_CODES, shareErrorKey } from "@/lib/rfq-share-errors"

type Messages = { Portal: { Contractor: Record<string, string> } }
const en = jest.requireActual<Messages>("../../messages/en.json").Portal.Contractor
const ar = jest.requireActual<Messages>("../../messages/ar.json").Portal.Contractor

describe("share link errors", () => {
  it("maps every code the route returns to its own message, in both languages", () => {
    for (const code of SHARE_ERROR_CODES) {
      const key = shareErrorKey(code)
      expect(key).toBe(`rfq_share_err_${code.toLowerCase()}`)
      expect([en[key], ar[key]].every((v) => typeof v === "string" && v.length > 0)).toBe(true)
    }
  })

  it("falls back to the generic sentence for anything else", () => {
    expect(shareErrorKey("FAILED")).toBe("rfq_share_generate_failed")
    expect(shareErrorKey("")).toBe("rfq_share_generate_failed")
  })

  it("names every error code the create route can return", () => {
    const route = jest.requireActual<{ readFileSync: (p: string, e: string) => string }>("fs").readFileSync("src/app/api/rfq-share/create/route.ts", "utf8")
    const codes = [...route.matchAll(/errorResponse\([^)]*?"([A-Z_]+)",\s*\d+\)/g)].map((m) => m[1])
    expect(codes.length).toBeGreaterThan(3)
    for (const code of codes) expect(SHARE_ERROR_CODES as readonly string[]).toContain(code)
  })
})
