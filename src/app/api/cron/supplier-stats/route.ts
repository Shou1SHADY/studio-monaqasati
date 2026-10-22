import { createHash, timingSafeEqual } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { rebuildSupplierStats } from "@/lib/procurement/supplier-stats-server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// The daily half of the supplier directory (SUP-02): every supplier company's card — what he completed on the platform, his
// on-time share, his computed rating — is rebuilt from the orders themselves. Vercel Cron calls this with
// `Authorization: Bearer $CRON_SECRET`. The directory route also rebuilds when it finds the cards older than a day, so a
// missed run only means one slower request.

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
    return NextResponse.json({ success: true, data: await rebuildSupplierStats(getAdminFirestore()) })
  } catch (error) {
    console.error("Supplier stats cron error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

export const GET = run
export const POST = run
