import type { ReactNode } from "react"
import { AlertTriangle, Ban, Info } from "lucide-react"
import { cn } from "@/lib/utils"

export type CalloutTone = "info" | "warn" | "block"

const TONE: Record<CalloutTone, { box: string; icon: typeof Info }> = {
  info: { box: "border-cta/20 bg-cta/5 text-foreground", icon: Info },
  warn: { box: "border-warning/25 bg-warning/5 text-foreground", icon: AlertTriangle },
  block: { box: "border-destructive/25 bg-destructive/5 text-foreground", icon: Ban },
}

const ICON_TONE: Record<CalloutTone, string> = { info: "text-cta", warn: "text-warning", block: "text-destructive" }

/** A sentence the screen needs you to read. `block` says why something cannot be saved;
 * `warn` saves and tells you (PRD S-08: money and custody block, paperwork warns). */
export function Callout({ tone, title, children, className }: { tone: CalloutTone; title?: ReactNode; children: ReactNode; className?: string }) {
  const Icon = TONE[tone].icon
  return (
    <div role={tone === "block" ? "alert" : "note"} className={cn("flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-relaxed", TONE[tone].box, className)}>
      <Icon size={17} className={cn("mt-0.5 shrink-0", ICON_TONE[tone])} aria-hidden="true" />
      <div className="min-w-0">
        {title && <p className="font-bold">{title}</p>}
        <div className={cn(title && "mt-0.5 text-muted-foreground")}>{children}</div>
      </div>
    </div>
  )
}
