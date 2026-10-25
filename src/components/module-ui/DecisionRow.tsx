import type { ElementType, ReactNode } from "react"
import { cn } from "@/lib/utils"

export type DecisionSeverity = "red" | "amber" | "blue"

export const SEVERITY_TILE: Record<DecisionSeverity, string> = {
  red: "bg-destructive/10 text-destructive",
  amber: "bg-warning/10 text-warning",
  blue: "bg-module/10 text-module",
}

const ageTone = (ageDays?: number) => ((ageDays ?? 0) > 21 ? "bg-destructive/10 text-destructive" : (ageDays ?? 0) > 7 ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground")

/**
 * One computed decision (PRD S-16): it appears and disappears with its cause —
 * a severity tile, what it is, why, how old, what it costs, and the one action.
 *
 * `dense` (PM 1.1 UX-13, the prototype's `.todo`): from `sm` ONE line of about 60 px — tile · title over a one-line
 * detail · the age chip and the amount inline · the action at the end (give it `size="sm"`). On a phone the age and
 * amount drop under the text, aligned with it, so the action never leaves the screen. Without `dense` the row stacks
 * title, detail and meta as before (HR Today keeps it).
 */
export function DecisionRow({
  severity,
  icon: Icon,
  title,
  detail,
  age,
  ageDays,
  amount,
  action,
  dense,
  className,
}: {
  severity: DecisionSeverity
  icon: ElementType
  title: ReactNode
  detail?: ReactNode
  /** Already worded ("3 days"), shown as a chip. */
  age?: string
  /** How old the cause is, in days: the chip turns amber after 7, red after 21. */
  ageDays?: number
  /** Already formatted, isolated left-to-right by the caller's formatter. */
  amount?: ReactNode
  action?: ReactNode
  /** One line from `sm`, meta inline before the action. */
  dense?: boolean
  className?: string
}) {
  const ageChip = age && <span className={cn("rounded-md px-1.5 py-0.5 font-semibold", ageTone(ageDays))}>{age}</span>

  if (dense)
    return (
      <li data-dense="" className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:flex-nowrap", className)}>
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", SEVERITY_TILE[severity])}>
          <Icon size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 basis-40">
          <p className="line-clamp-2 text-sm font-bold leading-snug text-foreground sm:line-clamp-1" dir="auto">
            {title}
          </p>
          {detail && (
            <p className="line-clamp-1 text-xs leading-relaxed text-muted-foreground" dir="auto">
              {detail}
            </p>
          )}
        </div>
        {(age || amount) && (
          <p className="flex shrink-0 items-center gap-2 text-xs max-sm:order-last max-sm:w-full max-sm:ps-11">
            {ageChip}
            {amount && <span className="whitespace-nowrap font-bold tabular-nums text-foreground">{amount}</span>}
          </p>
        )}
        {action && <div className="flex shrink-0 items-center">{action}</div>}
      </li>
    )

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
            {ageChip}
            {amount && <span className="font-bold tabular-nums text-foreground">{amount}</span>}
          </p>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center">{action}</div>}
    </li>
  )
}
