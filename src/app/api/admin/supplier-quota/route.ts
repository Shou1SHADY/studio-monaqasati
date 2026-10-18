import { NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { MAX_MONTHLY_QUOTES, QUOTA_SETTINGS_DOC } from "@/lib/supplier-approval"
import { freeMonthlyLimit } from "@/lib/supplier-approval-server"

// Admin-only: the free plan's monthly quotation allowance (supplier-approval.ts). null = no limit, the default. Written
// here (validated) though `platformSettings` is admin-writable by rule as well.

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

async function adminUid(req: Request): Promise<string | NextResponse> {
  const header = req.headers.get("authorization") || ""
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!idToken) return fail("Authentication required", "UNAUTHENTICATED", 401)
  let uid: string
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid
  } catch {
    return fail("Invalid or expired session", "UNAUTHENTICATED", 401)
  }
  const sender = (await getAdminFirestore().collection("users").doc(uid).get()).data()
  if (!sender || sender.role !== "Admin") return fail("Only admins can do this", "FORBIDDEN", 403)
  return uid
}

export async function GET(req: Request) {
  const who = await adminUid(req)
  if (typeof who !== "string") return who
  return NextResponse.json({ success: true, data: { freeMonthlyQuotes: await freeMonthlyLimit(getAdminFirestore()) } })
}

const schema = z.object({ freeMonthlyQuotes: z.number().int().min(1).max(MAX_MONTHLY_QUOTES).nullable() })

export async function POST(req: Request) {
  const who = await adminUid(req)
  if (typeof who !== "string") return who
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail(`A whole number from 1 to ${MAX_MONTHLY_QUOTES}, or no limit`, "INVALID_INPUT", 400)
  await getAdminFirestore()
    .collection(QUOTA_SETTINGS_DOC.collection)
    .doc(QUOTA_SETTINGS_DOC.id)
    .set({ freeMonthlyQuotes: parsed.data.freeMonthlyQuotes, updatedBy: who, updatedAt: new Date().toISOString() }, { merge: true })
  return NextResponse.json({ success: true, data: { freeMonthlyQuotes: parsed.data.freeMonthlyQuotes } })
}
