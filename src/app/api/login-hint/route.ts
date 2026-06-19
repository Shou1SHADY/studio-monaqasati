import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth } from "@/lib/firebaseAdmin"
import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

// Adjust these two constants to tune the rate limit.
const RATE_LIMIT_REQUESTS = 5
const RATE_LIMIT_WINDOW = "60 s"

// Lazy singleton — created once, reused across invocations in the same worker.
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

// Always return the same shape so the response leaks nothing.
const generic = () => NextResponse.json({ hint: "generic" })

export async function POST(req: NextRequest) {
  // --- Rate limit by client IP ---
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown"
  try {
    const limiter = getRatelimit()
    if (limiter) {
      const { success } = await limiter.limit(ip)
      if (!success) return generic() // silently cap — HTTP 200, no 429
    }
  } catch {
    // Redis unreachable — fail open, never block the login UX
  }

  // --- Parse body ---
  let email: string
  try {
    const body = await req.json()
    email = String(body?.email ?? "")
      .trim()
      .toLowerCase()
  } catch {
    return generic()
  }

  if (!email.includes("@")) return generic()

  // --- Provider lookup via Admin SDK ---
  try {
    const user = await getAdminAuth().getUserByEmail(email)
    const providers = user.providerData.map((p) => p.providerId)
    const isGoogleOnly =
      providers.includes("google.com") && !providers.includes("password")
    return NextResponse.json({ hint: isGoogleOnly ? "google" : "generic" })
  } catch {
    // auth/user-not-found or any other error → generic; never reveal account existence
    return generic()
  }
}
