// HR 1.0 — settings writes (WF-26, ST-01…06). The HR manager alone; the
// stored document is normalised first, so a bad value never reaches payroll.

import { doc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore"
import type { HrContext } from "./access"
import { HR_SETTINGS, normalizeHrSettings, type HrSettings } from "./settings"
import { assertHr } from "./write-guard"

export async function saveHrSettings(firestore: Firestore, ctx: HrContext, orgId: string, settings: HrSettings): Promise<void> {
  assertHr(ctx, "settings.manage")
  const clean = normalizeHrSettings(settings)
  const data = { ...clean, organizationId: orgId, updatedAt: serverTimestamp(), updatedBy: ctx.uid }
  // Each field is replaced whole — the settings are always written complete.
  await setDoc(doc(firestore, HR_SETTINGS, orgId), data, { mergeFields: Object.keys(data) })
}
