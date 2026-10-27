import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { verifyOtp, type OtpVerdict } from "@/lib/otp"
import { normalizePhoneE164 } from "@/lib/sms"
import { claimedOfferPatch, claimedOrderPatch, fieldFromClaims, isClaimableGuestOffer, newAccountSchema, newSupplierUser, phoneSubject, signupSourceOf } from "@/lib/supplier-free/phone-auth"

// Public: checks the code and signs the supplier in. A mobile that already has an account enters it; a new one needs
// a name and a company first (answered BEFORE the code is spent, so the same code is then used once), and the account
// is made here — Supplier, owner of its own company, on the free journey (no plan document = free). The guest offers
// that carried this verified mobile become his, with the orders already made from them. The browser gets a custom
// token and signs in with it; the account never has a password.

const bodySchema = z.object({
  challengeId: z.string().trim().min(8).max(64),
  phone: z.string().trim().min(7).max(20),
  code: z.string().trim().min(4).max(8),
  name: z.string().trim().max(80).optional(),
  company: z.string().trim().max(120).optional(),
  source: z.literal("self").optional(),
})

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

const VERDICT_ERRORS: Record<Exclude<OtpVerdict, "ok">, { message: string; code: string; status: number }> = {
  wrong: { message: "That code is not right", code: "OTP_WRONG", status: 400 },
  expired: { message: "The code expired — ask for a new one", code: "OTP_EXPIRED", status: 400 },
  exhausted: { message: "Too many wrong tries — ask for a new code", code: "OTP_EXHAUSTED", status: 429 },
  consumed: { message: "That code was already used — ask for a new one", code: "OTP_USED", status: 400 },
  missing: { message: "Ask for a code first", code: "OTP_MISSING", status: 400 },
  mismatch: { message: "That code was sent to another number", code: "OTP_MISMATCH", status: 400 },
  unavailable: { message: "The code could not be checked right now", code: "OTP_UNAVAILABLE", status: 503 },
}

/** The verified guest offers of this mobile become his (with their orders), and the requests they answered seed his
 * specialties and cities — empty lists would show him no request at all (LNK-02). Lists he already chose are kept. */
async function claimGuestWork(uid: string, phone: string, name: string, company: string, orgId: string = uid): Promise<number> {
  const db = getAdminFirestore()
  const at = new Date().toISOString()
  const snap = await db.collection("offers").where("guestContact.phone", "==", phone).get()
  let claimed = 0
  const rfqIds: string[] = []
  for (const doc of snap.docs) {
    const offer = doc.data() as Parameters<typeof isClaimableGuestOffer>[0] & { rfqId?: string }
    if (!isClaimableGuestOffer(offer, phone)) continue
    const batch = db.batch()
    batch.update(doc.ref, { ...claimedOfferPatch(uid, name, company, at), organizationId: orgId })
    const orders = await db.collection("purchaseOrders").where("offerId", "==", doc.id).get()
    for (const o of orders.docs) if (o.data().supplierOrgId === "guest") batch.update(o.ref, { ...claimedOrderPatch(uid, company), supplierOrgId: orgId })
    await batch.commit()
    claimed++
    if (offer.rfqId) rfqIds.push(offer.rfqId)
  }
  if (rfqIds.length) {
    const rfqs = await Promise.all([...new Set(rfqIds)].map((id) => db.collection("rfqs").doc(id).get().then((d) => d.data() || null).catch(() => null)))
    const userRef = db.collection("users").doc(uid)
    const current = (await userRef.get()).data() as { specializations?: unknown; coverageCities?: unknown } | undefined
    const seed = fieldFromClaims(rfqs, current)
    if (seed) await userRef.set(seed, { merge: true })
  }
  return claimed
}

export async function POST(req: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail("Enter the code", "INVALID_INPUT", 400)
    const phone = normalizePhoneE164(parsed.data.phone)
    if (!phone) return fail("Enter a valid mobile number", "INVALID_PHONE", 400)

    const auth = getAdminAuth()
    const db = getAdminFirestore()
    const existing = await auth.getUserByPhoneNumber(phone).catch(() => null)
    const account = newAccountSchema.safeParse({ name: parsed.data.name, company: parsed.data.company })
    const existingProfile = existing ? (await db.collection("users").doc(existing.uid).get()).data() as { role?: string } | undefined : undefined
    if (!existingProfile && !account.success) return NextResponse.json({ success: true, data: { needsProfile: true } })

    const verdict = await verifyOtp(db, parsed.data.challengeId, { purpose: "supplier_phone", subjectId: phoneSubject(phone) }, parsed.data.code)
    if (verdict !== "ok") {
      const e = VERDICT_ERRORS[verdict]
      return fail(e.message, e.code, e.status)
    }

    let uid: string
    let claimed = 0
    if (existing && existingProfile) {
      uid = existing.uid
      if (existingProfile.role !== "Supplier") return fail("This mobile belongs to another kind of account", "WRONG_ROLE", 403)
      await db.collection("users").doc(uid).set({ lastLoginAt: FieldValue.serverTimestamp() }, { merge: true })
      // A quote he sent as a visitor after the account existed is his too (LNK-04: merging with an existing account).
      const p = existingProfile as { name?: string; companyName?: string; organizationId?: string }
      claimed = await claimGuestWork(uid, phone, p.name || p.companyName || "", p.companyName || p.name || "", p.organizationId || uid).catch((err) => {
        console.error("Guest work not claimed:", err)
        return 0
      })
    } else if (account.success) {
      uid = existing ? existing.uid : (await auth.createUser({ phoneNumber: phone, displayName: account.data.name })).uid
      const userRef = db.collection("users").doc(uid)
      await userRef.set({ ...newSupplierUser(uid, phone, account.data), signupSource: signupSourceOf(0), signedUpAt: FieldValue.serverTimestamp(), joinedAt: FieldValue.serverTimestamp(), lastLoginAt: FieldValue.serverTimestamp() })
      claimed = await claimGuestWork(uid, phone, account.data.name, account.data.company).catch((err) => {
        console.error("Guest work not claimed:", err)
        return 0
      })
      if (claimed > 0) await userRef.set({ signupSource: signupSourceOf(claimed) }, { merge: true })
    } else {
      return fail("Enter a name and a company", "INVALID_INPUT", 400)
    }

    const token = await auth.createCustomToken(uid)
    return NextResponse.json({ success: true, data: { token, created: !existingProfile, claimed } })
  } catch (error) {
    console.error("Supplier phone verify error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
