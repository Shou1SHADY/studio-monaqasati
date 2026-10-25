import type { ElementType, ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * A titled block of a screen: header with an optional icon, count and actions, then its body.
 *
 * `description` (PM 1.1 UX-14) is the panel's subtitle — «3 عاجلة · أقدمها منذ 12 يوماً», «what this list is» — set
 * INLINE in the header after the title from `sm` (one line, cut with an ellipsis), and under the title on a phone. Use it
 * instead of a bordered `<p className="border-b px-4 py-2 text-xs …">` row of its own under the header: that row cost every
 * panel a band of height.
 */
export function Panel({
  title,
  icon: Icon,
  count,
  countTone = "mute",
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode
  icon?: ElementType
  count?: number
  /** Red when something in the count is urgent (the prototype's `.n r`); green when all is well (`.n g`). */
  countTone?: "mute" | "bad" | "ok"
  /** The subtitle, inline after the title (below it on a phone). Already worded. */
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  const heading = (
    <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold text-foreground">
      {Icon && <Icon size={16} className="shrink-0 text-module" aria-hidden="true" />}
      <span className="truncate">{title}</span>
      {count !== undefined && (
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums", countTone === "bad" ? "bg-destructive text-destructive-foreground" : countTone === "ok" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{count}</span>
      )}
    </h3>
  )
  return (
    <section className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        {description ? (
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
            {heading}
            <p className="min-w-0 text-xs text-muted-foreground sm:line-clamp-2" dir="auto" data-panel-description="">
              {description}
            </p>
          </div>
        ) : (
          heading
        )}
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  )
}
