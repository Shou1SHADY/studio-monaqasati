import type { ElementType, ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * What an empty list says: what would be here, and the one way to fill it.
 *
 * `bare` (PM 1.1 UX-17): inside a `Panel`, which already draws the frame — no dashed box of its own, less height.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  bare,
  className,
}: {
  icon: ElementType
  title: string
  description?: string
  action?: ReactNode
  bare?: boolean
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 text-center", bare ? "px-4 py-6" : "rounded-xl border border-dashed bg-muted/30 px-6 py-10", className)}>
      <span className={cn("grid place-items-center bg-module/10 text-module", bare ? "h-10 w-10 rounded-xl" : "h-12 w-12 rounded-2xl")}>
        <Icon size={bare ? 18 : 22} aria-hidden="true" />
      </span>
      <p className="text-sm font-bold text-foreground">{title}</p>
      {description && <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
