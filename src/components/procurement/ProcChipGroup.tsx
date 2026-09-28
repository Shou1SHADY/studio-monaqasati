"use client"

// The segment selector every Procurement list opens with (the reference
// prototype's chip group): one bordered strip, each segment with its count,
// the chosen one lifted in the module's colour.

import { cn } from "@/lib/utils"

export function ProcChipGroup<T extends string>({
  items,
  active,
  onPick,
  label,
  dimmed,
}: {
  items: Array<{ id: T; label: string; count?: number }>
  active: T
  onPick: (id: T) => void
  label: string
  /** A search spans every segment, so none reads as chosen while it runs. */
  dimmed?: boolean
}) {
  return (
    <div className={cn("inline-flex max-w-full flex-wrap items-center gap-1 rounded-xl border bg-card p-1", dimmed && "opacity-60")} role="tablist" aria-label={label}>
      {items.map((it) => {
        const on = it.id === active && !dimmed
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onPick(it.id)}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "bg-module/10 text-module shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {it.label}
            {it.count !== undefined && <span className="text-xs tabular-nums">{it.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
