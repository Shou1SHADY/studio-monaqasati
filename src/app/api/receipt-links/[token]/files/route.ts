import { NextRequest, NextResponse } from "next/server"
import { UPLOAD_MAX_BYTES } from "@/lib/upload-fit"
import { randomUUID } from "node:crypto"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminFirestore, getAdminStorage, getStorageBucketName } from "@/lib/firebaseAdmin"
import { MAX_RECEIVER_FILES, RECEIPT_LINKS, RECEIVER_FILE_KINDS, resolveReceiptLink, type ReceiverFile, type ReceiverFileKind } from "@/lib/receipt-links"

// The receiver attaches what proves the receipt (PUR-06): photos of the shipment, the
// weighbridge ticket, a certificate. Whoever holds the open link may attach — the link is
// the key, as for the count; the files land on the link and travel with the signed report.
// Images and PDFs only, 10 MB each, ten at most.

// Under Vercel's 4.5 MB request-body limit (prod); the browser shrinks a photo first (upload-fit.ts).
const MAX_BYTES = UPLOAD_MAX_BYTES
const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const db = getAdminFirestore()
    const resolved = await resolveReceiptLink(db, token)
    if (!resolved.ok) return fail("This link is invalid, used, or has expired", resolved.code, resolved.status)
    const { linkId, link } = resolved
    if ((link.files || []).length >= MAX_RECEIVER_FILES) return fail("Ten files at most", "TOO_MANY", 400)

    const form = await req.formData().catch(() => null)
    const file = form?.get("file")
    const kind = String(form?.get("kind") || "photo") as ReceiverFileKind
    if (!(file instanceof File) || !(RECEIVER_FILE_KINDS as readonly string[]).includes(kind)) return fail("Choose a file", "BAD_REQUEST", 400)
    if (!(file.type.startsWith("image/") || file.type === "application/pdf")) return fail("Images or PDF only", "BAD_TYPE", 400)
    if (file.size > MAX_BYTES) return fail("4 MB at most", "TOO_BIG", 400)

    const at = new Date().toISOString()
    const safe = file.name.replace(/[^\w.؀-ۿ-]+/g, "_").slice(-80) || "file"
    const path = `receipts/${link.organizationId}/${link.deliveryId}/${Date.now()}-${safe}`
    const bucketName = getStorageBucketName()
    const downloadToken = randomUUID()
    await getAdminStorage()
      .bucket(bucketName)
      .file(path)
      .save(Buffer.from(await file.arrayBuffer()), { contentType: file.type, metadata: { metadata: { firebaseStorageDownloadTokens: downloadToken } } })
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`
    const entry: ReceiverFile = { name: file.name.slice(0, 120), url, path, kind, at }
    await db.collection(RECEIPT_LINKS).doc(linkId).update({ files: FieldValue.arrayUnion(entry) })
    return NextResponse.json({ success: true, data: { file: { name: entry.name, url, kind } } })
  } catch (error) {
    console.error("Receipt link file error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
