import type { ElementType, ReactNode } from "react"
import { cn } from "@/lib/utils"

/** A titled block of a screen: header with an optional icon, count and actions, then its body. */
export function Panel({
  title,
  icon: Icon,
  count,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode
  icon?: ElementType
  count?: number
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold text-foreground">
          {Icon && <Icon size={16} className="shrink-0 text-module" aria-hidden="true" />}
          <span className="truncate">{title}</span>
          {count !== undefined && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">{count}</span>}
        </h3>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  )
}
