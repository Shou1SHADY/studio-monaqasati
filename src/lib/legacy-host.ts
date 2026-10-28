import { PRIMARY_ORIGIN } from "@/lib/app-env"

const LEGACY_HOSTS = new Set(["mdmaktech.sa", "www.mdmaktech.sa", "www.mdmak.sa"])

/** Where a page request on an old host goes: the same path and query on the primary domain. The API is never moved — the
 * mobile app and webhooks keep calling it where they always did — and only a GET/HEAD is redirected. `enabled` is the
 * switch the owner flips once the primary domain serves the site. */
export function legacyHostRedirect(input: { enabled: boolean; method: string; host: string | null; pathname: string; search: string }): string | null {
  if (!input.enabled || input.pathname.startsWith("/api/")) return null
  if (input.method !== "GET" && input.method !== "HEAD") return null
  const host = (input.host ?? "").toLowerCase().replace(/:\d+$/, "")
  if (!LEGACY_HOSTS.has(host)) return null
  return `${PRIMARY_ORIGIN}${input.pathname}${input.search}`
}
