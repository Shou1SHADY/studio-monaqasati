import { legacyHostRedirect } from "@/lib/legacy-host"

const on = { enabled: true, method: "GET", pathname: "/ar/pricing", search: "?x=1" }

describe("the redirect from the old domain to the primary one", () => {
  it.each(["mdmaktech.sa", "www.mdmaktech.sa", "MDMAKTECH.SA", "mdmaktech.sa:443", "www.mdmak.sa"])("sends a page on %s to mdmak.sa with its path and query", (host) => {
    expect(legacyHostRedirect({ ...on, host })).toBe("https://mdmak.sa/ar/pricing?x=1")
  })

  it("does nothing until the switch is on", () => {
    expect(legacyHostRedirect({ ...on, enabled: false, host: "mdmaktech.sa" })).toBeNull()
  })

  it("leaves the primary domain, the UAT hosts and unknown hosts alone", () => {
    for (const host of ["mdmak.sa", "uat.mdmaktech.sa", "notifications.mdmaktech.sa", "studio-monaqasati--mdmaktech-uat.us-east4.hosted.app", null]) {
      expect(legacyHostRedirect({ ...on, host })).toBeNull()
    }
  })

  it("never moves the API — the mobile app and webhooks keep calling it where they did", () => {
    expect(legacyHostRedirect({ ...on, host: "mdmaktech.sa", pathname: "/api/invitations/lookup" })).toBeNull()
  })

  it("moves only a page read, not a POST", () => {
    expect(legacyHostRedirect({ ...on, host: "mdmaktech.sa", method: "POST" })).toBeNull()
    expect(legacyHostRedirect({ ...on, host: "mdmaktech.sa", method: "HEAD" })).toBe("https://mdmak.sa/ar/pricing?x=1")
  })
})
