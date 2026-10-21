// Procurement 2.0 — the package: the BASE (Procurement + Inventory, always on) and three connectors the admin opens per
// subscriber. A connector is not a new switch: it IS one of the company's existing module switches
// (`companyModules/{orgId}.off`), so the eight states are read from the list that is already stored. A company with no
// document is the full package. Pure; the connector texts live in `Portal.ProcPackage`.

import { withDependents, type OptionalModule } from "@/lib/company-modules"
import type { PipelineUnit } from "./package-data"

export const CONNECTORS = ["pm", "fin", "mfg"] as const
export type Connector = (typeof CONNECTORS)[number]
export type PackageFlags = Record<Connector, boolean>

export const CONNECTOR_SWITCH: Record<Connector, OptionalModule> = {
  pm: "project-management",
  fin: "payments",
  mfg: "manufacturing",
}

export const FULL_PACKAGE: PackageFlags = { pm: true, fin: true, mfg: true }
export const BASE_PACKAGE: PackageFlags = { pm: false, fin: false, mfg: false }

/** The package a stored `off` list means. */
export function packageOf(off: readonly string[] | null | undefined): PackageFlags {
  const list = Array.isArray(off) ? off : []
  return {
    pm: !list.includes(CONNECTOR_SWITCH.pm),
    fin: !list.includes(CONNECTOR_SWITCH.fin),
    mfg: !list.includes(CONNECTOR_SWITCH.mfg),
  }
}

export const connectorOn = (off: readonly string[] | null | undefined, conn: Connector): boolean => packageOf(off)[conn]

/**
 * The `off` list for a package, keeping every other switch of the company as it was (HR). A module that needs an off
 * one goes with it (`withDependents`: HR goes off with Finance), so the list a package saves is the list it implies.
 */
export function offFor(pkg: PackageFlags, current: readonly string[] | null | undefined = []): string[] {
  const switches: string[] = CONNECTORS.map((c) => CONNECTOR_SWITCH[c])
  const kept = (Array.isArray(current) ? current : []).filter((id) => !switches.includes(id)) as OptionalModule[]
  const closed = CONNECTORS.filter((c) => !pkg[c]).map((c) => CONNECTOR_SWITCH[c])
  return Array.from(withDependents([...kept, ...closed], "contractor"))
}

export const samePackage = (a: PackageFlags, b: PackageFlags): boolean => CONNECTORS.every((c) => a[c] === b[c])

export const connectorsOf = (pkg: PackageFlags): Connector[] => CONNECTORS.filter((c) => pkg[c])

export const PACKAGE_STATE_IDS = ["full", "base", "pm", "fin", "mfg", "pm_fin", "pm_mfg", "fin_mfg"] as const
export type PackageStateId = (typeof PACKAGE_STATE_IDS)[number]

export interface PackageState {
  id: PackageStateId
  pkg: PackageFlags
}

const flags = (...on: Connector[]): PackageFlags => ({ pm: on.includes("pm"), fin: on.includes("fin"), mfg: on.includes("mfg") })

/** The eight combinations of the three connectors, in the order the prototype lists them. */
export const PACKAGE_STATES: readonly PackageState[] = [
  { id: "full", pkg: flags("pm", "fin", "mfg") },
  { id: "fin", pkg: flags("fin") },
  { id: "pm", pkg: flags("pm") },
  { id: "pm_fin", pkg: flags("pm", "fin") },
  { id: "fin_mfg", pkg: flags("fin", "mfg") },
  { id: "mfg", pkg: flags("mfg") },
  { id: "base", pkg: flags() },
  { id: "pm_mfg", pkg: flags("pm", "mfg") },
]

export function packageStateOf(pkg: PackageFlags): PackageStateId {
  return (PACKAGE_STATES.find((s) => samePackage(s.pkg, pkg)) as PackageState).id
}

export const PRESET_IDS = ["base", "contractor_no_accounting", "contractor", "factory", "full"] as const
export type PresetId = (typeof PRESET_IDS)[number]

/** The admin's shortcuts. Their commercial names are provisional (open decision 06). */
export const PRESETS: ReadonlyArray<{ id: PresetId; pkg: PackageFlags }> = [
  { id: "base", pkg: flags() },
  { id: "contractor_no_accounting", pkg: flags("pm") },
  { id: "contractor", pkg: flags("pm", "fin") },
  { id: "factory", pkg: flags("fin", "mfg") },
  { id: "full", pkg: flags("pm", "fin", "mfg") },
]

type Translate = (key: string, values?: Record<string, string | number>) => string

/** «الكاملة» · «الأساسية» · «الأساسية + المشاريع + المالية» — the package's name, from `Portal.ProcPackage`. */
export function packageLabel(pkg: PackageFlags, t: Translate): string {
  const on = connectorsOf(pkg)
  if (on.length === CONNECTORS.length) return t("label.full")
  if (!on.length) return t("label.base")
  return t("label.plus", { names: on.map((c) => t(`conn.${c}.short`)).join(" + ") })
}

/** «المشتريات وحدها (مع المخزون)» or «المشتريات + المشاريع …». */
export function packageTitle(pkg: PackageFlags, t: Translate): string {
  const on = connectorsOf(pkg)
  return on.length ? t("title.with", { names: on.map((c) => t(`conn.${c}.short`)).join(" + ") }) : t("title.alone")
}

export interface ConnectorTexts {
  name: string
  short: string
  question: string
  adds: string[]
  without: string[]
  onRule: string
  offRule: string
}

const TEXT_COUNTS: Record<Connector, { adds: number; without: number }> = {
  pm: { adds: 3, without: 2 },
  fin: { adds: 3, without: 3 },
  mfg: { adds: 3, without: 1 },
}

export function connectorTexts(conn: Connector, t: Translate): ConnectorTexts {
  const count = TEXT_COUNTS[conn]
  const list = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => t(`conn.${conn}.${prefix}${i + 1}`))
  return {
    name: t(`conn.${conn}.name`),
    short: t(`conn.${conn}.short`),
    question: t(`conn.${conn}.question`),
    adds: list("add", count.adds),
    without: list("without", count.without),
    onRule: t(`conn.${conn}.on`),
    offRule: t(`conn.${conn}.off`),
  }
}

/** Whether a unit's events are sent: the base always; a connector's only while it is in the package. */
export function unitIn(unit: PipelineUnit, pkg: PackageFlags): boolean {
  return unit === "core" || unit === "inv" ? true : pkg[unit]
}
