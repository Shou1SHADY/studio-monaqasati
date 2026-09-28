// Two more views on a project's Pulse (the PM 1.0 prototype's right column),
// both derived, nothing stored:
//   · the sections most behind — the BOQ's divisions (earthworks, concrete…)
//     by progress against the project's planned progress today. There is no
//     per-division programme yet, so every division is measured against the
//     same planned line; the ranking still says where the delay sits.
//   · the project log — the latest dated facts from its own records.

export interface SectionItem {
  division: string
  quantity: number
  rate: number
  executed: number
}

export interface SectionRow {
  division: string
  progress: number
  deviation: number
  value: number
}

const r1 = (n: number) => Math.round(n * 10) / 10

/** The divisions furthest behind the planned progress, worst first (none when
 * nothing is planned yet, or no division is priced). */
export function sectionsBehind(items: SectionItem[], planned: number | null, top = 4): SectionRow[] {
  if (planned == null || planned <= 0) return []
  const by = new Map<string, { c: number; e: number }>()
  for (const i of items) {
    if (!i.division || !(i.rate > 0) || !(i.quantity > 0)) continue
    const s = by.get(i.division) || { c: 0, e: 0 }
    s.c += i.quantity * i.rate
    s.e += Math.min(i.executed, i.quantity) * i.rate
    by.set(i.division, s)
  }
  return Array.from(by.entries())
    .map(([division, s]) => {
      const progress = r1((s.e / s.c) * 100)
      return { division, progress, deviation: r1(progress - planned), value: s.c }
    })
    .filter((s) => s.deviation < 0)
    .sort((a, b) => a.deviation - b.deviation || b.value - a.value)
    .slice(0, top)
}

export type LogKind =
  | "started"
  | "sheet"
  | "vo_approved"
  | "vo_rejected"
  | "vo_submitted"
  | "claim_notice"
  | "claim_submitted"
  | "claim_answered"
  | "addendum_signed"
  | "cert_prepared"
  | "cert_certified"
  | "cert_collected"
  | "ncr"
  | "prov"
  | "final"

export interface LogEntry {
  day: string
  kind: LogKind
  tone: "ok" | "warn" | "bad" | "info"
  params: Record<string, string | number>
}

export interface LogFacts {
  startedAt?: string | null
  acceptances?: { prov?: { on: string } | null; final?: { on: string } | null } | null
  sheets: Array<{ seq: number; status: string; day: string }>
  variations: Array<{ seq: number; title: string; status: string; day: string; value: number }>
  claims: Array<{ seq: number; status: string; eventOn: string; noticeOn?: string | null; submittedOn?: string | null; response?: { on: string; days: number } | null }>
  addenda: Array<{ seq: number; status: string; signedOn?: string | null }>
  certificates: Array<{ seq: number; status: string; prepOn?: string | null; certOn?: string | null; collectedOn?: string | null; net?: number; certified?: number | null; gross?: number }>
  ncrs: Array<{ seq: number; status: string; day: string }>
  /** A member without money sees no certificate and no value. */
  money: boolean
}

const two = (n: number) => String(n).padStart(2, "0")
const d10 = (s: string | null | undefined) => (s ? s.slice(0, 10) : "")

export function projectLog(f: LogFacts, top = 6): LogEntry[] {
  const out: LogEntry[] = []
  const add = (day: string | null | undefined, kind: LogKind, tone: LogEntry["tone"], params: LogEntry["params"] = {}) => {
    if (d10(day)) out.push({ day: d10(day), kind, tone, params })
  }
  add(f.startedAt, "started", "info")
  add(f.acceptances?.prov?.on, "prov", "ok")
  add(f.acceptances?.final?.on, "final", "ok")
  for (const s of f.sheets) if (s.status === "ok") add(s.day, "sheet", "ok", { no: two(s.seq) })
  for (const v of f.variations) {
    const params = { no: two(v.seq), title: v.title, value: f.money ? v.value : 0 }
    if (v.status === "appr") add(v.day, "vo_approved", "ok", params)
    else if (v.status === "rej") add(v.day, "vo_rejected", "bad", params)
    else if (v.status === "wait") add(v.day, "vo_submitted", "warn", params)
  }
  for (const c of f.claims) {
    if (c.response) add(c.response.on, "claim_answered", "ok", { no: two(c.seq), days: c.response.days })
    else if (c.submittedOn) add(c.submittedOn, "claim_submitted", "warn", { no: two(c.seq) })
    else if (c.noticeOn) add(c.noticeOn, "claim_notice", "warn", { no: two(c.seq) })
  }
  for (const a of f.addenda) if (a.status === "signed") add(a.signedOn, "addendum_signed", "info", { no: two(a.seq) })
  if (f.money) {
    for (const c of f.certificates) {
      if (c.status === "void") continue
      if (c.collectedOn) add(c.collectedOn, "cert_collected", "ok", { no: two(c.seq) })
      if (c.certOn) add(c.certOn, "cert_certified", "ok", { no: two(c.seq), value: c.certified ?? c.gross ?? 0 })
      else add(c.prepOn, "cert_prepared", "info", { no: two(c.seq), value: c.gross ?? 0 })
    }
  }
  for (const n of f.ncrs) add(n.day, "ncr", n.status === "done" ? "ok" : "bad", { no: two(n.seq) })
  return out.sort((a, b) => b.day.localeCompare(a.day)).slice(0, top)
}
