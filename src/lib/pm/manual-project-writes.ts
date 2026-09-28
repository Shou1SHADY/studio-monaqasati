// PM 1.0 — creating a project by hand (the prototype's prjsave without a file).
// The PM `create` key is checked first (a site engineer has none); then ONE
// transaction draws the project number and writes the project "not started"
// with its terms, its manager named, and — once, under its key — the advance
// term Finance waits for. The seats follow as separate writes (the rules read
// the project that now exists), flagged `viaManual`, before start only.

import { collection, doc, runTransaction, serverTimestamp, setDoc, addDoc, type Firestore } from "firebase/firestore"
import { defaultEnabledSections } from "../project-sections"
import { drawYearlyDocNumber } from "../sales-numbering"
import { assertPm, type PmContext } from "./access"
import { advanceEvent, eventDocId, PM_EVENTS } from "./events"
import type { AcceptSeat, PmActor } from "./handover-writes"
import { manualDuration, manualProjectBlocks, manualTerms, manualValue, type ManualBlock, type ManualProjectDraft } from "./manual-project"
import { termProblems } from "./terms"

export class PmManualProjectError extends Error {
  constructor(readonly blocks: ManualBlock[] | ["invalid_terms"]) {
    super(blocks.join(","))
    this.name = "PmManualProjectError"
  }
}

export interface ManualProjectInput {
  organizationId: string
  draft: ManualProjectDraft
  enabledSections: string[]
  manager: AcceptSeat
  siteEngineer?: AcceptSeat | null
  store?: { name: string; centralWarehouseId: string | null } | null
  managerNotification?: { title: string; message: string }
}

export async function createManualProject(firestore: Firestore, ctx: PmContext, actor: PmActor, input: ManualProjectInput): Promise<{ projectId: string; projectNo: string }> {
  assertPm(ctx, "project.create")
  const blocks = manualProjectBlocks(input.draft, input.manager?.uid ?? null)
  if (blocks.length) throw new PmManualProjectError(blocks)
  const terms = manualTerms(input.draft)
  if (termProblems(terms).length) throw new PmManualProjectError(["invalid_terms"])
  const d = input.draft
  const value = manualValue(d)
  const projectRef = doc(collection(firestore, "projects"))
  const storeRef = input.store ? doc(collection(firestore, "warehouses")) : null
  let projectNo = ""

  await runTransaction(firestore, async (tx) => {
    projectNo = await drawYearlyDocNumber(firestore, tx, input.organizationId, "PJ")
    const event = advanceEvent({ organizationId: input.organizationId, projectId: projectRef.id, projectNo, contractValue: value, terms, by: actor.uid, at: new Date().toISOString() })
    tx.set(projectRef, {
      organizationId: input.organizationId,
      contractorId: actor.uid,
      name: d.name.trim(),
      description: null,
      location: d.location.trim() || null,
      region: d.region.trim() || null,
      budget: value,
      status: "approved_waiting_start",
      projectType: d.kind,
      clientName: d.client.trim(),
      clientType: null,
      blueprintUrl: null,
      enabledSections: input.enabledSections.length ? input.enabledSections : Array.from(defaultEnabledSections()),
      rfqIds: [],
      projectManagerId: input.manager.uid,
      projectManagerName: input.manager.name,
      ...(storeRef ? { warehouseId: storeRef.id } : {}),
      pm: {
        no: projectNo,
        lifecycle: "plan",
        kind: d.kind,
        manual: true,
        startOn: d.startOn,
        durationDays: manualDuration(d),
        signedOn: null,
        terms,
        original: null,
        startedAt: null,
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    if (event && value > 0) tx.set(doc(firestore, PM_EVENTS, eventDocId(event.key)), event)
  })

  const seat = (who: AcceptSeat, pmRole: "pm" | "site") =>
    setDoc(doc(firestore, "projects", projectRef.id, "members", who.uid), {
      userId: who.uid,
      groupId: who.groupId,
      organizationId: input.organizationId,
      addedBy: actor.uid,
      viaManual: true,
      pmRole,
      off: [],
      from: new Date().toISOString().slice(0, 10),
      to: null,
      createdAt: serverTimestamp(),
    })
  await seat(input.manager, "pm")
  if (input.siteEngineer && input.siteEngineer.uid !== input.manager.uid) {
    try {
      await seat(input.siteEngineer, "site")
    } catch (err) {
      console.error("Failed to seat the site engineer", err)
    }
  }
  if (storeRef && input.store) {
    try {
      await setDoc(storeRef, {
        name: input.store.name,
        location: d.location.trim() || null,
        description: null,
        organizationId: input.organizationId,
        centralWarehouseId: input.store.centralWarehouseId,
        projectId: projectRef.id,
        projectName: d.name.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    } catch (err) {
      console.error("Failed to create the site store", err)
    }
  }
  if (input.manager.uid !== actor.uid && input.managerNotification) {
    try {
      await addDoc(collection(firestore, "users", input.manager.uid, "notifications"), {
        ...input.managerNotification,
        type: "project_manager_named",
        projectId: projectRef.id,
        link: `/contractor/projects/${projectRef.id}?tab=pmToday`,
        createdAt: new Date().toISOString(),
        read: false,
      })
    } catch (err) {
      console.error("Failed to write notification", err)
    }
  }
  return { projectId: projectRef.id, projectNo }
}
