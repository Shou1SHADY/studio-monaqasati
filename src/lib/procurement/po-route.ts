// The shared body of the purchase-order routes (`/api/procurement/po/*`): the caller's token, the zod schema at the top, the
// company's context, and the closed answer shapes — `{ success, data }` and `{ error, message, code, reason, params }`, where
// `reason` is the `Portal.Procurement.err_*` key the screen translates.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf, type Caller } from "@/lib/receipt-links"
import { PoActError, poCtx, type PoCtx } from "./po-server"
import { poVer } from "./po-state"
import type { PurchaseOrder } from "./types"

export const poId = z.string().trim().min(1).max(128)
export const localeField = z.enum(["ar", "en"]).optional()

export const fail = (message: string, code: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ error: true, message, code, ...extra }, { status })

/** The few fields a screen needs back; the order itself is read live. */
export const orderOut = (po: PurchaseOrder, extra: Record<string, unknown> = {}) => ({ poId: po.id, status: po.status, ver: poVer(po), ...extra })

async function signedIn(req: NextRequest): Promise<string | null> {
  const header = req.headers.get("authorization") || ""
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!idToken) return null
  try {
    return (await getAdminAuth().verifyIdToken(idToken)).uid
  } catch {
    return null
  }
}

function answerFor(error: unknown, label: string): NextResponse {
  if (error instanceof PoActError) return fail(error.reason.replace(/_/g, " "), error.reason.toUpperCase(), error.status, { reason: error.reason, params: error.params })
  console.error(`${label}:`, error)
  return fail("Internal server error", "INTERNAL", 500)
}

/** An act of the buying company: runs inside its context (actor, policies, package) and answers `{ success, data }`. */
export async function buyerRoute<S extends z.ZodType<{ locale?: "ar" | "en" }>>(req: NextRequest, label: string, schema: S, run: (ctx: PoCtx, input: z.infer<S>) => Promise<Record<string, unknown>>): Promise<NextResponse> {
  const uid = await signedIn(req)
  if (!uid) return fail("Sign in first", "UNAUTHENTICATED", 401)
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Check the request", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller) return fail("Account not found", "FORBIDDEN", 403)
    const ctx = await poCtx(db, caller, { locale: parsed.data.locale })
    return NextResponse.json({ success: true, data: await run(ctx, parsed.data) })
  } catch (error) {
    return answerFor(error, label)
  }
}

/** An act of the supplier on an order of his: the caller is a supplier, so no buying-company context is built. */
export async function supplierRoute<S extends z.ZodTypeAny>(req: NextRequest, label: string, schema: S, run: (caller: Caller, input: z.infer<S>) => Promise<Record<string, unknown>>): Promise<NextResponse> {
  const uid = await signedIn(req)
  if (!uid) return fail("Sign in first", "UNAUTHENTICATED", 401)
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Check the request", "BAD_REQUEST", 400)
  try {
    const caller = await callerOf(getAdminFirestore(), uid)
    if (!caller) return fail("Account not found", "FORBIDDEN", 403)
    return NextResponse.json({ success: true, data: await run(caller, parsed.data) })
  } catch (error) {
    return answerFor(error, label)
  }
}
