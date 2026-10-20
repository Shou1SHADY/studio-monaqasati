import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { RECEIPT_LINKS, linkRefusal, type ReceiptLink } from "@/lib/receipt-links"

// The member a delivery was forwarded to opens it from his own tasks (PUR-06): the open
// link of that delivery is handed to HIM only — its token never sits on the delivery,
// which any signed-in user may list.

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

export async function GET(req: NextRequest) {
  const header = req.headers.get("authorization") || ""
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!idToken) return fail("Sign in first", "UNAUTHENTICATED", 401)
  let uid: string
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid
  } catch {
    return fail("Sign in first", "UNAUTHENTICATED", 401)
  }
  const deliveryId = req.nextUrl.searchParams.get("deliveryId") || ""
  if (!deliveryId || deliveryId.length > 128) return fail("Which delivery?", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const snap = await db.collection(RECEIPT_LINKS).where("deliveryId", "==", deliveryId).get()
    const mine = snap.docs.map((d) => d.data() as ReceiptLink).find((l) => l.receiver.userId === uid && !linkRefusal(l, Date.now()))
    if (!mine) return fail("Not forwarded to you, or already counted", "NOT_YOURS", 404)
    return NextResponse.json({ success: true, data: { token: mine.token } })
  } catch (error) {
    console.error("my receipt link:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
