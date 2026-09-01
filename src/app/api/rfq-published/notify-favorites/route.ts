import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { sendDirectMessage, normalizePhoneE164, isSmsConfigured } from "@/lib/sms"
import { resolveIdentityAdmin } from "@/lib/org-identity-admin"
import { PUBLIC_BASE_URL } from "@/lib/rfq-share"

// Called (fire-and-forget) right after a contractor publishes RFQs. Every
// supplier the contractor has FAVORITED gets a direct SMS about the new RFQ —
// for private RFQs only the favorites the RFQ was actually addressed to.
// Suppliers already texted about an RFQ are never texted about it again
// (smsNotifiedSupplierIds on the RFQ doc).

const bodySchema = z.object({
  rfqIds: z.array(z.string().trim().min(1).max(128)).min(1).max(25),
})

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: true, message, code }, { status })
}

async function resolvePhone(
  db: FirebaseFirestore.Firestore,
  supplierId: string
): Promise<string | null> {
  const userSnap = await db.collection("users").doc(supplierId).get()
  if (userSnap.exists) {
    const u = userSnap.data()!
    const resolved = await resolveIdentityAdmin(db, supplierId, u)
    const phone = normalizePhoneE164((resolved?.phone as string) || (resolved?.phoneNumber as string))
    if (phone) return phone
  }
  const orgSnap = await db.collection("organizations").doc(supplierId).get()
  if (orgSnap.exists) {
    const o = orgSnap.data()!
    const phone = normalizePhoneE164((o.phone as string) || (o.phoneNumber as string))
    if (phone) return phone
    if (o.ownerUserId) {
      const ownerSnap = await db.collection("users").doc(o.ownerUserId as string).get()
      const owner = ownerSnap.data()
      return normalizePhoneE164((owner?.phone as string) || (owner?.phoneNumber as string))
    }
  }
  return null
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || ""
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null
    if (!idToken) return errorResponse("Authentication required", "UNAUTHENTICATED", 401)

    let decoded
    try {
      decoded = await getAdminAuth().verifyIdToken(idToken)
    } catch {
      return errorResponse("Invalid or expired session", "UNAUTHENTICATED", 401)
    }

    const json = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) return errorResponse("rfqIds is required", "INVALID_INPUT", 400)
    const { rfqIds } = parsed.data

    if (!isSmsConfigured()) {
      return NextResponse.json({ success: true, data: { sent: 0, skipped: "SMS_NOT_CONFIGURED" } })
    }

    const db = getAdminFirestore()
    const senderSnap = await db.collection("users").doc(decoded.uid).get()
    const sender = senderSnap.data()
    if (!sender) return errorResponse("User profile not found", "PROFILE_NOT_FOUND", 403)
    const orgId = (sender.organizationId as string) || decoded.uid

    // The favorites list lives on the ORG OWNER's user doc (the member's
    // organizationId IS the owner's uid); links born of favoriting carry
    // requestedBy: "contractor_favorite" and catch older favorites too.
    const ownerSnap = orgId === decoded.uid ? senderSnap : await db.collection("users").doc(orgId).get()
    const explicitFavorites: string[] = (ownerSnap.data()?.favoriteSuppliers as string[]) || []
    const favoriteLinksSnap = await db
      .collection("contractorSupplierLinks")
      .where("contractorOrgId", "==", orgId)
      .where("requestedBy", "==", "contractor_favorite")
      .get()
    const favoriteIds = new Set<string>(explicitFavorites)
    favoriteLinksSnap.forEach((d) => {
      const supplierOrgId = d.data().supplierOrgId as string
      if (supplierOrgId && d.data().status !== "removed") favoriteIds.add(supplierOrgId)
    })
    if (favoriteIds.size === 0) {
      return NextResponse.json({ success: true, data: { sent: 0, favorites: 0 } })
    }

    const contractorIdentity = await resolveIdentityAdmin(db, decoded.uid, sender)
    const contractorName =
      (contractorIdentity?.companyName as string) || (contractorIdentity?.name as string) || ""

    const phoneCache = new Map<string, string | null>()
    let totalSent = 0

    for (const rfqId of rfqIds) {
      const rfqSnap = await db.collection("rfqs").doc(rfqId).get()
      if (!rfqSnap.exists) continue
      const rfq = rfqSnap.data()!
      const rfqOrgId = (rfq.organizationId as string) || (rfq.contractorId as string)
      if (rfqOrgId !== orgId) continue
      if (rfq.status !== "New") continue

      const alreadyNotified = new Set<string>((rfq.smsNotifiedSupplierIds as string[]) || [])
      let recipients = [...favoriteIds].filter((id) => !alreadyNotified.has(id))
      if (rfq.visibility === "private") {
        const allowed = new Set<string>((rfq.allowedSupplierOrgIds as string[]) || [])
        recipients = recipients.filter((id) => allowed.has(id))
      }
      if (recipients.length === 0) continue

      const smsBody =
        `منصة مدماك: طلب عروض جديد «${(rfq.title as string) || ""}»` +
        (contractorName ? ` من ${contractorName}` : "") +
        (rfq.deadline ? `. آخر موعد للتقديم: ${rfq.deadline}` : "") +
        `. قدّم عرضك: ${PUBLIC_BASE_URL}/supplier/rfqs`

      const sentIds: string[] = []
      for (const supplierId of recipients) {
        if (!phoneCache.has(supplierId)) {
          phoneCache.set(supplierId, await resolvePhone(db, supplierId))
        }
        const phone = phoneCache.get(supplierId)
        if (!phone) continue
        const result = await sendDirectMessage({ to: phone, body: smsBody })
        if (result.sent) sentIds.push(supplierId)
      }

      if (sentIds.length > 0) {
        totalSent += sentIds.length
        await rfqSnap.ref.update({ smsNotifiedSupplierIds: FieldValue.arrayUnion(...sentIds) })
      }
    }

    return NextResponse.json({ success: true, data: { sent: totalSent, favorites: favoriteIds.size } })
  } catch (err) {
    console.error("notify-favorites error:", err)
    return errorResponse("Failed to notify favorite suppliers", "INTERNAL_ERROR", 500)
  }
}
