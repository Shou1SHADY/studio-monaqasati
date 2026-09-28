// The ledger shadow of a PM 1.0 certification — kept apart from `hooks.ts`
// (mirrored into the mobile app, which carries no Project Management). Like
// every hook: fire-and-forget, silent when Accounting is off, never throwing.

import type { Firestore } from "firebase/firestore"
import type { PmEvent } from "../pm/events"
import { isAccountingEnabled, postToLedgerSafe } from "./post"
import { pmCertificatePosting } from "./pm-postings"

/** A certificate was certified (its `prj:IPC` event): the revenue event, posted
 * exactly as a legacy claim is — keyed on the event, so the Finance desk's
 * "post" and this hook land on the same entry. */
export function onPmCertificateCertified(firestore: Firestore, actor: { organizationId: string; userId: string; userName: string }, event: PmEvent, projectName?: string | null): void {
  void (async () => {
    try {
      if (!(await isAccountingEnabled(firestore, actor.organizationId))) return
      await postToLedgerSafe(firestore, actor, pmCertificatePosting(event, projectName))
    } catch (err) {
      console.error("PM certificate posting failed:", err)
    }
  })()
}
