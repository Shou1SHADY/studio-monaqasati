import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { deliveryLines, maskPhone, resolveReceiptLink } from "@/lib/receipt-links"

// Public: what the receiver needs to count a delivery — and nothing more.
// The token is 32 random bytes, so it is the key; what comes back is the
// supplier's name, the order number and the lines' names and units. Never the
// notified quantities (the count is blind, as at the office's receiving
// desk), never a price, and never the mobile number — only its last digits.

const fail = (message: string, code: string, status: number) =>
  NextResponse.json({ error: true, message, code }, { status })

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const db = getAdminFirestore()
    const resolved = await resolveReceiptLink(db, token)
    if (!resolved.ok) return fail("This link is invalid, used, or has expired", resolved.code, resolved.status)

    const { link, delivery } = resolved
    const lines = await deliveryLines(db, delivery)
    return NextResponse.json({
      success: true,
      data: {
        receiverName: link.receiver.name,
        phoneMasked: maskPhone(link.receiver.phone),
        supplierName: (delivery.supplierName as string) || "",
        poNumber: (delivery.poNumber as string) || null,
        rfqTitle: (delivery.rfqTitle as string) || "",
        deliveryDate: (delivery.deliveryDate as string) || null,
        forwardedBy: link.createdByName,
        expiresAt: link.expiresAt,
        lines: lines.map((l) => ({ poLineId: l.poLineId, name: l.name, unit: l.unit })),
      },
    })
  } catch (error) {
    console.error("Receipt link read error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
