import { NextRequest, NextResponse } from "next/server"
import { createSign } from "crypto"
import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

// Adjust these two constants to tune the rate limit.
const RATE_LIMIT_REQUESTS = 20
const RATE_LIMIT_WINDOW = "60 s"

// Lazy singleton — created once, reused across warm invocations.
let ratelimit: Ratelimit | null = null

function getRatelimit(): Ratelimit | null {
  if (ratelimit) return ratelimit
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  try {
    ratelimit = new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW),
      prefix: "login-hint",
    })
    return ratelimit
  } catch {
    return null
  }
}

// Cache the Google access token across warm invocations (valid 60 min, cached 55 min).
let cachedToken: { value: string; expiresAt: number } | null = null

async function getGoogleAccessToken(): Promise<string | null> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
  if (!clientEmail || !privateKey) return null

  try {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
    const payload = Buffer.from(
      JSON.stringify({
        iss: clientEmail,
        sub: clientEmail,
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
        scope: "https://www.googleapis.com/auth/identitytoolkit",
      })
    ).toString("base64url")

    const signer = createSign("RSA-SHA256")
    signer.update(`${header}.${payload}`)
    const signature = signer.sign(privateKey, "base64url")
    const jwt = `${header}.${payload}.${signature}`

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    })
    if (!res.ok) return null

    const data = (await res.json()) as { access_token?: string }
    const token = data.access_token ?? null
    if (token) cachedToken = { value: token, expiresAt: Date.now() + 55 * 60 * 1000 }
    return token
  } catch {
    return null
  }
}

const generic = () => NextResponse.json({ hint: "generic" })

export async function POST(req: NextRequest) {
  // --- Rate limit by client IP ---
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown"
  try {
    const limiter = getRatelimit()
    if (limiter) {
      const { success } = await limiter.limit(ip)
      if (!success) return generic()
    }
  } catch {
    // Redis unreachable — fail open, never block login UX
  }

  // --- Parse body ---
  let email: string
  try {
    const body = await req.json()
    email = String(body?.email ?? "").trim().toLowerCase()
  } catch {
    return generic()
  }

  if (!email.includes("@")) return generic()

  // --- Provider lookup via Firebase Identity Toolkit REST API ---
  // Uses Node.js crypto + fetch — no firebase-admin package, no ESM conflicts.
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID
    if (!projectId) return generic()

    const accessToken = await getGoogleAccessToken()
    if (!accessToken) return generic()

    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: [email] }),
      }
    )
    if (!res.ok) return generic()

    const data = (await res.json()) as { users?: { providerUserInfo?: { providerId: string }[] }[] }
    const user = data.users?.[0]
    if (!user) return generic()

    const providers = (user.providerUserInfo ?? []).map((p) => p.providerId)
    const isGoogleOnly = providers.includes("google.com") && !providers.includes("password")
    return NextResponse.json({ hint: isGoogleOnly ? "google" : "generic" })
  } catch {
    return generic()
  }
}
