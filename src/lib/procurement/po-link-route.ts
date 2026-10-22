// The shared body of the order-link routes (`/api/po-link/[token]/*`): the token resolves one order (or nothing), acts are counted
// against the link's cap, the body is checked by a strict zod schema (an unknown key — a quantity, a plate — is refused, G-08),
// and the answer is `{ success, data: { view } }` or `{ error, message, code }`.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import type { Firestore } from "firebase-admin/firestore"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import type { PoLinkView } from "@/lib/po-link"
import { PoLinkError, buildLinkView, limitActs, resolveOrderLink, type ResolvedOrder } from "./po-link-server"
import type { PoWithChat } from "./po-messages"

export const localeField = z.enum(["ar", "en"]).optional()

const fail = (message: string, code: string, status: number, headers?: Record<string, string>) => NextResponse.json({ error: true, message, code }, { status, headers: { "Cache-Control": "no-store", ...headers } })

export function answerFor(error: unknown, label: string): NextResponse {
  if (error instanceof PoLinkError) return fail(error.code.replace(/_/g, " ").toLowerCase(), error.code, error.status, error.retryAfterSec ? { "Retry-After": String(error.retryAfterSec) } : undefined)
  console.error(`${label}:`, error)
  return fail("Internal server error", "INTERNAL", 500)
}

export const viewOut = async (db: Firestore, po: PoWithChat) => ({ view: await buildLinkView(db, po) as PoLinkView })

type Params = { params: Promise<{ token: string }> }

/** A read: opens the link and answers the order as the supplier sees it. */
export async function linkRead(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const { token } = await params
    const db = getAdminFirestore()
    const resolved = await resolveOrderLink(db, token)
    return NextResponse.json({ success: true, data: await viewOut(db, resolved.po) }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return answerFor(error, "order link read")
  }
}

/** An act of the supplier on the order the token opens. */
export async function linkAct<S extends z.ZodTypeAny>(req: NextRequest, { params }: Params, label: string, schema: S, run: (db: Firestore, resolved: ResolvedOrder, input: z.infer<S>) => Promise<PoWithChat>): Promise<NextResponse> {
  try {
    const { token } = await params
    const db = getAdminFirestore()
    const parsed = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail("Check the request", "BAD_REQUEST", 400)
    const resolved = await resolveOrderLink(db, token)
    await limitActs(db, resolved.poId)
    const po = await run(db, resolved, parsed.data)
    return NextResponse.json({ success: true, data: await viewOut(db, po) }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return answerFor(error, label)
  }
}
