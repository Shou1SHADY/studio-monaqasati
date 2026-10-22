import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { PoLinkError, limitActs, resolveOrderLink } from "@/lib/procurement/po-link-server"
import { answerFor } from "@/lib/procurement/po-link-route"
import { MessageRefusal, storeMessageFile } from "@/lib/procurement/po-messages-server"
import { poLinkActs } from "@/lib/po-link"

// A file for the order's conversation (an image or a PDF, 4 MB at most): stored under the order, its address handed back to be
// attached to the next message.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const db = getAdminFirestore()
    const resolved = await resolveOrderLink(db, token)
    if (!poLinkActs(resolved.po).reply) throw new PoLinkError("CANCELLED", 409)
    await limitActs(db, resolved.poId)
    const form = await req.formData().catch(() => null)
    const file = form?.get("file")
    if (!(file instanceof File)) throw new PoLinkError("BAD_REQUEST", 400)
    try {
      const stored = await storeMessageFile(resolved.po.organizationId, resolved.poId, file)
      return NextResponse.json({ success: true, data: { file: stored } })
    } catch (err) {
      if (err instanceof MessageRefusal) throw new PoLinkError("BAD_REQUEST", err.status)
      throw err
    }
  } catch (error) {
    return answerFor(error, "order link file")
  }
}
