// PM 1.1 — accepting a handover FILE, as ONE transaction (HO-02, WF-01, CON-01).
// The project is born "plan" with its number, its original terms, the manager
// named, the advance term sent to Finance once (with the advance frozen beside
// it, IPC-07) — and its BOQ written IN THE SAME transaction. A file that carries
// the winning bid's priced BOQ is accepted only by transferring that BOQ as it
// is: no Excel, no typing, no «later», no edit (CON-01, FX-08). The 1.0 wizard
// wrote the lines in a later client batch, which could fail half-way and leave a
// project with part of its contract — and wrote whatever the wizard had edited.
//
// The rules cannot let a client create a project and its BOQ lines together
// (a line's rule reads the project with get(), which sees the state before the
// write), so this runs on the server (/api/pm/handover-accept, Admin SDK). The
// core is written over a tiny store interface so the same code is tested over
// the in-memory Firestore.

import { CRM_OPPORTUNITIES } from "../crm"
import { defaultEnabledSections } from "../project-sections"
import { formatYearlyDocNumber } from "../sales-numbering"
import { MFG_COUNTERS } from "../manufacturing-engine"
import { advanceEvent, PM_EVENTS, pmEventDocId } from "./events"
import { acceptBlocks, handoverBoqCount, isSelfDevelopment, mayActOnHandover, PM_HANDOVERS, type BoqSource, type HandoverBoqLine, type PmHandover, type ProjectKind } from "./handover"
import { defaultTerms, termProblems, type ContractTerms } from "./terms"

/** A BOQ line as the acceptance writes it (the new-project wizard's shape). */
export interface AcceptBoqLine {
  itemNo: string
  descriptionAr: string
  descriptionEn: string
  unit: string
  quantity: number
  unitPrice: number
  groupId: string | null
  /** Parser extras (division, sheet, estimated cost…) — plain values only. */
  extra?: Record<string, string | number | boolean | null>
}

export interface AcceptBoqGroup {
  id: string
  titleAr: string
  categoryAr: string
}

export interface AcceptCoreInput {
  kind: ProjectKind
  location: string | null
  region?: string | null
  enabledSections: string[]
  terms?: ContractTerms
  manager: { uid: string; name: string | null }
  note?: string | null
  /** A site store will be made for the project: its id is drawn here and named on the project. */
  wantsStore?: boolean
  /** Where the BOQ comes from. With a priced BOQ on the file only "crm" is accepted. */
  source: BoqSource
  /** The lines of an Excel / typed BOQ (ignored for "crm" — the file's own lines are written — and "later"). */
  lines?: AcceptBoqLine[]
  groups?: AcceptBoqGroup[]
}

export interface AcceptStoreTx {
  get(path: string): Promise<Record<string, unknown> | null>
  set(path: string, data: Record<string, unknown>): void
  update(path: string, data: Record<string, unknown>): void
}

export interface AcceptStore {
  run<T>(fn: (tx: AcceptStoreTx) => Promise<T>): Promise<T>
  newId(collection: string): string
  /** The server's timestamp sentinel. */
  stamp(): unknown
}

export type AcceptCoreCode = "missing" | "not_yours" | "not_waiting" | "blocked" | "invalid" | "boq_from_crm" | "boq_empty"

export class AcceptCoreError extends Error {
  constructor(readonly code: AcceptCoreCode) {
    super(code)
    this.name = "AcceptCoreError"
  }
}

export interface AcceptCoreResult {
  projectId: string
  projectNo: string
  storeId: string | null
  organizationId: string
  title: string
  location: string | null
  requestedBy: string
  lines: number
}

/** CON-01 — the source a file allows: only its own priced BOQ when it carries one. */
export function acceptSourceBlock(h: Pick<PmHandover, "boq">, source: BoqSource, lineCount: number): AcceptCoreCode | null {
  if (handoverBoqCount(h) > 0) return source === "crm" ? null : "boq_from_crm"
  if (source === "crm") return "boq_from_crm"
  if ((source === "xl" || source === "man") && lineCount === 0) return "boq_empty"
  return null
}

/** The file's priced BOQ as project lines — codes, quantities and rates exactly as sent. */
export function handoverBoqLines(boq: HandoverBoqLine[] | null | undefined): AcceptBoqLine[] {
  return (boq ?? [])
    .filter((l) => l.quantity > 0)
    .map((l) => ({
      itemNo: l.code,
      descriptionAr: l.descriptionAr || l.descriptionEn || "",
      descriptionEn: l.descriptionEn || l.descriptionAr || "",
      unit: l.unit,
      quantity: l.quantity,
      unitPrice: l.rate > 0 ? l.rate : 0,
      groupId: null,
    }))
}

const fileExtra = (h: PmHandover, k: "region" | "consultantName") => {
  const v = (h as unknown as Record<string, unknown>)[k]
  return typeof v === "string" && v.trim() ? v.trim() : null
}

/** `organizationId`: the caller's company (the server knows it) — a file of another company is never theirs. */
export async function acceptHandoverCore(store: AcceptStore, actor: { uid: string; owner: boolean; organizationId?: string }, handoverId: string, input: AcceptCoreInput): Promise<AcceptCoreResult> {
  if (!input.manager?.uid) throw new AcceptCoreError("invalid")
  const projectId = store.newId("projects")
  const storeId = input.wantsStore ? store.newId("warehouses") : null
  const note = input.note?.trim() || null
  return store.run(async (tx) => {
    const raw = await tx.get(`${PM_HANDOVERS}/${handoverId}`)
    if (!raw) throw new AcceptCoreError("missing")
    const h = { id: handoverId, ...raw } as PmHandover
    if ((actor.organizationId && h.organizationId !== actor.organizationId) || !mayActOnHandover(actor, h)) throw new AcceptCoreError("not_yours")
    if (h.status !== "wait") throw new AcceptCoreError("not_waiting")
    if (acceptBlocks(h).length) throw new AcceptCoreError("blocked")
    const terms = input.terms ?? defaultTerms({ advance: h.advance, retention: h.retention, selfDevelopment: isSelfDevelopment(input.kind) })
    if (termProblems(terms).length) throw new AcceptCoreError("invalid")
    const sourceBlock = acceptSourceBlock(h, input.source, input.lines?.length ?? 0)
    if (sourceBlock) throw new AcceptCoreError(sourceBlock)
    // CON-01: the file's own lines, never what a screen sent.
    const lines = input.source === "crm" ? handoverBoqLines(h.boq) : input.source === "later" ? [] : (input.lines ?? [])

    const year = new Date().getUTCFullYear()
    const counterPath = `${MFG_COUNTERS}/${h.organizationId}__PJ__${year}`
    const counter = await tx.get(counterPath)
    const seq = (Number(counter?.last) || 0) + 1
    const projectNo = formatYearlyDocNumber("PJ", year, seq)
    const now = new Date().toISOString()
    const event = advanceEvent({ organizationId: h.organizationId, projectId, projectNo, contractValue: h.value, terms, by: actor.uid, at: now })

    tx.set(counterPath, { organizationId: h.organizationId, type: "PJ", year, last: seq, updatedAt: store.stamp() })
    tx.set(`projects/${projectId}`, {
      organizationId: h.organizationId,
      contractorId: actor.uid,
      name: h.title,
      description: h.note,
      location: input.location ?? h.location,
      region: input.region?.trim() || fileExtra(h, "region") || null,
      consultant: fileExtra(h, "consultantName"),
      budget: h.value,
      status: "approved_waiting_start",
      projectType: input.kind,
      clientName: h.clientName,
      clientType: h.clientType,
      blueprintUrl: null,
      enabledSections: input.enabledSections.length ? input.enabledSections : Array.from(defaultEnabledSections()),
      rfqIds: [],
      sourceOpportunityId: h.opportunityId,
      pmHandoverId: h.id,
      contractNumber: h.contractNumber,
      projectManagerId: input.manager.uid,
      projectManagerName: input.manager.name,
      ...(storeId ? { warehouseId: storeId } : {}),
      pm: {
        no: projectNo,
        lifecycle: "plan",
        kind: input.kind,
        startOn: h.startOn,
        durationDays: h.durationDays,
        signedOn: h.signedOn,
        terms,
        original: null,
        startedAt: null,
        acceptNote: note,
        ...(input.source === "crm" ? { boqFrom: "crm" } : {}),
        // IPC-07: the advance freezes in the transaction that sends prj:ADV.
        ...(event ? { advAmt: event.amount } : {}),
      },
      createdAt: store.stamp(),
      updatedAt: store.stamp(),
    })
    for (const { extra, ...line } of lines) {
      tx.set(`projects/${projectId}/boqItems/${store.newId(`projects/${projectId}/boqItems`)}`, {
        ...line,
        ...(extra ?? {}),
        tenderId: null,
        isEditable: true,
        executedQuantity: 0,
        billedQuantity: 0,
        createdAt: store.stamp(),
        updatedAt: store.stamp(),
      })
    }
    if (input.source === "xl") {
      const used = new Set(lines.map((l) => l.groupId))
      for (const g of input.groups ?? []) if (used.has(g.id)) tx.set(`projects/${projectId}/boqGroups/${g.id}`, { titleAr: g.titleAr, categoryAr: g.categoryAr, createdAt: store.stamp(), updatedAt: store.stamp() })
    }
    tx.update(`${PM_HANDOVERS}/${handoverId}`, { status: "acc", projectId, acceptedAt: now, acceptedBy: actor.uid, acceptNote: note })
    tx.update(`${CRM_OPPORTUNITIES}/${h.opportunityId}`, {
      projectId,
      handoverStatus: "accepted",
      projectManagerId: input.manager.uid,
      projectManagerName: input.manager.name,
      updatedAt: store.stamp(),
    })
    if (event) tx.set(`${PM_EVENTS}/${pmEventDocId(event.organizationId, event.key)}`, event as unknown as Record<string, unknown>)
    return { projectId, projectNo, storeId, organizationId: h.organizationId, title: h.title, location: input.location ?? h.location, requestedBy: h.requestedBy, lines: lines.length }
  })
}
