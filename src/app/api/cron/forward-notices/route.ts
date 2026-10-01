import { createHash, timingSafeEqual } from "node:crypto"
import type { Firestore } from "firebase-admin/firestore"
import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { LINK_TTL_MS, RECEIPT_LINKS, maskPhone, newToken, type ReceiptLink, type Receiver } from "@/lib/receipt-links"
import { normalizePhoneE164 } from "@/lib/sms"
import { AUTO_FORWARD_ACTOR, autoForwardSkip, selectDueNotices, type DueNotice } from "@/lib/procurement/auto-forward"
import { resolvePolicies } from "@/lib/procurement/policies"
import { PROCUREMENT_RECEIVERS, type ProcReceiver } from "@/lib/procurement/receivers"
import type { DeskDelivery } from "@/lib/procurement/receipt-desk"
import { PROCUREMENT_SETTINGS, PURCHASE_ORDERS, type ProcurementPolicies } from "@/lib/procurement/types"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// The scheduled half of PRD 3.0 §5.2-3b: a delivery notice Procurement has not
// forwarded when `forwardWindowDays` lapses goes to the register's suggested
// receiver, tagged `auto`. Vercel Cron calls this daily with
// `Authorization: Bearer $CRON_SECRET`. Admin SDK, so no security rule applies;
// the notice is re-read inside a transaction, which makes a second run (or two
// overlapping ones) forward nothing twice.

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

const digest = (s: string) => createHash("sha256").update(s).digest()

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get("authorization") || ""
  if (!header.startsWith("Bearer ")) return false
  return timingSafeEqual(digest(header.slice(7)), digest(secret))
}

type Outcome = "forwarded" | "already" | "no_phone" | "failed"

async function forwardOne(db: Firestore, orgId: string, due: DueNotice, now: number): Promise<{ outcome: Outcome; token?: string; receiver?: Receiver }> {
  const phone = normalizePhoneE164(due.receiver.phone)
  if (!phone) return { outcome: "no_phone" }

  let userId: string | null = null
  if (due.receiver.userId) {
    const member = (await db.collection("users").doc(due.receiver.userId).get()).data() as { organizationId?: string } | undefined
    if (member && (member.organizationId || due.receiver.userId) === orgId) userId = due.receiver.userId
  }
  const receiver: Receiver = { kind: userId ? "user" : "person", userId, name: due.receiver.name, phone }

  const deliveryRef = db.collection("deliveries").doc(due.delivery.id)
  const token = newToken()
  const linkRef = db.collection(RECEIPT_LINKS).doc()
  const at = new Date(now).toISOString()
  const link: ReceiptLink = {
    token,
    deliveryId: due.delivery.id,
    organizationId: orgId,
    receiver,
    status: "open",
    createdById: AUTO_FORWARD_ACTOR.id,
    createdByName: AUTO_FORWARD_ACTOR.name,
    createdAt: at,
    expiresAt: new Date(now + LINK_TTL_MS).toISOString(),
    note: null,
  }

  const outcome = await db.runTransaction(async (tx): Promise<Outcome> => {
    const fresh = (await tx.get(deliveryRef)).data() as (DeskDelivery & { contractorOrgId?: string }) | undefined
    if (!fresh || fresh.contractorOrgId !== orgId) return "already"
    if (fresh.status !== "pending_confirmation" || fresh.closedByReceipt || fresh.forwardedTo || fresh.receiverReport) return "already"
    const open = await tx.get(db.collection(RECEIPT_LINKS).where("deliveryId", "==", due.delivery.id))
    for (const d of open.docs) if (d.data().status === "open") tx.update(d.ref, { status: "revoked" })
    tx.set(linkRef, link)
    tx.update(deliveryRef, {
      forwardedTo: {
        linkId: linkRef.id,
        name: receiver.name,
        userId: receiver.userId,
        phoneMasked: maskPhone(receiver.phone),
        byName: AUTO_FORWARD_ACTOR.name,
        at,
        note: null,
        auto: true,
      },
    })
    return "forwarded"
  })
  return { outcome, token, receiver }
}

async function notify(db: Firestore, orgId: string, due: DueNotice, receiver: Receiver, token: string, now: number) {
  if (!receiver.userId) return
  const supplier = due.delivery.supplierName || ""
  await db
    .collection("users")
    .doc(receiver.userId)
    .collection("notifications")
    .add({
      userId: receiver.userId,
      organizationId: orgId,
      type: "receipt_forwarded",
      i18n: { title: "pn_receipt_auto_forwarded_title", message: "pn_receipt_auto_forwarded", params: { supplier } },
      title: "📦 استلام مُحوَّل إليك تلقائياً",
      message: `حوّل النظام إليك تلقائياً استلام توريد من ${supplier || "المورد"} لم تحوّله المشتريات في المهلة — افتح الرابط وعدّ ما وصل ووقّع.`,
      deliveryId: due.delivery.id,
      link: `/receive/${token}`,
      createdAt: new Date(now).toISOString(),
      read: false,
    })
    .catch((err: { code?: string }) => console.warn("auto-forward notification failed:", err?.code || err))
}

async function run(req: NextRequest) {
  if (!process.env.CRON_SECRET) return fail("Cron is not configured", "NOT_CONFIGURED", 401)
  if (!authorised(req)) return fail("Unauthorised", "UNAUTHORISED", 401)

  try {
    const db = getAdminFirestore()
    const nowMs = Date.now()
    const now = new Date(nowMs)
    const pending = await db.collection("deliveries").where("status", "==", "pending_confirmation").get()
    const byOrg = new Map<string, DeskDelivery[]>()
    for (const doc of pending.docs) {
      const data = doc.data() as DeskDelivery & { contractorOrgId?: string }
      if (!data.contractorOrgId) continue
      const list = byOrg.get(data.contractorOrgId) || []
      list.push({ ...data, id: doc.id })
      byOrg.set(data.contractorOrgId, list)
    }

    const totals = { orgs: byOrg.size, pending: pending.size, forwarded: 0, skipped: 0, failed: 0 }
    for (const [orgId, deliveries] of byOrg) {
      try {
        const settings = (await db.collection(PROCUREMENT_SETTINGS).doc(orgId).get()).data() as Partial<ProcurementPolicies> | undefined
        const policies = resolvePolicies(settings) as ProcurementPolicies
        const [receiversSnap, projectsSnap] = await Promise.all([
          db.collection(PROCUREMENT_RECEIVERS).where("organizationId", "==", orgId).get(),
          db.collection("projects").where("organizationId", "==", orgId).get(),
        ])
        const receivers = receiversSnap.docs.map((d) => ({ ...(d.data() as Omit<ProcReceiver, "id">), id: d.id }))
        const projects = projectsSnap.docs.map((d) => ({ id: d.id, warehouseId: (d.data().warehouseId as string | null | undefined) ?? null }))
        const poIds = Array.from(new Set(deliveries.map((d) => d.poId).filter((id): id is string => Boolean(id))))
        const orders = (
          await Promise.all(poIds.map(async (id) => ({ id, projectId: ((await db.collection(PURCHASE_ORDERS).doc(id).get()).data()?.projectId as string | null | undefined) ?? null })))
        )

        const input = { orgId, policies, receivers, projects, orders, now }
        const due = selectDueNotices({ ...input, deliveries })
        totals.skipped += deliveries.filter((d) => autoForwardSkip(d, input).skip !== null).length
        for (const item of due) {
          try {
            const res = await forwardOne(db, orgId, item, nowMs)
            if (res.outcome === "forwarded" && res.token && res.receiver) {
              totals.forwarded += 1
              await notify(db, orgId, item, res.receiver, res.token, nowMs)
            } else {
              totals.skipped += 1
            }
          } catch (error) {
            totals.failed += 1
            console.error("Auto-forward failed for", item.delivery.id, error)
          }
        }
      } catch (error) {
        totals.failed += 1
        console.error("Auto-forward failed for org", orgId, error)
      }
    }
    return NextResponse.json({ success: true, data: totals })
  } catch (error) {
    console.error("Auto-forward cron error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

export const GET = run
export const POST = run
