import type { ElementType, ReactNode } from "react"
import { cn } from "@/lib/utils"

export type DecisionSeverity = "red" | "amber" | "blue"

export const SEVERITY_TILE: Record<DecisionSeverity, string> = {
  red: "bg-destructive/10 text-destructive",
  amber: "bg-warning/10 text-warning",
  blue: "bg-module/10 text-module",
}

/** One computed decision (PRD S-16): it appears and disappears with its cause —
 * a severity tile, what it is, why, how old, what it costs, and the one action. */
export function DecisionRow({
  severity,
  icon: Icon,
  title,
  detail,
  age,
  amount,
  action,
  className,
}: {
  severity: DecisionSeverity
  icon: ElementType
  title: ReactNode
  detail?: ReactNode
  /** Already worded ("3 days"), shown as a chip. */
  age?: string
  /** Already formatted, isolated left-to-right by the caller's formatter. */
  amount?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <li className={cn("flex flex-wrap items-start gap-3 px-4 py-3", className)}>
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", SEVERITY_TILE[severity])}>
        <Icon size={17} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm font-bold leading-snug text-foreground" dir="auto">
          {title}
        </p>
        {detail && (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground" dir="auto">
            {detail}
          </p>
        )}
        {(age || amount) && (
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            {age && <span className="rounded-md bg-muted px-1.5 py-0.5 font-semibold text-muted-foreground">{age}</span>}
            {amount && <span className="font-bold tabular-nums text-foreground">{amount}</span>}
          </p>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center">{action}</div>}
    </li>
  )
}
