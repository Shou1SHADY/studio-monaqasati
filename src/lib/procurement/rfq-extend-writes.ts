// «مدّد الموعد أو أضف موردين» (R-40, prototype `extend`): the light change to a
// live RFQ — a later deadline and more invitees — without reopening the form.
// Offered while the prices are still sealed or nothing came in, so nobody has
// seen a competitor's figure. A passed deadline makes it a re-publish. One
// transaction that re-reads the RFQ; the log names the new date and how many
// suppliers were added.

import { addDoc, collection, doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { rfqLogEntry, type RfqLogEntry } from "./rfq-detail"
import { actsOnRfq, type RfqAuthorLike, type RfqRunner, type RfqWriteActor } from "./rfq-access"
import { ProcWriteError } from "./writes"

export interface ExtendInput {
  deadline: string
  addSupplierOrgIds: string[]
}

export type ExtendRefusal = "rfq_not_open" | "date_invalid" | "no_permission"

/** `today` is `YYYY-MM-DD`; the new deadline must be after it. */
export function extendRefusal(rfq: ({ status?: string | null; directAward?: boolean | null } & RfqAuthorLike) | null, actor: Pick<RfqRunner, "isOwner" | "canPrepare"> & Partial<RfqRunner>, input: ExtendInput, today: string): ExtendRefusal | null {
  if (!actsOnRfq(rfq || {}, { uid: "", canApprove: false, ...actor })) return "no_permission"
  if (!rfq || rfq.status !== "New" || rfq.directAward) return "rfq_not_open"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deadline) || input.deadline <= today) return "date_invalid"
  return null
}

export function extendPatch(
  rfq: { visibility?: string | null; allowedSupplierOrgIds?: string[] | null; invitedSupplierOrgIds?: string[] | null },
  input: ExtendInput
): { deadline: string; allowedSupplierOrgIds?: string[]; invitedSupplierOrgIds: string[]; added: number } {
  const allowed = rfq.allowedSupplierOrgIds || []
  const invited = rfq.invitedSupplierOrgIds || []
  const fresh = Array.from(new Set(input.addSupplierOrgIds.filter((id) => id && !allowed.includes(id) && !invited.includes(id))))
  const out: { deadline: string; allowedSupplierOrgIds?: string[]; invitedSupplierOrgIds: string[]; added: number } = {
    deadline: input.deadline,
    invitedSupplierOrgIds: [...invited, ...fresh],
    added: fresh.length,
  }
  if (rfq.visibility === "private") out.allowedSupplierOrgIds = [...allowed, ...fresh]
  return out
}

/** How the invitation reads — the caller's translator for Portal.Shared, when it has one. */
export interface ExtendCopy {
  has: (key: string) => boolean
  (key: string, params?: Record<string, string | number>): string
}

export async function extendRfq(firestore: Firestore, actor: RfqWriteActor, rfqId: string, input: ExtendInput, now = new Date(), copy?: ExtendCopy): Promise<number> {
  const at = now.toISOString()
  const today = at.slice(0, 10)
  const ref = doc(firestore, "rfqs", rfqId)
  let fresh: string[] = []
  let title = ""
  const added = await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new ProcWriteError("rfq_missing")
    const rfq = snap.data() as RfqAuthorLike & { status?: string; directAward?: boolean; visibility?: string; allowedSupplierOrgIds?: string[]; invitedSupplierOrgIds?: string[]; log?: RfqLogEntry[] }
    const refusal = extendRefusal(rfq, actor, input, today)
    if (refusal) throw new ProcWriteError(refusal)
    const { added, ...patch } = extendPatch(rfq, input)
    fresh = patch.invitedSupplierOrgIds.slice(patch.invitedSupplierOrgIds.length - added)
    title = (rfq as { title?: string }).title || ""
    tx.update(ref, { ...patch, updatedAt: serverTimestamp(), log: [...(rfq.log || []), rfqLogEntry(actor, "extended", at, { params: { date: input.deadline, added } })] })
    return added
  })
  // Each supplier the extension added hears of the RFQ, as an invitee does (best-effort).
  const params = { rfq: title, date: input.deadline }
  const heading = copy?.has("pn_rfq_invited_title") ? copy("pn_rfq_invited_title", params) : "دعوة لتقديم عرض"
  const message = copy?.has("pn_rfq_invited") ? copy("pn_rfq_invited", params) : `دُعيت لتقديم عرض في «${title}» حتى ${input.deadline}`
  await Promise.all(
    fresh.map((uid) =>
      addDoc(collection(firestore, "users", uid, "notifications"), {
        userId: uid,
        organizationId: uid,
        type: "rfq_invited",
        i18n: { title: "pn_rfq_invited_title", message: "pn_rfq_invited", params },
        title: heading,
        message,
        rfqId,
        rfqTitle: title,
        link: `/supplier/rfqs?rfq=${rfqId}`,
        createdAt: at,
        read: false,
      }).catch((err) => console.warn("invitation notice failed:", (err as { code?: string })?.code || err))
    )
  )
  return added
}
