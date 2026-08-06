import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("Authorization") ?? ""
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null
    if (!token) {
      return NextResponse.json({ error: true, message: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
    }

    const adminAuth = getAdminAuth()
    const decoded = await adminAuth.verifyIdToken(token).catch((err: unknown) => {
      console.error("[admin/auth-cleanup] verifyIdToken failed:", (err as Error)?.message)
      return null
    })
    if (!decoded) {
      return NextResponse.json({ error: true, message: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
    }

    const db = getAdminFirestore()
    const senderSnap = await db.collection("users").doc(decoded.uid).get()
    const sender = senderSnap.data()
    if (!sender || sender.role !== "Admin") {
      return NextResponse.json({ error: true, message: "Forbidden", code: "FORBIDDEN" }, { status: 403 })
    }

    const body = await req.json().catch(() => ({})) as { dryRun?: boolean }
    const dryRun = body.dryRun !== false

    // Collect all Firestore users doc IDs
    const usersSnap = await db.collection("users").get()
    const firestoreUids = new Set(usersSnap.docs.map(d => d.id))

    // Paginate through all Auth users
    const authUsers: Array<{ uid: string; email: string | undefined; createdAt: string }> = []
    let pageToken: string | undefined

    do {
      const result = await adminAuth.listUsers(1000, pageToken)
      for (const user of result.users) {
        authUsers.push({
          uid: user.uid,
          email: user.email,
          createdAt: user.metadata.creationTime,
        })
      }
      pageToken = result.pageToken
    } while (pageToken)

    // Find orphans: in Auth but NOT in Firestore
    const orphans = authUsers.filter(u => !firestoreUids.has(u.uid))

    if (dryRun || orphans.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          dryRun,
          totalAuthAccounts: authUsers.length,
          totalFirestoreUsers: firestoreUids.size,
          orphansFound: orphans.length,
          orphans,
        },
      })
    }

    // Actually delete
    const results: Array<{ uid: string; email: string | undefined; deleted: boolean; error?: string }> = []

    for (const orphan of orphans) {
      try {
        await adminAuth.deleteUser(orphan.uid)
        results.push({ uid: orphan.uid, email: orphan.email, deleted: true })
      } catch (err: unknown) {
        const e = err as { code?: string; message?: string }
        if (e.code === "auth/user-not-found") {
          results.push({ uid: orphan.uid, email: orphan.email, deleted: true })
        } else {
          results.push({ uid: orphan.uid, email: orphan.email, deleted: false, error: e.message })
        }
      }
    }

    const deleted = results.filter(r => r.deleted).length
    const failed  = results.filter(r => !r.deleted).length

    return NextResponse.json({
      success: true,
      data: {
        dryRun: false,
        totalAuthAccounts: authUsers.length,
        totalFirestoreUsers: firestoreUids.size,
        orphansFound: orphans.length,
        deleted,
        failed,
        results,
      },
    })
  } catch (err) {
    console.error("[admin/auth-cleanup]", err)
    return NextResponse.json({ error: true, message: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 })
  }
}
