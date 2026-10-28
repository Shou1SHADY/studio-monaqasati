import { AUTO_RETRY_WINDOW_MS, failedChunkUrl, isTransientLoadError, mayAutoRetry } from "@/lib/transient-error"

describe("a page that failed to load (PUR-09 #3)", () => {
  it("knows a cut connection or a missing chunk from a real crash", () => {
    expect(isTransientLoadError({ message: "Connection closed." })).toBe(true)
    expect(isTransientLoadError({ name: "ChunkLoadError", message: "Loading chunk 812 failed." })).toBe(true)
    expect(isTransientLoadError({ message: "TypeError: Failed to fetch" })).toBe(true)
    expect(isTransientLoadError({ message: "Cannot read properties of undefined (reading 'lines')" })).toBe(false)
    expect(isTransientLoadError(null)).toBe(false)
  })
  it("retries once, then shows the error", () => {
    expect(mayAutoRetry(null, 1000)).toBe(true)
    expect(mayAutoRetry(1000, 1000 + AUTO_RETRY_WINDOW_MS - 1)).toBe(false)
    expect(mayAutoRetry(1000, 1000 + AUTO_RETRY_WINDOW_MS + 1)).toBe(true)
  })
})

describe("a chunk the browser holds broken", () => {
  const origin = "https://uat.mdmaktech.sa"
  it("names our own static file from webpack's message, script or stylesheet", () => {
    const js = "Loading chunk 65023 failed.\n(missing: https://uat.mdmaktech.sa/_next/static/chunks/65023-d758bdbef8b6cbef.js)"
    expect(failedChunkUrl({ message: js }, origin)).toBe("https://uat.mdmaktech.sa/_next/static/chunks/65023-d758bdbef8b6cbef.js")
    const css = "Loading CSS chunk 812 failed.\n(https://uat.mdmaktech.sa/_next/static/css/a1b2.css)"
    expect(failedChunkUrl({ message: css }, origin)).toBe("https://uat.mdmaktech.sa/_next/static/css/a1b2.css")
  })
  it("takes nothing that is not our static file", () => {
    expect(failedChunkUrl({ message: "Loading chunk 1 failed.\n(missing: https://evil.example/_next/static/x.js)" }, origin)).toBeNull()
    expect(failedChunkUrl({ message: "Loading chunk 1 failed.\n(missing: https://uat.mdmaktech.sa/api/x)" }, origin)).toBeNull()
    expect(failedChunkUrl({ message: "Connection closed." }, origin)).toBeNull()
    expect(failedChunkUrl(null, origin)).toBeNull()
  })
})
