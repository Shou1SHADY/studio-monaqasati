// HR 1.0 — settings writes (WF-26, ST-01…06). The HR manager alone; the
// stored document is normalised first, so a bad value never reaches payroll.
// Every save appends what it changed to the document's log (ST-01: "a policy
// is editable and logged") — read and written in one transaction, so two
// saves never lose each other's entries.

import { doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import type { HrContext } from "./access"
import { appendSettingsLog, HR_SETTINGS, normalizeHrSettings, type HrSettings } from "./settings"
import { assertHr } from "./write-guard"

export async function saveHrSettings(firestore: Firestore, ctx: HrContext, orgId: string, settings: HrSettings, actor?: { name?: string | null }): Promise<void> {
  assertHr(ctx, "settings.manage")
  const ref = doc(firestore, HR_SETTINGS, orgId)
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    const before = normalizeHrSettings(snap.exists() ? (snap.data() as Partial<HrSettings>) : null)
    const clean = normalizeHrSettings({ ...settings, log: before.log })
    const log = appendSettingsLog(before, clean, { uid: ctx.uid, name: actor?.name ?? null }, new Date().toISOString())
    const data = { ...clean, log, organizationId: orgId, updatedAt: serverTimestamp(), updatedBy: ctx.uid }
    // Each field is replaced whole — the settings are always written complete.
    if (snap.exists()) tx.update(ref, data)
    else tx.set(ref, data)
  })
}
