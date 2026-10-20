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
