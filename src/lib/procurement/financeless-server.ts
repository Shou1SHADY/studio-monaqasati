// The server's side of a Finance-less company (PUR-10): is Finance in its package, and the
// caller allowed to mark payment («يعلّم الدفع» — the owner and the procurement manager).

import { randomUUID } from "node:crypto"
import type { Firestore } from "firebase-admin/firestore"
import { COMPANY_MODULES } from "@/lib/company-modules"
import { getAdminStorage, getStorageBucketName } from "@/lib/firebaseAdmin"
import type { PermissionId } from "@/lib/permissions"
import { UPLOAD_MAX_BYTES } from "@/lib/upload-fit"
import type { TransferFile } from "./payment-mark"

export async function financeOn(db: Firestore, orgId: string): Promise<boolean> {
  const off = (await db.collection(COMPANY_MODULES).doc(orgId).get()).data()?.off
  return !(Array.isArray(off) && off.includes("payments"))
}

/** Project Management in the package: then materials are asked for from the project, never the team's «طلب مواد». */
export async function projectsOn(db: Firestore, orgId: string): Promise<boolean> {
  const off = (await db.collection(COMPANY_MODULES).doc(orgId).get()).data()?.off
  return !(Array.isArray(off) && off.includes("project-management"))
}

export const mayMarkPayment = (can: (p: PermissionId) => boolean): boolean => can("po.approve")

export type OrderFileRefusal = "BAD_TYPE" | "TOO_BIG"

/** A PDF or an image, within the upload limit — what an order's attached copy may be. */
export function orderFileRefusal(file: { type: string; size: number }): OrderFileRefusal | null {
  if (!(file.type === "application/pdf" || file.type.startsWith("image/"))) return "BAD_TYPE"
  return file.size > UPLOAD_MAX_BYTES ? "TOO_BIG" : null
}

/** Stores a copy (the transfer's picture) under the order's folder and returns where to read it. */
export async function saveOrderFile(orgId: string, poId: string, folder: string, file: File): Promise<TransferFile> {
  const bucketName = getStorageBucketName()
  const path = `purchase-orders/${orgId}/${poId}/${folder}/${Date.now()}-${file.name.replace(/[^\w.؀-ۿ-]+/g, "_").slice(-80)}`
  const token = randomUUID()
  await getAdminStorage().bucket(bucketName).file(path).save(Buffer.from(await file.arrayBuffer()), { contentType: file.type, metadata: { metadata: { firebaseStorageDownloadTokens: token } } })
  return { name: file.name.slice(0, 120), url: `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`, path }
}
