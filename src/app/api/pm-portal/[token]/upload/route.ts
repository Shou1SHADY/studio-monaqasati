import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { getAdminFirestore, getAdminStorage, getStorageBucketName } from "@/lib/firebaseAdmin"
import { consumeMobileRate } from "@/lib/links/rate"
import { UPLOAD_MAX_BYTES } from "@/lib/upload-fit"
import {
  PM_PORTAL_LINKS,
  PORTAL_SESSION_HEADER,
  PORTAL_UPLOADS_KEEP,
  projectRefusal,
  resolvePortalSession,
  type PmPortalLink,
  type PortalProjectDoc,
  type PortalUpload,
} from "@/lib/pm/portal-links"

// The consultant attaches what backs his answer (CP-07: optional everywhere) —
// his signed reply, a photo, his certificate. He has no account, so the file
// goes up through this route on his session and lands where every PM file does
// (`organizations/{org}/pm/projects/{id}/portal/…`), and on the link's list of
// uploads: an answer may attach only files listed there. Images and PDFs,
// under the request-body limit (the page shrinks a photo first).

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const db = getAdminFirestore()
    const now = Date.now()
    const resolved = await resolvePortalSession(db, token, req.headers.get(PORTAL_SESSION_HEADER), now)
    if (!resolved.ok) return fail("Enter the code again", resolved.code, resolved.status)
    const { linkId, link } = resolved
    const project = (await db.collection("projects").doc(link.projectId).get()).data() as PortalProjectDoc | undefined
    const closed = projectRefusal(project, link.organizationId)
    if (closed) return fail("This project is closed", closed, 409)

    const form = await req.formData().catch(() => null)
    const file = form?.get("file")
    if (!(file instanceof File)) return fail("Choose a file", "BAD_REQUEST", 400)
    if (!(file.type.startsWith("image/") || file.type === "application/pdf")) return fail("Images or PDF only", "BAD_TYPE", 400)
    if (file.size > UPLOAD_MAX_BYTES) return fail("4 MB at most", "TOO_BIG", 400)
    const rate = await consumeMobileRate(db, "write", link.consultant.phone, now)
    if (!rate.ok) return fail("Too many files — try again later", rate.code, rate.status)

    const safe = file.name.replace(/[^\w.؀-ۿ-]+/g, "_").slice(-80) || "file"
    const path = `organizations/${link.organizationId}/pm/projects/${link.projectId}/portal/${Date.now()}_${safe}`
    const bucketName = getStorageBucketName()
    const downloadToken = randomUUID()
    await getAdminStorage()
      .bucket(bucketName)
      .file(path)
      .save(Buffer.from(await file.arrayBuffer()), { contentType: file.type, metadata: { metadata: { firebaseStorageDownloadTokens: downloadToken } } })
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`
    const entry: PortalUpload = { url, name: file.name.slice(0, 120), path, at: new Date(now).toISOString() }
    const linkRef = db.collection(PM_PORTAL_LINKS).doc(linkId)
    await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(linkRef)).data() as PmPortalLink | undefined
      tx.update(linkRef, { uploads: [...(fresh?.uploads ?? []), entry].slice(-PORTAL_UPLOADS_KEEP) })
    })
    return NextResponse.json({ success: true, data: { file: { url, name: entry.name } } })
  } catch (error) {
    console.error("PM portal upload error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}
