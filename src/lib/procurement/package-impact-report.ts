// The impact route's answer as the admin's screen reads it: only known connectors and counts, whole numbers.

import type { OptionalModule } from "@/lib/company-modules"
import { PENDING_KEYS, readPending, type PendingItem } from "@/lib/company-modules-pending"
import { CONNECTORS, type Connector } from "./package"
import { IMPACT_KEYS, type ImpactCounts } from "./package-migration"

export interface ImpactReportChange {
  conn: Connector
  to: "on" | "off"
  impact: Partial<ImpactCounts>
}

export interface ImpactReport {
  changes: ImpactReportChange[]
  hrDependent: boolean
  projectsCapped: boolean
  scanCap: number
  warnings: Array<{ module: OptionalModule; items: PendingItem[] }>
}

const whole = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

export function readImpactReport(data: unknown): ImpactReport {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>
  const changes = (Array.isArray(d.changes) ? d.changes : [])
    .filter((c): c is { conn: unknown; to: unknown; impact?: unknown } => Boolean(c) && typeof c === "object")
    .filter((c): c is { conn: Connector; to: "on" | "off"; impact?: unknown } => (CONNECTORS as readonly unknown[]).includes(c.conn) && (c.to === "on" || c.to === "off"))
    .map((c) => {
      const raw = (c.impact && typeof c.impact === "object" ? c.impact : {}) as Record<string, unknown>
      const impact: Partial<ImpactCounts> = {}
      for (const k of IMPACT_KEYS) if (k in raw) impact[k] = whole(raw[k])
      return { conn: c.conn, to: c.to, impact }
    })
  const grouped = readPending(
    Object.fromEntries((Array.isArray(d.warnings) ? d.warnings : []).filter((w): w is { module: string; items: unknown } => Boolean(w) && typeof w === "object").map((w) => [w.module, w.items])),
  )
  const warnings = (Object.keys(PENDING_KEYS) as OptionalModule[]).filter((m) => grouped[m]?.length).map((module) => ({ module, items: grouped[module] ?? [] }))
  return { changes, hrDependent: d.hrDependent === true, projectsCapped: d.projectsCapped === true, scanCap: whole(d.scanCap) || 300, warnings }
}

/** True when the admin has nothing to read: no connector changes, or none touches a record. */
export const impactQuiet = (r: ImpactReport): boolean =>
  r.warnings.length === 0 && !r.hrDependent && r.changes.every((c) => Object.values(c.impact).every((n) => !n))
