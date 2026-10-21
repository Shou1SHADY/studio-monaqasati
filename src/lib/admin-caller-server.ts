import { NextRequest, NextResponse } from "next/server"
import type { Firestore } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"

export const adminError = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

export interface AdminCaller {
  uid: string
  name: string
  db: Firestore
}

/** The signed-in platform admin behind a request, or the response that refuses it. */
export async function adminCaller(req: NextRequest): Promise<AdminCaller | NextResponse> {
  const header = req.headers.get("authorization") || ""
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!idToken) return adminError("Authentication required", "UNAUTHENTICATED", 401)
  let uid: string
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid
  } catch {
    return adminError("Invalid or expired session", "UNAUTHENTICATED", 401)
  }
  const db = getAdminFirestore()
  const sender = (await db.collection("users").doc(uid).get()).data()
  if (!sender || sender.role !== "Admin") return adminError("Only admins can do this", "FORBIDDEN", 403)
  return { uid, name: String(sender.name || sender.email || ""), db }
}
