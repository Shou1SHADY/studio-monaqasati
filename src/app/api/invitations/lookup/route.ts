import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"

// Public endpoint: resolves an invitation token to prefill the register page.
// Tokens are 32 random bytes (hex) — unguessable, so no auth is required, and
// only non-sensitive display fields are returned.

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: true, message, code }, { status })
}

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token") || ""
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return errorResponse("Invalid invitation link", "INVALID_TOKEN", 400)
    }

    const db = getAdminFirestore()
    const snap = await db
      .collection("invitations")
      .where("inviteToken", "==", token)
      .limit(1)
      .get()

    if (snap.empty) {
      return errorResponse("Invitation not found", "NOT_FOUND", 404)
    }

    const inv = snap.docs[0].data()
    if (inv.type !== "supplier_invite" || inv.status !== "pending") {
      return errorResponse("This invitation is no longer valid", "INVITATION_NOT_PENDING", 410)
    }

    return NextResponse.json({
      success: true,
      data: {
        email: inv.email as string,
        companyName: (inv.companyName as string) || null,
        contractorName: (inv.contractorName as string) || "",
      },
    })
  } catch (err) {
    console.error("Invitation lookup error:", err)
    return errorResponse("Failed to look up invitation", "INTERNAL_ERROR", 500)
  }
}
