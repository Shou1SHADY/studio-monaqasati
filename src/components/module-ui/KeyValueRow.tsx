import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** A label and its value on one line — the drawer's and the review step's row. */
export function KeyValueRow({ label, value, ltr, strong, className }: { label: ReactNode; value: ReactNode; ltr?: boolean; strong?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 border-b border-border/60 py-2 text-sm last:border-b-0", className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-end tabular-nums", strong ? "font-black text-foreground" : "font-semibold text-foreground")} dir={ltr ? "ltr" : "auto"}>
        {value}
      </span>
    </div>
  )
}
