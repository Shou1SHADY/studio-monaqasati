// HR 1.0 — the two acts Today does on the spot, with no page to open:
// reminding a workplace's supervisor that his sheet stopped (AT-03/04 — the
// HR manager or payroll; a notification, once a day per workplace) and
// recording that an approved leave's exit re-entry visa was issued (LV-08 —
// government relations, or the HR manager when nobody holds that role;
// stamped once on the leave, the only field it changes).

import { doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import type { HrContext } from "./access"
import { HR_REQUESTS } from "./collections"
import type { HrActor } from "./employee-writes"
import { emitHrNotice, hrLinks } from "./notify"
import type { HrRequest } from "./requests"
import type { HrSite } from "./sites"
import { assertHr, HrWriteError } from "./write-guard"

/** AT-03/04 — "ذكّر المشرف": the supervisor of a workplace whose sheet stopped is told, once a day. */
export async function remindSheet(firestore: Firestore, ctx: HrContext, actor: HrActor, site: Pick<HrSite, "id" | "organizationId" | "name" | "supervisorUserId">, since: string, today: string): Promise<number> {
  if (!ctx.roles.has("manager") && !ctx.roles.has("payroll")) throw new HrWriteError("no_role")
  if (!site.supervisorUserId) throw new HrWriteError("blocked", ["no_supervisor"])
  return emitHrNotice(firestore, actor, {
    kind: "hr_sheet_reminder",
    organizationId: site.organizationId,
    to: [{ users: [site.supervisorUserId] }],
    params: { site: site.name, since },
    link: hrLinks.site(site.id),
    once: `${site.id}_${today}`,
  })
}

/** LV-08 — the exit re-entry visa of an approved leave abroad is recorded, once, before he travels. */
export async function recordExitVisa(firestore: Firestore, ctx: HrContext, actor: HrActor, requestId: string): Promise<void> {
  assertHr(ctx, "platform.tasks")
  await runTransaction(firestore, async (tx) => {
    const ref = doc(firestore, HR_REQUESTS, requestId)
    const s = await tx.get(ref)
    if (!s.exists()) throw new HrWriteError("missing")
    const r = s.data() as HrRequest & { exitVisa?: unknown }
    if (r.kind !== "leave" || r.state !== "approved" || r.exitVisa) throw new HrWriteError("blocked", ["stale"])
    if (ctx.employeeId && r.employeeId === ctx.employeeId) throw new HrWriteError("own_request")
    tx.update(ref, { exitVisa: { by: actor.uid, byName: actor.name, at: new Date().toISOString() }, updatedAt: serverTimestamp() })
  })
}
