"use client"

import { cn } from "@/lib/utils"

export type SegmentTone = "bad" | "warn" | "ok" | "mute"

export interface Segment {
  id: string
  label: string
  /** Computed from the data (e.g. addenda awaiting signature), never typed; "!" is a state, not a number. */
  count?: number | "!"
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

/** In the tray the track is already muted: a quiet count takes the module's tint instead of disappearing into it. */
const TRAY_COUNT_TONE: Record<SegmentTone, string> = { ...COUNT_TONE, mute: "bg-module/10 text-module" }

/**
 * The sub-sections inside a tab — at most five (PRD §5), each only if its section is on.
 *
 * `variant`:
 * - `pills` (default — HR, Procurement, the free supplier): separate rounded pills, the chosen one filled in the module's
 *   colour; one row that scrolls sideways when the width runs out.
 * - `tray` (PM 1.1 UX-07): one muted track with the chosen segment lifted white — quieter than the group rail above it and
 *   unlike the filter chips below it, so navigation and filtering no longer look alike. It WRAPS instead of scrolling, so a
 *   phone never cuts a label, and its segments are 44 px tall on a phone, 36 px from `sm`.
 */
export function SegmentedNav({
  segments,
  active,
  onSelect,
  ariaLabel,
  variant = "pills",
  className,
}: {
  segments: Segment[]
  active: string
  onSelect: (id: string) => void
  ariaLabel: string
  variant?: "pills" | "tray"
  className?: string
}) {
  if (segments.length < 2) return null
  const tray = variant === "tray"
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      data-variant={variant}
      className={cn(
        tray
          ? "inline-flex max-w-full flex-wrap items-center gap-1 rounded-xl bg-muted p-1"
          : "-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:thin] sm:mx-0 sm:px-0",
        className
      )}
    >
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
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              tray
                ? cn("min-h-11 rounded-lg px-3 text-[13px] font-semibold sm:min-h-9", on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:bg-card/60 hover:text-foreground")
                : cn("min-h-11 rounded-full border px-3.5 text-sm font-bold", on ? "border-module bg-module text-module-foreground" : "border-border bg-card text-muted-foreground hover:border-module/40 hover:text-foreground")
            )}
          >
            {s.label}
            {s.count !== undefined && (s.count === "!" || s.count > 0) && (
              <span className={cn("min-w-5 rounded-full px-1.5 text-center text-[11px] tabular-nums leading-5", tray ? TRAY_COUNT_TONE[s.tone ?? "mute"] : on ? "bg-white/20 text-module-foreground" : COUNT_TONE[s.tone ?? "mute"])}>{s.count}</span>
            )}
            {s.readOnlyLabel && <span className={cn("rounded px-1 text-[10px] font-semibold", tray ? "bg-background/70" : on ? "bg-white/20" : "bg-muted")}>{s.readOnlyLabel}</span>}
          </button>
        )
      })}
    </div>
  )
}
