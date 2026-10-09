// Switching a module off while it still has unfinished items in flight (decided 8 Oct 2026): the admin is told
// what is pending, in numbers, and confirms. Nothing is deleted: a pending item stays in the data and comes back
// when the module is switched on again. Pure: the counting itself lives in the admin API.

import type { OptionalModule } from "./company-modules"

export const PENDING_KEYS = {
  "project-management": ["plant", "handover"],
  hr: ["exits", "advances", "payroll"],
  manufacturing: ["notes", "requests"],
} as const satisfies Record<OptionalModule, readonly string[]>

export type PendingKey = (typeof PENDING_KEYS)[OptionalModule][number]

export interface PendingItem {
  key: PendingKey
  count: number
}

export type PendingByModule = Partial<Record<OptionalModule, PendingItem[]>>

const known = (module: OptionalModule, key: unknown): key is PendingKey => (PENDING_KEYS[module] as readonly unknown[]).includes(key)

/** What came back from the API, cleaned: only known modules and keys, only positive whole counts. */
export function readPending(data: unknown): PendingByModule {
  const out: PendingByModule = {}
  if (!data || typeof data !== "object") return out
  for (const module of Object.keys(PENDING_KEYS) as OptionalModule[]) {
    const raw = (data as Record<string, unknown>)[module]
    if (!Array.isArray(raw)) continue
    const items = raw
      .filter((i): i is { key: unknown; count: unknown } => Boolean(i) && typeof i === "object")
      .filter((i) => known(module, i.key) && typeof i.count === "number" && Number.isFinite(i.count) && i.count > 0)
      .map((i) => ({ key: i.key as PendingKey, count: Math.floor(i.count as number) }))
    if (items.length) out[module] = items
  }
  return out
}

/** The warnings to show: what is pending in the modules this save would switch OFF (a module already off warns nobody). */
export function warningsFor(before: ReadonlySet<OptionalModule>, after: ReadonlySet<OptionalModule>, pending: PendingByModule): Array<{ module: OptionalModule; items: PendingItem[] }> {
  return (Object.keys(PENDING_KEYS) as OptionalModule[])
    .filter((m) => after.has(m) && !before.has(m) && (pending[m]?.length ?? 0) > 0)
    .map((module) => ({ module, items: pending[module] ?? [] }))
}
