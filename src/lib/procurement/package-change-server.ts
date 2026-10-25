// What the admin reads before saving a contractor's package, and what the save then writes — one computation for the
// impact route and the save route, so the report the admin saw is the one the save re-checks.

import type { Firestore } from "firebase-admin/firestore"
import { COMPANY_MODULES, offSet, type OptionalModule } from "@/lib/company-modules"
import { warningsFor, type PendingItem } from "@/lib/company-modules-pending"
import { loadPending } from "@/lib/company-modules-pending-server"
import { loadPackageSnapshot } from "./package-migration-server"
import { planPackageChange, type PackageChangePlan } from "./package-migration"

export interface StoredModules {
  off: string[]
  needs: Record<string, unknown>
  history: unknown[]
  /** «نشط» / «تجريبي» (AD-03) as stored — read it through `subscriptionStatusOf`. */
  subscription?: string
}

/** The switches a contractor can have, with the ones that need an off one added — the list as the app reads it. */
export const contractorOff = (list: unknown): OptionalModule[] => [...offSet({ off: list }, "contractor")].sort()

export async function readStoredModules(db: Firestore, orgId: string): Promise<StoredModules> {
  const data = (await db.collection(COMPANY_MODULES).doc(orgId).get()).data() ?? {}
  return {
    off: contractorOff(data.off),
    needs: data.needs && typeof data.needs === "object" ? (data.needs as Record<string, unknown>) : {},
    history: Array.isArray(data.history) ? data.history : [],
    subscription: typeof data.subscription === "string" ? data.subscription : undefined,
  }
}

export interface PackageAssessment {
  plan: PackageChangePlan
  warnings: Array<{ module: OptionalModule; items: PendingItem[] }>
}

export async function assessPackageChange(db: Firestore, orgId: string, currentOff: readonly string[], nextOff: readonly string[]): Promise<PackageAssessment> {
  const plan = planPackageChange(await loadPackageSnapshot(db, orgId), currentOff, nextOff)
  const closing = nextOff.filter((m) => !currentOff.includes(m))
  const warnings = closing.length ? warningsFor(new Set(currentOff as OptionalModule[]), new Set(nextOff as OptionalModule[]), await loadPending(db, orgId)) : []
  return { plan, warnings }
}

export const assessmentIsQuiet = (a: PackageAssessment): boolean => a.plan.quiet && a.warnings.length === 0
