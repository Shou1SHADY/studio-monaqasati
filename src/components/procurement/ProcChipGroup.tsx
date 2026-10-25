"use client"

// The segment selector every Procurement list opens with (the reference
// prototype's chip group): one bordered strip, each segment with its count,
// the chosen one lifted in the module's colour. It stays ONE row: when the
// width runs out the strip scrolls sideways instead of wrapping a lone segment
// onto a second line.

import type { ElementType } from "react"
import { cn } from "@/lib/utils"

export function ProcChipGroup<T extends string>({
  items,
  active,
  onPick,
  label,
  dimmed,
}: {
  items: Array<{ id: T; label: string; count?: number; icon?: ElementType }>
  active: T
  onPick: (id: T) => void
  label: string
  /** A search spans every segment, so none reads as chosen while it runs. */
  dimmed?: boolean
}) {
  return (
    <div className={cn("inline-flex max-w-full flex-nowrap items-center gap-1 overflow-x-auto rounded-xl border bg-card p-1 [scrollbar-width:thin]", dimmed && "opacity-60")} role="tablist" aria-label={label}>
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
              "inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors sm:min-h-9 sm:px-2.5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "bg-module/10 text-module shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {it.icon && <it.icon size={14} aria-hidden="true" />}
            {it.label}
            {it.count !== undefined && <span className="text-xs tabular-nums">{it.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
