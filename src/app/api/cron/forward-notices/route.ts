import { createHash, timingSafeEqual } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { runAutoForward } from "@/lib/procurement/auto-forward-server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// The scheduled half of PRD 3.0 §5.2-3b: a delivery notice Procurement has not
// forwarded when `forwardWindowDays` lapses goes to the register's suggested
// receiver, tagged `auto`. Vercel Cron calls this daily with
// `Authorization: Bearer $CRON_SECRET`. The work is `runAutoForward`, which a
// Procurement page also asks for on demand (/api/procurement/auto-forward).

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

const digest = (s: string) => createHash("sha256").update(s).digest()

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get("authorization") || ""
  if (!header.startsWith("Bearer ")) return false
  return timingSafeEqual(digest(header.slice(7)), digest(secret))
}

async function run(req: NextRequest) {
  if (!process.env.CRON_SECRET) return fail("Cron is not configured", "NOT_CONFIGURED", 401)
  if (!authorised(req)) return fail("Unauthorised", "UNAUTHORISED", 401)
  try {
    const totals = await runAutoForward(getAdminFirestore(), Date.now())
    return NextResponse.json({ success: true, data: totals })
  } catch (error) {
    console.error("Auto-forward cron error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

export const GET = run
export const POST = run
