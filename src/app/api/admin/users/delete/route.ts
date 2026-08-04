import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"

const bodySchema = z.object({
  uid: z.string().trim().min(1),
})

export async function DELETE(req: NextRequest) {
  try {
    const authHeader = req.headers.get("Authorization") ?? ""
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null
    if (!token) {
      return NextResponse.json({ error: true, message: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
    }

    const adminAuth = getAdminAuth()
    const decoded = await adminAuth.verifyIdToken(token).catch(() => null)
    if (!decoded) {
      return NextResponse.json({ error: true, message: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
    }

    const db = getAdminFirestore()
    const senderSnap = await db.collection("users").doc(decoded.uid).get()
    const sender = senderSnap.data()
    if (!sender || sender.role !== "Admin") {
      return NextResponse.json({ error: true, message: "Forbidden", code: "FORBIDDEN" }, { status: 403 })
    }

    const json = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: true, message: "Invalid input", code: "INVALID_INPUT" }, { status: 400 })
    }

    const { uid } = parsed.data

    await adminAuth.deleteUser(uid).catch((err: any) => {
      if (err.code !== "auth/user-not-found") throw err
    })

    await db.collection("users").doc(uid).delete()

    return NextResponse.json({ success: true, data: {} })
  } catch (err) {
    console.error("[admin/users/delete]", err)
    return NextResponse.json({ error: true, message: "Failed to delete user", code: "INTERNAL_ERROR" }, { status: 500 })
  }
}
