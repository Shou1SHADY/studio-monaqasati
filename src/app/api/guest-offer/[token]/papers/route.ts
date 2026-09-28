import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { z } from "zod"
import { getAdminFirestore, getAdminStorage, getStorageBucketName } from "@/lib/firebaseAdmin"
import { notifyContractor, resolveGuestOfferToken } from "@/lib/guest-offer"
import { SAUDI_VAT_RE } from "@/lib/procurement/rfq-form"
import { GUEST_PAPER_KINDS, guestPaperPath, guestPaperRefusal, mergeGuestPapers, type GuestPaper } from "@/lib/procurement/guest-supplier"

// Public endpoint: a guest supplier completes his papers from his private offer
// link — the CR and the VAT certificate, and the VAT number he may have left
// blank («يمكنكم إضافته لاحقاً»). Without them no order is issued to him, so
// they are welcome at any stage; a newer file replaces the older of its kind.

const fieldsSchema = z.object({
  vatNumber: z.string().trim().regex(SAUDI_VAT_RE).optional().or(z.literal("")),
})

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const resolution = await resolveGuestOfferToken(token)
    if (!resolution.ok) return fail("This link is invalid or has expired", resolution.code, resolution.status)
    const { offer, offerId, linkId } = resolution

    const form = await req.formData().catch(() => null)
    if (!form) return fail("Invalid form submission", "INVALID_INPUT", 400)
    const vatRaw = form.get("vatNumber")
    const parsed = fieldsSchema.safeParse({ vatNumber: typeof vatRaw === "string" ? vatRaw : "" })
    if (!parsed.success) return fail("A VAT number is 15 digits starting and ending with 3", "INVALID_VAT", 400)

    const files: Array<{ kind: (typeof GUEST_PAPER_KINDS)[number]; file: File }> = []
    for (const kind of GUEST_PAPER_KINDS) {
      const f = form.get(`paper_${kind}`)
      if (!(f instanceof File) || f.size === 0) continue
      const refusal = guestPaperRefusal(f)
      if (refusal) return fail("Papers must be PDF, JPG or PNG files of 5MB or less", refusal === "size" ? "PAPER_TOO_LARGE" : "INVALID_PAPER", 400)
      files.push({ kind, file: f })
    }
    const vatNumber = parsed.data.vatNumber || ""
    if (!files.length && !vatNumber) return fail("Attach a paper or enter the VAT number", "NOTHING_TO_SAVE", 400)

    const added: GuestPaper[] = []
    if (files.length) {
      const bucket = getAdminStorage().bucket(getStorageBucketName())
      const stamp = Date.now()
      const root = (offer.shareLinkId as string) || `offer-${linkId}`
      for (const { kind, file } of files) {
        const objectPath = guestPaperPath(root, offerId, kind, file.name, stamp)
        const downloadToken = randomUUID()
        await bucket.file(objectPath).save(Buffer.from(await file.arrayBuffer()), {
          contentType: file.type,
          metadata: { metadata: { firebaseStorageDownloadTokens: downloadToken } },
        })
        added.push({
          kind,
          name: file.name || kind,
          url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`,
          contentType: file.type,
          size: file.size,
          at: new Date().toISOString(),
        })
      }
    }

    const update: Record<string, unknown> = { updatedAt: new Date().toISOString() }
    if (added.length) update.guestPapers = mergeGuestPapers(offer.guestPapers as GuestPaper[] | undefined, added)
    if (vatNumber) update["guestContact.vatNumber"] = vatNumber
    await getAdminFirestore().collection("offers").doc(offerId).update(update)

    const supplierName = (offer.companyName as string) || (offer.supplierName as string) || "المورد"
    const rfqTitle = (offer.rfqTitle as string) || ""
    await notifyContractor({
      contractorId: (offer.contractorId as string) || null,
      organizationId: (offer.contractorOrgId as string) || (offer.contractorId as string) || null,
      type: "guest_papers",
      title: "📄 أكمل المورد الزائر أوراقه",
      message: `أرفق المورد ${supplierName} ${vatNumber ? "رقمه الضريبي" : ""}${vatNumber && added.length ? " و" : ""}${added.length ? "أوراقه الرسمية" : ""} على عرضه لطلب عروض الأسعار: ${rfqTitle}`,
      offerId,
      rfqId: (offer.rfqId as string) || null,
      rfqTitle,
    })

    return NextResponse.json({ success: true, data: { papers: update.guestPapers ?? offer.guestPapers ?? [], vatNumber: vatNumber || null } })
  } catch (err) {
    console.error("Guest papers error:", err)
    return fail("Failed to save your papers", "INTERNAL_ERROR", 500)
  }
}
