import { scrubTokens, sentryOptions } from "@/lib/sentry-options"

describe("Sentry never sees a guest link's token", () => {
  it("masks the token in every guest route, page or API, keeping the rest of the URL", () => {
    expect(scrubTokens("https://mdmaktech.sa/receive/Ab3_xY9-qq?locale=en")).toBe("https://mdmaktech.sa/receive/[token]?locale=en")
    expect(scrubTokens("/en/offer/tok123")).toBe("/en/offer/[token]")
    expect(scrubTokens("GET /rfq/abc#top")).toBe("GET /rfq/[token]#top")
    expect(scrubTokens("/api/receipt-links/abc/code")).toBe("/api/receipt-links/[token]/code")
    expect(scrubTokens("/api/guest-offer/abc/action")).toBe("/api/guest-offer/[token]/action")
    expect(scrubTokens("/api/rfq-share/abc/offer")).toBe("/api/rfq-share/[token]/offer")
  })

  it("leaves portal routes alone", () => {
    expect(scrubTokens("/contractor/rfqs/HIX5ifjUQw0UyRoHqeL6/offers")).toBe("/contractor/rfqs/HIX5ifjUQw0UyRoHqeL6/offers")
    expect(scrubTokens(undefined)).toBeUndefined()
  })

  it("scrubs error events and breadcrumbs, and sends nothing about the person or request", () => {
    const o = sentryOptions()
    const event = o.beforeSend!({ type: undefined, request: { url: "https://x/receive/secret" }, transaction: "/receive/secret", breadcrumbs: [{ data: { url: "/api/receipt-links/secret/sign" } }] }, {}) as unknown as {
      request: { url: string }
      transaction: string
      breadcrumbs: Array<{ data: { url: string } }>
    }
    expect(JSON.stringify(event)).not.toContain("secret")
    expect(o.dataCollection).toMatchObject({ userInfo: false, cookies: false, httpHeaders: false, httpBodies: [] })
    expect(o.enabled).toBe(false)
  })
})
