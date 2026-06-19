export type LoginHint = "google" | "generic"

/**
 * Asks the server whether a failed email/password login is actually a Google account.
 * Always resolves — never rejects, never blocks the login UX.
 * Call only after a credential-error failure; do NOT call preemptively.
 */
export async function fetchLoginHint(email: string): Promise<LoginHint> {
  try {
    const res = await fetch("/api/login-hint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return "generic"
    const data: unknown = await res.json()
    return (data as any)?.hint === "google" ? "google" : "generic"
  } catch {
    return "generic"
  }
}
