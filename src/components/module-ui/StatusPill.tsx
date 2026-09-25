import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type PillTone = "ok" | "warn" | "bad" | "info" | "mute" | "module" | "violet"

export const PILL_TONE: Record<PillTone, string> = {
  ok: "bg-success/10 text-success",
  warn: "bg-warning/10 text-warning",
  bad: "bg-destructive/10 text-destructive",
  info: "bg-cta/10 text-cta",
  mute: "bg-muted text-muted-foreground",
  module: "bg-module/10 text-module",
  violet: "bg-violet/10 text-violet",
}

/** A state in a word — one tone per meaning, used on every screen alike. */
export function StatusPill({ tone, children, className }: { tone: PillTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold [unicode-bidi:isolate]", PILL_TONE[tone], className)}>
      {children}
    </span>
  )
}
