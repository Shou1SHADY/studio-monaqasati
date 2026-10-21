// What the project did to a request after it reached Procurement (PUR-01 p.5, step 6): stop a
// line that has not arrived (`cl` on the line, written by Projects' «أوقِف ما لم يصل» with who and
// the day) — withdrawn when nothing of it came, changed to what arrived when something did. Read
// from the request itself, so the same facts mark the request on the incoming page, the RFQ and the
// order; the decision is Procurement's — cancel, adjust with the supplier, or keep. Pure.

import type { ProjectRequestDoc, ProjectRequestLine } from "./needs"
import { rfqNeedSources, type NeedLinkedRfq } from "./rfq-view"

export interface ProjectChangeLine {
  /** The line's index in the request's `lines`. */
  line: number
  name: string
  unit: string
  was: number
  now: number
}

export interface ProjectChange {
  kind: "withdrawn" | "changed"
  /** The day the project did it (the latest, when several lines). */
  on: string | null
  byName: string | null
  lines: ProjectChangeLine[]
}

type ChangeInput = Pick<ProjectRequestDoc, "pm" | "status" | "lines">

const got = (l: ProjectRequestLine) => (l.receipts || []).reduce((a, x) => a + (Number(x.q) || 0), 0)
const held = (l: ProjectRequestLine) => l.chg?.st === "wait" || l.chg?.st === "no"
const byProject = (l: ProjectRequestLine) => l.cl?.t === "cancel" && l.cl.why !== "chg"

/** The change of one kind, folded over its lines: the latest day and the name that went with it. */
function fold(kind: ProjectChange["kind"], lines: ProjectChangeLine[], marks: Array<{ on: string | null; byName: string | null }>): ProjectChange | null {
  if (!lines.length) return null
  const latest = marks.slice().sort((a, b) => (a.on || "").localeCompare(b.on || "")).pop()
  return { kind, on: latest?.on ?? null, byName: latest?.byName ?? null, lines }
}

/**
 * What the project withdrew or changed on an approved request. `line` null = the request's own
 * lines (those a later change added are their own needs); a number = that one line (a line
 * sourced apart from its request).
 */
export function requestChanges(pr: ChangeInput, line: number | null = null): ProjectChange[] {
  if (!pr.pm || pr.status !== "approved") return []
  const withdrawn: ProjectChangeLine[] = []
  const changed: ProjectChangeLine[] = []
  const wMarks: Array<{ on: string | null; byName: string | null }> = []
  const cMarks: Array<{ on: string | null; byName: string | null }> = []
  ;(pr.lines || []).forEach((l, index) => {
    if (line == null ? Boolean(l.late) : index !== line) return
    if (held(l) || !l.cl) return
    const mark = { on: l.cl.on ?? null, byName: l.cl.byName ?? null }
    const was = Number(l.qty) || 0
    if (byProject(l)) {
      withdrawn.push({ line: index, name: (l.name || "").trim(), unit: (l.unit || "").trim(), was, now: 0 })
      wMarks.push(mark)
    } else if (l.cl.t === "short" && got(l) < was) {
      changed.push({ line: index, name: (l.name || "").trim(), unit: (l.unit || "").trim(), was, now: got(l) })
      cMarks.push(mark)
    }
  })
  return [fold("withdrawn", withdrawn, wMarks), fold("changed", changed, cMarks)].filter((c): c is ProjectChange => c !== null)
}

/** Every line of the request withdrawn by the project (none left to buy): who and when, else null. */
export function wholeWithdrawal(pr: ChangeInput): { on: string | null; byName: string | null } | null {
  if (!pr.pm || pr.status !== "approved") return null
  const own = (pr.lines || []).filter((l) => !l.late && !held(l))
  if (!own.length || !own.every((l) => l.cl?.t === "cancel") || !own.some(byProject)) return null
  const change = requestChanges(pr)[0]
  return change ? { on: change.on, byName: change.byName } : null
}

export interface ProjectRequestRef {
  projectId: string
  purchaseRequestId: string
  /** The one line of the request that this RFQ or order carries, when it carries not the whole. */
  line: number | null
}

/** The project requests an RFQ or an order answers (an order names its own in `purchaseSource`), each once. */
export function projectRequestsOf(doc: NeedLinkedRfq): ProjectRequestRef[] {
  const out = new Map<string, ProjectRequestRef>()
  for (const src of rfqNeedSources(doc)) {
    if (src.kind !== "project_request" || !src.projectId || !src.purchaseRequestId) continue
    const line = (src as { line?: number | null }).line ?? null
    out.set(`${src.projectId}/${src.purchaseRequestId}/${line ?? ""}`, { projectId: src.projectId, purchaseRequestId: src.purchaseRequestId, line })
  }
  return [...out.values()]
}
