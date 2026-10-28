export const DEFAULT_PUBLIC_BASE_URL = "https://mdmak.sa"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

/** The origin of the running deployment: UAT's links open UAT, production's open production. A localhost value (a
 * developer's machine pointed at real data) never ends up in a link someone else receives. */
export function publicBaseUrl(): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "")
  if (!configured) return DEFAULT_PUBLIC_BASE_URL
  try {
    const url = new URL(configured)
    if (LOCAL_HOSTS.has(url.hostname) || (url.protocol !== "https:" && url.protocol !== "http:")) return DEFAULT_PUBLIC_BASE_URL
    return url.origin
  } catch {
    return DEFAULT_PUBLIC_BASE_URL
  }
}

export const LINK_PATHS = { rfq: "rfq", offer: "offer", po: "po" } as const

export const linkUrl = (kind: keyof typeof LINK_PATHS, token: string): string => `${publicBaseUrl()}/${LINK_PATHS[kind]}/${token}`
