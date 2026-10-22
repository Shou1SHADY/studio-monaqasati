import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { deliveryLines, maskPhone, resolveReceiptLink } from "@/lib/receipt-links"
import { resolveLanding } from "@/lib/procurement/receipt-effects-server"

// Public: what the receiver needs to count a delivery — and nothing more.
// The token is 32 random bytes, so it is the key; what comes back is the
// supplier's name, the order number and the lines' names and units. Never a
// requested quantity (the count is blind: the receiver counts, he does not
// agree), never a price, and never the mobile number — only its last digits.

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
    // The order's own title under its number (PUR-06: the notice's copy could differ from the order's).
    const po = typeof delivery.poId === "string" && delivery.poId ? (await db.collection("purchaseOrders").doc(delivery.poId).get()).data() : null
    const place = await resolveLanding(
      db,
      link.organizationId,
      { warehouseId: (delivery.landedWarehouseId as string | undefined) || (delivery.warehouseId as string | undefined) || null, projectId: (delivery.projectId as string | undefined) || (po?.projectId as string | undefined) || null, receiverUserId: link.receiver.userId },
      false
    )
    return NextResponse.json({
      success: true,
      data: {
        where: place.module === "projects" ? "project" : "warehouse",
        receiverName: link.receiver.name,
        phoneMasked: maskPhone(link.receiver.phone),
        supplierName: (delivery.supplierName as string) || "",
        poNumber: (po?.docNumber as string) || (delivery.poNumber as string) || null,
        rfqTitle: (po?.rfqTitle as string) || (delivery.rfqTitle as string) || "",
        // The member it was forwarded to may confirm signed in, without a code.
        receiverUserId: link.receiver.userId || null,
        files: (link.files || []).map((f) => ({ name: f.name, url: f.url, kind: f.kind })),
        deliveryDate: (delivery.deliveryDate as string) || null,
        forwardedBy: link.createdByName,
        noNotice: delivery.noNotice === true,
        note: link.note || null,
        expiresAt: link.expiresAt,
        lines: lines.map((l) => ({ poLineId: l.poLineId, name: l.name, unit: l.unit })),
      },
    })
  } catch (error) {
    console.error("Receipt link read error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
