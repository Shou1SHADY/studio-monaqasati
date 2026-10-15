import { createHash, timingSafeEqual } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { runReceiptWindow } from "@/lib/supplier-free/receipt-window"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Supplier 1.0, decision 2: a delivery the supplier reported with no receipt reminds the receivers after 2 days and goes
// to the procurement manager after 5. Vercel Cron calls this daily (production only — UAT has no cron) with
// `Authorization: Bearer $CRON_SECRET`. Admin SDK; each report is stamped inside a transaction, so nobody is told twice.

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
    return NextResponse.json({ success: true, data: await runReceiptWindow(getAdminFirestore()) })
  } catch (error) {
    console.error("Receipt-window cron error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

export const GET = run
export const POST = run
