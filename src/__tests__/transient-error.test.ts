import { AUTO_RETRY_WINDOW_MS, isTransientLoadError, mayAutoRetry } from "@/lib/transient-error"

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
