// PM 1.0 — switching a project's sections (PRD WF-23, SEC-01…05, INV-17).
// Switching on is immediate, with its dependencies. Switching off states a
// reason ("other" stated) and passes the blockers first: money and custody
// block — stock in the project store, a certificate not yet collected — while
// open paperwork only warns. Every switch is logged with who, what, when and
// why; nothing is deleted, so switching back restores it. Core sections never
// switch off. By `approve`, never on an archived project.

import { collection, doc, getDocs, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { PM_CERTIFICATES } from "./certificate"
import type { PmCertificate } from "./certificate-writes"
import { withFreshState } from "./project-writes"
import { SECTION_REGISTRY, type SectionId } from "../project-sections"

export const SECTION_OFF_REASONS = ["not_in_contract", "client_scope", "subcontracted", "other"] as const
export type SectionOffReason = (typeof SECTION_OFF_REASONS)[number]

export type SectionBlocker = "store_stock" | "uncollected"

export interface SectionFacts {
  /** Lines with stock left in the project's own store. */
  storeLines: number
  /** Certified certificates Finance has not collected in full. */
  uncollected: number
}

/** SEC-03: only money and custody block. */
export function switchOffBlockers(turnedOff: SectionId[], facts: SectionFacts): SectionBlocker[] {
  const out: SectionBlocker[] = []
  if (turnedOff.includes("store") && facts.storeLines > 0) out.push("store_stock")
  if ((turnedOff.includes("ipc") || turnedOff.includes("collect")) && facts.uncollected > 0) out.push("uncollected")
  return out
}

export type SwitchBlock = SectionBlocker | "archived" | "core" | "no_reason" | "reason_text" | "no_change"

export function switchBlocks(input: { archived: boolean; turnedOn: SectionId[]; turnedOff: SectionId[]; reason: SectionOffReason | null; reasonText?: string | null; facts: SectionFacts }): SwitchBlock[] {
  const out: SwitchBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.turnedOn.length && !input.turnedOff.length) out.push("no_change")
  if (input.turnedOff.some((id) => SECTION_REGISTRY[id]?.required)) out.push("core")
  if (input.turnedOff.length) {
    if (!input.reason) out.push("no_reason")
    else if (input.reason === "other" && !input.reasonText?.trim()) out.push("reason_text")
    out.push(...switchOffBlockers(input.turnedOff, input.facts))
  }
  return out
}

export class PmSectionsError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmSectionsError"
  }
}

/** What the blockers need, read now: the project store and the certificates. */
export async function readSectionFacts(firestore: Firestore, projectId: string, warehouseId: string | null | undefined): Promise<SectionFacts> {
  const [certs, store] = await Promise.all([
    getDocs(collection(firestore, "projects", projectId, PM_CERTIFICATES)).catch(() => null),
    warehouseId ? getDocs(collection(firestore, "warehouses", warehouseId, "inventoryItems")).catch(() => null) : Promise.resolve(null),
  ])
  const uncollected = (certs?.docs ?? [])
    .map((d) => d.data() as PmCertificate & { collected?: number | null })
    .filter((c) => (c.status === "appr" || c.status === "part") && (c.collected ?? 0) < 1).length
  const storeLines = (store?.docs ?? []).filter((d) => (Number((d.data() as { quantity?: number }).quantity) || 0) > 0).length
  return { storeLines, uncollected }
}

export interface SectionActor {
  uid: string
  name: string | null
}

export async function switchSections(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: SectionActor,
  input: { next: SectionId[]; reason: SectionOffReason | null; reasonText?: string | null; facts: SectionFacts }
): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const ref = doc(firestore, "projects", projectId)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmSectionsError("missing")
    const project = snap.data() as { status?: string; projectManagerId?: string | null; enabledSections?: string[]; pm?: Record<string, unknown> & { secLog?: unknown[] } }
    if (!project.pm) throw new PmSectionsError("not_pm_project")
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "sections.manage")
    const before = new Set((project.enabledSections ?? []) as SectionId[])
    const after = new Set(input.next)
    const turnedOn = input.next.filter((id) => !before.has(id))
    const turnedOff = [...before].filter((id) => !after.has(id))
    const blocks = switchBlocks({ archived: fresh.archived, turnedOn, turnedOff, reason: input.reason, reasonText: input.reasonText, facts: input.facts })
    if (blocks.length) throw new PmSectionsError("blocked", blocks)
    const entry = {
      on: turnedOn,
      off: turnedOff,
      reason: turnedOff.length ? input.reason : null,
      reasonText: turnedOff.length && input.reason === "other" ? input.reasonText?.trim() ?? null : null,
      by: actor.uid,
      byName: actor.name,
      at: new Date().toISOString(),
    }
    tx.update(ref, { enabledSections: input.next, pm: { ...project.pm, secLog: [...(project.pm.secLog ?? []), entry].slice(-200) }, updatedAt: serverTimestamp() })
  })
}
