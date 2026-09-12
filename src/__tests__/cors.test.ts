import { allowedOrigin, corsHeaders, MOBILE_PWA_ORIGINS } from "@/lib/cors"

describe("cors allow-list for the mobile PWA", () => {
  it("echoes a listed origin and nothing else", () => {
    expect(allowedOrigin("https://mdmak-mobile-uat.web.app")).toBe("https://mdmak-mobile-uat.web.app")
    expect(allowedOrigin("https://evil.example")).toBeNull()
    expect(allowedOrigin(null)).toBeNull()
    expect(allowedOrigin("")).toBeNull()
  })

  it("lists every hosted PWA origin", () => {
    for (const origin of MOBILE_PWA_ORIGINS) expect(allowedOrigin(origin)).toBe(origin)
  })

  it("allows the local dev server outside production", () => {
    // Jest runs with NODE_ENV=test, which counts as "not production".
    expect(allowedOrigin("http://localhost:8081")).toBe("http://localhost:8081")
  })

  it("honours CORS_EXTRA_ORIGINS", () => {
    const before = process.env.CORS_EXTRA_ORIGINS
    process.env.CORS_EXTRA_ORIGINS = "https://preview.example, https://two.example"
    try {
      expect(allowedOrigin("https://two.example")).toBe("https://two.example")
    } finally {
      if (before === undefined) delete process.env.CORS_EXTRA_ORIGINS
      else process.env.CORS_EXTRA_ORIGINS = before
    }
  })

  it("never allows credentials and always varies on Origin", () => {
    const h = corsHeaders("https://mdmak-mobile-uat.web.app")
    expect(h["Access-Control-Allow-Origin"]).toBe("https://mdmak-mobile-uat.web.app")
    expect(h["Access-Control-Allow-Headers"]).toContain("Authorization")
    expect(h.Vary).toBe("Origin")
    expect(h["Access-Control-Allow-Credentials"]).toBeUndefined()
  })
})
