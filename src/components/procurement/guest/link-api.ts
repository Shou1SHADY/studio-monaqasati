// The visitor page's calls: one place that keeps the session his verified mobile bought (in his browser, for its twelve hours)
// and sends it on every act that needs an identity. Nothing here is trusted by the server — it checks the session itself.

export interface StoredSession {
  secret: string
  expiresAt: string
  phone: string
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: string; status: number }

const keyOf = (token: string) => `mdmak.link.session.${token}`
const viewerKey = "mdmak.link.viewer"

export function readSession(token: string): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(keyOf(token))
    if (!raw) return null
    const s = JSON.parse(raw) as StoredSession
    return s?.secret && Date.parse(s.expiresAt) > Date.now() ? s : null
  } catch {
    return null
  }
}

export function saveSession(token: string, session: StoredSession | null): void {
  try {
    if (session) window.localStorage.setItem(keyOf(token), JSON.stringify(session))
    else window.localStorage.removeItem(keyOf(token))
  } catch {
    // Private windows can refuse storage; the page then asks for a code again.
  }
}

/** A random id this browser keeps, so opening the link twice in half an hour is one view. */
export function viewerId(): string {
  try {
    const stored = window.localStorage.getItem(viewerKey)
    if (stored && /^[A-Za-z0-9_-]{16,64}$/.test(stored)) return stored
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    const id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    window.localStorage.setItem(viewerKey, id)
    return id
  } catch {
    return ""
  }
}

export interface LinkApi {
  token: string
  call: <T>(path: string, init?: { method?: string; json?: unknown; form?: FormData; session?: string | null }) => Promise<ApiResult<T>>
  session: () => StoredSession | null
}

export function makeLinkApi(token: string): LinkApi {
  return {
    token,
    session: () => readSession(token),
    call: async <T,>(path: string, init: { method?: string; json?: unknown; form?: FormData; session?: string | null } = {}): Promise<ApiResult<T>> => {
      const secret = init.session === undefined ? readSession(token)?.secret : init.session
      try {
        const res = await fetch(`/api/rfq-share/${token}${path}`, {
          method: init.method ?? (init.json !== undefined || init.form ? "POST" : "GET"),
          headers: { ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}), ...(secret ? { "x-link-session": secret } : {}) },
          body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
        })
        const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T; code?: string } | null
        if (res.ok && json?.success) return { ok: true, data: json.data as T }
        return { ok: false, code: json?.code || "INTERNAL", status: res.status }
      } catch {
        return { ok: false, code: "NETWORK", status: 0 }
      }
    },
  }
}
