// The shared body of the routes that raise an order without an RFQ (`/api/procurement/po/{direct,service,retroactive}`): the caller's
// token, the zod schema at the top, the company's context, and the closed answer shapes — `{ success, data }` and
// `{ error, message, code, reason, params }`, where `reason` is the `Portal.Procurement.err_*` key the screen translates.

import { NextRequest, NextResponse } from "next/server"
import type { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { PoDirectError } from "./po-direct-server"
import { PoActError, poCtx, type PoCtx } from "./po-server"
import { fail } from "./po-route"

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

export async function raiseRoute<S extends z.ZodType<{ locale?: "ar" | "en" }>>(req: NextRequest, label: string, schema: S, run: (ctx: PoCtx, input: z.infer<S>) => Promise<Record<string, unknown>>): Promise<NextResponse> {
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
    if (error instanceof PoDirectError || error instanceof PoActError) return fail(error.reason.replace(/_/g, " "), error.reason.toUpperCase(), error.status, { reason: error.reason, params: error.params })
    console.error(`${label}:`, error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
