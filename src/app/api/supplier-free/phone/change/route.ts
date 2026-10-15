import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { COMPANY_IDENTITY } from "@/lib/company-identity"
import { verifyOtp, type OtpVerdict } from "@/lib/otp"
import { normalizePhoneE164 } from "@/lib/sms"
import { accountChangeSchema, normalizeCr, phoneChangeRefusal, phoneSubject } from "@/lib/supplier-free/phone-auth"

// Signed in: changes a free supplier's locked fields with a code (Supplier 1.0, ACC-05). A new sign-in mobile is
// proved by the code /api/supplier-free/phone/code sent TO it, and refused when another account holds it; a new
// commercial register is confirmed by the code sent to the current sign-in mobile. The mobile is changed on the
// Auth account (what the code sign-in looks up) and on the profile; the register on the profile and its identity
// mirror, with the old register's certificate taken off so "Verified" waits for the new one.

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

/** `+9665XXXXXXXX` → `05XXXXXXXX`: profiles written by older screens keep the local form. */
const localForm = (e164: string) => (e164.startsWith("+966") ? `0${e164.slice(4)}` : e164)

export async function POST(req: NextRequest) {
  try {
    const idToken = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || ""
    if (!idToken) return fail("Sign in first", "UNAUTHENTICATED", 401)
    let uid: string
    try {
      uid = (await getAdminAuth().verifyIdToken(idToken)).uid
    } catch {
      return fail("Sign in first", "UNAUTHENTICATED", 401)
    }
    const parsed = accountChangeSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail("Check the fields", "INVALID_INPUT", 400)

    const auth = getAdminAuth()
    const db = getAdminFirestore()
    const userRef = db.collection("users").doc(uid)
    const profile = (await userRef.get()).data() as { role?: string; phone?: string } | undefined
    if (!profile || profile.role !== "Supplier") return fail("Only a supplier account changes these here", "WRONG_ROLE", 403)
    const account = await auth.getUser(uid)
    const current = normalizePhoneE164(account.phoneNumber || profile.phone || "") || ""
    const body = parsed.data

    if (body.kind === "phone") {
      const next = normalizePhoneE164(body.phone)
      if (!next) return fail("Enter a valid mobile number", "INVALID_PHONE", 400)
      const holders: string[] = []
      const owner = await auth.getUserByPhoneNumber(next).catch(() => null)
      if (owner) holders.push(owner.uid)
      for (const form of [next, localForm(next)]) {
        const snap = await db.collection("users").where("phone", "==", form).limit(5).get()
        snap.docs.forEach((d) => holders.push(d.id))
      }
      const refusal = phoneChangeRefusal(uid, current, next, holders)
      if (refusal === "SAME_PHONE") return fail("That is already your sign-in mobile", refusal, 400)
      if (refusal === "PHONE_TAKEN") return fail("Another account uses this mobile", refusal, 409)
      const verdict = await verifyOtp(db, body.challengeId, { purpose: "supplier_phone", subjectId: phoneSubject(next) }, body.code)
      if (verdict !== "ok") {
        const e = VERDICT_ERRORS[verdict]
        return fail(e.message, e.code, e.status)
      }
      await auth.updateUser(uid, { phoneNumber: next })
      await userRef.set({ phone: next, phoneChangedAt: FieldValue.serverTimestamp() }, { merge: true })
      return NextResponse.json({ success: true, data: { phone: next } })
    }

    const cr = normalizeCr(body.crNumber)
    if (!cr) return fail("Enter the ten-digit register number", "INVALID_CR", 400)
    if (!current) return fail("Add a sign-in mobile first", "NO_PHONE", 400)
    const verdict = await verifyOtp(db, body.challengeId, { purpose: "supplier_phone", subjectId: phoneSubject(current) }, body.code)
    if (verdict !== "ok") {
      const e = VERDICT_ERRORS[verdict]
      return fail(e.message, e.code, e.status)
    }
    const patch = { crNumber: cr, legalDocuments: { cr: FieldValue.delete() }, crChangedAt: FieldValue.serverTimestamp() }
    await userRef.set(patch, { merge: true })
    await db
      .collection(COMPANY_IDENTITY)
      .doc(uid)
      .set({ crNumber: cr, legalDocuments: { cr: FieldValue.delete() }, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      .catch((err) => console.error("companyIdentity mirror failed", err))
    return NextResponse.json({ success: true, data: { crNumber: cr } })
  } catch (error) {
    console.error("Supplier account change error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
