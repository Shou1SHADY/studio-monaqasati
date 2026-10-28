/**
 * A page that failed to LOAD, not one that is broken (PUR-09 #3): the first open of
 * Procurement → Orders died with "Connection closed" (the server's stream cut off) and
 * worked on reload. Such an error is retried once by itself; anything else is shown.
 */
const TRANSIENT = [/connection closed/i, /chunkloaderror/i, /loading chunk [\w-]+ failed/i, /failed to fetch/i, /network ?error/i, /load failed/i]

export function isTransientLoadError(error: { message?: string; name?: string } | null | undefined): boolean {
  const text = `${error?.name || ""} ${error?.message || ""}`
  return TRANSIENT.some((re) => re.test(text))
}

/** One automatic retry per page in a minute — never a reload loop. */
export const AUTO_RETRY_WINDOW_MS = 60_000

export function mayAutoRetry(lastRetryAt: number | null, now: number): boolean {
  return lastRetryAt == null || now - lastRetryAt > AUTO_RETRY_WINDOW_MS
}

/**
 * A chunk the browser holds broken (a response cut off mid-way on UAT's small server)
 * is cached `immutable` for a year, so a plain reload runs the same broken copy again.
 * Webpack names the file in the message — "(missing: https://…/_next/static/chunks/…js)"
 * for a script, "(https://…css)" for a stylesheet; only our own static files are taken.
 */
const FAILED_CHUNK = /\((?:missing: )?(https?:\/\/[^)\s]+)\)/

export function failedChunkUrl(error: { message?: string } | null | undefined, origin: string): string | null {
  const m = error?.message?.match(FAILED_CHUNK)
  if (!m) return null
  try {
    const url = new URL(m[1])
    return url.origin === origin && url.pathname.startsWith("/_next/static/") ? url.href : null
  } catch {
    return null
  }
}

/** Fetches the failed chunk past the browser cache, replacing the copy it kept; never throws. */
export async function refreshFailedChunk(error: { message?: string } | null | undefined): Promise<void> {
  const url = failedChunkUrl(error, window.location.origin)
  if (!url) return
  try {
    await fetch(url, { cache: "reload", signal: AbortSignal.timeout(10_000) })
  } catch { /* offline or slow — the reload still happens */ }
}

/** Reload the page after the failed chunk (if any) is fetched again. */
export function reloadAfterLoadError(error: { message?: string } | null | undefined): void {
  void refreshFailedChunk(error).finally(() => window.location.reload())
}
