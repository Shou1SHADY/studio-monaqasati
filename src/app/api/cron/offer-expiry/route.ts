import { createHash, timingSafeEqual } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import type { CrmOpportunity, CrmQuotation } from "@/lib/crm"
import { expiryNotice, riyadhToday, selectExpiredOffers } from "@/lib/crm-offer-expiry"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// OPP-04 #8: an offer that ran past its validity with no answer tells the person who asked for the price. Vercel Cron
// calls this daily with `Authorization: Bearer $CRON_SECRET`. Admin SDK, so no security rule applies; the deal is
// re-read inside a transaction and stamped `expiryNoticeQuoteId`, so a second run (or two overlapping ones) tells
// nobody twice.

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
    const db = getAdminFirestore()
    const today = riyadhToday()
    // Only sent offers of a deal can lapse unanswered; past validity is filtered here, not in an index.
    const sent = await db.collection("crmQuotations").where("status", "==", "sent").get()
    const quotes = sent.docs
      .map((d) => ({ ...(d.data() as Omit<CrmQuotation, "id">), id: d.id }) as CrmQuotation)
      .filter((q) => !!q.opportunityId)
    const lapsed = quotes.filter((q) => q.validUntil && q.validUntil.slice(0, 10) < today && !q.supersededById)
    const totals = { sent: sent.size, lapsed: lapsed.length, notified: 0, skipped: 0, failed: 0 }
    if (lapsed.length === 0) return NextResponse.json({ success: true, data: totals })

    const oppIds = Array.from(new Set(lapsed.map((q) => q.opportunityId as string)))
    const oppSnaps = await db.getAll(...oppIds.map((id) => db.collection("crmOpportunities").doc(id)))
    const opps = oppSnaps.filter((s) => s.exists).map((s) => ({ ...(s.data() as Omit<CrmOpportunity, "id">), id: s.id }) as CrmOpportunity)
    const requestIds = Array.from(new Set(opps.map((o) => o.pricingRequestId).filter((id): id is string => !!id)))
    const requesters = new Map<string, string>()
    if (requestIds.length) {
      const reqSnaps = await db.getAll(...requestIds.map((id) => db.collection("salesQuoteRequests").doc(id)))
      for (const s of reqSnaps) {
        const by = s.exists ? (s.data()?.requestedByUserId as string | undefined) : undefined
        if (by) requesters.set(s.id, by)
      }
    }
    // The current offer is read across ALL of a deal's sent versions, not only the lapsed ones.
    const dealQuotes = quotes.filter((q) => oppIds.includes(q.opportunityId as string))

    for (const item of selectExpiredOffers(opps, dealQuotes, requesters, today)) {
      try {
        const oppRef = db.collection("crmOpportunities").doc(item.opp.id)
        const createdAt = new Date().toISOString()
        const told = await db.runTransaction(async (tx) => {
          const fresh = (await tx.get(oppRef)).data()
          if (!fresh || fresh.expiryNoticeQuoteId === item.quote.id) return false
          tx.update(oppRef, { expiryNoticeQuoteId: item.quote.id })
          tx.set(db.collection("users").doc(item.recipientId).collection("notifications").doc(), expiryNotice(item, createdAt))
          return true
        })
        if (told) totals.notified += 1
        else totals.skipped += 1
      } catch (error) {
        totals.failed += 1
        console.error("Offer-expiry notice failed for", item.opp.id, error)
      }
    }
    return NextResponse.json({ success: true, data: totals })
  } catch (error) {
    console.error("Offer-expiry cron error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

export const GET = run
export const POST = run
