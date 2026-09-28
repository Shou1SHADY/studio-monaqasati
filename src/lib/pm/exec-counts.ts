// The Execution tab's sub-tab counts (the prototype's SEGS.exec): a count
// shows only what needs someone — the number of daily reports is not news, a
// failed inspection is. Measurement: sheets awaiting the PM. Inspections &
// punch («الفحص والملاحظات»): open or failed requests + open punch items + open
// NCRs, red when an inspection failed. Site: activities in the look-ahead that
// are not ready when the weekly plan is on, else open obstacles.
// Subcontractors: certificates awaiting approval. Pure: no I/O.

/** The same tones as SegmentedNav's count chip. */
export type SegmentTone = "bad" | "warn" | "ok" | "mute"

export interface ExecCount {
  count?: number
  tone?: SegmentTone
}

export interface ExecFacts {
  sheets: Array<{ status: string }>
  inspections: Array<{ status: string }>
  punch: Array<{ status: string }>
  ncrs: Array<{ status: string }>
  obstacles: Array<{ closeOn?: string | null }>
  subCertificates: Array<{ status: string }>
  /** Look-ahead rows not ready — pass when the weekly plan is on, else null. */
  lookaheadBlocked: number | null
}

const n = (count: number, tone: SegmentTone): ExecCount => (count > 0 ? { count, tone } : {})

export function execCounts(f: ExecFacts): Record<"pmMeasure" | "pmQa" | "pmSite" | "pmSubs", ExecCount> {
  const wirOpen = f.inspections.filter((w) => w.status === "open" || w.status === "fail").length
  const failed = f.inspections.some((w) => w.status === "fail")
  const punchOpen = f.punch.filter((p) => p.status !== "done").length
  const ncrOpen = f.ncrs.filter((x) => x.status !== "done").length
  return {
    pmMeasure: n(f.sheets.filter((s) => s.status === "wait").length, "warn"),
    pmQa: n(wirOpen + punchOpen + ncrOpen, failed ? "bad" : "warn"),
    pmSite: n(f.lookaheadBlocked ?? f.obstacles.filter((o) => !o.closeOn).length, "warn"),
    pmSubs: n(f.subCertificates.filter((c) => c.status === "int").length, "warn"),
  }
}
