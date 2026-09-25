"use client"

import { cn } from "@/lib/utils"

export type SegmentTone = "bad" | "warn" | "ok" | "mute"

export interface Segment {
  id: string
  label: string
  /** Computed from the data (e.g. addenda awaiting signature), never typed. */
  count?: number
  tone?: SegmentTone
  /** Shown as a small tag when the viewer can read but not change this segment. */
  readOnlyLabel?: string
}

const COUNT_TONE: Record<SegmentTone, string> = {
  bad: "bg-destructive text-destructive-foreground",
  warn: "bg-warning text-warning-foreground",
  ok: "bg-success/15 text-success",
  mute: "bg-muted text-muted-foreground",
}

/** The sub-sections inside a tab — at most five (PRD §5), each only if its section is on. */
export function SegmentedNav({
  segments,
  active,
  onSelect,
  ariaLabel,
}: {
  segments: Segment[]
  active: string
  onSelect: (id: string) => void
  ariaLabel: string
}) {
  if (segments.length < 2) return null
  return (
    <div role="tablist" aria-label={ariaLabel} className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:thin] sm:mx-0 sm:px-0">
      {segments.map((s) => {
        const on = s.id === active
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(s.id)}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-bold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              on ? "border-module bg-module text-module-foreground" : "border-border bg-card text-muted-foreground hover:border-module/40 hover:text-foreground"
            )}
          >
            {s.label}
            {s.count !== undefined && s.count > 0 && (
              <span className={cn("min-w-5 rounded-full px-1.5 text-center text-[11px] tabular-nums leading-5", on ? "bg-white/20 text-module-foreground" : COUNT_TONE[s.tone ?? "mute"])}>{s.count}</span>
            )}
            {s.readOnlyLabel && <span className={cn("rounded px-1 text-[10px] font-semibold", on ? "bg-white/20" : "bg-muted")}>{s.readOnlyLabel}</span>}
          </button>
        )
      })}
    </div>
  )
}
